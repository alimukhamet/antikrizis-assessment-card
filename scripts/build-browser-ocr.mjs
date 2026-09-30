import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ENGINE_VERSION, MODEL_ASSETS } from '../lib/browser-ocr/config.mjs';
const root=path.resolve(import.meta.dirname,'..');
const target=path.join(root,'public/browser-ocr-assets');
const versionTarget=path.join(target,ENGINE_VERSION);
const cache=path.join(root,'node_modules/.cache/browser-ocr-models');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(versionTarget,{recursive:true});
await fs.mkdir(cache,{recursive:true});

for(const asset of MODEL_ASSETS) {
  const cached=path.join(cache,asset.sha256+'.tar');
  let bytes=await fs.readFile(cached).catch(()=>null);
  if(!bytes || bytes.byteLength!==asset.bytes || digest(bytes)!==asset.sha256) {
    const response=await fetch(asset.url,{signal:AbortSignal.timeout(180_000)});
    if(!response.ok) throw new Error(`OCR model download failed: ${asset.file} (${response.status})`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.byteLength!==asset.bytes || digest(bytes)!==asset.sha256) throw new Error(`OCR model integrity mismatch: ${asset.file}`);
    await fs.writeFile(cached,bytes);
  }
  await fs.writeFile(path.join(versionTarget,asset.file),bytes);
}
const ortDist=path.dirname(fileURLToPath(import.meta.resolve('onnxruntime-web')));
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) {
  await fs.copyFile(path.join(ortDist,name),path.join(versionTarget,name));
}
await build({entryPoints:[path.join(root,'lib/browser-ocr/browser-ocr.mjs')],outfile:path.join(target,'browser-ocr.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await build({entryPoints:[path.join(root,'lib/browser-ocr/worker.mjs')],outfile:path.join(versionTarget,'worker.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,alias:{'onnxruntime-web':'onnxruntime-web/wasm'},external:['fs','path'],legalComments:'eof'});
// Browser-only OpenCV has unreachable Node branches; fs/path must never be fetched.
const packages=[['@paddleocr/paddleocr-js','LICENSE'],['@techstark/opencv-js','LICENSE'],['onnxruntime-web','LICENSE'],['clipper-lib','License.txt'],['js-yaml','LICENSE']];
const licenses=[];
for(const [name,file] of packages) {
  let dir=path.dirname(fileURLToPath(import.meta.resolve(name)));
  while(dir!==path.dirname(dir)) {
    try { const pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8')); if(pkg.name===name)break; } catch {}
    dir=path.dirname(dir);
  }
  const text=await fs.readFile(path.join(dir,file),'utf8').catch(()=>null);
  if(text) licenses.push(`${name}\n${text}`);
  else if(name==='@paddleocr/paddleocr-js') licenses.push('PaddleOCR.js and PaddleOCR models\n'+await fs.readFile(path.join(root,'lib/browser-ocr/licenses/paddle.txt'),'utf8'));
  else if(name==='onnxruntime-web') licenses.push(await fs.readFile(path.join(root,'lib/browser-ocr/licenses/onnxruntime.txt'),'utf8'));
  else if(name==='clipper-lib') licenses.push('Clipper 6.4.2. Copyright Angus Johnson 2010-2017; Javascript port by Timo; JSBN by Tom Wu.\n'+await fs.readFile(path.join(root,'lib/browser-ocr/licenses/boost.txt'),'utf8'));
  else throw new Error(`Missing dependency license: ${name}`);
}
licenses.push(await fs.readFile(path.join(root,'lib/browser-ocr/licenses/jsbn.txt'),'utf8'));
await fs.writeFile(path.join(versionTarget,'LICENSES.txt'),licenses.join('\n\n--------------------\n\n'));
const files=[];
for(const name of (await fs.readdir(versionTarget)).sort()) {
  const bytes=await fs.readFile(path.join(versionTarget,name));
  if(bytes.length>25*1024*1024) throw new Error(`Cloudflare static asset too large: ${name}`);
  files.push({name,bytes:bytes.length,sha256:digest(bytes)});
}
await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify({engineVersion:ENGINE_VERSION,versionPath:ENGINE_VERSION,models:MODEL_ASSETS.map(({file,model,sha256,bytes})=>({file,model,sha256,bytes})),files},null,2)+'\n');
console.log(`Local browser OCR assets prepared (${files.reduce((sum,file)=>sum+file.bytes,0)} bytes).`);
