import { PaddleOCR } from '@paddleocr/paddleocr-js';
import cvModule from '@techstark/opencv-js';
import { ENGINE_VERSION, MAX_PAGE_PIXELS, MAX_PAGE_SIDE, MODEL_ASSETS } from './config.mjs';

let engine;
let busy = false;
const base = new URL('./', self.location.href);
const cacheName = `profile-ocr-assets-${ENGINE_VERSION}`;

async function assetFetch(input) {
  const url = new URL(typeof input === 'string' ? input : input.url, base);
  if (url.origin !== self.location.origin || !url.href.startsWith(base.href)) throw new Error('Unexpected OCR model URL.');
  let cache;
  try { cache=await caches.open(cacheName); const saved=await cache.match(url.href); if(saved) return saved; } catch { /* Private mode can disable CacheStorage. HTTP caching still applies. */ }
  const response=await fetch(url,{credentials:'same-origin',cache:'force-cache'});
  if(!response.ok) throw new Error('Не удалось загрузить модуль распознавания. Попробуйте ещё раз.');
  if(cache) { try { await cache.put(url.href,response.clone()); } catch { /* A full browser cache must not prevent OCR. */ } }
  return response;
}

async function initialize() {
  if(engine) return engine;
  engine=await PaddleOCR.create({
    worker:false,
    textDetectionModelName:MODEL_ASSETS[0].model,
    textDetectionModelAsset:{url:new URL(MODEL_ASSETS[0].file,base).href},
    textRecognitionModelName:MODEL_ASSETS[1].model,
    textRecognitionModelAsset:{url:new URL(MODEL_ASSETS[1].file,base).href},
    textDetectionBatchSize:1,
    textRecognitionBatchSize:1,
    ortOptions:{backend:'wasm',wasmPaths:base.href,numThreads:1,proxy:false},
    fetch:assetFetch,
  });
  return engine;
}

async function toImageData(image) {
  if(image instanceof ImageData) return image;
  const bitmap=await createImageBitmap(image);
  try {
    if(bitmap.width>MAX_PAGE_SIDE || bitmap.height>MAX_PAGE_SIDE || bitmap.width*bitmap.height>MAX_PAGE_PIXELS) throw new Error('OCR page exceeds the supported size.');
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context) throw new Error('Browser canvas is unavailable.');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0);
    return context.getImageData(0,0,canvas.width,canvas.height);
  } finally { bitmap.close(); }
}

self.onmessage=async({data})=>{
  const {id,image}=data;
  if(busy) { self.postMessage({id,error:'OCR is already processing a page.'});return; }
  busy=true;
  let sourceMat;
  try {
    const started=performance.now();
    if(!engine) self.postMessage({id,progress:{stage:'loading',message:'Подготовка распознавания на устройстве…'}});
    const ocr=await initialize();
    const source=await toImageData(image);
    if(source.width>MAX_PAGE_SIDE || source.height>MAX_PAGE_SIDE || source.width*source.height>MAX_PAGE_PIXELS) throw new Error('OCR page exceeds the supported size.');
    // Emscripten's legacy module is thenable; awaiting it directly loops forever.
    // PaddleOCR initialization above has already made its cv.Mat API ready.
    const cv=cvModule instanceof Promise ? await cvModule : cvModule;
    sourceMat=cv.matFromImageData(source);
    self.postMessage({id,progress:{stage:'recognizing',message:'Чтение страницы на устройстве…'}});
    const [result]=await ocr.predict(sourceMat,{textDetLimitSideLen:1280,textDetLimitType:'max',textRecScoreThresh:0.5});
    const lines=result.items.map(item=>({text:String(item.text).normalize('NFKC'),confidence:Number(item.score),box:item.poly}));
    self.postMessage({id,result:{engineVersion:ENGINE_VERSION,text:lines.map(line=>line.text).join('\n'),lines,width:source.width,height:source.height,durationMs:Math.round(performance.now()-started)}});
  } catch {
    self.postMessage({id,error:'Не удалось распознать страницу. Проверьте документ вручную или повторите распознавание.'});
  } finally { sourceMat?.delete();busy=false; }
};
