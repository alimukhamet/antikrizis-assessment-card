import {createHash} from 'node:crypto';
import {ENGINE_VERSION} from '../lib/browser-ocr/config.mjs';

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const productionModelUrl=file=>`https://assessment.anti-krizis.kz/browser-ocr-assets/${ENGINE_VERSION}/${file}`;

export async function downloadVerifiedModel(asset,send=fetch) {
  const fetchVerified=async url=>{
    const response=await send(url,{signal:AbortSignal.timeout(180_000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.byteLength!==asset.bytes || digest(bytes)!==asset.sha256)throw new Error(`OCR model integrity mismatch: ${asset.file}`);
    return bytes;
  };
  try {
    return {bytes:await fetchVerified(asset.url),source:'official'};
  } catch(primaryError) {
    try {
      return {bytes:await fetchVerified(productionModelUrl(asset.file)),source:'production'};
    } catch(fallbackError) {
      throw new AggregateError([primaryError,fallbackError],`OCR model download failed from both verified sources: ${asset.file}`);
    }
  }
}
