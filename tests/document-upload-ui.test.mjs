import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{JSDOM}from'jsdom';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(lost=false){const dom=new JSDOM('<button id="anchor"></button><p id="status"></p>',{runScripts:'outside-only',url:'https://assessment.example'}),w=dom.window,calls=[];const payload={documents:['synthetic']};w.HostedAssessment={ready:()=>true,getContext:()=>({client:{external:{dealId:'11665'}}})};w.ServerDrafts={capture:()=>payload};w.fetch=async(url,options)=>{if(!options)return{ok:true,json:async()=>({unsent:null})};const body=JSON.parse(options.body);calls.push(body);if(lost&&calls.length===2)throw Error('lost response');return{ok:true,json:async()=>({state:'verified',nextBatch:body.batchIndex+1,documentsUploaded:body.batchIndex===1})};};w.eval(fs.readFileSync(new URL('../public/document-upload.js',import.meta.url),'utf8'));const flow=w.DocumentUpload.mount(w.document.getElementById('anchor'),w.document.getElementById('status'));flow.checked({identityRevision:1,documents:{issues:[{code:'EDS_SEPARATE_UPLOAD_REQUIRED'}]}},{dealId:'11665',payload,signature:JSON.stringify(payload)});return{calls,button:w.document.querySelectorAll('button')[1],flow,w,payload};}
test('document upload advances through verified batches with one stable request ID',async()=>{const s=setup();await s.button.onclick();assert.deepEqual(s.calls.map(c=>c.batchIndex),[0,1]);assert.equal(s.calls[0].requestId,s.calls[1].requestId);assert.match(s.w.document.getElementById('status').textContent,/Документы сохранены в сделке/);});
test('uncertain upload automatically checks the same batch once without allowing a new write',async()=>{
 const s=setup(),progress=[];let posts=0;
 s.w.fetch=async(url,options)=>{if(!options)return{ok:true,json:async()=>({unsent:null})};const body=JSON.parse(options.body);s.calls.push(body);return{ok:true,json:async()=>++posts===1?{requestId:'recovered-root',state:'uncertain'}:{state:'verified',documentsUploaded:true}};};
 await s.flow.submit({onProgress:text=>progress.push(text)});
 assert.equal(s.calls.length,2);assert.equal(s.calls[1].action,'reconcile');assert.equal(s.calls[1].requestId,'recovered-root');assert.equal(s.calls[1].batchIndex,0);assert.ok(progress.some(text=>text.includes('без повторной загрузки')));s.w.close();
});
test('persistent uncertainty stops visibly, and the optional cancellation lookup never delays success',async()=>{
 const s=setup();s.w.fetch=async(url,options)=>{if(!options)return new Promise(()=>{});s.calls.push(JSON.parse(options.body));return{ok:true,json:async()=>({state:'uncertain'})};};
 await assert.rejects(s.flow.submit(),/не подтвердил сохранение документов/);assert.equal(s.calls.length,2);
 s.w.fetch=async(url,options)=>!options?new Promise(()=>{}):{ok:true,json:async()=>({state:'verified',documentsUploaded:true})};
 assert.equal(await s.flow.submit(),true);s.w.close();
});
test('lost batch response retries that same batch and blocks unreviewed packages',async()=>{const s=setup(true);await s.button.onclick();await s.button.onclick();assert.deepEqual(s.calls.map(c=>c.batchIndex),[0,1,1]);assert.equal(s.calls[1].requestId,s.calls[2].requestId);s.flow.checked({documents:{issues:[{code:'WRONG_CLIENT'}]}},{});assert.equal(s.button.disabled,true);});
test('fresh page adopts the server recovered root before proceeding to the next batch',async()=>{
 const root='00000000-0000-0000-0000-000000000123';
 for(let reload=0;reload<2;reload++){
  const s=setup();s.w.fetch=async(url,options)=>{if(!options)return{ok:true,json:async()=>({unsent:null})};const body=JSON.parse(options.body);s.calls.push(body);return{ok:true,json:async()=>({requestId:root,state:'verified',nextBatch:body.batchIndex+1,documentsUploaded:body.batchIndex===1})};};
  await s.button.onclick();assert.equal(s.calls.length,2);assert.equal(s.calls[1].requestId,root);s.w.close();
 }
});
test('reopening restores cancellation without revalidating an obsolete document package',async()=>{
 const s=setup(),requestId='00000000-0000-0000-0000-000000000456';await tick();
 let pending=true;s.w.fetch=async(url,options)=>{if(!options)return{ok:true,json:async()=>({unsent:pending?{requestId}:null})};const body=JSON.parse(options.body);s.calls.push(body);assert.equal(body.action,'cancel');assert.equal(body.uploadId,requestId);pending=false;return{ok:true,json:async()=>({state:'cancelled'})};};
 s.flow.invalidate();s.w.document.dispatchEvent(new s.w.Event('assessment-case-opened'));await tick();
 const cancel=[...s.w.document.querySelectorAll('button')].find(b=>b.textContent==='Отменить неотправленную загрузку');assert.equal(cancel.hidden,false);assert.equal(s.button.disabled,true);
 await cancel.onclick();assert.equal(s.calls.length,1);assert.equal(cancel.hidden,true);assert.equal(s.button.disabled,true);s.w.close();
});
test('reopening restores unsent credential cancellation without selecting the key again',async()=>{
 const dom=new JSDOM('<div class="field"><input id="previewEdsPassword"></div><input id="fio">',{runScripts:'outside-only',url:'https://assessment.example'}),w=dom.window,calls=[],requestId='00000000-0000-0000-0000-000000000789';
 w.selectedFiles=[];w.refreshRequiredDocuments=()=>{};w.HostedAssessment={ready:()=>true,getContext:()=>({client:{external:{dealId:'11665'}}})};
 w.fetch=async(url,options)=>{if(!options)return{ok:true,json:async()=>({credentials:null,unsent:{requestId}})};calls.push(JSON.parse(options.body));return{ok:true,json:async()=>({state:'cancelled'})};};
 w.eval(fs.readFileSync(new URL('../public/credential-upload.js',import.meta.url),'utf8'));await tick();
 const cancel=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Отменить неотправленную ЭЦП');assert.equal(cancel.hidden,false);await cancel.onclick();
 assert.deepEqual(calls,[{action:'cancel',requestId}]);assert.equal(cancel.hidden,true);assert.equal(w.document.getElementById('previewEdsPassword').value,'');w.close();
});
