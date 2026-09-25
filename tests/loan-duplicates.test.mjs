import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

function setup(t){
 const dom=new JSDOM('<button id="checkQuestions"></button><div id="creditors"><div class="repeat-rows"></div></div>',{runScripts:'outside-only',url:'https://assessment.example'}),w=dom.window,d=w.document;
 t.after(()=>dom.window.close());w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const parent=d.querySelector('.repeat-rows');
 for(let i=0;i<3;i++){const row=d.createElement('div');row.id='loan-'+i;row.className='repeat-item';for(const [key,value]of Object.entries({n8038:'SYNTHETIC BANK',loanContractId:i===2?'OTHER-LOAN':'LOAN-A',n8040:'100.25',n8041:i===0?'10':'20',loanParticipants:'Нет',n8039:i===0?'Кредитная карта':'Потребительский кредит'})){const input=d.createElement('input');input.id=key+'_r'+i;input.value=value;row.append(input);}parent.append(row);}
 const calls=[],contexts=[{client:{external:{dealId:'synthetic'}}}];
 w.af={busy:false,rowKeys:new Map([...parent.children].map((row,i)=>['source-'+i,row.id])),sources:new Map([...parent.querySelectorAll('input')].map(input=>[input.id,{reviewId:'saved-'+input.id}])),conflicts:[{key:'conflict-0',id:'n8041_r0'},{key:'conflict-other',id:'n8041_r2'}]};
 w.HostedAssessment={ready:()=>true,getContext:()=>contexts[0]};let saveOk=true,onSave=null;
 const capture=()=>({rows:[...parent.children].map(row=>({id:row.id,values:[...row.querySelectorAll('input')].map(input=>[input.id,input.value])})),documents:[{documentId:'unchanged-original'}]});
 w.ServerDrafts={capture,isBusy:()=>false,save:async()=>{calls.push({action:'save',payload:capture()});if(onSave)await onSave();return saveOk;}};
 w.afRefresh=()=>{};w.renumber=()=>{};w.AssessmentWorkflow={refresh:()=>{},reveal:input=>calls.push({action:'focus',id:input.id})};
 w.afAnalyze=async options=>calls.push({action:'restore-evidence',options});w.AssessmentCheck={run:async()=>calls.push({action:'check'})};
 w.eval(fs.readFileSync('public/loan-duplicates.js','utf8'));
 const loan={creditor:'SYNTHETIC BANK',contractNumber:'LOAN-A',aliases:['LOAN-A'],rows:[0,1],duplicateRows:[0,1],documentId:'synthetic-pdf',page:3};
 return {w,d,parent,calls,contexts,capture,loan,setSaveOk:value=>{saveOk=value;},onSave:fn=>{onSave=fn;},open:()=>w.LoanDuplicates.open(loan),choose:async index=>d.querySelector(`[data-keep-loan="${index}"]`).onclick()};
}

test('comparison shows differing payments and preserves the entire chosen record, unrelated loan and originals',async t=>{
 const s=setup(t),before=s.capture();assert.equal(s.open(),true);assert.match(s.d.querySelector('dialog').textContent,/Оставить эту запись/);assert.match(s.d.querySelector('dialog').textContent,/Кредитная карта/);assert.equal(s.d.querySelectorAll('.loan-duplicate-card').length,2);
 await s.choose(1);assert.equal(s.parent.children.length,2);assert.deepEqual(s.capture().rows,[before.rows[1],before.rows[2]]);assert.deepEqual(s.capture().documents,before.documents);
 assert.deepEqual(s.calls.map(c=>c.action),['save','restore-evidence','check']);assert.equal(s.calls[1].options.restoreOnly,true);assert.equal(s.w.af.rowKeys.has('source-0'),false);assert.equal(s.w.af.sources.has('n8041_r0'),false);assert.equal(s.w.af.sources.get('n8041_r1').reviewId,'saved-n8041_r1');assert.deepEqual(Array.from(s.w.af.conflicts,c=>c.key),['conflict-other']);
 await s.d.querySelector('.loan-duplicate-undo button').onclick();assert.deepEqual(s.capture(),before);assert.equal(s.w.af.rowKeys.get('source-0'),'loan-0');assert.equal(s.w.af.sources.get('n8041_r0').reviewId,'saved-n8041_r0');assert.equal(s.w.af.conflicts.length,2);
});
test('failed save restores both records and their evidence without an automatic retry or confirmation',async t=>{
 const s=setup(t),before=s.capture();s.setSaveOk(false);s.open();await s.choose(1);assert.deepEqual(s.capture(),before);assert.equal(s.calls.length,1);assert.equal(s.w.af.sources.has('n8041_r0'),true);assert.equal(s.w.af.rowKeys.has('source-0'),true);assert.match(s.d.querySelector('dialog [role=status]').textContent,/не подтверждено/);
});
test('a changed form cannot apply an obsolete selection',async t=>{
 const s=setup(t);s.open();s.d.getElementById('n8041_r1').value='25';await s.choose(1);assert.equal(s.parent.children.length,3);assert.equal(s.calls.length,0);assert.match(s.d.querySelector('dialog [role=status]').textContent,/Ответы изменились/);
});
test('a wrong contract number opens that field, never keeps or approves the mismatched row',async t=>{
 const s=setup(t);s.d.getElementById('loanContractId_r0').value='OTHER-BANK-NUMBER';const before=s.capture();s.open();assert.equal(s.d.querySelector('[data-keep-loan="0"]').textContent,'Исправить номер');await s.choose(0);assert.deepEqual(s.capture(),before);assert.deepEqual(s.calls,[{action:'focus',id:'loanContractId_r0'}]);
});
test('case switches close the dialog and never restore old rows or run checks in a different case',async t=>{
 const s=setup(t);s.open();s.onSave(async()=>{s.contexts[0]={client:{external:{dealId:'another'}}};s.parent.replaceChildren();s.d.dispatchEvent(new s.w.Event('assessment-case-opened'));});s.setSaveOk(false);await s.choose(1);assert.equal(s.parent.children.length,0);assert.equal(s.d.querySelector('dialog'),null);assert.deepEqual(s.calls.map(c=>c.action),['save']);
});
