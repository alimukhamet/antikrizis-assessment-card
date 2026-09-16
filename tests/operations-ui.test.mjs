import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync('public/questionnaire.html','utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
async function setup(t,{mode='contract',draft=null,stageError=null,delayedDraft=false,handoff=null,powerReady=true,clientIin='000000000010',analyze=null,draftResponse=null,fastTimeout=false}={}){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html'+(mode==='handoff'?'?mode=handoff':''),runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext()),calls=[],errors=[];
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener('error',event=>errors.push(event.error));
 let releaseDraft;const draftWait=new Promise(r=>{releaseDraft=r;});
 const context={caseId:'case',identityRevision:1,assessmentDay:'2026-09-16',client:{title:'SYNTHETIC CLIENT',iin:clientIin,external:{system:'bitrix',dealId:'900001'}}};
 if(fastTimeout){const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===30000||ms===15000||ms===25000?35:ms,...args);}
 const destination={categoryId:'13',fromStageId:'C13:FINAL_INVOICE',fromStageName:'Договор',stageId:'C13:WON',stageName:'Сделка завершена'};
 w.fetch=async(path,options={})=>{
  calls.push({path,method:options.method||'GET',body:options.body});let result;
  if(path==='/api/assessment/900001')result=context;
  else if(path==='/api/assessment/clients')result={drafts:[],recent:[]};
  else if(path.endsWith('/draft')){if(options.method==='POST')result={revision:2,latestRevision:2};else{if(draftResponse)return draftResponse();if(delayedDraft)await draftWait;result={draft};}}
  else if(path.endsWith('/submission'))result={submission:null};
  else if(path.endsWith('/uploads'))result={unsent:null};
  else if(path.endsWith('/credentials'))result={credentials:{verified:false},identityRevision:1};
  else if(path.endsWith('/handoff'))result={handoff,destination,stageError};
  else if(analyze&&path.endsWith('/analyze'))return analyze(path,options,context);
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
const storedDraft=(answers=[],groups=[],documents=[{documentId:'gkb',type:'ГКБ — полный отчёт',person:'Клиент',originalName:'synthetic-gkb.pdf'}])=>({revision:3,identityRevision:1,payload:{schemaVersion:1,answers,groups,docContext:{social:'0',salary:'0',salaryBank:'none'},pendingFiles:[],documents}});
const evidence=context=>({...context,documentId:'gkb',extractionId:'parsed-gkb',eligibleForAutofill:Boolean(context.client.iin),findings:context.client.iin?[]:['DEAL_IDENTITY_UNVERIFIED'],document:{totalPages:1,pages:[{text:'SYNTHETIC',needsOcr:false}],extraction:{identity:{iin:'000000000010',name:'OLD DOCUMENT NAME'},kind:'gkb_full',facts:[{key:'identity.name',value:'OLD DOCUMENT NAME',page:1,source:'Synthetic name'},{key:'identity.iin',value:'000000000010',page:1,source:'Synthetic ID'}],credits:[{contractNumber:'SYNTHETIC-1',page:1,facts:[{key:'creditor',value:'SYNTHETIC BANK',page:1,source:'Synthetic bank'}]}],findings:[]}}});
test('reopening restores matching evidence but never repopulates cleared answers or removed loans',async t=>{
 const draft=storedDraft([{key:'fio',value:'',checked:false},{key:'iin',value:'000000000010',checked:false}],[{id:'creditors',rows:[],rowKeys:[]}]);
 const s=await setup(t,{draft,analyze:async(p,o,c)=>({ok:true,json:async()=>evidence(c)})});let jump;s.d.addEventListener('assessment-analysis-complete',e=>{jump=e.detail.showPackageSummary;});await s.load();await tick();
 assert.equal(jump,false,'Reopening must not scroll past the client identity and loading warnings');
 assert.equal(s.d.getElementById('fio').value,'');assert.equal(s.d.querySelectorAll('#creditors > .repeat-rows > *').length,0);
 assert.equal(s.run('af.sources.has("iin")'),true,'Matching saved answer retains its evidence badge');
 assert.equal(s.d.body.dataset.uxClientState,'ready');assert.equal(s.w.ServerDrafts.isDirty(),false);
 assert.equal(s.calls.some(c=>c.method==='POST'&&c.path.endsWith('/draft')),false);
});
test('saved card shows loading progress and keeps answers locked until cached reads finish',async t=>{
 let release;const wait=new Promise(r=>{release=r;});const draft=storedDraft();draft.payload.pendingFiles=['not-uploaded.pdf','test.key'];
 const s=await setup(t,{draft,analyze:async(p,o,c)=>{await wait;return{ok:true,json:async()=>evidence(c)};}});await s.load();
 assert.equal(s.d.body.dataset.uxDraftPhase,'documents');assert.equal(s.d.getElementById('uxLoadStatus').hidden,false);assert.match(s.d.getElementById('uxLoadStatus').textContent,/Читаем/);assert.equal(s.d.getElementById('questionnaireStep').inert,true);
 release();await tick();await tick();assert.equal(s.d.body.dataset.uxClientState,'ready');assert.equal(s.d.getElementById('uxLoadStatus').hidden,true);assert.match(s.d.getElementById('uxPendingFiles').textContent,/not-uploaded.pdf/);
 s.run('selectedFiles.push({id:99,file:{name:"not-uploaded.pdf"},storedDocumentId:"saved-replacement"})');assert.equal(s.w.ServerDrafts.pendingFiles().includes('not-uploaded.pdf'),false,'Reselected files must not keep an obsolete reminder');
});
test('stalled draft read times out visibly and retry safely loads without saving blank data',async t=>{
 let attempts=0;const s=await setup(t,{fastTimeout:true,draftResponse:()=>++attempts===1?new Promise(()=>{}):Promise.resolve({ok:true,json:async()=>({draft:null})})});await s.load();await tick();await tick();
 assert.equal(s.w.ServerDrafts.loadState().phase,'error');assert.equal(s.d.getElementById('questionnaireStep').inert,true);assert.match(s.d.getElementById('uxLoadStatus').textContent,/Сервер не ответил/);
 await s.d.querySelector('#uxLoadStatus button').onclick();await tick();assert.equal(s.d.body.dataset.uxClientState,'ready');assert.equal(s.calls.some(c=>c.method==='POST'),false);
});
test('opening an outdated cache does not silently reprocess and missing IIN has a clear deal-level warning',async t=>{
 const stale=await setup(t,{draft:storedDraft(),analyze:async()=>({ok:false,json:async()=>({error:'CACHE_REPROCESS_REQUIRED'})})});await stale.load();await tick();
 assert.equal(stale.calls.filter(c=>c.path.endsWith('/analyze')).length,1);assert.equal(JSON.parse(stale.calls.find(c=>c.path.endsWith('/analyze')).body).cacheOnly,true);assert.equal(stale.d.body.dataset.uxClientState,'ready');assert.match(stale.run('af.results.get(1).error'),/Версия обработки изменилась/);
 const missing=await setup(t,{draft:storedDraft(),clientIin:null,analyze:async(p,o,c)=>({ok:true,json:async()=>evidence(c)})});await missing.load();await tick();assert.equal(missing.d.getElementById('uxIdentityWarning').hidden,false);assert.match(missing.d.getElementById('uxIdentityWarning').textContent,/В Bitrix не указан ИИН/);assert.equal(missing.run('af.results.get(1).blocked'),true);
});
test('document-only draft requires explicit client confirmation and can resolve an old value without overwriting other edits',async t=>{
 const s=await setup(t,{clientIin:null});await s.load();const p={...evidence(s.context),eligibleForDraftAutofill:true};
 p.document.extraction.credits[0].facts.push({key:'contractIdentifier',value:'SYNTHETIC-1',page:1,source:'Synthetic contract'});
 s.run('selectedFiles.push({id:1,file:{name:"synthetic.pdf"},storedDocumentId:"gkb",type:"ГКБ — полный отчёт",person:"Клиент"})');
 s.run('af.results.set(1,HostedAssessment.adapt('+JSON.stringify(p)+'));afClientChoices()');
 let confirmations=0;s.w.confirm=()=>{confirmations++;return false;};s.run('afApply()');assert.equal(s.d.getElementById('iin').value,'');assert.equal(confirmations,1);
 s.w.confirm=()=>{confirmations++;return true;};s.run('afApply()');assert.equal(confirmations,2);assert.equal(s.d.getElementById('iin').value,'000000000010');assert.equal(s.d.getElementById('fio').value,'OLD DOCUMENT NAME');assert.match(s.d.querySelector('[data-for="iin"]').textContent,/Черновик из ГКБ/);assert.equal(s.d.querySelector('[data-for="iin"]').textContent.includes('Верно'),false);
 const rows=()=>s.d.querySelectorAll('#creditors > .repeat-rows > *').length;assert.equal(rows(),1);s.run('af.rowKeys.clear();afApply()');assert.equal(rows(),1,'Legacy/manual row with the same lender and contract is reused');assert.equal(confirmations,2);
 s.d.getElementById('fio').value='MANUAL NAME';s.run('afApply()');assert.equal(s.d.getElementById('fio').value,'MANUAL NAME');const take=[...s.d.querySelectorAll('#afConflicts button')].find(b=>b.textContent==='Взять из документа');assert.ok(take);let savesScheduled=0;const changed=s.w.ServerDrafts.changed;s.w.ServerDrafts.changed=()=>{savesScheduled++;changed();};take.click();assert.equal(s.d.getElementById('fio').value,'OLD DOCUMENT NAME');assert.equal(savesScheduled,1,'Taking a report value must schedule autosave');
 assert.equal(s.calls.some(c=>c.path.endsWith('/reviews')),false);assert.equal(s.w.HostedAssessment.getContext().client.iin,null);
});
test('actual supplied reports fill and restore four distinct active loans in the production form', {skip:!process.env.ASSESSMENT_REPORT_AUDIT_DIR},async t=>{
 const path=process.env.ASSESSMENT_REPORT_AUDIT_DIR,parsed=[55,54].map(n=>JSON.parse(fs.readFileSync(path+'/document ('+n+').json','utf8')));
 const s=await setup(t,{clientIin:null});await s.load();let confirmations=0;s.w.confirm=()=>{confirmations++;return true;};
 for(const [i,p] of parsed.entries()){
  const payload={...s.context,documentId:'report-'+i,extractionId:'parsed-'+i,eligibleForAutofill:false,eligibleForDraftAutofill:true,findings:['DEAL_IDENTITY_UNVERIFIED'],document:{...p.read,extraction:p.result}};
  s.run('selectedFiles.push({id:'+(i+1)+',file:{name:"report-'+i+'.pdf"},storedDocumentId:"report-'+i+'",person:"Клиент",type:"'+(i?'ГКБ — краткий отчёт':'ГКБ — полный отчёт')+'"});af.results.set('+(i+1)+',HostedAssessment.adapt('+JSON.stringify(payload)+'))');
 }
 s.run('afClientChoices();afApply()');assert.equal(confirmations,1);
 const readRows=()=>s.run('JSON.stringify([...document.querySelectorAll("#creditors > .repeat-rows > *")].map(row=>Object.fromEntries([...row.querySelectorAll("input,select")].map(e=>[e.id.replace(/_r\\d+$/, ""),e.value]))))');
 const rows=JSON.parse(readRows());assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.loanContractId)).size,4);assert.equal(rows.reduce((sum,r)=>sum+Math.round(Number(r.n8040)*100),0),1355636817);assert.equal(rows.filter(r=>r.loanStatus.startsWith('В просрочке')).every(r=>!r.n8041),true);assert.equal(s.d.getElementById('iin').value,parsed[0].result.identity.iin);assert.equal(s.d.getElementById('fio').value,parsed[0].result.identity.name);assert.equal(s.run('af.conflicts.length'),0);
 s.run('afApply()');assert.equal(JSON.parse(readRows()).length,4);
 const payload=s.w.ServerDrafts.capture(),reloaded=await setup(t,{clientIin:null,draft:{revision:4,identityRevision:1,payload:{...payload,documents:payload.documents.map((d,i)=>({...d,originalName:"report-"+i+".pdf"}))}},analyze:async(p,o,c)=>{const i=Number(p.match(/report-(\d+)/)[1]),r=parsed[i];return{ok:true,json:async()=>({...c,documentId:'report-'+i,extractionId:'parsed-'+i,eligibleForAutofill:false,eligibleForDraftAutofill:true,findings:['DEAL_IDENTITY_UNVERIFIED'],document:{...r.read,extraction:r.result}})};}});
 reloaded.w.confirm=()=>{throw Error('Reload must not ask to fill or modify a saved draft');};await reloaded.load();await tick();await tick();
 assert.equal(JSON.stringify(reloaded.w.ServerDrafts.capture().groups),JSON.stringify(payload.groups));assert.equal(reloaded.w.ServerDrafts.capture().documents.length,2);
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
