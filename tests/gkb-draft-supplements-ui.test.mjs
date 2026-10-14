import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {JSDOM} from 'jsdom';import * as planner from '../public/gkb-draft-supplements.mjs';
const iin='991231300003',ctx={client:{iin,external:{dealId:'11665'}},identityRevision:1,assessmentDay:'2026-10-14'};
const fact=(key,value)=>({key,value,page:1,source:'SYNTHETIC ONLY'});
function setup(){
 const html=fs.readFileSync('public/questionnaire.html','utf8'),dom=new JSDOM(html,{url:'http://local.test/questionnaire.html?mode=profile',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,run=s=>vm.runInContext(s,dom.getInternalVMContext());
 w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLElement.prototype.getClientRects=function(){return [{}];};w.GkbDraftSupplements=planner;w.HostedAssessment={getContext:()=>ctx,mount(){},ready:()=>false};w.fetch=async()=>{throw Error('No review or remote writes allowed');};
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))run(m[1]);run(fs.readFileSync('public/loan-status.js','utf8'));run(fs.readFileSync('public/assessment-review.js','utf8'));
 const credit=(id,missing)=>({contractNumber:id,page:1,facts:[fact('creditor','SYNTHETIC BANK'),fact('overdueDays','0'),...missing?[]:[fact('debtOutstanding','100.25')]],components:{remaining:null,arrears:'0.00',penalty:'0.00'}});
 const reports=['gkbShort','gkbFull'].map((kind,i)=>({kind,blocked:!i,date:'2026-08-25',identity:{iin},server:{dealId:'11665',identityRevision:1,documentId:'doc-'+i,extractionId:'ext-'+i},creditEvidence:{readable:true,credits:[credit('MATCH',!!i),credit(i?'OTHER-FULL':'OTHER..',false)],creditList:{declared:2,complete:!!i},findings:i?['TOTAL_DEBT_REQUIRES_RECONCILIATION']:['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED']}}));
 w.reports=reports;run(`af.client='${iin}';af.results.set(1,reports[0]);af.results.set(2,reports[1]);selectedFiles.push({id:1,person:'Клиент',file:{name:'short.pdf'}},{id:2,person:'Клиент',file:{name:'full.pdf'}});`);
 const row=run(`afRow('creditors','${iin}|SYNTHETIC BANK|MATCH')`),field=key=>[...row.querySelectorAll('input,select,textarea')].find(e=>e.id.replace(/_r\d+$/,'')===key);
 field('n8038').value='SYNTHETIC BANK';field('loanContractId').value='MATCH';
 return {dom,w,run,row,field,reports};
}
test('explicit fill writes only blank balance and restores an unconfirmed source after reload',async()=>{
 const f=setup();try{
  assert.equal(await f.run('afSupplementDraftBalances()'),0);assert.equal(f.field('n8040').value,'');
  f.run('af.fillingMissing=true');assert.equal(await f.run('afSupplementDraftBalances()'),1);assert.equal(f.field('n8040').value,'100.25');assert.equal(f.field('n8041').value,'');assert.equal(f.field('n8042').value,'');assert.equal(f.field('loanStatus').value,'');
  assert.match(f.field('n8040').closest('.field').textContent,/требуется сверка отчётов/);assert.equal(f.reports[0].blocked,true);
  assert.equal(await f.run('afConfirmPending()'),true,'draft supplements are excluded from ordinary reviews; server package check still decides readiness');assert.equal(f.run('af.sources.size'),1);const source=f.run('af.sources.values().next().value');assert.equal(source.pending,true);assert.equal(source.reviewId,undefined);
  assert.equal(await f.run('afSupplementDraftBalances()'),0);
  f.run('af.fillingMissing=false;af.sources.clear();af.restoringEvidence=true');assert.equal(await f.run('afSupplementDraftBalances()'),1);assert.equal(f.run('af.sources.size'),1);
  f.run('af.sources.clear()');f.field('n8040').value='';assert.equal(await f.run('afSupplementDraftBalances()'),0);assert.equal(f.field('n8040').value,'');
 }finally{await new Promise(resolve=>setTimeout(resolve,20));f.dom.window.close();}
});
test('staff values, zero, cleared/replaced answers, stale context and ambiguous rows stay unchanged',async()=>{
 for(const change of [f=>{f.field('n8040').value='0';},f=>{f.field('n8040').value='250';},f=>{f.field('n8040').dataset.sourceReplaced='true';},f=>{f.field('n8040').dataset.clientConfirmedValue='0';},f=>{f.reports[0].server.identityRevision=2;},f=>{f.row.parentElement.append(f.row.cloneNode(true));}]){
  const f=setup();try{change(f);const before=f.row.innerHTML,value=f.field('n8040').value;f.run('af.fillingMissing=true');assert.equal(await f.run('afSupplementDraftBalances()'),0);assert.equal(f.field('n8040').value,value);assert.equal(f.row.innerHTML,before);}finally{await new Promise(resolve=>setTimeout(resolve,20));f.dom.window.close();}
 }
});

test('supplements cannot enter fact review bindings and yield to a subsequently eligible source',async()=>{
 const f=setup();try{
  f.run('af.fillingMissing=true');await f.run('afSupplementDraftBalances()');
  f.run(fs.readFileSync('public/server-drafts.js','utf8'));
  assert.equal(f.w.ServerDrafts.reviewBindings().length,0);
  f.run('af.fillingMissing=false');
  const input=f.field('n8040'),source={fileId:2,page:1,server:f.reports[1].server,serverFactKey:'credits.0.debtOutstanding'};
  assert.equal(f.w.afPut(input,'100.25',source),true,'new eligible source replaces unconfirmed draft supplement');
  assert.equal(f.run('af.sources.values().next().value.gkbDraftSupplement'),undefined);
  const bindings=f.w.ServerDrafts.reviewBindings();assert.equal(bindings.length,1);assert.equal(bindings[0].documentId,'doc-1');assert.equal(bindings[0].reviewId,null);
 }finally{await new Promise(resolve=>setTimeout(resolve,20));f.dom.window.close();}
});
