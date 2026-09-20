import assert from 'node:assert/strict';
import {JSDOM,requestInterceptor} from 'jsdom';

// Uses the shipped renderer and its local assets with the actual saved data.
// This verifies DOCX generation, not a human opening/signing the downloaded file.
export async function renderContract(mf,origin,contract){
 const resources=requestInterceptor(async request=>{
  const url=new URL(request.url);assert.equal(url.origin,origin);assert.ok(url.pathname.startsWith('/vendor/contracts/'));
  const response=await mf.dispatchFetch(request.url);assert.equal(response.status,200);
  return new Response(await response.arrayBuffer(),{headers:{'content-type':'text/javascript'}});
 });
 const dom=new JSDOM('<!doctype html><body></body>',{url:origin,runScripts:'dangerously',resources:{interceptors:[resources]}});
 try{
  const response=await mf.dispatchFetch(origin+'/contract-renderer.js');assert.equal(response.status,200);
  const w=dom.window;w.eval(await response.text());await w.ContractRenderer.ready();
  const blob=await w.ContractRenderer.render(contract.data,contract.rendererVersion);assert.ok(blob.size>10000);
  const buffer=await new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
  const xml=new w.PizZip(buffer).file('word/document.xml').asText();
  assert.ok(xml.includes('SYNTHETIC ONLY'));assert.ok(xml.includes('TEST-NOT-FOR-SIGNING'));assert.ok(!xml.includes('{{'));assert.ok(!xml.includes('undefined'));
 }finally{dom.window.close();}
}
