import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import{createHash}from'node:crypto';
import {httpHeaders} from './bitrix-headers-helper.mjs'; function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./http-headers'?httpHeaders:imports[n],URL,Map,Set,Uint8Array,AbortSignal,AbortController,btoa,TextEncoder,ReadableStream,TransformStream,Response,fetch:()=>{throw Error('Unexpected network request')}});return exports;}
const upload=load('lib/crm/document-upload.ts',{'../documents/repository':{sha256:async b=>createHash('sha256').update(b).digest('hex')}}),{createCrmDocumentReader,createVerifiedDocumentUploadAdapter}=load('lib/crm/document-download.ts',{'./document-upload':upload});
const portal='https://crm.example',webhook=portal+'/rest/1/test/',iin='000000000010';
test('Bitrix headers identify the integration and never disclose the webhook in Referer',()=>{
 const json=httpHeaders.bitrixHeaders(webhook),file=httpHeaders.bitrixHeaders(webhook,'file');
 assert.equal(json.accept,'application/json');assert.equal(json['content-type'],'application/json');assert.ok(json['user-agent']);
 assert.equal(file.accept,'*/*');assert.equal(file.referer,portal+'/');assert.match(file['accept-language'],/ru/);assert.ok(file['user-agent']);assert.equal(JSON.stringify(file).includes('/rest/1/test'),false);
});
test('seven-file reconciliation reads the exact deal once, verifies every hash, and never writes',async()=>{
 let reads=0,downloads=0;
 const files=Array.from({length:7},(_,i)=>({id:String(i+22),urlMachine:portal+'/rest/crm.controller.item.getFile.json?token=synthetic-'+i}));
 const expected=files.map((f,i)=>({name:'synthetic-'+i+'.pdf',byteSize:1,sha256:createHash('sha256').update(new Uint8Array([i])).digest('hex')}));
 const adapter=createVerifiedDocumentUploadAdapter(webhook,'11665',iin,async(url,o)=>{
  if(o.method==='POST'){assert.match(url,/crm.item.get.json$/);assert.equal(o.headers.accept,'application/json');assert.ok(o.headers['user-agent']);reads++;return metadata({ufCrmAnkPrimaryDocs:files});}
  assert.equal(o.headers.referer,portal+'/');assert.equal(o.headers.accept,'*/*');assert.ok(o.headers['accept-language']);assert.ok(o.headers['user-agent']);downloads++;
  return new Response(new Uint8Array([Number(new URL(url).searchParams.get('token').split('-').at(-1))]));
 });
 const receipt=await adapter.reconcile('11665',iin,[],expected);
 assert.equal(receipt.verified,true);assert.equal(receipt.files.length,7);assert.equal(reads,1);assert.equal(downloads,7);
});
function metadata(patch={}){return Response.json({result:{item:{id:11665,ufCrmAiIin:iin,ufCrmAnkPrimaryDocs:[{id:22,urlMachine:portal+'/rest/crm.controller.item.getFile.json?token=synthetic'}],...patch}}});}
test('download refreshes machine link from exact deal and emits only bytes',async()=>{const calls=[];const read=createCrmDocumentReader(webhook,'11665',iin,async(url,options)=>{calls.push({url,options});return options.method==='POST'?metadata():new Response(new Uint8Array([1,2,3]));});assert.deepEqual(await read({id:'22'}),new Uint8Array([1,2,3]));assert.deepEqual(await read({id:'22'}),new Uint8Array([1,2,3]));assert.equal(calls.filter(c=>c.options.method==='POST').length,2);assert.equal(JSON.parse(calls[0].options.body).id,'11665');assert.equal(calls[1].options.credentials,'omit');assert.equal(calls[1].options.redirect,'manual');});
test('wrong client, foreign file and untrusted link stop before download',async()=>{for(const patch of [{ufCrmAiIin:'other'},{ufCrmAnkPrimaryDocs:[]},{ufCrmAnkPrimaryDocs:[{id:22,urlMachine:'https://other.example/file'}]}]){let downloads=0;const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>{if(o.method==='POST')return metadata(patch);downloads++;return new Response('x');});await assert.rejects(read({id:'22'}));assert.equal(downloads,0);}});
test('same-origin storage redirect works; cross-origin never receives a request',async()=>{for(const foreign of [false,true]){const calls=[];const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>{calls.push(url);if(o.method==='POST')return metadata();if(url.includes('getFile'))return new Response(null,{status:302,headers:{location:foreign?'https://unverified-storage.example/file':'/upload/file'}});return new Response('verified test bytes');});if(foreign){await assert.rejects(read({id:'22'}),/REDIRECT_UNTRUSTED/);assert.equal(calls.length,2);}else assert.equal(new TextDecoder().decode(await read({id:'22'})),'verified test bytes');}});
test('oversize or expired downloads fail without leaking token-bearing errors',async()=>{for(const response of [()=>new Response('x',{headers:{'content-length':String(36*1024*1024)}}),()=>new Response(null,{status:401})]){const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>o.method==='POST'?metadata():response());await assert.rejects(read({id:'22'}),e=>e instanceof upload.DocumentUploadError&&!e.message.includes('token'));}});
test('verified upload factory uses CRM byte download for content readback',async()=>{let uploaded=false;const adapter=createVerifiedDocumentUploadAdapter(webhook,'11665',iin,async(url,o)=>{if(url.includes('crm.item.update')){const body=await new Response(o.body).json();assert.equal(body.fields.ufCrmAnkPrimaryDocs[0][1],'AQID');uploaded=true;return metadata();}if(url.includes('crm.item.get'))return uploaded?metadata():metadata({ufCrmAnkPrimaryDocs:[]});return new Response(new Uint8Array([1,2,3]));});const r=await adapter.append('11665',iin,[],[{name:'SYNTHETIC.pdf',bytes:new Uint8Array([1,2,3])}]);assert.equal(r.verified,true);assert.equal(r.files[0].id,'22');});

test('malformed download configuration exposes only a fixed error code',()=>{assert.throws(()=>createCrmDocumentReader('not-a-url-containing-synthetic-secret','11665',iin),e=>e.code==='INVALID_DOWNLOAD_CONFIGURATION'&&!e.message.includes('synthetic-secret'));});
test('complete Content-Length bytes finish even if the upstream never closes the stream',async()=>{
 let cancelled=false;const progress=[];
 const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>o.method==='POST'?metadata():new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled=true;return new Promise(()=>{});}}),{headers:{'content-length':'3'}}),{onProgress:e=>progress.push(e)});
 let timer;try{assert.deepEqual(await Promise.race([read({id:'22'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Waiting for a stream close after complete body')),100);})]),new Uint8Array([1,2,3]));}finally{clearTimeout(timer);}
 assert.equal(cancelled,true);assert.equal(progress.at(-1).phase,'body-complete');assert.equal(progress.at(-1).bytes,3);
});
test('truncated and overlong uncompressed bodies fail, while compressed wire length is not decoded length',async()=>{
 for(const length of ['2','4']){const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>o.method==='POST'?metadata():new Response(new Uint8Array([1,2,3]),{headers:{'content-length':length}}));await assert.rejects(read({id:'22'}),/CRM_FILE_LENGTH_MISMATCH/);}
 const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>o.method==='POST'?metadata():new Response(new Uint8Array([1,2,3]),{headers:{'content-length':'2','content-encoding':'gzip'}}));assert.equal((await read({id:'22'})).length,3);
});
test('ranged transfer assembles every byte with at most three concurrent reads and unchanged signed URLs',async()=>{
 const source=Uint8Array.from({length:267731},(_,i)=>i%251);let active=0,maximum=0,parts=0;
 const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>{
  if(o.method==='POST')return metadata();assert.equal(url,portal+'/rest/crm.controller.item.getFile.json?token=synthetic');
  const m=/^bytes=(\d+)-(\d+)$/.exec(o.headers.range);assert.ok(m);const start=Number(m[1]),end=Math.min(Number(m[2]),source.length-1);assert.ok(end-start<8192);
  if(start)assert.equal(o.headers['if-range'],'"synthetic-etag"');parts++;active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,1));active--;
  return new Response(source.slice(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${source.length}`,'content-length':String(end-start+1),etag:'"synthetic-etag"'}});
 });
 const result=await read({id:'22'});assert.deepEqual(result,source);assert.equal(createHash('sha256').update(result).digest('hex'),createHash('sha256').update(source).digest('hex'));assert.equal(parts,Math.ceil(source.length/8192));assert.equal(maximum,3);
});
test('ranged transfers reject shifted ranges, changed files, oversized totals and short bodies',async()=>{
 for(const variant of ['shift','changed','oversize','short']){
  let reads=0;const read=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>{
   if(o.method==='POST')return metadata();reads++;const start=Number(/^bytes=(\d+)/.exec(o.headers.range)[1]),end=start?16383:8191;
   if(variant==='changed'&&start)return new Response(new Uint8Array(16384),{status:200});
   const total=variant==='oversize'?36*1024*1024:16384,from=variant==='shift'?start+1:start;
   return new Response(new Uint8Array(variant==='short'?8191:8192),{status:206,headers:{'content-range':`bytes ${from}-${end}/${total}`,'content-length':'8192'}});
  });
  await assert.rejects(read({id:'22'}),e=>['CRM_FILE_RANGE_MISMATCH','CRM_FILE_LENGTH_MISMATCH','CRM_FILE_TOO_LARGE'].includes(e.code));if(variant!=='changed')assert.equal(reads,1);
 }
});
test('weak ETags and generated Last-Modified dates are not sent as If-Range validators',async()=>{
 let parts=0;const reader=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>{
  if(o.method==='POST')return metadata();const start=parts++*8192;assert.equal(o.headers['if-range'],undefined);
  return new Response(new Uint8Array(8192),{status:206,headers:{'content-range':`bytes ${start}-${start+8191}/16384`,'content-length':'8192',etag:'W/"weak"','last-modified':new Date().toUTCString()}});
 });assert.equal((await reader({id:'22'})).length,16384);assert.equal(parts,2);
});


test('PDF import preserves safe names but excludes signing keys before reading their body',async()=>{
 const names=[];let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 const reader=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>o.method==='POST'?metadata():new Response(stream,{headers:{'content-disposition':'attachment; filename="SYNTHETIC_SECRET.pfx"'}}),{pdfOnly:true,onFilename:n=>names.push(n)});
 await assert.rejects(reader({id:'22'}),/CREDENTIAL_NOT_ANALYSED/);assert.equal(cancelled,true);assert.equal(names.length,0);
 const pdf=createCrmDocumentReader(webhook,'11665',iin,async(url,o)=>o.method==='POST'?metadata():new Response('%PDF-1.7',{headers:{'content-disposition':"attachment; filename*=UTF-8''%D0%A2%D0%B5%D1%81%D1%82.pdf"}}),{pdfOnly:true,onFilename:n=>names.push(n)});
 assert.equal(new TextDecoder().decode(await pdf({id:'22'})),'%PDF-1.7');assert.deepEqual(names,['Тест.pdf']);
});
