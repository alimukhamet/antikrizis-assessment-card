# Browser OCR runtime

The profile UI owns document access, PDF.js rendering, per-page leases, persisted results and employee review. This runtime recognizes a single already-rendered page on the employee's device. It never sends document bytes to an OCR provider.

```js
import {createBrowserOcr, ENGINE_VERSION} from '/browser-ocr-assets/browser-ocr.mjs';
const runtime=createBrowserOcr({onProgress({stage,message}) { /* loading / recognizing */ }});
const result=await runtime.recognizePage(imageData,{signal:abortController.signal});
// result: engineVersion, text, lines[{text,confidence,box}], width,height,durationMs
runtime.dispose();
```

`box` is a four-point polygon in rendered-image pixel coordinates. Confidence is 0–1. Text is NFKC-normalized. PDF rendering must keep each dimension at most 2,600 pixels and total area at most 4.5 million pixels. Render one page at a time; concurrent recognition requests are rejected. `dispose()` is idempotent and permanent for that instance. An aborted page terminates its worker immediately; subsequent recognition on the same undisposed runtime starts another worker. Errors or 180 seconds without completion release the worker and leave the source for manual review.

Run `node scripts/build-browser-ocr.mjs` as part of the existing build. Exact official model archives are SHA-256 checked, cached under `node_modules/.cache/browser-ocr-models`, and copied to a versioned public directory. The worker bundles PaddleOCR.js 0.4.2, OpenCV.js 4.10.0-release.1 and ONNX Runtime Web 1.30.0. Runtime model requests are same-origin and CacheStorage-backed; ORT and JavaScript use ordinary HTTP cache validators. Single-thread WASM needs no cross-origin-isolation header changes. Change `ENGINE_VERSION` when changing models, runtime, recognition settings or result semantics.

The cold static asset payload is about 37.8 MB uncompressed. Loading is lazy. Source images and OCR text are not placed into the model CacheStorage. A missing/full browser cache is tolerated. The official browser SDK's DOM image conversion is avoided by converting worker ImageData to the supported OpenCV Mat input. Do not directly await the legacy OpenCV module: it is a self-resolving Emscripten thenable.

## Verification, 30 September 2026

A private local browser trial used Chromium 154 on Apple M1, without external network requests. The production-built runtime read a real bilingual photographed salary certificate (141 lines, 9.73 seconds including startup) and a rasterized Kazakh GKB first page (65 lines, 7.87 seconds). A new worker repeated GKB in 7.17 seconds with identical text. Across these jobs only two model downloads occurred; both were retained in the model cache. Cancellation passed. Six runtime lifecycle tests cover serialization, lazy loading, cancellation/restart, failure recovery, page bounds and cleanup.

These are two-page local benchmarks, not a fleet performance or universal accuracy claim. GKB identity components, identifiers and dates were readable. The photographed document recovered identifying text and salary figures, but stamps and Kazakh letters have errors. Flat text ordering in slanted tables can interleave cells; coordinates remain available. OCR results require source review and must not silently become verified client facts, loans or evidence. Browser OCR does not itself reconstruct financial tables.

Sources: [official browser SDK](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/cross_platform/browser.en.md), [Cyrillic model](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.en.md). Third-party license notices are shipped with generated runtime assets.
