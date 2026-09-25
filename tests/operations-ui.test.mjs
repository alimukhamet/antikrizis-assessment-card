import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync('public/questionnaire.html','utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
async function respondConfirmation(s,pending,accept=true){
 await tick();const dialog=s.d.getElementById('afConfirmation');assert.ok(dialog?.open,'An in-page confirmation must be visible');
 const button=dialog.querySelector('.btn-main');assert.equal(button.disabled,true,'Confirmation requires an explicit unchecked agreement');
 if(accept){const checkbox=dialog.querySelector('input[type="checkbox"]');checkbox.checked=true;checkbox.dispatchEvent(new s.w.Event('change'));assert.equal(button.disabled,false);button.click();}else dialog.querySelector('.btn-ghost').click();
 return pending;
}
async function setup(t,{identity=null,mode='contract',draft=null,stageError=null,delayedDraft=false,handoff=null,powerReady=true,clientIin='000000000010',analyze=null,draftResponse=null,fastTimeout=false,answerIssues=[]}={}){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html'+(mode==='handoff'?'?mode=handoff':''),runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext()),calls=[],diagnostics=[],errors=[];
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener('error',event=>errors.push(event.error));
 let releaseDraft;const draftWait=new Promise(r=>{releaseDraft=r;});
 const context={caseId:'case',identityRevision:1,assessmentDay:'2026-09-16',client:{title:'SYNTHETIC CLIENT',iin:clientIin,external:{system:'bitrix',dealId:'900001'}}};
 if(fastTimeout){const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===30000||ms===15000||ms===25000?35:ms,...args);}
 const destination={categoryId:'13',fromStageId:'C13:FINAL_INVOICE',fromStageName:'Договор',stageId:'C13:WON',stageName:'Сделка завершена'};
 w.fetch=async(path,options={})=>{
  // Diagnostics have a separate, metadata-only destination; the assertions below
  // still reject every unintended customer-data write.
  if(path==='/api/operations-monitor'){
   const event=JSON.parse(options.body);assert.equal(options.method,'POST');
   assert.deepEqual(Object.keys(event).sort(),['id','dealId','action','code','clientVersion','status','asset','line'].sort());
   diagnostics.push(event);return {ok:true,json:async()=>({ok:true,serverVersion:d.body.dataset.assessmentVersion})};
  }
  calls.push({path,method:options.method||'GET',body:options.body});let result;
  if(path==='/api/assessment/900001')result=context;
  else if(path==='/api/assessment/clients')result={drafts:[],recent:[]};
  else if(identity&&path.endsWith('/identity'))result=await identity(JSON.parse(options.body),context);
  else if(path.endsWith('/draft')){if(options.method==='POST')result={revision:2,latestRevision:2};else{if(draftResponse)return draftResponse();if(delayedDraft)await draftWait;result={draft};}}
  else if(path.endsWith('/submission'))result={submission:null};
  else if(path.endsWith('/uploads'))result={unsent:null};
  else if(path.endsWith('/credentials'))result={credentials:{verified:false},identityRevision:1};
  else if(path.endsWith('/handoff'))result={handoff,destination,stageError,delivery:{ready:true}};
  else if(analyze&&path.endsWith('/analyze'))return analyze(path,options,context);
  else if(path.endsWith('/documents/power/analyze'))result={...context,documentId:'power',extractionId:'parsed-power',eligibleForAutofill:true,document:{totalPages:2,pages:[{text:'Synthetic page',needsOcr:false},{text:'Synthetic page two',needsOcr:false}],extraction:{identity:{iin:context.client.iin},kind:'power_of_attorney',facts:[],credits:[],findings:[]}},reviewContext:{pages:2,iin:context.client.iin}};
  else if(path.endsWith('/handoff-check'))result={identityRevision:1,documents:{packageReady:powerReady,issues:powerReady?[]:[{code:'POWER_SCOPE_REVIEW_REQUIRED',documentId:'power',message:'Сверьте полномочия.'}],manuallyReviewed:[],structurallyChecked:powerReady?['Доверенность']:[]}};
  else if(path.endsWith('/check'))result={identityRevision:1,answersComplete:false,issues:answerIssues,documents:{issues:[],manuallyReviewed:[]},evidence:{issues:[]}};
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
 return{w,d,run,calls,diagnostics,context,destination,releaseDraft,async load(){d.getElementById('hostDealId').value='900001';await d.getElementById('hostLoadDeal').onclick();await tick();}};
}
test('production portal starts with no client, no random deal, and no business writes',async t=>{
 const s=await setup(t);assert.equal(s.w.HostedAssessment.getContext(),null);assert.equal(s.d.body.dataset.uxClientState,'empty');assert.equal(s.d.getElementById('uxClientEntry').hidden,false);assert.equal(s.d.getElementById('questionnaireStep').inert,true);assert.equal(s.calls.length,0);
 assert.equal(s.run('requiredDocumentLabels().length'),6);assert.equal(s.run('requiredDocumentLabels().includes("Доверенность")'),false);assert.equal(s.run('requiredDocumentLabels().includes("ЭЦП файл")'),false);
 const controls=s.w.ServerDrafts.capture();assert.ok(controls.answers.length>=81);assert.equal(controls.groups.length,22); // + profilefamily (profile backfill only);
 await s.load();assert.equal(s.d.body.dataset.uxClientState,'ready');assert.match(s.d.querySelector('.wf-client-copy').textContent,/SYNTHETIC CLIENT/);assert.match(s.d.querySelector('.wf-client-copy').textContent,/900001/);
 assert.equal(s.d.querySelector('[data-client-path="/lawyer-handoff"]').getAttribute('href'),'/lawyer-handoff?dealId=900001');
 assert.equal(s.calls.some(c=>c.method==='POST'),false);
 assert.equal(s.diagnostics[0].code,'PAGE_OPEN');assert.equal(s.diagnostics[0].dealId,null);
 assert.ok(s.diagnostics.some(e=>e.code==='PAGE_OPEN'&&e.dealId==='900001'),'Selecting a client without a URL change must attach the real deal ID to diagnostics');
});
const storedDraft=(answers=[],groups=[],documents=[{documentId:'gkb',type:'ГКБ — полный отчёт',person:'Клиент',originalName:'synthetic-gkb.pdf'}])=>({revision:3,identityRevision:1,payload:{schemaVersion:1,answers,groups,docContext:{social:'0',salary:'0',salaryBank:'none'},pendingFiles:[],documents}});
test('client search does not recalculate or mutate the questionnaire on each keystroke',async t=>{
 const s=await setup(t);await s.load();await s.w.ClientWorkspace.open();
 const before=JSON.stringify(s.w.ServerDrafts.capture());let refreshes=0,styles=0;
 const refresh=s.w.AssessmentWorkflow.refresh,style=s.w.getComputedStyle;
 s.w.AssessmentWorkflow.refresh=(...args)=>{refreshes++;return refresh(...args);};
 s.w.getComputedStyle=(...args)=>{styles++;return style(...args);};
 const search=s.d.querySelector('input[aria-label="Найти клиента"]');
 for(const character of 'Darhan'){search.value+=character;search.dispatchEvent(new s.w.Event('input',{bubbles:true}));await tick();}
 assert.equal(refreshes,0);assert.equal(styles,0);
 assert.equal(JSON.stringify(s.w.ServerDrafts.capture()),before);
 assert.equal(s.calls.some(c=>c.method==='POST'),false);
});
test('transfer year survives digit-by-digit typing, UI refreshes, new rows and draft restoration',async t=>{
 const s=await setup(t);await s.load();s.d.getElementById('c8037').value='1';s.d.getElementById('c8037').dispatchEvent(new s.w.Event('change',{bubbles:true}));
 const input=s.d.querySelector('#transfers > .repeat-rows input[type="month"]'),editor=input.nextElementSibling.shadowRoot,month=editor.querySelector('select'),year=editor.querySelector('input');
 month.value='05';month.dispatchEvent(new s.w.Event('change',{bubbles:true}));await tick();assert.equal(month.value,'05');
 for(const digit of '2024'){year.value+=digit;year.dispatchEvent(new s.w.Event('input',{bubbles:true}));const typed=year.value;await tick();assert.equal(year.value,typed,'The next UI refresh must not erase a partial year');assert.equal(month.value,'05');}
 assert.equal(input.value,'2024-05');assert.equal(s.w.ServerDrafts.capture().groups.find(g=>g.id==='transfers').rows[0].find(a=>a.key==='n8034').value,'2024-05');
 const row=s.run("add(document.getElementById('transfers'))");await tick();const next=row.querySelector('input[type="month"]'),shadow=next.nextElementSibling.shadowRoot;
 for(const digit of '2025'){shadow.querySelector('input').value+=digit;shadow.querySelector('input').dispatchEvent(new s.w.Event('input',{bubbles:true}));await tick();}
 shadow.querySelector('select').value='02';shadow.querySelector('select').dispatchEvent(new s.w.Event('change',{bubbles:true}));await tick();assert.equal(next.value,'2025-02','Year-first entry works too');
 const captured=s.w.ServerDrafts.capture(),reopened=await setup(t,{draft:storedDraft(captured.answers,captured.groups,[])});await reopened.load();await tick();
 const dates=[...reopened.d.querySelectorAll('#transfers > .repeat-rows input[type="month"]')];assert.deepEqual(dates.map(e=>e.value),['2024-05','2025-02']);assert.equal(dates[0].nextElementSibling.shadowRoot.querySelector('input').value,'2024');
 input.value='';input.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(year.value,'','An explicit reset still clears the editor');
});
const evidence=context=>({...context,documentId:'gkb',extractionId:'parsed-gkb',eligibleForAutofill:Boolean(context.client.iin),findings:context.client.iin?[]:['DEAL_IDENTITY_UNVERIFIED'],document:{totalPages:1,pages:[{text:'SYNTHETIC',needsOcr:false}],extraction:{identity:{iin:'000000000010',name:'OLD DOCUMENT NAME'},kind:'gkb_full',facts:[{key:'identity.name',value:'OLD DOCUMENT NAME',page:1,source:'Synthetic name'},{key:'identity.iin',value:'000000000010',page:1,source:'Synthetic ID'}],credits:[{contractNumber:'SYNTHETIC-1',page:1,facts:[{key:'creditor',value:'SYNTHETIC BANK',page:1,source:'Synthetic bank'}]}],findings:[]}}});
test('floating download action shows live progress, blocks repeated clicks and exposes failures',async t=>{
 const s=await setup(t);await s.load();s.d.getElementById('needsSocialDoc').value='0';s.d.getElementById('needsSalaryDoc').value='none';
 s.run('requiredDocumentLabels().forEach((type,i)=>selectedFiles.push({id:i+1,type,person:"Клиент",storedDocumentId:"synthetic-"+i,file:{name:"synthetic-"+i+".pdf"}}))');
 assert.equal(s.w.AssessmentWorkflow.show('contract'),true);
 let finish;s.w.AssessmentCheck.run=()=>new Promise(resolve=>finish=resolve);
 const button=s.d.querySelector('.wf-bottom-nav > .btn-main');button.click();await tick();
 assert.equal(button.disabled,true);assert.match(button.textContent,/Проверяю/);assert.equal(s.d.getElementById('workflowDownloadStatus').hidden,false);
 finish();await tick();assert.equal(button.disabled,false);assert.match(s.d.getElementById('workflowDownloadStatus').textContent,/Проверка не завершена/);
 s.w.AssessmentWorkflow.show('answers');assert.equal(s.d.getElementById('workflowDownloadStatus').hidden,true);assert.equal(button.disabled,false);
});
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
test('opening an outdated analysis refreshes its PDF while preserving answers and missing-IIN warnings',async t=>{
 const draft=storedDraft([{key:'fio',value:'KEEP MANUAL NAME',checked:false},{key:'iin',value:'000000000010',checked:false}]);
 const stale=await setup(t,{draft,analyze:async(p,o,c)=>JSON.parse(o.body).cacheOnly?{ok:false,json:async()=>({error:'CACHE_REPROCESS_REQUIRED'})}:{ok:true,json:async()=>evidence(c)}});await stale.load();await tick();
 const reads=stale.calls.filter(c=>c.path.endsWith('/analyze'));assert.deepEqual(reads.map(c=>JSON.parse(c.body).cacheOnly),[true,false]);assert.equal(reads[0].path,reads[1].path);assert.equal(stale.d.body.dataset.uxClientState,'ready');assert.equal(stale.run('af.results.get(1).error'),undefined);assert.equal(stale.d.getElementById('fio').value,'KEEP MANUAL NAME');assert.equal(stale.w.ServerDrafts.isDirty(),false);assert.equal(stale.calls.some(c=>c.method==='POST'&&c.path.endsWith('/draft')),false);
 const missing=await setup(t,{draft:storedDraft(),clientIin:null,analyze:async(p,o,c)=>({ok:true,json:async()=>evidence(c)})});await missing.load();await tick();assert.equal(missing.d.getElementById('uxIdentityWarning').hidden,false);assert.match(missing.d.getElementById('uxIdentityWarning').textContent,/ИИН заполняется из ГКБ/);assert.equal(missing.run('af.results.get(1).blocked'),true);
});
test('document IIN is confirmed once, enables verified flow and preserves manual edits',async t=>{
 const s=await setup(t,{clientIin:null,identity:async(body,c)=>({...c,client:{...c.client,iin:'000000000010'},analysis:{...p,client:{...c.client,iin:'000000000010'},eligibleForAutofill:true,eligibleForDraftAutofill:false,findings:[]}})});await s.load();const p={...evidence(s.context),eligibleForDraftAutofill:true};
 p.document.extraction.credits[0].facts.push({key:'contractIdentifier',value:'SYNTHETIC-1',page:1,source:'Synthetic contract'});
 s.run('selectedFiles.push({id:1,file:{name:"synthetic.pdf"},storedDocumentId:"gkb",type:"ГКБ — полный отчёт",person:"Клиент"})');
 s.run('af.results.set(1,HostedAssessment.adapt('+JSON.stringify(p)+'));afClientChoices()');
 s.w.confirm=()=>{throw Error('Native confirmation must not be used');};await respondConfirmation(s,s.run('afApply()'),false);assert.equal(s.d.getElementById('iin').value,'');assert.equal(s.calls.filter(c=>c.path.endsWith('/identity')).length,0);
 await respondConfirmation(s,s.run('afApply()'));assert.equal(s.d.getElementById('iin').value,'000000000010');assert.equal(s.d.getElementById('fio').value,'OLD DOCUMENT NAME');assert.equal(s.d.querySelector('[data-for="iin"]').textContent.includes('Верно'),false);assert.equal(s.d.getElementById('uxIdentityWarning').hidden,true);
 const rows=()=>s.d.querySelectorAll('#creditors > .repeat-rows > *').length;assert.equal(rows(),1);await s.run('af.rowKeys.clear();afApply()');assert.equal(rows(),1,'Legacy/manual row with the same lender and contract is reused');assert.equal(s.d.getElementById('afConfirmation'),null);
 s.d.getElementById('fio').value='MANUAL NAME';s.run('afApply()');assert.equal(s.d.getElementById('fio').value,'MANUAL NAME');const take=[...s.d.querySelectorAll('#afConflicts button')].find(b=>b.textContent==='Взять из документа');assert.ok(take);let savesScheduled=0;const changed=s.w.ServerDrafts.changed;s.w.ServerDrafts.changed=()=>{savesScheduled++;changed();};take.click();assert.equal(s.d.getElementById('fio').value,'OLD DOCUMENT NAME');assert.equal(savesScheduled,1,'Taking a report value must schedule autosave');
 assert.equal(s.calls.some(c=>c.path.endsWith('/reviews')),false);assert.equal(s.w.HostedAssessment.getContext().client.iin,'000000000010');assert.equal(s.calls.filter(c=>c.path.endsWith('/identity')).length,1);
});
test('normal document check resolves the GKB identity without restoring deleted answers or confirming facts',async t=>{
 const draft=storedDraft([{key:'fio',value:'',checked:false},{key:'iin',value:'',checked:false}],[{id:'creditors',rows:[],rowKeys:[]}]);
 const s=await setup(t,{clientIin:null,draft,analyze:async(p,o,c)=>({ok:true,json:async()=>({...evidence(c),eligibleForDraftAutofill:true})}),identity:async(body,c)=>{const fresh={...c,client:{...c.client,iin:'000000000010'}};return{...fresh,analysis:evidence(fresh)};}});await s.load();await tick();
 s.w.confirm=()=>{throw Error('Native confirmation must not be used');};
 const warning=s.d.getElementById('uxIdentityWarning');assert.match(warning.textContent,/ИИН найден в ГКБ/);assert.match(warning.textContent,/000000000010/);assert.doesNotMatch(warning.textContent,/Взять ИИН/);
 const before=s.w.ServerDrafts.capture();const pending=s.w.AssessmentCheck.documents();await tick();assert.equal(s.calls.filter(c=>c.path.endsWith('/identity')).length,0,'Reading a GKB alone must never bind it to an unconfirmed deal');
 const result=await respondConfirmation(s,pending);assert.ok(result);assert.equal(s.calls.filter(c=>c.path.endsWith('/identity')).length,1);assert.equal(s.calls.filter(c=>c.path.endsWith('/check')).length,1,'Continue to the original action in the same click');
 assert.equal(s.d.getElementById('iin').value,'000000000010');assert.equal(s.d.getElementById('fio').value,'');assert.equal(s.d.querySelectorAll('#creditors > .repeat-rows > *').length,0);
 const after=s.w.ServerDrafts.capture();assert.equal(JSON.stringify(after.groups),JSON.stringify(before.groups));assert.equal(JSON.stringify(after.documents),JSON.stringify(before.documents));assert.equal(s.calls.some(c=>c.path.includes('/reviews')),false);
});
test('IIN action is disabled during document loading, and cancelling the in-page confirmation performs no write',async t=>{
 let release;const wait=new Promise(r=>release=r);const s=await setup(t,{clientIin:null,draft:storedDraft(),analyze:async(p,o,c)=>{await wait;return{ok:true,json:async()=>({...evidence(c),eligibleForDraftAutofill:true})};}});await s.load();
 assert.equal(s.d.querySelector('#uxIdentityWarning button').disabled,true);release();await tick();await tick();assert.equal(s.d.querySelector('#uxIdentityWarning button').disabled,false);
 await respondConfirmation(s,s.w.AssessmentCheck.documents(),false);assert.equal(s.calls.some(c=>c.path.endsWith('/identity')||c.path.endsWith('/check')),false);assert.match(s.d.getElementById('documentCheckStatus').textContent,/отменено/);
});
test('identity retries only a known pre-write CRM failure, not uncertain writes or client timeouts',async t=>{
 for(const code of ['BITRIX_TEMPORARILY_UNAVAILABLE','IDENTITY_SAVE_UNCERTAIN','REQUEST_TIMEOUT']){
  const s=await setup(t,{clientIin:null,identity:async(body,c)=>{const fresh={...c,client:{...c.client,iin:'000000000010'}};return{...fresh,analysis:evidence(fresh)};}});await s.load();const p={...evidence(s.context),eligibleForDraftAutofill:true};
  s.run('selectedFiles.push({id:1,file:{name:"synthetic.pdf"},storedDocumentId:"gkb",type:"ГКБ — полный отчёт",person:"Клиент"});af.results.set(1,HostedAssessment.adapt('+JSON.stringify(p)+'));afClientChoices()');
  let attempts=0;const fetch=s.w.fetch;s.w.fetch=async(path,options)=>{if(path.endsWith('/identity')&&++attempts===1)return{ok:false,json:async()=>({error:code})};return fetch(path,options);};
  const result=await respondConfirmation(s,s.run('afEnsureIdentity()'));assert.equal(attempts,code==='BITRIX_TEMPORARILY_UNAVAILABLE'?2:1);assert.equal(result,code==='BITRIX_TEMPORARILY_UNAVAILABLE');
  if(code!=='BITRIX_TEMPORARILY_UNAVAILABLE'){assert.equal(s.d.getElementById('iin').value,'');assert.equal(s.d.querySelector('#uxIdentityWarning button').disabled,false);}
 }
});
test('changing a document or answer while confirming identity stops the write',async t=>{
 const s=await setup(t,{clientIin:null});await s.load();const p={...evidence(s.context),eligibleForDraftAutofill:true};s.run('selectedFiles.push({id:1,file:{name:"synthetic.pdf"},storedDocumentId:"gkb",type:"ГКБ — полный отчёт",person:"Клиент"});af.results.set(1,HostedAssessment.adapt('+JSON.stringify(p)+'));afClientChoices()');
 const pending=s.run('afEnsureIdentity()');s.d.getElementById('fio').value='Changed during confirmation';await respondConfirmation(s,pending);assert.equal(s.calls.some(c=>c.path.endsWith('/identity')),false);assert.match(s.d.getElementById('afStatus').textContent,/изменились/);
});
test('identity upgrade keeps corrected values and reasons pending, and preserves an explicit choice among multiple IINs',async t=>{
 const s=await setup(t,{clientIin:null,identity:async(body,c)=>{const fresh={...c,client:{...c.client,iin:'000000000010'}};return{...fresh,analysis:evidence(fresh)};}});await s.load();const p={...evidence(s.context),eligibleForDraftAutofill:true};
 s.run('selectedFiles.push({id:1,file:{name:"synthetic.pdf"},storedDocumentId:"gkb",type:"ГКБ — полный отчёт",person:"Клиент"});af.results.set(1,HostedAssessment.adapt('+JSON.stringify(p)+'));afClientChoices()');
 s.d.getElementById('fio').value='Manual correction';s.run('af.sources.set("fio",{...af.results.get(1).fields.find(f=>f.key==="fio"),fileId:1,pending:true,edited:true,correctionReason:"Original spelling verified"})');
 await respondConfirmation(s,s.run('afEnsureIdentity()'));assert.equal(s.d.getElementById('fio').value,'Manual correction');assert.equal(s.run('af.sources.get("fio").server.draftOnly'),undefined);assert.equal(s.run('af.sources.get("fio").pending'),true);assert.equal(s.run('af.sources.get("fio").correctionReason'),'Original spelling verified');assert.equal(s.calls.some(c=>c.path.includes('/reviews')),false);
 s.d.getElementById('iin').value='';s.run('selectedFiles.push({id:2,file:{name:"other.pdf"}});af.results.set(2,{identity:{iin:"000000000011",fio:"Other person"}});afClientChoices()');s.d.getElementById('afClient').value='000000000011';s.run('afClientChoices()');assert.equal(s.d.getElementById('afClient').value,'000000000011');
});
test('download invokes identity confirmation and then the separate fact review, with a visible cancellation result',async t=>{
 const s=await setup(t,{clientIin:null,identity:async(body,c)=>{const fresh={...c,client:{...c.client,iin:'000000000010'}};return{...fresh,analysis:evidence(fresh)};}});await s.load();const p={...evidence(s.context),eligibleForDraftAutofill:true};
 s.run('selectedFiles.push({id:1,file:{name:"synthetic.pdf"},storedDocumentId:"gkb",type:"ГКБ — полный отчёт",person:"Клиент"});af.results.set(1,HostedAssessment.adapt('+JSON.stringify(p)+'));afClientChoices()');
 const pending=s.d.getElementById('saveAssessment').onclick();await respondConfirmation(s,Promise.resolve());
 await respondConfirmation(s,pending,false);assert.equal(s.calls.filter(c=>c.path.endsWith('/identity')).length,1);assert.equal(s.calls.some(c=>c.path.includes('/reviews')||c.path.endsWith('/check')||c.path.endsWith('/submission')&&c.method==='POST'),false);assert.match(s.d.getElementById('checkStatus').textContent,/Подтверждение отменено/);assert.equal(s.d.getElementById('saveAssessment').disabled,false);
});
test('actual supplied reports fill and restore four distinct active loans in the production form', {skip:!process.env.ASSESSMENT_REPORT_AUDIT_DIR},async t=>{
 const path=process.env.ASSESSMENT_REPORT_AUDIT_DIR,parsed=[55,54].map(n=>JSON.parse(fs.readFileSync(path+'/document ('+n+').json','utf8')));
 const reportResponse=(i,c)=>({...c,documentId:'report-'+i,extractionId:'parsed-'+i,eligibleForAutofill:true,eligibleForDraftAutofill:false,findings:[],document:{...parsed[i].read,extraction:parsed[i].result}});
 const owner=parsed[0].result.identity.iin;const s=await setup(t,{clientIin:null,identity:async(b,c)=>{const fresh={...c,client:{...c.client,iin:owner}};return{...fresh,analysis:reportResponse(0,fresh)};},analyze:async(p,o,c)=>({ok:true,json:async()=>reportResponse(Number(p.match(/report-(\d+)/)[1]),{...c,client:{...c.client,iin:owner}})})});await s.load();s.w.confirm=()=>{throw Error('Native confirmation must not be used');};
 for(const [i,p] of parsed.entries()){
  const payload={...s.context,documentId:'report-'+i,extractionId:'parsed-'+i,eligibleForAutofill:false,eligibleForDraftAutofill:true,findings:['DEAL_IDENTITY_UNVERIFIED'],document:{...p.read,extraction:p.result}};
  s.run('selectedFiles.push({id:'+(i+1)+',file:{name:"report-'+i+'.pdf"},storedDocumentId:"report-'+i+'",person:"Клиент",type:"'+(i?'ГКБ — краткий отчёт':'ГКБ — полный отчёт')+'"});af.results.set('+(i+1)+',HostedAssessment.adapt('+JSON.stringify(payload)+'))');
 }
 await respondConfirmation(s,s.run('afClientChoices();afApply()'));assert.equal(s.calls.filter(c=>c.path.endsWith('/identity')).length,1);
 const readRows=()=>s.run('JSON.stringify([...document.querySelectorAll("#creditors > .repeat-rows > *")].map(row=>Object.fromEntries([...row.querySelectorAll("input,select")].map(e=>[e.id.replace(/_r\\d+$/, ""),e.value]))))');
 const rows=JSON.parse(readRows());assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.loanContractId)).size,4);assert.equal(rows.reduce((sum,r)=>sum+Math.round(Number(r.n8040)*100),0),1355636817);assert.equal(rows.filter(r=>r.loanStatus.startsWith('В просрочке')).every(r=>!r.n8041),true);assert.equal(s.d.getElementById('iin').value,parsed[0].result.identity.iin);assert.equal(s.d.getElementById('fio').value,parsed[0].result.identity.name);assert.equal(s.run('af.conflicts.length'),0);
 s.run('afApply()');assert.equal(JSON.parse(readRows()).length,4);
 const payload=s.w.ServerDrafts.capture(),reloaded=await setup(t,{clientIin:owner,draft:{revision:4,identityRevision:1,payload:{...payload,documents:payload.documents.map((d,i)=>({...d,originalName:"report-"+i+".pdf"}))}},analyze:async(p,o,c)=>{const i=Number(p.match(/report-(\d+)/)[1]),r=parsed[i];return{ok:true,json:async()=>({...c,documentId:'report-'+i,extractionId:'parsed-'+i,eligibleForAutofill:true,eligibleForDraftAutofill:false,findings:[],document:{...r.read,extraction:r.result}})};}});
 reloaded.w.afConfirmDialog=()=>{throw Error('Reload must not ask to fill or modify a saved draft');};await reloaded.load();await tick();await tick();
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

 test('missing-answer links stay visible after navigation to the field and back to contract',async t=>{
 const s=await setup(t,{answerIssues:[{group:'creditors',row:0,key:'n8041',label:'Ежемесячный платёж'}]});await s.load();s.d.getElementById('needsSocialDoc').value='0';s.d.getElementById('needsSalaryDoc').value='none';
 s.run('requiredDocumentLabels().forEach((type,i)=>selectedFiles.push({id:i+1,type,person:"Клиент",storedDocumentId:"synthetic-"+i,file:{name:"synthetic-"+i+".pdf"}}))');
 s.w.AssessmentWorkflow.show('contract');await s.w.AssessmentCheck.run();
 const links=s.d.getElementById('answerCheckIssues');assert.equal(links.hidden,false);assert.equal(links.closest('[data-assessment-step]').dataset.stepCurrent,'true');assert.equal(s.d.body.dataset.assessmentWorkflow,'answers');assert.equal(s.d.activeElement.tagName,'MONEY-INPUT');assert.match(s.d.activeElement.source.id,/^n8041/);assert.equal(s.d.activeElement.shadowRoot.activeElement.tagName,'INPUT');
 s.w.AssessmentWorkflow.show('contract');assert.equal(links.closest('[data-assessment-step]').dataset.stepCurrent,'true');links.querySelector('button').click();assert.equal(s.d.body.dataset.assessmentWorkflow,'answers');
});
