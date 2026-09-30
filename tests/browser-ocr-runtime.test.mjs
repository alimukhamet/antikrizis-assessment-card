import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserOcr, ENGINE_VERSION } from '../lib/browser-ocr/browser-ocr.mjs';

function setup(options={}) {
  const workers=[];
  const runtime=createBrowserOcr({...options,workerFactory(url){const worker={url,terminated:false,messages:[],postMessage(message){this.messages.push(message);},terminate(){this.terminated=true;},reply(data){this.onmessage({data});}};workers.push(worker);return worker;}});
  return {runtime,workers};
}
const page={width:100,height:100};

test('OCR is lazy, processes only one page, and keeps the worker ready for the next page',async()=>{
  const {runtime,workers}=setup();assert.equal(workers.length,0);
  const first=runtime.recognizePage(page);assert.equal(workers.length,1);
  await assert.rejects(runtime.recognizePage(page),/one page/);
  workers[0].reply({id:99,result:{text:'wrong'}});
  workers[0].reply({id:1,result:{text:'первая'}});assert.deepEqual(await first,{text:'первая'});
  const next=runtime.recognizePage(page);assert.equal(workers.length,1);
  workers[0].reply({id:2,result:{text:'вторая'}});assert.equal((await next).text,'вторая');
  assert.ok(workers[0].url.pathname.includes(ENGINE_VERSION));runtime.dispose();
});
test('Abort releases inference immediately and a later page starts a fresh worker',async()=>{
  const {runtime,workers}=setup();const controller=new AbortController();
  const first=runtime.recognizePage(page,{signal:controller.signal});const rejected=assert.rejects(first,{name:'AbortError'});
  controller.abort();await rejected;assert.equal(workers[0].terminated,true);
  const next=runtime.recognizePage(page);assert.equal(workers.length,2);
  workers[0].reply({id:1,result:{text:'late'}});
  workers[1].reply({id:2,result:{text:'new'}});assert.equal((await next).text,'new');runtime.dispose();
});
test('Failed initialization can be retried, while dispose prevents future work',async()=>{
  const {runtime,workers}=setup();const first=runtime.recognizePage(page);
  workers[0].reply({id:1,error:'asset unavailable'});await assert.rejects(first,/asset unavailable/);assert.ok(workers[0].terminated);
  const second=runtime.recognizePage(page);workers[1].reply({id:2,result:{text:'ok'}});await second;
  runtime.dispose();runtime.dispose();await assert.rejects(runtime.recognizePage(page),/disposed/);
});
test('Oversized and already cancelled pages do not load models or start a worker',async()=>{
  const {runtime,workers}=setup();const controller=new AbortController();controller.abort();
  await assert.rejects(runtime.recognizePage(page,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(runtime.recognizePage({width:3000,height:100}),/supported size/);
  await assert.rejects(runtime.recognizePage({width:2500,height:2500}),/supported size/);
  assert.equal(workers.length,0);runtime.dispose();
});
test('A broken progress renderer does not lose completed OCR',async()=>{
  const {runtime,workers}=setup({onProgress(){throw Error('detached DOM');}});
  const result=runtime.recognizePage(page);workers[0].reply({id:1,progress:{stage:'loading'}});workers[0].reply({id:1,result:{text:'saved'}});
  assert.equal((await result).text,'saved');runtime.dispose();
});
test('Worker failure rejects pending work and releases worker',async()=>{
  const {runtime,workers}=setup();const result=runtime.recognizePage(page);workers[0].onerror();
  await assert.rejects(result,/устройстве/);assert.ok(workers[0].terminated);runtime.dispose();
});
