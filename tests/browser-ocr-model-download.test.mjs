import {test} from 'node:test';
import assert from 'node:assert/strict';
import {digest,downloadVerifiedModel,productionModelUrl} from '../scripts/browser-ocr-model-download.mjs';
import {ENGINE_VERSION} from '../lib/browser-ocr/config.mjs';

const good=Buffer.from('pinned synthetic model');
const bad=Buffer.from(good);bad[0]^=1;
const asset={file:'detection.tar',url:'https://official.invalid/detection.tar',bytes:good.length,sha256:digest(good)};
const response=bytes=>new Response(bytes,{status:200});

test('official model succeeds without requesting production fallback',async()=>{
 const calls=[];
 const result=await downloadVerifiedModel(asset,async(url,options)=>{calls.push({url,options});return response(good);});
 assert.deepEqual(result,{bytes:good,source:'official'});
 assert.deepEqual(calls.map(call=>call.url),[asset.url]);
 assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('network, HTTP and integrity failures use only the exact pinned production asset',async()=>{
 for(const primary of [()=>{throw new Error('ETIMEDOUT');},()=>new Response(null,{status:503}),()=>response(bad)]){
  const calls=[];
  const result=await downloadVerifiedModel(asset,async url=>{
   calls.push(url);
   return calls.length===1?primary():response(good);
  });
  assert.equal(result.source,'production');
  assert.deepEqual(result.bytes,good);
  assert.deepEqual(calls,[asset.url,`https://assessment.anti-krizis.kz/browser-ocr-assets/${ENGINE_VERSION}/detection.tar`]);
  assert.equal(calls[1],productionModelUrl(asset.file));
 }
});

test('corrupt or unavailable production fallback fails closed',async()=>{
 for(const fallback of [()=>response(bad),()=>response(good.subarray(1)),()=>new Response(null,{status:404}),()=>{throw new Error('offline');}]){
  const calls=[];
  await assert.rejects(downloadVerifiedModel(asset,async url=>{
   calls.push(url);
   return calls.length===1?response(bad):fallback();
  }),error=>{
   assert.match(error.message,/both verified sources/);
   assert.equal(error.errors.length,2);
   assert.match(error.errors[0].message,/integrity mismatch/);
   return true;
  });
  assert.equal(calls.length,2);
 }
});
