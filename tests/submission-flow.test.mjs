import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{JSDOM}from'jsdom';
function setup({uncertain=false,editDuringPrepare=false}={}){
 const dom=new JSDOM('<button id="anchor">Check</button><p id="status"></p>',{url:'https://assessment.example',runScripts:'outside-only'}),w=dom.window;let payload={answers:['INITIAL']},row=null,rendered=null,downloads=0;const calls=[];
 w.HostedAssessment={ready:()=>true,getContext:()=>({client:{external:{dealId:'11665'}}})};w.ServerDrafts={capture:()=>payload,reviewBindings:()=>[]};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{downloads++;};
 w.SubmissionDestination={confirm:async()=>({dealId:'11665',iin:'SYNTHETIC',identityRevision:1})};
 w.ContractRenderers={['a'.repeat(64)]:{render:async(data,version)=>{rendered={data,version};return{};}}};
 w.fetch=async(url,options)=>{if(!options?.method)return{ok:true,json:async()=>({submission:row})};const b=JSON.parse(options.body);calls.push(b);if(b.action==='prepare'){row={requestId:b.requestId,state:'prepared',assessmentSaved:false,historySaved:false,contractNumber:'TEST',reviewText:'SAVED SNAPSHOT'};if(editDuringPrepare)payload={answers:['EDITED']};}if(b.action==='commit')row={...row,state:uncertain?'uncertain':'verified',assessmentSaved:!uncertain};if(b.action==='reconcile')row={...row,state:'verified',assessmentSaved:true};if(b.action==='history')row={...row,historySaved:true};if(b.action==='cancel')row={...row,state:'cancelled'};return{ok:true,json:async()=>b.action==='contract'?{contract:{rendererVersion:'a'.repeat(64),data:{client_name:'SAVED PERSON'}}}:row};};
 w.eval(fs.readFileSync(new URL('../public/submission-flow.js',import.meta.url),'utf8'));const flow=w.SubmissionFlow.mount(w.document.getElementById('anchor'),w.document.getElementById('status'));
 const check=ready=>flow.checked({readyToSubmit:ready,identityRevision:1},{dealId:'11665',payload,bindings:[],signature:JSON.stringify({payload,bindings:[]})});
 return{w,flow,check,calls,save:[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Скачать договор'),resume:()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Продолжить сохранение')),rendered:()=>rendered,downloads:()=>downloads};
}
test('one action saves fields, history and downloads the immutable contract snapshot',async()=>{const s=setup();s.check(false);assert.equal(s.save.disabled,false);s.check(true);await s.save.onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','commit','history','contract']);assert.equal(new Set(s.calls.map(c=>c.requestId)).size,1);assert.equal(s.rendered().data.client_name,'SAVED PERSON');assert.equal(s.downloads(),1);});
test('interrupted save resumes with readback, without another commit',async()=>{const s=setup({uncertain:true});s.check(true);await s.save.onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','commit']);assert.equal(s.downloads(),0);await s.resume().onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','commit','reconcile','history','contract']);assert.equal(s.downloads(),1);});
test('editing answers during preparation cancels before any CRM write',async()=>{const s=setup({editDuringPrepare:true});s.check(true);await s.save.onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','cancel']);assert.equal(s.downloads(),0);});
test('download starts validation and saves draft documents before preparing the contract',async()=>{
 const s=setup(),steps=[];s.w.AssessmentCheck={run:async()=>{steps.push('check');s.check(true);},result:()=>({readyToSubmit:true})};s.w.ServerDrafts.save=async()=>{steps.push('draft');return true;};s.w.AssessmentDocumentUpload={submit:async()=>steps.push('documents')};const fetch=s.w.fetch;s.w.fetch=async(url,options)=>{if(options?.method)steps.push(JSON.parse(options.body).action);return fetch(url,options);};
 await s.save.onclick();assert.deepEqual(steps,['check','draft','documents','prepare','commit','history','contract']);assert.equal(s.downloads(),1);
});
test('incomplete answers and failed document persistence stop before contract submission',async()=>{
 const incomplete=setup();incomplete.w.AssessmentCheck={run:async()=>{},result:()=>({answersComplete:false})};await incomplete.save.onclick();assert.equal(incomplete.calls.length,0);assert.equal(incomplete.downloads(),0);
 const failed=setup();failed.check(true);failed.w.AssessmentDocumentUpload={submit:async()=>{throw Error('document receipt missing');}};await failed.save.onclick();assert.equal(failed.calls.length,0);assert.equal(failed.downloads(),0);
});
test('the final action uploads pending signature keys only after all other checks pass, then rechecks',async()=>{
 const s=setup(),steps=[];let signatureReady=false;
 s.w.ServerDrafts.capture=()=>({answers:['INITIAL'],pendingFiles:signatureReady?[]:['client.p12']});
 s.w.CredentialUpload={pendingOnly:pending=>pending.length===1&&pending[0]==='client.p12',submit:async()=>{steps.push('keys');signatureReady=true;}};
 s.w.AssessmentCheck={run:async()=>{steps.push('check');if(signatureReady){const payload=s.w.ServerDrafts.capture();s.flow.checked({readyToSubmit:true,identityRevision:1},{dealId:'11665',payload,bindings:[],signature:JSON.stringify({payload,bindings:[]})});}},result:()=>({answersComplete:true,evidence:{issues:[]},documents:{issues:[{code:'DOCUMENT_UPLOAD_PENDING'},{code:'EDS_SEPARATE_UPLOAD_REQUIRED'}]}})};
 await s.save.onclick();assert.deepEqual(steps,['check','keys','check']);assert.equal(s.downloads(),1);
});
test('a pending PDF or another document problem prevents any signature or contract write',async()=>{
 for(const extra of [null,'DOCUMENT_CLIENT_UNVERIFIED']){const s=setup();let keys=0;
  s.w.ServerDrafts.capture=()=>({pendingFiles:extra?['client.p12']:['client.p12','unread.pdf']});
  s.w.CredentialUpload={pendingOnly:pending=>pending.every(name=>name==='client.p12'),submit:async()=>keys++};
  s.w.AssessmentCheck={run:async()=>{},result:()=>({answersComplete:true,evidence:{issues:[]},documents:{issues:[{code:'DOCUMENT_UPLOAD_PENDING'},{code:'EDS_SEPARATE_UPLOAD_REQUIRED'},...(extra?[{code:extra}]:[])]}})};
  await s.save.onclick();assert.equal(keys,0);assert.equal(s.calls.length,0);assert.equal(s.downloads(),0);
 }
});
test('cancelling destination review prevents document, credential, field and history writes',async()=>{
 const s=setup();s.check(true);let documents=0;s.w.SubmissionDestination.confirm=async()=>null;s.w.AssessmentDocumentUpload={submit:async()=>documents++};await s.save.onclick();assert.equal(documents,0);assert.equal(s.calls.length,0);
});
test('every outbound submission action includes the confirmed destination',async()=>{
 const s=setup();s.check(true);await s.save.onclick();for(const call of s.calls.filter(c=>['prepare','commit','history'].includes(c.action)))assert.deepEqual(call.destination,{dealId:'11665',iin:'SYNTHETIC',identityRevision:1});
});
test('a changed answer during destination review prevents all outbound writes',async()=>{
 const s=setup();s.check(true);s.w.SubmissionDestination.confirm=async()=>{s.w.ServerDrafts.capture=()=>({answers:['DIFFERENT']});return{dealId:'11665',iin:'SYNTHETIC',identityRevision:1};};await s.save.onclick();assert.equal(s.calls.length,0);
});
