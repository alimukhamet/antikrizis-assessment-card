import { ENGINE_VERSION, MAX_PAGE_PIXELS, MAX_PAGE_SIDE } from './config.mjs';
export { ENGINE_VERSION };
export const engineVersion = ENGINE_VERSION;
const abortError = () => new DOMException('Распознавание остановлено.', 'AbortError');

/** One lazy, dedicated worker. Cancellation terminates active inference immediately. */
export function createBrowserOcr({ assetBase = '/browser-ocr-assets/', onProgress = () => {}, workerFactory } = {}) {
  const origin = globalThis.location?.origin;
  const base = new URL(assetBase, globalThis.location?.href ?? 'http://localhost/');
  if (origin && base.origin !== origin) throw new Error('OCR assets must use the current origin.');
  let worker = null;
  let active = null;
  let disposed = false;
  let nextId = 0;
  const progress = (value) => { try { onProgress(value); } catch { /* UI feedback cannot abort OCR. */ } };
  const stop = (error) => {
    worker?.terminate(); worker = null;
    if (active) { const pending = active; active = null; pending.finish(error); }
  };
  const getWorker = () => {
    if (worker) return worker;
    const url = new URL(`${ENGINE_VERSION}/worker.mjs`, base);
    worker = workerFactory ? workerFactory(url) : new Worker(url, {type:'module', name:'profile-document-ocr'});
    worker.onmessage = ({data}) => {
      if (!active || data.id !== active.id) return;
      if (data.progress) { progress(data.progress); return; }
      const pending = active; active = null;
      if (data.error) {
        worker?.terminate(); worker = null;
        pending.finish(new Error(data.error));
      } else pending.finish(null, data.result);
    };
    worker.onerror = () => stop(new Error('Не удалось запустить распознавание на этом устройстве.'));
    worker.onmessageerror = () => stop(new Error('Не удалось прочитать результат распознавания.'));
    return worker;
  };
  return {
    engineVersion: ENGINE_VERSION,
    async recognizePage(image, {signal} = {}) {
      if (disposed) throw new Error('OCR runtime is disposed.');
      if (signal?.aborted) throw abortError();
      if (active) throw new Error('OCR processes one page at a time.');
      const width=Number(image?.width), height=Number(image?.height);
      if (width && height && (width>MAX_PAGE_SIDE || height>MAX_PAGE_SIDE || width*height>MAX_PAGE_PIXELS)) throw new Error('OCR page exceeds the supported size.');
      return new Promise((resolve,reject) => {
        const id=++nextId;
        const abort=()=>stop(abortError());
        const timer=setTimeout(()=>stop(new Error('Распознавание страницы заняло слишком много времени. Попробуйте более чёткий снимок.')),180_000);
        active={id,finish(error,result){clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error) reject(error); else resolve(result);}};
        signal?.addEventListener('abort',abort,{once:true});
        try { getWorker().postMessage({id,image}); } catch(error) { stop(error); }
      });
    },
    dispose() { if (!disposed) { disposed=true; stop(abortError()); } },
  };
}
