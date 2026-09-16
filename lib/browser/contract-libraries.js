/* Browser-only contract dependencies. Kept separate from the approved legal template. */
const LIB_URLS = {
  pizzip: [
    'https://cdn.jsdelivr.net/npm/pizzip@3.1.7/dist/pizzip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pizzip/3.1.7/pizzip.min.js',
    'https://unpkg.com/pizzip@3.1.7/dist/pizzip.min.js'
  ],
  docxtemplater: [
    'https://cdn.jsdelivr.net/npm/docxtemplater@3.50.0/build/docxtemplater.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/docxtemplater/3.50.0/docxtemplater.min.js',
    'https://unpkg.com/docxtemplater@3.50.0/build/docxtemplater.min.js'
  ]
};
const CONTRACT_LIBRARY_TIMEOUT_MS = 8000;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('CONTRACT_LIBRARY_TIMEOUT')), CONTRACT_LIBRARY_TIMEOUT_MS);
    script.async = true;
    script.src = src;
    script.onload = () => finish();
    script.onerror = () => finish(new Error('CONTRACT_LIBRARY_UNAVAILABLE'));
    try { document.head.appendChild(script); } catch (error) { finish(error); }
  });
}
async function loadLibFromList(name, urls, check) {
  if (check()) return;
  for (const url of urls) {
    // Another renderer on the same page may already have loaded this dependency.
    if (check()) return;
    try { await loadScript(url); if (check()) return; } catch { /* Try the next pinned mirror. */ }
  }
  throw new Error('Не удалось загрузить модуль договора ' + name + '. Проверьте соединение и нажмите «Скачать договор» ещё раз. Сохранённые данные не удалены.');
}
let libsReady = null;
function ensureLibs() {
  if (!libsReady) {
    libsReady = (async () => {
      await loadLibFromList('PizZip', LIB_URLS.pizzip, () => typeof window.PizZip === 'function');
      await loadLibFromList('docxtemplater', LIB_URLS.docxtemplater, () => typeof window.docxtemplater === 'function');
    })().catch(error => {
      // Do not cache a rejection forever: retry must work without losing the form.
      libsReady = null;
      throw error;
    });
  }
  return libsReady;
}
function base64ToArrayBuffer(b64) {
  const binary = atob(b64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
