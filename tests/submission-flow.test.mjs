import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{JSDOM}from'jsdom';
function setup({uncertain=false,editDuringPrepare=false}={}){
 const dom=new JSDOM('<button id="anchor">Check</button><p id="status"></p>',{url:'https://assessment.example',runScripts:'outside-only'}),w=dom.window;let payload={answers:['INITIAL']},row=null,rendered=null,downloads=0;const calls=[];
 w.HostedAssessment={ready:()=>true,getContext:()=>({client:{external:{dealId:'11665'}}})};w.ServerDrafts={capture:()=>payload,reviewBindings:()=>[]};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{downloads++;};
 w.SubmissionDestination={confirm:async()=>({dealId:'11665',iin:'SYNTHETIC',identityRevision:1})};
 w.ContractRenderers={['a'.repeat(64)]:{render:async(data,version)=>{rendered={data,version};return new w.Blob(['SYNTHETIC CONTRACT'],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});}}};
 w.fetch=async(url,options)=>{if(!options?.method)return{ok:true,json:async()=>({submission:row})};const b=JSON.parse(options.body);calls.push(b);if(b.action==='prepare'){row={requestId:b.requestId,state:'prepared',assessmentSaved:false,historySaved:false,contractNumber:'TEST',reviewText:'SAVED SNAPSHOT'};if(editDuringPrepare)payload={answers:['EDITED']};}if(b.action==='complete'){const pending=uncertain&&row.state==='prepared';row={...row,state:pending?'uncertain':'verified',assessmentSaved:!pending,historySaved:!pending,contract:pending?null:{rendererVersion:'a'.repeat(64),data:{client_name:'SAVED PERSON'}}};}if(b.action==='cancel')row={...row,state:'cancelled'};return{ok:true,json:async()=>row};};
 w.eval(fs.readFileSync(new URL('../public/submission-flow.js',import.meta.url),'utf8'));const flow=w.SubmissionFlow.mount(w.document.getElementById('anchor'),w.document.getElementById('status'));
 const check=ready=>flow.checked({readyToSubmit:ready,identityRevision:1},{dealId:'11665',payload,bindings:[],signature:JSON.stringify({payload,bindings:[]})});
 return{w,flow,check,calls,save:[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Скачать договор'),resume:()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Продолжить сохранение')),rendered:()=>rendered,downloads:()=>downloads};
}
test('one action saves fields, history and downloads the immutable contract snapshot',async()=>{const s=setup();s.check(false);assert.equal(s.save.disabled,false);s.check(true);await s.save.onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','complete']);assert.equal(new Set(s.calls.map(c=>c.requestId)).size,1);assert.equal(s.rendered().data.client_name,'SAVED PERSON');assert.equal(s.downloads(),1);});
test('interrupted save resumes with readback, without another commit',async()=>{const s=setup({uncertain:true});s.check(true);await s.save.onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','complete']);assert.equal(s.downloads(),0);await new Promise(setImmediate);await s.resume().onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','complete','complete']);assert.equal(s.downloads(),1);});
test('editing answers during preparation cancels before any CRM write',async()=>{const s=setup({editDuringPrepare:true});s.check(true);await s.save.onclick();assert.deepEqual(s.calls.map(c=>c.action),['prepare','cancel']);assert.equal(s.downloads(),0);});
test('download starts validation and saves draft documents before preparing the contract',async()=>{
 const s=setup(),steps=[];s.w.AssessmentCheck={run:async()=>{steps.push('check');s.check(true);},result:()=>({readyToSubmit:true})};s.w.ServerDrafts.save=async()=>{steps.push('draft');return true;};s.w.AssessmentDocumentUpload={submit:async()=>steps.push('documents')};const fetch=s.w.fetch;s.w.fetch=async(url,options)=>{if(options?.method)steps.push(JSON.parse(options.body).action);return fetch(url,options);};
 await s.save.onclick();assert.deepEqual(steps,['check','draft','documents','prepare','complete']);assert.equal(s.downloads(),1);
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
 const s=setup();s.check(true);await s.save.onclick();for(const call of s.calls.filter(c=>['prepare','complete'].includes(c.action)))assert.deepEqual(call.destination,{dealId:'11665',iin:'SYNTHETIC',identityRevision:1});
});
test('a changed answer during destination review prevents all outbound writes',async()=>{
 const s=setup();s.check(true);s.w.SubmissionDestination.confirm=async()=>{s.w.ServerDrafts.capture=()=>({answers:['DIFFERENT']});return{dealId:'11665',iin:'SYNTHETIC',identityRevision:1};};await s.save.onclick();assert.equal(s.calls.length,0);
});

test('download exposes immediate busy/progress and retains a direct file link without repeating writes',async()=>{
 const s=setup(),events=[];s.check(true);s.w.document.addEventListener('assessment-submission-progress',e=>events.push({...e.detail}));
 let finish;s.w.AssessmentDocumentUpload={submit:({onProgress})=>{onProgress('SAVING DOCUMENTS');return new Promise(resolve=>finish=resolve);}};
 const pending=s.save.onclick();await new Promise(setImmediate);assert.equal(s.save.disabled,true);assert.equal(events.at(-1).busy,true);assert.equal(events.at(-1).message,'SAVING DOCUMENTS');
 await s.save.onclick();assert.equal(s.calls.length,0);finish(true);await pending;
 assert.equal(events.at(-1).busy,false);assert.equal(s.downloads(),1);
 const link=s.w.document.getElementById('downloadContractFile');assert.equal(link.hidden,false);assert.match(link.download,/11665\.docx$/);assert.equal(link.isConnected,true);
 link.click();assert.equal(s.downloads(),2);assert.equal(s.calls.filter(c=>c.action==='complete').length,1);
 s.flow.invalidate();assert.equal(link.hidden,true);assert.equal(link.hasAttribute('href'),false);s.w.close();
});
test('download and its controls do not wait for optional recovery status after completion',async()=>{
 const s=setup();s.check(true);const fetch=s.w.fetch;s.w.fetch=(url,options)=>options?.method?fetch(url,options):new Promise(()=>{});
 await s.save.onclick();assert.equal(s.save.disabled,false);assert.equal(s.downloads(),1);s.w.close();
});
test('a failed check gives a visible reason instead of a silent download no-op',async()=>{
 const s=setup();s.w.AssessmentCheck={run:async()=>{},result:()=>null};await s.save.onclick();assert.match(s.w.document.getElementById('status').textContent,/Проверка не завершена/);assert.equal(s.downloads(),0);s.w.close();
});
test('document blockers stop the download, report the real phase and open document review',async()=>{
 const s=setup(),progress=[],blocked=[];const result={answersComplete:true,readyToSubmit:false,evidence:{issues:[]},documents:{issues:[{code:'ENPF_PERIOD_UNVERIFIED',documentId:'enpf'},{code:'DOCUMENT_TYPE_UNVERIFIED',documentId:'identity'}]}};
 s.w.document.addEventListener('assessment-submission-progress',event=>progress.push({...event.detail}));s.w.document.addEventListener('assessment-submission-blocked',event=>blocked.push(event.detail));s.w.AssessmentCheck={run:async()=>{},result:()=>result};
 await s.save.onclick();assert.equal(progress.find(event=>event.busy)?.label,'Проверяю…');assert.equal(progress.some(event=>event.busy&&event.label==='Готовлю договор…'),false);assert.equal(blocked.length,1);assert.equal(blocked[0].reason,'documents');assert.equal(blocked[0].result,result);assert.match(s.w.document.getElementById('status').textContent,/Договор не скачан.*документы \(2\)/);assert.equal(s.calls.length,0);assert.equal(s.downloads(),0);s.w.close();
});
test('direct file link refuses a stale client or answer snapshot',async()=>{
 for(const change of [s=>s.w.HostedAssessment.getContext=()=>({client:{external:{dealId:'other'}}}),s=>s.w.ServerDrafts.capture=()=>({answers:['CHANGED']})]){
  const s=setup();s.check(true);await s.save.onclick();change(s);const link=s.w.document.getElementById('downloadContractFile'),event=new s.w.MouseEvent('click',{cancelable:true});link.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(link.hidden,true);s.w.close();
 }
});
test('real upload and submission flows recover a delayed document receipt and then download once',async()=>{
 const s=setup(),fetch=s.w.fetch,uploads=[];s.w.eval(fs.readFileSync(new URL('../public/document-upload.js',import.meta.url),'utf8'));
 const upload=s.w.DocumentUpload.mount(s.w.document.getElementById('anchor'),s.w.document.createElement('p'));
 s.w.AssessmentDocumentUpload=upload;const payload=s.w.ServerDrafts.capture();upload.checked({identityRevision:1,documents:{issues:[]}},{dealId:'11665',payload});s.check(true);
 s.w.fetch=async(url,options)=>{
  if(!url.endsWith('/uploads'))return fetch(url,options);
  if(!options)return new Promise(()=>{});
  uploads.push(JSON.parse(options.body));return{ok:true,json:async()=>uploads.length===1?{state:'uncertain'}:{state:'verified',documentsUploaded:true}};
 };
 await s.save.onclick();assert.equal(uploads.length,2);assert.equal(uploads[1].action,'reconcile');assert.equal(uploads[0].requestId,uploads[1].requestId);assert.deepEqual(s.calls.map(c=>c.action),['prepare','complete']);assert.equal(s.downloads(),1);s.w.close();
});

test('an answer edited during asynchronous rendering prevents a stale download',async()=>{
 const s=setup();s.check(true);let finish;
 s.w.ContractRenderers['a'.repeat(64)].render=()=>new Promise(resolve=>{finish=resolve;});
 const work=s.save.onclick();while(!finish)await new Promise(setImmediate);
 s.w.ServerDrafts.capture=()=>({answers:['EDITED DURING RENDER']});
 finish(new s.w.Blob(['SYNTHETIC']));await work;
 assert.equal(s.downloads(),0);assert.match(s.w.document.getElementById('status').textContent,/изменились/);assert.equal(s.save.disabled,false);s.w.close();
});
test('an answer edited while the saved contract is fetched prevents rendering',async()=>{
 const s=setup();s.check(true);const fetch=s.w.fetch;
 s.w.fetch=async(url,options)=>{const result=await fetch(url,options);if(options?.method&&JSON.parse(options.body).action==='complete')s.w.ServerDrafts.capture=()=>({answers:['CHANGED']});return result;};
 await s.save.onclick();assert.equal(s.downloads(),0);assert.equal(s.rendered(),null);s.w.close();
});
test('an answer edited during server continuation prevents an outdated final file',async()=>{
 const s=setup();s.check(true);const fetch=s.w.fetch;
 s.w.fetch=async(url,options)=>{const result=await fetch(url,options);if(options?.method&&JSON.parse(options.body).action==='complete')s.w.ServerDrafts.capture=()=>({answers:['CHANGED']});return result;};
 await s.save.onclick();assert.equal(s.downloads(),0);assert.equal(s.calls.filter(call=>call.action==='complete').length,1);s.w.close();
});
test('an empty renderer result never becomes a successful downloadable contract',async()=>{
 const s=setup();s.check(true);s.w.ContractRenderers['a'.repeat(64)].render=async()=>new s.w.Blob([]);
 await s.save.onclick();assert.equal(s.downloads(),0);assert.match(s.w.document.getElementById('status').textContent,/пустой файл/);assert.equal(s.save.disabled,false);s.w.close();
});
test('a stalled renderer releases the button and ignores late completion',async()=>{
 const s=setup();s.check(true);const timer=s.w.setTimeout.bind(s.w);s.w.setTimeout=(fn,ms)=>timer(fn,ms===60000?5:ms);
 let finish;s.w.ContractRenderers['a'.repeat(64)].render=()=>new Promise(resolve=>{finish=resolve;});
 await s.save.onclick();assert.equal(s.save.disabled,false);assert.equal(s.downloads(),0);assert.match(s.w.document.getElementById('status').textContent,/слишком много времени/);
 finish(new s.w.Blob(['LATE']));await new Promise(setImmediate);assert.equal(s.downloads(),0);s.w.close();
});
