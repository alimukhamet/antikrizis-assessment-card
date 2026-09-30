export const ENGINE_VERSION = 'paddleocr-js-0.4.2-cyrillic-v1';
export const MAX_PAGE_PIXELS = 4_500_000;
export const MAX_PAGE_SIDE = 2600;
export const MODEL_ASSETS = Object.freeze([
  {file:'detection.tar', model:'PP-OCRv5_mobile_det', bytes:4843520, sha256:'781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30', url:'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar'},
  {file:'cyrillic.tar', model:'cyrillic_PP-OCRv5_mobile_rec', bytes:8079360, sha256:'3f5657de92e90edeb63483424aadcf19caee571b45d35af75a163a2ca576a260', url:'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/cyrillic_PP-OCRv5_mobile_rec_onnx_infer.tar'},
]);
