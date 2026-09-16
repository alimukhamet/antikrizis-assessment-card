import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync('public/questionnaire.html','utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
async function setup(t,{mode='contract',draft=null,stageError=null,delayedDraft=false,handoff=null,powerReady=true}={}){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html'+(mode==='handoff'?'?mode=handoff':''),runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext()),calls=[],errors=[];
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener('error',event=>errors.push(event.error));
 let releaseDraft;const draftWait=new Promise(r=>{releaseDraft=r;});
 const context={caseId:'case',identityRevision:1,assessmentDay:'2026-09-16',client:{title:'SYNTHETIC CLIENT',iin:'000000000010',external:{system:'bitrix',dealId:'900001'}}};
 const destination={categoryId:'13',fromStageId:'C13:FINAL_INVOICE',fromStageName:'Договор',stageId:'C13:WON',stageName:'Сделка завершена'};
 w.fetch=async(path,options={})=>{
  calls.push({path,method:options.method||'GET',body:options.body});let result;
  if(path==='/api/assessment/900001')result=context;
  else if(path==='/api/assessment/clients')result={drafts:[],recent:[]};
  else if(path.endsWith('/draft')){if(options.method==='POST')result={revision:2,latestRevision:2};else{if(delayedDraft)await draftWait;result={draft};}}
  else if(path.endsWith('/submission'))result={submission:null};
  else if(path.endsWith('/uploads'))result={unsent:null};
  else if(path.endsWith('/credentials'))result={credentials:{verified:false},identityRevision:1};
  else if(path.endsWith('/handoff'))result={handoff,destination,stageError};
  else if(path.endsWith('/documents/power/analyze'))result={...context,documentId:'power',extractionId:'parsed-power',eligibleForAutofill:true,document:{totalPages:2,pages:[{text:'Synthetic page',needsOcr:false},{text:'Synthetic page two',needsOcr:false}],extraction:{identity:{iin:context.client.iin},kind:'power_of_attorney',facts:[],credits:[],findings:[]}},reviewContext:{pages:2,iin:context.client.iin}};
  else if(path.endsWith('/handoff-check'))result={identityRevision:1,documents:{packageReady:powerReady,issues:powerReady?[]:[{code:'POWER_SCOPE_REVIEW_REQUIRED',documentId:'power',message:'Сверьте полномочия.'}],manuallyReviewed:[],structurallyChecked:powerReady?['Доверенность']:[]}};
  else if(path.endsWith('/check'))result={identityRevision:1,answersComplete:false,issues:[],documents:{issues:[],manuallyReviewed:[]},evidence:{issues:[]}};
  else throw Error('Unexpected request '+path);
  return{ok:true,json:async()=>result};
 };
 // Execute the production classic scripts, in their real order, without a preview bootstrap.
 for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  if(match[1].includes('type="module"'))continue;
  const src=match[1].match(/src="([^"]+)"/);run(src?fs.readFileSync('public/'+src[1].replace(/^\//,''),'utf8'):match[2]);
 }
 t.after(()=>{w.close();assert.deepEqual(errors,[]);});
 await tick();
 return{w,d,run,calls,context,destination,releaseDraft,async load(){d.getElementById('hostDealId').value='900001';await d.getElementById('hostLoadDeal').onclick();await tick();}};
}
test('production portal starts with no client, no random deal, and no writes',async t=>{
 const s=await setup(t);assert.equal(s.w.HostedAssessment.getContext(),null);assert.equal(s.d.body.dataset.uxClientState,'empty');assert.equal(s.d.getElementById('uxClientEntry').hidden,false);assert.equal(s.d.getElementById('questionnaireStep').inert,true);assert.equal(s.calls.length,0);
 assert.equal(s.run('requiredDocumentLabels().length'),6);assert.equal(s.run('requiredDocumentLabels().includes("Доверенность")'),false);assert.equal(s.run('requiredDocumentLabels().includes("ЭЦП файл")'),false);
 const controls=s.w.ServerDrafts.capture();assert.ok(controls.answers.length>=81);assert.equal(controls.groups.length,18);
 await s.load();assert.equal(s.d.body.dataset.uxClientState,'ready');assert.match(s.d.querySelector('.wf-client-copy').textContent,/SYNTHETIC CLIENT/);assert.match(s.d.querySelector('.wf-client-copy').textContent,/900001/);
 assert.equal(s.d.querySelector('[data-client-path="/lawyer-handoff"]').getAttribute('href'),'/lawyer-handoff?dealId=900001');
 assert.equal(s.calls.some(c=>c.method==='POST'),false);
});
test('handoff has three file cards and enables its pickers only once the correct draft loads',async t=>{
 const s=await setup(t,{mode:'handoff',delayedDraft:true});await s.load();
 assert.equal(s.d.querySelectorAll('.ux-handoff-card').length,3);assert.equal(s.d.getElementById('handoffSend').disabled,true);assert.equal(s.d.getElementById('uxHandoff').inert,true);
 s.releaseDraft();await tick();
 assert.equal(s.d.body.dataset.uxClientState,'ready');
 for(const type of ['ЭЦП файл','Доверенность'])assert.equal(s.d.querySelector('[data-required-picker="'+type+'"]').disabled,false,type);
 await s.w.ClientWorkspace.open();assert.equal(s.d.querySelector('.client-archive-toggle input').checked,true);
 assert.equal(s.d.getElementById('handoffSend').disabled,true,'All three items must be ready');
});
test('reopening handoff retains signed PDF and power without silently confirming the signature',async t=>{
 const draft={revision:1,identityRevision:1,payload:{schemaVersion:1,answers:[],groups:[],docContext:{social:'',salary:''},pendingFiles:[],documents:[{documentId:'power',type:'Доверенность',person:'Клиент',originalName:'power.pdf'},{documentId:'signed',type:'Подписанный договор',person:'Клиент',originalName:'signed-qr.pdf'}]}};
 const s=await setup(t,{mode:'handoff',draft});await s.load();await tick();
 assert.equal(s.d.getElementById('handoffSignedName').textContent,'signed-qr.pdf');assert.equal(s.d.getElementById('handoffSignedConfirmed').checked,false);assert.equal(s.d.getElementById('handoffPowerState').textContent,'Проверена');
 assert.deepEqual(JSON.parse(s.run('JSON.stringify(selectedFiles.map(f=>f.storedDocumentId))')),['power','signed']);assert.ok(s.calls.filter(c=>c.path.includes('/analyze')).every(c=>c.path.endsWith('/documents/power/analyze')),'Only power review context is loaded, never signed-contract answers');
 assert.equal(s.d.getElementById('fio').value,'');
 const manual=await setup(t,{mode:'handoff',draft,powerReady:false});await manual.load();await tick();assert.match(manual.d.getElementById('handoffPowerReview').textContent,/2 стр/);assert.equal(manual.d.getElementById('handoffSend').disabled,true);
});
test('unknown Bitrix destination fails closed and a saved uncertain attempt only resumes',async t=>{
 const blocked=await setup(t,{mode:'handoff',stageError:'HANDOFF_STAGE_UNVERIFIED'});await blocked.load();assert.equal(blocked.d.getElementById('handoffSend').disabled,true);assert.match(blocked.d.getElementById('handoffStage').textContent,/не подтверждена/);
 const handoff={requestId:'12345678-1234-1234-1234-123456789012',state:'uncertain',destination:{fromStageName:'Договор',stageName:'Сделка завершена'}};
 const s=await setup(t,{mode:'handoff',handoff});await s.load();s.w.ClientContextUI.confirm=async()=>({dealId:'900001',iin:'000000000010',identityRevision:1});s.w.CredentialUpload.submit=()=>{throw Error('Must not resend keys');};
 assert.equal(s.d.getElementById('handoffSend').disabled,false);await s.d.getElementById('handoffSend').onclick();
 const writes=s.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/handoff'));assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0].body).action,'resume');assert.equal(JSON.parse(writes[0].body).requestId,handoff.requestId);
});
