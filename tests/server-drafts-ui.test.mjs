import * as intake from '../public/intake-data.mjs';
import {test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import{JSDOM}from'jsdom';import{webcrypto}from'node:crypto';import ts from'typescript';
const schema=JSON.parse(fs.readFileSync('lib/questionnaire/schema.json','utf8'));const exports={};class RepositoryError extends Error{}
const recovery={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/questionnaire/draft-recovery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:recovery});
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/questionnaire/draft.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='../../public/intake-data.mjs'?intake:n==='./schema.json'?schema:n==='./draft-recovery'?recovery:{RepositoryError},Map,Set});
for(const mode of ['contract','handoff'])test(mode+' draft restore preserves answers and every document reference',async()=>{
 const html=fs.readFileSync('public/questionnaire.html','utf8'),dom=new JSDOM(html,{url:'http://local.test/questionnaire.html?mode='+mode,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,context=dom.getInternalVMContext();
 const run=s=>vm.runInContext(s,context);let stored=null,revision=0;
 w.crypto.randomUUID=()=>webcrypto.randomUUID();w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden')?[{}]:[];};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.fetch=async(url,options={})=>{
  if(url==='/api/assessment/11665')return{ok:true,json:async()=>({client:{external:{dealId:'11665'},iin:null,title:'SYNTHETIC'},identityRevision:1})};
  if(url==='/api/assessment/11665/draft'){
   if(options.method==='POST'){const body=JSON.parse(options.body);assert.equal(body.expectedRevision,revision);stored=JSON.parse(JSON.stringify(exports.validateDraft(body.payload)));revision++;return{ok:true,json:async()=>({ok:true,revision,latestRevision:revision,identityRevision:1})};}
   return{ok:true,json:async()=>({draft:stored?{payload:stored,revision,identityRevision:1,updatedAt:new Date().toISOString()}:null,currentIdentityRevision:1})};
  }
  throw Error('Unexpected API '+url);
 };
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))run(m[1]);for(const file of ['loan-status.js','money-input.js','hosted-assessment.js','assessment-review.js','intake-data.js','enforcement-editor.js','server-drafts.js'])run(fs.readFileSync('public/'+file,'utf8'));
 const d=w.document;d.getElementById('hostDealId').value='11665';await d.getElementById('hostLoadDeal').onclick();await w.ServerDrafts.inspect();
 d.getElementById('fio').value='SYNTHETIC DRAFT';d.getElementById('summa').value='500123';d.getElementById('marital').value='В браке';d.getElementById('marital').dispatchEvent(new w.Event('change',{bubbles:true}));
 run('setCount(document.getElementById("count-clientjobs"),2)');d.getElementById('count-clientjobs').dispatchEvent(new w.Event('change',{bubbles:true}));const jobs=d.querySelectorAll('#clientjobs .repeat-rows input[type=number]');jobs[0].value='120000';jobs[1].value='80000';
 const real=d.querySelector('[data-owner="client"][data-holding="real"]');real.checked=true;real.dispatchEvent(new w.Event('change',{bubbles:true}));d.querySelector('#clientreal .repeat-rows select').value='Дом';d.getElementById('comment').value='<img src=x onerror=alert(1)>';
 const businessNone=d.querySelector('[data-owner="client"][data-holding="businessNone"]');businessNone.checked=true;businessNone.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(real.checked,true);
 const enforcement=d.getElementById('enforcementStatus');enforcement.value='yes';enforcement.dispatchEvent(new w.Event('change',{bubbles:true}));
 const group=d.getElementById('enforcements');group.querySelector('[id^=enforcementCreditor]').value='SYNTHETIC CREDITOR';group.querySelector('[id^=enforcementAmount]').value='0';group.querySelector('.add-row').click();
 const second=group.querySelector('.repeat-rows').lastElementChild;second.querySelector('[id^=enforcementCreditor]').value='SYNTHETIC SECOND';second.querySelector('[id^=enforcementAmount]').value='1250.25';
 await w.ServerDrafts.save();assert.equal(revision,1);assert.ok(stored.groups.every(g=>!('html'in g)));assert.equal(stored.groups.find(g=>g.id==='clientjobs').rows.length,2);
 d.getElementById('fio').value='changed';d.getElementById('summa').value='1';run('setCount(document.getElementById("count-clientjobs"),0)');d.getElementById('count-clientjobs').dispatchEvent(new w.Event('change',{bubbles:true}));
 stored.documents=[{documentId:'stored-full',originalName:'full.pdf',type:'ГКБ — полный отчёт',person:'Клиент'},{documentId:'missing-name',type:'Подписанный договор',person:'Клиент'},{documentId:'identity',originalName:'identity.pdf',type:'Удостоверение личности',person:'Клиент'}];let analyses=0;w.afAnalyze=async preferences=>{analyses++;assert.equal(preferences.restoreOnly,true);};
 const restore=w.ServerDrafts.restore();await Promise.resolve();d.querySelector('[data-draft-replace]').click();await restore;assert.equal(w.ServerDrafts.recovery().answers.find(a=>a.key==='fio').value,'changed');assert.equal(d.getElementById('fio').value,'SYNTHETIC DRAFT');assert.equal(d.getElementById('summa').value,'500123');assert.equal(d.querySelectorAll('#clientjobs .repeat-rows input').length,2);assert.deepEqual(Array.from(d.querySelectorAll('#clientjobs .repeat-rows input'),e=>e.value),['120000','80000']);assert.equal(d.getElementById('partnerIncome').classList.contains('hidden'),false);assert.equal(d.getElementById('client-asset-real').classList.contains('hidden'),false);assert.equal(d.querySelector('#clientreal .repeat-rows select').value,'Дом');assert.equal(d.getElementById('count-partnerjobs').value,'');assert.equal(d.getElementById('clientCarCount').value,'');assert.equal(d.getElementById('comment').value,'<img src=x onerror=alert(1)>');assert.equal(d.querySelector('img[src=x]'),null);
 assert.equal(d.querySelector('[data-owner="client"][data-holding="businessNone"]').checked,true);assert.equal(d.getElementById('enforcementStatus').value,'yes');assert.equal(d.querySelectorAll('#enforcements .repeat-item').length,2);assert.deepEqual(Array.from(d.querySelectorAll('#enforcements input[id^=enforcementAmount]'),e=>e.value),['0','1250.25']);
 run("af.sources.set(document.querySelector('#creditors .repeat-rows input[id^=n8041]').id,{server:{documentId:'doc',extractionId:'ext'},serverFactKey:'credits.0.monthlyPayment',reviewId:'review',pending:false})");
 const binding=w.ServerDrafts.reviewBindings()[0];assert.equal(binding.key,'n8041');assert.equal(binding.group,'creditors');assert.equal(binding.row,0);assert.equal(binding.reviewId,'review');
 run("af.sources.values().next().value.pending=true");assert.equal(w.ServerDrafts.reviewBindings()[0].reviewId,null);
 assert.equal(analyses,mode==='handoff'?0:1);assert.equal(w.ServerDrafts.canSwitch(),true);assert.deepEqual(Array.from(w.ServerDrafts.capture().documents,v=>v.documentId),['stored-full','missing-name','identity']);
 const reviewType='Удостоверение личности';
 assert.equal(w.ServerDrafts.setDocumentReviewDraft('identity',reviewType,{issuedAt:'2020-01-02',expiresAt:'2030-01-02'}),true);
 assert.equal(w.ServerDrafts.isDirty(),true);await w.ServerDrafts.save();
 assert.equal(stored.documentReviewDrafts[0].values.issuedAt,'2020-01-02');
 assert.equal(stored.documentReviewDrafts[0].values.expiresAt,'2030-01-02');
 w.ServerDrafts.setDocumentReviewDraft('identity',reviewType,{issuedAt:'2021-01-02'});
 const reloadDates=w.ServerDrafts.restore();await Promise.resolve();d.querySelector('[data-draft-replace]').click();await reloadDates;
 assert.equal(w.ServerDrafts.getDocumentReviewDraft('identity',reviewType).issuedAt,'2020-01-02');
 assert.equal(w.ServerDrafts.getDocumentReviewDraft('identity',reviewType).expiresAt,'2030-01-02');
 assert.equal('complete'in w.ServerDrafts.getDocumentReviewDraft('identity',reviewType),false);
 assert.equal(w.ServerDrafts.setDocumentReviewDraft('other-client-file',reviewType,{issuedAt:'2020-01-02'}),false);
 dom.window.close();
});
