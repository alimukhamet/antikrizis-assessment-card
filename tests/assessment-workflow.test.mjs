import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const html=fs.readFileSync('public/questionnaire.html','utf8');
function setup(t){
 const dom=new JSDOM(html,{url:'https://assessment.example/questionnaire.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext());
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[data-step-current="false"]')?[{}]:[];};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 const calls=[];
 w.fetch=async(path,options={})=>{
  calls.push({path,method:options.method||'GET'});
  if(path==='/api/assessment/11665')return{ok:true,json:async()=>({caseId:'synthetic-case',identityRevision:1,assessmentDay:'2026-09-12',client:{title:'SYNTHETIC UX TEST',iin:'991231300003',external:{system:'bitrix',dealId:'11665'}}})};
  if(path.endsWith('/check'))return{ok:true,json:async()=>({identityRevision:1,answersComplete:true,readyToSubmit:true,issues:[],documents:{issues:[],manuallyReviewed:[]},evidence:{issues:[]}})};
  if(path.endsWith('/draft'))return{ok:true,json:async()=>({draft:null})};
  if(path.endsWith('/submission'))return{ok:true,json:async()=>({submission:null})};
  if(path.endsWith('/credentials'))return{ok:true,json:async()=>({credentials:{verified:false},identityRevision:1})};
  if(path.endsWith('/uploads'))return{ok:true,json:async()=>({unsent:null})};
  throw Error('Unexpected test request: '+path);
 };
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))run(match[1]);
 for(const name of ['loan-status','money-input','hosted-assessment','assessment-review','intake-data','enforcement-editor','server-drafts','document-review','document-upload','credential-upload','submission-flow','server-answer-check','client-confirmed-amount','required-answers','document-replacement'])run(fs.readFileSync('public/'+name+'.js','utf8'));
 t.after(async()=>{await new Promise(resolve=>setTimeout(resolve,0));dom.window.close();});
 const capture=()=>JSON.parse(JSON.stringify(w.ServerDrafts.capture()));
 return{w,d,run,calls,capture,mount(){run(fs.readFileSync('public/assessment-workflow.js','utf8'));},async load(){d.getElementById('hostDealId').value='11665';await d.getElementById('hostLoadDeal').onclick();await new Promise(resolve=>setTimeout(resolve,0));}};
}

// Already stored synthetic documents isolate navigation from upload transport.
function collect(s){
 s.run(`document.getElementById('needsSocialDoc').value='0';document.getElementById('needsSalaryDoc').value='none';selectedFiles=requiredDocumentLabels().filter(type=>type!=='ЭЦП файл').map((type,i)=>({id:i+1,type,person:'Клиент',storedDocumentId:'synthetic-'+i,file:{name:type+'.pdf',size:10}}));CredentialUpload={...CredentialUpload,collected:()=>true};`);
 s.w.AssessmentWorkflow?.refresh();
}
function mountParticipants(s){s.run('(()=>{'+fs.readFileSync('public/loan-participants.mjs','utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync('public/loan-participants-editor.mjs','utf8').replace(/^import .*;\n/,'')+'})();');}

test('batch upload starts with the client owner and preserves a selected family exception',t=>{
 const s=setup(t);s.mount();const input=s.d.getElementById('previewDocuments');
 assert.equal(s.d.getElementById('workflowCollection').hidden,true);assert.equal(s.d.querySelector('.wf-bottom-nav .btn-main').textContent,'Выберите клиента');
 const choose=name=>{Object.defineProperty(input,'files',{value:[new s.w.File(['synthetic'],name,{type:'application/pdf'})],configurable:true});input.dispatchEvent(new s.w.Event('change',{bubbles:true}));};
 choose('client.pdf');assert.equal(s.run('selectedFiles[0].person'),'Клиент');
 assert.equal(s.d.querySelector('.wf-file-assignments').open,false);
 const owner=s.d.getElementById('doc-1-person');owner.value='Супруг(а)';owner.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 assert.match(owner.getAttribute('aria-label'),/Чей документ: client\.pdf/);for(const id of ['saveDraft','afExport','hostLoadDeal'])assert.ok(s.d.getElementById(id).getAttribute('aria-label'),id);
 choose('second-client.pdf');assert.deepEqual(JSON.parse(s.run('JSON.stringify(selectedFiles.map(f=>f.person))')),['Супруг(а)','Клиент']);
 assert.equal(s.run('af.sources.size'),0);assert.equal(s.calls.length,0);
});

test('steps preserve every answer, repeat row and document requirement',async t=>{
 const s=setup(t);await s.load();
 s.d.getElementById('fio').value='SYNTHETIC CLIENT';s.d.getElementById('dognum').value='SYNTHETIC-11665';s.d.getElementById('summa').value='600000';
 collect(s);const before=s.capture(),requirements=s.run('requiredDocumentLabels().join("|")');s.mount();
 const mounted=s.capture();
 assert.deepEqual(mounted,before);
 assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');
 assert.ok(s.d.getElementById('dognum').closest('#questionnaireStep'));
 assert.equal(s.d.getElementById('dognum').closest('[data-assessment-step]').dataset.assessmentStep,'contract');
 for(const name of ['answers','contract','documents']){s.w.AssessmentWorkflow.show(name,{focus:false});assert.deepEqual(s.capture(),mounted);assert.equal(s.run('requiredDocumentLabels().join("|")'),requirements);}
 const ids=[...s.d.querySelectorAll('[id]')].map(node=>node.id);assert.equal(new Set(ids).size,ids.length);
 assert.equal(s.d.querySelectorAll('#previewDocuments').length,1);
 assert.equal(s.d.querySelectorAll('[data-required-picker]').length,10);
 assert.equal(s.d.querySelector('.wf-credential [data-required-picker="ЭЦП файл"]').closest('details'),null);
 assert.equal(s.d.querySelector('[aria-current="step"]').dataset.goStep,'documents');
});
test('reprocessing merges a source-only legacy loan alias while keeping its debt conflict and manual additions',async t=>{
 for(const manual of [false,true]){const s=setup(t);await s.load();
  s.run(`af.client='991231300003';var shortRow=afRow('creditors',af.client+'|BANK|CODE');afRowFields(shortRow,{n8040:'100'},{fileId:'short'});var fullRow=afRow('creditors',af.client+'|BANK|NUMBER');afRowFields(fullRow,{n8040:'120',n8041:'10'},{fileId:'full'});`);
  if(manual)s.run(`fullRow.querySelector('[id^="n8041"]').value='11'`);
  const count=s.d.querySelectorAll('#creditors > .repeat-rows > .repeat-item').length;
  s.run(`var loan={aliases:['BANK|CODE','BANK|NUMBER'],fields:{n8040:'120',n8041:'10'}};var merged=afRow('creditors',af.client+'|BANK|CODE',loan);afRowFields(merged,loan.fields,{fileId:'full'});`);
  assert.equal(s.run('merged.id===shortRow.id'),true);
  assert.equal(s.d.querySelectorAll('#creditors > .repeat-rows > .repeat-item').length,count-(manual?0:1));
  assert.equal(s.run('af.conflicts.some(c=>c.id.startsWith("n8040")&&c.value==="120")'),true);
  if(manual)assert.equal(s.run('fullRow.querySelector(\'[id^="n8041"]\').value'),'11');
 }
});

test('spacing variants merge only the same sourced contract and keep manual edits and distinct contracts',async t=>{
 for(const manual of [false,true]){
  const s=setup(t);await s.load();
  s.run(`af.client='991231300003';var bankShort='АО "Банк ЦентрКредит"',bankFull='АО "Банк Центр Кредит"';
   var shortRow=afRow('creditors',af.client+'|'+bankShort+'|CODE');afRowFields(shortRow,{n8038:bankShort,n8040:'100'},{fileId:'short'});
   var fullRow=add(document.getElementById('creditors'));fullRow.id='legacy-full-row';afRowFields(fullRow,{n8038:bankFull,n8040:'100',n8041:'10'},{fileId:'full'});
   af.rowKeys.set('creditors|'+af.client+'|'+bankFull+'|CODE',fullRow.id);
   var distinctRow=afRow('creditors',af.client+'|'+bankShort+'|OTHER');afRowFields(distinctRow,{n8038:bankShort,n8040:'100'},{fileId:'short'});`);
  if(manual)s.run(`fullRow.querySelector('[id^="n8041"]').value='11'`);
  s.run(`var loan={aliases:[bankFull+'|CODE',bankFull+'|NUMBER'],fields:{n8038:bankFull,n8040:'100',n8041:'10'}};var merged=afRow('creditors',af.client+'|'+bankFull+'|CODE',loan);afRowFields(merged,loan.fields,{fileId:'full'});`);
  assert.equal(s.run('merged.id===shortRow.id'),true);
  assert.equal(s.d.querySelectorAll('#creditors > .repeat-rows > .repeat-item').length,manual?3:2);
  assert.equal(s.run('distinctRow.isConnected'),true);
  assert.equal(s.run('af.conflicts.some(c=>c.id.startsWith("n8038"))'),false);
  if(manual)assert.equal(s.run('fullRow.querySelector(\'[id^="n8041"]\').value'),'11');
  s.mount();assert.match(s.d.querySelector('.wf-debt-total').textContent,manual?/300 ₸/:/200 ₸/);
 }
});

test('hidden workflow steps retain missing answers and pending sources while conditional fields stay inactive',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 const counts=()=>s.run('JSON.stringify({missing:afMissing().map(e=>e.id),groups:afMissingGroups().length,pending:afPending().map(([id])=>id)})');
 s.run('af.sources.set("fio",{pending:true});visibilityRules();afRefresh()');
 const expected=counts();assert.match(expected,/summa/);assert.match(expected,/fio/);
 assert.equal(s.d.getElementById('summa').required,true);
 assert.equal(s.run('afLogicalVisible(document.getElementById("partnerKaspiAnnual"))'),false);
 for(const name of ['answers','contract','documents']){s.w.AssessmentWorkflow.show(name,{focus:false});s.run('visibilityRules();afRefresh()');assert.equal(counts(),expected);assert.equal(s.d.getElementById('summa').required,true);}
 const marital=s.d.getElementById('marital');marital.value='В браке';marital.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 assert.equal(s.run('afLogicalVisible(document.getElementById("partnerKaspiAnnual"))'),true);
 marital.value='Холост / не замужем';marital.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 assert.equal(s.run('afLogicalVisible(document.getElementById("partnerKaspiAnnual"))'),false);
});

test('navigation and source shortcuts reveal their fields without mutating the draft or authorizing writes',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();const before=s.capture();let edits=0;
 s.d.addEventListener('input',()=>edits++);s.d.addEventListener('change',()=>edits++);
 assert.equal(s.d.querySelector('.wf-answer-section').open,false);s.run('afFocus(document.getElementById("fio"))');assert.equal(s.d.body.dataset.assessmentWorkflow,'answers');assert.equal(s.d.activeElement.id,'fio');assert.equal(s.d.getElementById('fio').closest('.wf-answer-section').open,true);
 s.run('afFocus(document.getElementById("summa"))');assert.equal(s.d.body.dataset.assessmentWorkflow,'contract');assert.equal(s.d.activeElement.id,'summa');
 s.d.getElementById('continueToAnswers').click();assert.equal(s.d.body.dataset.assessmentWorkflow,'answers');
 assert.deepEqual(s.capture(),before);assert.equal(edits,0);assert.equal(s.calls.filter(call=>call.method!=='GET').length,0);
});

test('step changes preserve a checked snapshot; editing an answer invalidates it',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 const save=[...s.d.querySelectorAll('button')].find(node=>node.textContent==='Сохранить и скачать');
 assert.equal(save.disabled,false);
 await s.d.getElementById('checkQuestions').onclick();assert.equal(save.disabled,false);
 for(const name of ['documents','answers','contract']){s.w.AssessmentWorkflow.show(name,{focus:false});assert.equal(save.disabled,false);}
 assert.equal(s.calls.filter(call=>call.method==='POST').length,1);
 s.d.getElementById('fio').dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(save.disabled,false);
});

test('answers open the first unfinished section and preserve the employee selection without changing answers',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();const before=s.capture();
 const sections=[...s.d.querySelectorAll('.wf-answer-section')];
 s.w.AssessmentWorkflow.show('answers',{focus:false});
 assert.equal(sections[0].open,true);assert.equal(sections.filter(node=>node.open).length,1);
 sections[0].open=false;sections[1].open=true;
 s.w.AssessmentWorkflow.show('documents',{focus:false});s.w.AssessmentWorkflow.show('answers',{focus:false});
 assert.equal(sections[0].open,false);assert.equal(sections[1].open,true);
 assert.equal(s.d.getElementById('childrenTotal').closest('.field').querySelector(':scope > .hint').textContent,'Всего, включая совершеннолетних. Если детей нет — 0.');
 assert.ok(s.d.getElementById('kaspiAnnual').closest('.field').querySelector(':scope > .hint'));
 s.d.dispatchEvent(new s.w.Event('assessment-case-opened'));
 assert.equal(sections.some(node=>node.open),false);
 s.w.AssessmentWorkflow.show('answers',{focus:false});assert.equal(sections[0].open,true);
 assert.deepEqual(s.capture(),before);assert.equal(s.calls.filter(call=>call.method!=='GET').length,0);
});


test('Russian month editors preserve ISO drafts, sources and newly added loan rows',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 const input=s.d.querySelector('#creditors input[type="month"]');input.value='2023-05';
 const before=s.capture();s.run(fs.readFileSync('public/russian-month.js','utf8'));
 assert.deepEqual(s.capture(),before);assert.equal(s.run('afControls().filter(e=>e.id==="'+input.id+'").length'),1);
 const shadow=input.nextElementSibling.shadowRoot,month=shadow.querySelector('select'),year=shadow.querySelector('input');
 assert.equal(month.selectedOptions[0].textContent,'Май');assert.equal(year.value,'2023');
 month.value='09';month.dispatchEvent(new s.w.Event('change',{bubbles:true}));year.value='2024';year.dispatchEvent(new s.w.Event('input',{bubbles:true}));
 assert.equal(input.value,'2024-09');assert.equal(s.capture().groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='n8038Start').value,'2024-09');
 input.value='2022-02';input.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(month.selectedOptions[0].textContent,'Февраль');assert.equal(year.value,'2022');
 year.value='20';year.dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(input.value,'');assert.ok(s.run('afMissing().some(e=>e.id==="'+input.id+'")'));
 const row=s.run("add(document.getElementById('creditors'))");await new Promise(resolve=>setTimeout(resolve,0));assert.ok(row.querySelector('assessment-month'));
 assert.equal(s.capture().groups.find(g=>g.id==='creditors').rows[0].some(a=>!a.key),false);
});

test('empty participant tables offer only a source, while named participants attach to their exact loan',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 s.run(`af.client='991231300003';var loan={key:'BANK|LOAN1',aliases:['BANK|LOAN1'],fields:{n8038:'BANK'},relatedPartiesNotice:{page:3,source:'Нет данных'}};var row=afRow('creditors',af.client+'|BANK|LOAN1',loan);afRowFields(row,loan.fields,{fileId:1});afLoanParticipantsNotice(row,loan,1);`);
 assert.equal(s.d.querySelectorAll('#creditors > .repeat-rows > .repeat-item').length,1);
 const input=s.d.querySelector('#creditors textarea[id^="loanParticipants"]');assert.equal(input.value,'');
 assert.match(s.d.querySelector('.af-related-notice').textContent,/В ГКБ не указано/);assert.equal(s.d.querySelector('.af-related-notice').querySelectorAll('button').length,1);
 assert.equal(s.run('af.sources.has("'+input.id+'")'),false);
 s.run(`var second=afRow('creditors',af.client+'|BANK|LOAN2');afRowFields(second,{loanParticipants:'TEST PERSON — Гарант'},{fileId:1,fieldKeys:{loanParticipants:'credits.1.relatedParties'},fieldReview:{loanParticipants:{page:8,quote:'Связанные субъекты'}}});`);
 assert.equal(input.value,'');const other=s.d.querySelectorAll('#creditors textarea[id^="loanParticipants"]')[1];assert.equal(other.value,'TEST PERSON — Гарант');
 assert.equal(s.run('af.sources.get("'+other.id+'").page'),8);assert.equal(s.run('af.sources.get("'+other.id+'").serverFactKey'),'credits.1.relatedParties');
});

test('the complete applicable document package gates all navigation without requiring fact approvals',async t=>{
 const s=setup(t);await s.load();s.mount();const before=s.capture();
 for(const name of ['answers','contract']){assert.equal(s.w.AssessmentWorkflow.show(name,{focus:false}),false);assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');s.d.querySelector('[data-go-step="'+name+'"]').click();assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');}
 s.run('afFocus(document.getElementById("fio"))');assert.equal(s.d.activeElement.id,'workflowCollection');
 s.d.getElementById('continueToAnswers').click();assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');
 s.w.sessionStorage.setItem('assessment-step:11665','answers');s.d.dispatchEvent(new s.w.Event('assessment-draft-restored'));assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');assert.deepEqual(s.capture(),before);
 collect(s);assert.equal(s.w.AssessmentWorkflow.collection().ready,true);assert.equal(s.w.AssessmentWorkflow.show('answers',{focus:false}),true);assert.equal(s.d.body.dataset.assessmentWorkflow,'answers');assert.equal(s.run('af.sources.size'),0);
 s.run('selectedFiles[0].person="Супруг(а)"');s.w.AssessmentWorkflow.refresh();assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');
 collect(s);s.run('delete selectedFiles[0].storedDocumentId');assert.equal(s.w.AssessmentWorkflow.show('answers',{focus:false}),false);
 collect(s);s.run('af.busy=true');assert.equal(s.w.AssessmentWorkflow.show('answers',{focus:false}),false);s.run('af.busy=false');
 collect(s);s.d.getElementById('needsSocialDoc').value='1';assert.equal(s.w.AssessmentWorkflow.collection().ready,false);assert.ok(s.w.AssessmentWorkflow.collection().missing.includes('Справка по выплатам пенсии и пособий'));
 collect(s);s.d.getElementById('needsSalaryDoc').value='1';assert.ok(s.w.AssessmentWorkflow.collection().missing.includes('Выписка зарплатного банка'));
 collect(s);s.w.CredentialUpload.collected=()=>false;assert.equal(s.w.AssessmentWorkflow.collection().ready,false);assert.ok(s.w.AssessmentWorkflow.collection().missing.includes('ЭЦП файл'));
 assert.equal(s.calls.filter(c=>c.method!=='GET').length,0);
});

test('a partial batch names missing documents above the file list and opens the exact add picker',async t=>{
 const s=setup(t);await s.load();collect(s);
 s.run(`selectedFiles=selectedFiles.filter(item=>!['Справка ЕНПФ','Доверенность'].includes(item.type));selectedFiles.push({...selectedFiles[0],id:80},{id:81,type:'Доверенность',person:'Супруг(а)',storedDocumentId:'spouse-power',file:{name:'power.pdf',size:10}});`);
 s.mount();const notice=s.d.getElementById('workflowCollection');
 assert.equal(notice.hidden,false);assert.equal(notice.closest('details'),null);assert.equal(notice.nextElementSibling.id,'afFiles');
 assert.match(notice.querySelector('strong').textContent,/Не хватает документов · 2/);
 assert.equal(notice.querySelector('.wf-collection-count').textContent,'6 из 8 в пакете');
 assert.deepEqual([...notice.querySelectorAll('[data-package-state="missing"]')].map(e=>e.dataset.packageDocument),['Справка ЕНПФ','Доверенность']);
 const input=s.d.querySelector('[data-required-picker="Справка ЕНПФ"]');let chosen=0;input.addEventListener('click',e=>{e.preventDefault();chosen++;});
 notice.querySelector('[aria-label="Добавить: Справка ЕНПФ"]').click();assert.equal(chosen,1);
 assert.equal(s.d.querySelector('.wf-bottom-nav .btn-main').textContent,'Добавить: Справка ЕНПФ');assert.equal(s.d.querySelector('.wf-bottom-nav .btn-main').getAttribute('aria-disabled'),'false');
 s.d.querySelector('.wf-bottom-nav .btn-main').click();assert.equal(chosen,2);
 const before=s.capture();s.w.AssessmentWorkflow.refresh();assert.deepEqual(s.capture(),before);assert.equal(s.calls.filter(c=>c.method!=='GET').length,0);
});

test('package status separates an unfinished upload from missing files and keeps manual-review scans present',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 s.run(`delete selectedFiles[0].storedDocumentId;af.results.set(selectedFiles[0].id,{error:'Synthetic upload failed'});af.results.set(selectedFiles[4].id,{blocked:true,kind:'other'});`);
 s.w.AssessmentWorkflow.refresh();const notice=s.d.getElementById('workflowCollection');
 assert.match(notice.querySelector('strong').textContent,/Завершите добавление · 1/);
 assert.equal(notice.querySelectorAll('[data-package-state="missing"]').length,0);assert.equal(notice.querySelectorAll('[data-package-state="pending"]').length,1);
 assert.equal(s.w.AssessmentWorkflow.collection().ready,false);
 s.run('af.busy=true');s.w.AssessmentWorkflow.refresh();assert.match(notice.textContent,/Получаем список документов/);assert.equal(notice.querySelectorAll('button').length,0);
 s.run(`af.busy=false;selectedFiles[0].storedDocumentId='uploaded-original';af.results.delete(selectedFiles[0].id);`);
 s.d.dispatchEvent(new s.w.Event('assessment-analysis-complete'));
 assert.equal(s.w.AssessmentWorkflow.collection().ready,true);assert.equal(notice.hidden,false);assert.match(notice.textContent,/Проверьте замечания · 1/);assert.match(notice.textContent,/8 из 8/);
});

test('the missing package list updates with benefit and salary answers and after draft restoration',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 const choose=async(id,value)=>{s.d.getElementById(id).value=value;s.d.getElementById(id).dispatchEvent(new s.w.Event('change',{bubbles:true}));await Promise.resolve();};
 await choose('needsSocialDoc','1');await choose('needsSalaryDoc','1');
 const notice=s.d.getElementById('workflowCollection');assert.match(notice.querySelector('.wf-collection-count').textContent,/8 из 10/);
 assert.match(notice.textContent,/Справка по выплатам пенсии и пособий/);assert.match(notice.textContent,/Выписка зарплатного банка/);
 await choose('needsSocialDoc','0');await choose('needsSalaryDoc','kaspi');assert.equal(s.w.AssessmentWorkflow.collection().ready,true);assert.equal(notice.querySelectorAll('[data-package-document]').length,0);
 await choose('needsSocialDoc','');assert.equal(s.w.AssessmentWorkflow.collection().ready,false);assert.match(notice.textContent,/Уточните, нужны ли дополнительные документы/);assert.doesNotMatch(notice.textContent,/Справка по выплатам/);
 s.run(`selectedFiles=selectedFiles.filter(item=>item.type!=='Доверенность')`);s.d.dispatchEvent(new s.w.Event('assessment-draft-restored'));assert.ok(notice.querySelector('[aria-label="Добавить: Доверенность"]'));
});

test('a document for another client cannot complete the package and unassigned files have a visible type action',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 s.run(`af.results.set(selectedFiles[0].id,{identity:{iin:'990101300002'}});selectedFiles.push({id:90,type:'Другой документ',person:'Клиент',storedDocumentId:'unclassified',file:{name:'unknown.pdf',size:10}});renderDocuments();`);
 s.w.AssessmentWorkflow.refresh();const notice=s.d.getElementById('workflowCollection');
 assert.equal(s.w.AssessmentWorkflow.collection().ready,false);assert.match(notice.textContent,/ГКБ — краткий отчёт/);assert.match(notice.textContent,/другого клиента/);assert.match(notice.textContent,/Без типа · 1/);
 [...notice.querySelectorAll('button')].find(b=>b.textContent==='Указать тип').click();assert.equal(s.d.getElementById('workflowDocumentTools').open,true);assert.equal(s.d.querySelector('.wf-file-assignments').open,true);
});

test('participants use explicit choices and role rows; partial entries survive without passing completeness',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();mountParticipants(s);
 const input=s.d.querySelector('#creditors textarea[id^="loanParticipants"]'),shadow=input.nextElementSibling.shadowRoot,choice=shadow.querySelector('select');
 assert.deepEqual([...choice.options].map(o=>o.textContent),['Выберите ответ','Нет','Есть']);assert.equal(s.d.querySelector('#creditors [data-unknown="loanParticipants"]'),null);
 choice.value='some';choice.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(input.checkValidity(),false);
 let name=shadow.querySelector('input'),role=shadow.querySelector('.person select');assert.deepEqual([...role.options].map(o=>o.value),['','Созаёмщик','Гарант','Поручитель','Залогодатель']);
 name.value='ТЕСТОВЫЙ УЧАСТНИК';name.dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(input.checkValidity(),false);
 const partial=input.value;input.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(input.value,partial);assert.equal(shadow.querySelector('input').value,'ТЕСТОВЫЙ УЧАСТНИК');
 role=shadow.querySelector('.person select');role.value='Гарант';role.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(input.value,'ТЕСТОВЫЙ УЧАСТНИК — Гарант');assert.equal(input.checkValidity(),true);
 const answers=s.capture().groups.find(g=>g.id==='creditors').rows[0];assert.equal(answers.filter(a=>a.key==='loanParticipants').length,1);assert.equal(answers.some(a=>a.key===''),false);
 shadow.querySelector('.add').click();assert.equal(input.checkValidity(),false);assert.equal(shadow.querySelectorAll('.person').length,2);
 const before=input.value;input.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(input.value,before);assert.equal(shadow.querySelectorAll('.person').length,2);
 choice.value='none';choice.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(input.value,'Нет');assert.equal(input.checkValidity(),true);
 input.value='ПРЕЖНИЙ ОТКРЫТЫЙ ОТВЕТ';input.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(choice.value,'');assert.equal(input.checkValidity(),false);assert.match(shadow.querySelector('.legacy').textContent,/ПРЕЖНИЙ ОТКРЫТЫЙ ОТВЕТ/);
 const row=s.run("add(document.getElementById('creditors'))");await new Promise(resolve=>setTimeout(resolve,0));assert.ok(row.querySelector('loan-participants'));
});

test('a discrepancy jumps to the exact loan and field without changing or approving either value',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 s.run(`af.client='991231300003';var one=afRow('creditors','991231300003|BANK|1');afRowFields(one,{n8038:'SAME BANK',n8040:'100'},{fileId:1,page:2});var two=afRow('creditors','991231300003|BANK|2');afRowFields(two,{n8038:'SAME BANK',n8040:'1769342.83'},{fileId:1,page:2});afRowFields(two,{n8040:'1778817.78'},{fileId:2,page:10});afRenderConflicts();`);
 s.w.AssessmentWorkflow.refresh();s.w.AssessmentWorkflow.show('answers',{focus:false});
 const before=s.capture(),pending=s.run('afPending().length'),box=s.d.querySelector('.af-conflict'),button=box.querySelector('[data-conflict-target]'),target=s.d.getElementById(button.dataset.conflictTarget);
 assert.match(box.textContent,/Кредит 2 · SAME BANK/);assert.match(box.textContent,/1.769.342,83/);assert.match(box.textContent,/1.778.817,78/);
 target.closest('.wf-loan').open=false;target.closest('.wf-answer-section').open=false;button.click();
 assert.equal(s.d.activeElement,target);assert.equal(target.closest('.wf-loan').open,true);assert.equal(target.closest('.wf-answer-section').open,true);assert.ok(target.closest('.field').classList.contains('af-field-focus'));assert.deepEqual(s.capture(),before);assert.equal(s.run('af.conflicts.length'),1);assert.equal(s.run('afPending().length'),pending);
});

test('collecting an EDS key is local and requires its owner confirmation and password',async t=>{
 const s=setup(t);await s.load();s.mount();
 s.run(`selectedFiles=[{id:1,type:'ЭЦП файл',person:'Клиент',file:new File(['SYNTHETIC KEY'], 'synthetic.p12')}];`);
 assert.equal(s.w.CredentialUpload.collected(),false);
 const password=s.d.getElementById('previewEdsPassword'),owner=password.closest('.field').querySelector('input[type="checkbox"]');password.value='SYNTHETIC-LOCAL-ONLY';assert.equal(s.w.CredentialUpload.collected(),false);owner.checked=true;
 assert.equal(s.w.CredentialUpload.collected(),true);assert.equal(s.w.CredentialUpload.verified(),false);assert.equal(s.calls.filter(c=>c.method!=='GET').length,0);
 const capture=JSON.stringify(s.capture());assert.doesNotMatch(capture,/SYNTHETIC-LOCAL-ONLY|SYNTHETIC KEY/);assert.equal(s.capture().documents.length,0);
 s.run('selectedFiles[0].person="Супруг(а)"');assert.equal(s.w.CredentialUpload.collected(),false);
});

test('an existing CRM key can be reused after owner confirmation, with a safe download and editable replacement',async t=>{
 const s=setup(t);await s.load();s.mount();let imported=false;const posts=[],original=s.w.fetch;
 s.w.fetch=async(path,options={})=>{
  if(!path.endsWith('/credentials'))return original(path,options);
  if(options.method==='POST'){posts.push(JSON.parse(options.body));imported=true;return {ok:true,json:async()=>({verified:true})};}
  return {ok:true,json:async()=>({identityRevision:1,credentials:imported?{verified:true,requestId:'00000000-0000-0000-0000-000000000001',files:[{id:'22',name:'ЭЦП.p12',byteSize:3}],passwordStored:true}:null})};
 };
 s.w.CredentialUpload.offerExisting('22');assert.equal(s.w.CredentialUpload.verified(),false);assert.equal(posts.length,0);
 const button=[...s.d.querySelectorAll('button')].find(b=>b.textContent==='Взять ЭЦП из Bitrix'),password=s.d.getElementById('previewEdsPassword'),owner=password.closest('.field').querySelector('input[type="checkbox"]');
 await button.onclick();assert.equal(posts.length,0);assert.equal(s.d.activeElement,owner);
 owner.checked=true;await button.onclick();assert.equal(posts.length,1);assert.deepEqual(posts[0].fileIds,['22']);assert.equal(posts[0].action,'import');assert.equal(posts[0].ownerConfirmed,true);assert.equal('password' in posts[0],false);assert.equal('files' in posts[0],false);
 assert.equal(s.w.CredentialUpload.verified(),true);assert.equal(password.hidden,true);const link=s.d.querySelector('.credential-stored a');assert.equal(link.textContent,'Скачать ЭЦП.p12');assert.match(link.href,/requestId=.*fileId=22/);assert.equal(s.capture().documents.length,0);
 let pickerOpened=false;const picker=s.d.querySelector('[data-required-document="ЭЦП файл"] input[type=file]');picker.click=()=>{pickerOpened=true;};s.d.querySelector('.credential-stored button').click();assert.equal(pickerOpened,true);assert.equal(password.hidden,true);
 s.run("selectedFiles.push({id:99,type:'ЭЦП файл',person:'Клиент',file:new File(['NEW SYNTHETIC'],'replacement.p12')})");s.d.getElementById('previewDocuments').dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(s.w.CredentialUpload.verified(),false);assert.equal(password.hidden,false);
});

test('entering benefits updates document collection without losing the answers',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();s.w.AssessmentWorkflow.show('answers',{focus:false});
 s.d.getElementById('fio').value='PRESERVE THIS CLIENT';const count=s.d.getElementById('clientBenefitsCount');count.value='1';count.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 assert.equal(s.d.getElementById('needsSocialDoc').value,'1');assert.equal(s.d.getElementById('require-social').classList.contains('hidden'),false);assert.equal(s.w.AssessmentWorkflow.collection().ready,false);
 assert.equal(s.w.AssessmentWorkflow.show('contract',{focus:false}),false);assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');assert.equal(s.capture().answers.find(a=>a.key==='fio').value,'PRESERVE THIS CLIENT');assert.equal(s.capture().groups.find(g=>g.id==='clientbenefits').rows.length,1);
 s.run("selectedFiles.push({id:99,type:'Справка по выплатам пенсии и пособий',person:'Клиент',storedDocumentId:'synthetic-benefit',file:{name:'benefit.pdf',size:10}})");s.w.AssessmentWorkflow.refresh();assert.equal(s.w.AssessmentWorkflow.show('answers',{focus:false}),true);
 count.value='0';count.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(s.d.getElementById('needsSocialDoc').value,'0');assert.equal(s.d.getElementById('require-social').classList.contains('hidden'),true);assert.ok(s.capture().documents.some(d=>d.documentId==='synthetic-benefit'),'existing document stays stored');
});
test('an explicit No clears a stale benefits count and removes the conditional certificate',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();const count=s.d.getElementById('clientBenefitsCount');count.value='1';s.run('refreshRequiredDocuments()');
 assert.equal(count.checkValidity(),false);assert.match(count.validationMessage,/не совпадает/);assert.ok(!s.w.AssessmentWorkflow.collection().missing.includes('Справка по выплатам пенсии и пособий'));
 s.d.getElementById('needsSocialDoc').dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(count.value,'0');assert.equal(count.checkValidity(),true);
 s.d.getElementById('needsSocialDoc').value='1';s.d.getElementById('needsSocialDoc').dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(count.value,'');assert.ok(s.w.AssessmentWorkflow.collection().missing.includes('Справка по выплатам пенсии и пособий'));
 count.value='';s.run('refreshRequiredDocuments()');assert.equal(count.validity.customError,false);assert.equal(count.validity.valueMissing,true);
});
test('Russian editor rejects future dates on restored and new loans using the assessment day',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();s.w.AssessmentWorkflow.show('answers',{focus:false});s.run(fs.readFileSync('public/russian-month.js','utf8'));
 const input=s.d.querySelector('#creditors input[type="month"]');input.value='2099-01';input.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 assert.equal(input.max,'2026-09');assert.equal(input.checkValidity(),false);assert.match(input.validationMessage,/будущем/);assert.ok(s.run('afMissing().some(e=>e.id==="'+input.id+'")'));
 const shadow=input.nextElementSibling.shadowRoot;assert.equal(shadow.querySelector('[role="status"]').hidden,false);assert.equal(shadow.querySelector('input').value,'2099');
 shadow.querySelector('input').value='2026';shadow.querySelector('input').dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(input.value,'2026-01');assert.equal(input.checkValidity(),true);assert.equal(shadow.querySelector('[role="status"]').hidden,true);
 const month=shadow.querySelector('select');month.value='10';month.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(input.checkValidity(),false);month.value='09';month.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(input.checkValidity(),true);
 const row=s.run("add(document.getElementById('creditors'))");await new Promise(resolve=>setTimeout(resolve,0));assert.equal(row.querySelector('input[type="month"]').max,'2026-09');
});

test('unknown shortcuts are absent and restored unknowns become unanswered, never zero',async t=>{
 const s=setup(t);await s.load();s.mount();
 for(const root of[s.d,...[...s.d.querySelectorAll('template')].map(t=>t.content)]){
  assert.equal([...root.querySelectorAll('option')].some(o=>/Не знаю/.test(o.textContent)),false);
  for(const label of root.querySelectorAll('label'))if(/Не знаю/.test(label.textContent))assert.ok(label.closest('[hidden],[data-legacy-answer]'));
 }
 s.d.getElementById('childrenTotal').value='2';s.d.querySelector('[data-legacy-unknown="childrenTotal"]').checked=true;s.d.querySelector('[data-holding="unknown"]').checked=true;
 s.w.RequiredAnswers.restore();assert.equal(s.d.getElementById('childrenTotal').value,'');assert.equal(s.d.getElementById('childrenTotal').disabled,false);assert.equal(s.d.querySelector('[data-holding="none"]').checked,false);assert.equal(s.d.querySelector('[data-holding="unknown"]').checked,false);
});

test('replacement preserves the prior file on read failure or another client IIN',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();s.w.ServerDrafts.save=async()=>true;
 const item=s.run('selectedFiles[0]');const count=s.run('selectedFiles.length');
 for(const mode of ['failed','wrong-client']){
  s.w.HostedAssessment.analyzeFile=async()=>{if(mode==='failed')throw Error('TEST READ FAILURE');return{};};
  s.w.HostedAssessment.adapt=()=>({identity:{iin:'OTHER'},server:{dealId:'11665',documentId:'new-doc'}});
  assert.equal(await s.w.DocumentReplacement.replace(item,new s.w.File(['test'],'new.pdf')),false);assert.equal(s.run('selectedFiles[0]'),item);assert.equal(s.run('selectedFiles.length'),count);
 }
});

test('replacement keeps typed answers and persists the retired source as a final-save blocker',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();s.w.ServerDrafts.save=async()=>true;
 s.run(`af.sources.set('fio',{fileId:1,value:'OLD SOURCE',pending:false,reviewId:'old-review',server:{dealId:'11665',documentId:'synthetic-0',extractionId:'old'}});document.getElementById('fio').value='EMPLOYEE EDIT';`);
 s.w.HostedAssessment.analyzeFile=async()=>({});s.w.HostedAssessment.adapt=()=>({identity:{iin:'991231300003'},fields:[],loans:[],properties:[],pageText:['test'],kind:'gkbShort',type:'ГКБ — краткий отчёт',server:{dealId:'11665',documentId:'new-doc',extractionId:'new'},sourcePreview:'/new.pdf'});
 assert.equal(await s.w.DocumentReplacement.replace(s.run('selectedFiles[0]'),new s.w.File(['test'],'new.pdf')),true);
 assert.equal(s.d.getElementById('fio').value,'EMPLOYEE EDIT');assert.equal(s.run("af.sources.get('fio').reviewId"),null);
 assert.equal(s.capture().answers.find(a=>a.key==='fio').sourceReplaced,true);assert.equal(s.capture().documents[0].documentId,'new-doc');
 assert.ok(s.d.querySelector('.af-source[data-for="fio"]').textContent.includes('Источник заменён'));
 // Editing is deliberate re-entry; stale document approval cannot survive it.
 s.d.getElementById('fio').value='RECHECKED PERSON';s.d.getElementById('fio').dispatchEvent(new s.w.Event('input',{bubbles:true}));
 assert.equal(s.capture().answers.find(a=>a.key==='fio').sourceReplaced,undefined);assert.equal(s.run("af.sources.has('fio')"),false);
});

test('an unreadable stored scan stays openable without document-condition answers',async t=>{
 const s=setup(t);await s.load();s.mount();
 s.run(`selectedFiles=[{id:1,type:'Удостоверение личности',person:'Клиент',storedDocumentId:'scan',file:{name:'scan.pdf'}}];af.results.set(1,{kind:'other',blocked:true,notes:['Тип документа не установлен по содержимому.']});afRenderResults();`);
 const row=s.d.querySelector('.af-file');assert.match(row.querySelector('summary').textContent,/Тип не определён.*Сверить вручную/);assert.ok(!row.querySelector('summary .needs-review'));assert.match(row.textContent,/Выбран как: Удостоверение личности/);
 assert.ok([...row.querySelectorAll('button')].some(b=>b.textContent==='Открыть документ'));const replacement=row.closest('.af-file-entry').querySelector('.af-replace-document');assert.ok(replacement);assert.equal(replacement.closest('details.af-file'),null);assert.equal(row.querySelector('.af-document-notes').open,false);
});
test('replacement actions become enabled when restored documents finish reading',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 s.w.HostedAssessment.analyzeFile=async item=>item;
 s.w.HostedAssessment.adapt=item=>({kind:'other',type:item.type,identity:{iin:'991231300003'},fields:[],loans:[],properties:[],pageText:['SYNTHETIC'],server:{dealId:'11665',documentId:item.storedDocumentId,extractionId:'synthetic'},sourcePreview:'/synthetic.pdf'});
 await s.run('afAnalyze({cacheOnly:true})');
 const buttons=[...s.d.querySelectorAll('.af-replace-document')];assert.equal(buttons.length,7);assert.ok(buttons.every(button=>!button.disabled));
});

test('first intake requires the two context answers before any file analysis or CRM import',async t=>{
 const s=setup(t);await s.load();s.mount();s.run(fs.readFileSync('public/client-workspace.js','utf8'));
 const intake=s.d.getElementById('workflowDocumentIntake'),choose=s.d.getElementById('afChoose');
 assert.equal(intake.parentElement.firstElementChild,intake);assert.equal(choose.disabled,true);
 s.run("selectedFiles=[{id:1,type:'',person:'Клиент',file:{name:'client.pdf',size:10}}];");
 const before=s.calls.length;await s.run('afAnalyze()');await s.w.ClientWorkspace.importDocuments();assert.equal(s.calls.length,before);assert.equal(s.d.activeElement.id,'needsSocialDoc');
 s.d.getElementById('needsSocialDoc').value='0';s.w.AssessmentWorkflow.refresh();assert.equal(choose.disabled,true);
 s.d.getElementById('needsSalaryDoc').value='none';s.w.AssessmentWorkflow.refresh();assert.equal(choose.disabled,false);assert.equal(s.d.getElementById('importCrmDocuments').disabled,false);
});
test('finished package offers the loan comparison directly for shortened IDs',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();
 s.run("af.results.set(1,{blocked:true,findings:['SHORT_CONTRACT_ID_TRUNCATED'],identity:{iin:'991231300003'},server:{dealId:'11665',documentId:'synthetic-0'}});afRenderResults();afRefresh();");
 let comparisons=0;s.w.GkbComparison={open(){comparisons++;},statusButton(){return s.d.createElement('button');}};const notice=s.d.getElementById('workflowCollection');assert.match(notice.textContent,/сопоставить кредиты/);
 const compare=notice.querySelector('[data-package-attention="1"] button');assert.equal(compare.textContent,'Сверить кредиты');compare.click();assert.equal(comparisons,1);
 s.run("af.busy=true;afAnalysisProgress(2,7)");assert.match(notice.textContent,/Прочитано документов · 2 из 7/);assert.equal(notice.querySelector('[data-package-attention]'),null);
 s.run("af.busy=false;af.progress=null;document.dispatchEvent(new CustomEvent('assessment-analysis-complete',{detail:{showPackageSummary:true}}))");assert.equal(s.d.activeElement.id,'workflowCollection');assert.match(notice.textContent,/сопоставить кредиты/);
});
test('an unreadable ENPF period offers direct manual review',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();let opened=null;s.w.DocumentReview.open=async id=>{opened=id;};
 const id=s.run(`(()=>{const item=selectedFiles.find(item=>item.type==='Справка ЕНПФ');af.results.set(item.id,{findings:['ENPF_PERIOD_UNVERIFIED'],identity:{iin:'991231300003'},server:{dealId:'11665',documentId:item.storedDocumentId}});afRenderResults();afRefresh();return item.id;})()`);
 const action=s.d.querySelector(`[data-package-attention="${id}"] button`);assert.equal(action.textContent,'Проверить');action.click();assert.equal(opened,s.run(`selectedFiles.find(item=>item.id===${id}).storedDocumentId`));
});
test('a blocked download returns to the exact document review',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();s.w.AssessmentWorkflow.show('contract',{focus:false});
 const review=s.d.createElement('details'),summary=s.d.createElement('summary');review.dataset.documentReview='';review.dataset.reviewDocumentId='enpf';summary.textContent='Справка ЕНПФ — сверить';review.append(summary);s.d.getElementById('documentReviewResults').append(review);
 s.d.dispatchEvent(new s.w.CustomEvent('assessment-submission-blocked',{detail:{reason:'documents',result:{documents:{issues:[{code:'ENPF_PERIOD_UNVERIFIED',documentId:'enpf'}]}}}}));
 assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');assert.equal(s.d.querySelector('.wf-review-details').open,true);assert.equal(review.open,true);assert.equal(s.d.activeElement,summary);assert.match(s.d.getElementById('documentCheckStatus').textContent,/проверьте документы: 1/);
});
test('automatic analysis requests only the new document and retains the stored result',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();s.run("selectedFiles=selectedFiles.slice(0,1);selectedFiles.push({id:2,type:'',person:'Клиент',file:{name:'new.pdf',size:10}});var analyzed=[];HostedAssessment={...HostedAssessment,analyzeFile:async item=>{analyzed.push(item.id);throw Error('Synthetic file failure');}};");
 await s.run('afAnalyze({onlyNew:true})');assert.equal(s.run('JSON.stringify(analyzed)'),'[2]');assert.equal(s.run('selectedFiles[0].storedDocumentId'),'synthetic-0');assert.match(s.d.getElementById('workflowCollection').textContent,/Synthetic file failure/);
});


test('the document next action targets the missing EDS step and checks once before opening answers',async t=>{
 const s=setup(t);await s.load();const collected=s.w.CredentialUpload.collected;collect(s);s.w.CredentialUpload.collected=collected;
 s.run("selectedFiles.push({id:99,type:'ЭЦП файл',person:'Клиент',file:new File(['SYNTHETIC KEY'],'synthetic.p12')})");s.mount();
 const password=s.d.getElementById('previewEdsPassword'),owner=password.closest('.field').querySelector('input[type=checkbox]'),next=s.d.querySelector('.wf-bottom-nav .btn-main');
 assert.equal(next.textContent,'Указать пароль ЭЦП');next.click();assert.equal(s.d.activeElement,password);
 password.value='SYNTHETIC-SECRET';password.dispatchEvent(new s.w.Event('input',{bubbles:true}));await Promise.resolve();
 assert.equal(next.textContent,'Подтвердить владельца ЭЦП');next.click();assert.equal(s.d.activeElement,owner);
 owner.checked=true;owner.dispatchEvent(new s.w.Event('change',{bubbles:true}));await Promise.resolve();
 assert.equal(next.textContent,'Проверить и продолжить →');next.click();next.click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(s.d.body.dataset.assessmentWorkflow,'answers');assert.equal(s.calls.filter(c=>c.path.endsWith('/check')).length,1);
 assert.equal(s.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/credentials')).length,0);
 assert.doesNotMatch(JSON.stringify(s.capture()),/SYNTHETIC-SECRET|SYNTHETIC KEY/);
});

test('loan status hides monthly payment for default and keeps identifiers visible in summaries and exports',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();s.w.AssessmentWorkflow.show('answers',{focus:false});const row=s.d.querySelector('#creditors .repeat-item'),find=id=>[...row.querySelectorAll('input,select')].find(control=>control.id.replace(/_r\d+$/,'')===id);
 find('n8038').value='SYNTHETIC BANK';find('loanContractId').value='CARD-002';find('n8040').value='1806000.00';find('n8042').value='322';find('n8042').dispatchEvent(new s.w.Event('change',{bubbles:true}));await Promise.resolve();
 assert.equal(find('loanStatus').value,'В просрочке — требуют полную сумму');assert.equal(find('n8041').required,false);assert.ok(find('n8041').closest('.field').classList.contains('hidden'));assert.match(row.querySelector('details.wf-loan > summary').textContent,/CARD-002.*В просрочке.*1\s806\s000/);
 row.querySelector('[data-loan-claim]').checked=false;let exported='';s.run('afDownload=(name,content)=>{globalThis.__exported=content}');s.d.getElementById('afExport').click();exported=s.run('__exported');assert.match(exported,/Включить в иск: Нет/);assert.match(exported,/1\s806\s000 ₸/);assert.match(exported,/Договор и оплата · юристы не видят/);assert.doesNotMatch(exported,/Договор и оплатаюристы/);
 find('loanStatus').value='Платится по графику';find('loanStatus').dispatchEvent(new s.w.Event('change',{bubbles:true}));await Promise.resolve();assert.equal(find('n8041').required,true);assert.equal(find('n8041').closest('.field').classList.contains('hidden'),false);
});

test('a failed document check stays on documents and displays an actionable error',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();const fetch=s.w.fetch;
 s.w.fetch=async(path,options)=>path.endsWith('/check')?{ok:false,json:async()=>({})}:fetch(path,options);
 s.d.querySelector('.wf-bottom-nav .btn-main').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');assert.equal(s.d.querySelector('.wf-review-details').open,true);
 assert.match(s.d.getElementById('documentCheckStatus').textContent,/Не удалось/);assert.equal(s.d.querySelector('.wf-bottom-nav .btn-main').textContent,'Проверить и продолжить →');
});

test('check and continue opens unresolved document inspection before advancing to answers',async t=>{
 const s=setup(t);await s.load();collect(s);s.mount();const fetch=s.w.fetch;
 const selected=s.capture().documents.find(item=>item.type==='Справка ЕНПФ');
 s.w.fetch=async(path,options)=>path.endsWith('/check')?{ok:true,json:async()=>({identityRevision:1,answersComplete:true,readyToSubmit:false,issues:[],evidence:{issues:[]},documents:{issues:[{code:'ENPF_PERIOD_UNVERIFIED',documentId:selected.documentId,message:'Сверьте период по оригиналу.'}],manuallyReviewed:[]}})}:fetch(path,options);
 s.d.querySelector('.wf-bottom-nav .btn-main').click();await new Promise(resolve=>setTimeout(resolve,0));
 const review=s.d.querySelector(`[data-review-document-id="${selected.documentId}"]`);
 assert.equal(s.d.body.dataset.assessmentWorkflow,'documents');assert.equal(review.open,true);assert.equal(s.d.activeElement,review.querySelector('summary'));assert.match(review.textContent,/Сверьте период по оригиналу/);
 assert.equal(s.calls.some(call=>call.method==='POST'&&call.path.endsWith('/submission')),false);
});


test('a confirmed replacement EDS key clears only obsolete key reminders in the restored draft',async t=>{
 const s=setup(t);await s.load();const payload=s.capture();payload.pendingFiles=['old-synthetic.p12','missing-synthetic.pdf'];
 await s.w.ServerDrafts.restore({automatic:true,draft:{payload,revision:2,identityRevision:1}});
 s.run("selectedFiles=[{id:99,type:'ЭЦП файл',person:'Клиент',file:new File(['SYNTHETIC KEY'],'replacement.p12')}]");
 assert.deepEqual(s.capture().pendingFiles,['old-synthetic.p12','missing-synthetic.pdf','replacement.p12']);
 const password=s.d.getElementById('previewEdsPassword'),owner=password.closest('.field').querySelector('input[type=checkbox]');
 password.value='SYNTHETIC SECRET';owner.checked=true;
 assert.deepEqual(s.capture().pendingFiles,['missing-synthetic.pdf','replacement.p12']);
 assert.doesNotMatch(JSON.stringify(s.capture()),/SYNTHETIC SECRET|SYNTHETIC KEY/);
 s.run("selectedFiles[0].person='Супруг(а)'");assert.ok(s.capture().pendingFiles.includes('old-synthetic.p12'));
});


test('duplicate PDF selections merge only after their types agree and answer sources remain attached',async t=>{
 const s=setup(t);await s.load();
 s.run(`selectedFiles=[{id:1,type:'ГКБ — краткий отчёт',person:'Клиент',storedDocumentId:'same',file:{name:'statement.pdf'}},{id:2,type:'Выписка Kaspi Gold',person:'Клиент',storedDocumentId:'same',file:{name:'statement.pdf'}}];af.results.set(1,{kind:'other'});af.results.set(2,{kind:'kaspi'});af.sources.set('kaspiAnnual',{fileId:2});afMergeDuplicateSelections();`);
 assert.equal(s.run('selectedFiles.length'),2);
 s.run(`selectedFiles[0].type='Выписка Kaspi Gold';afMergeDuplicateSelections();`);
 assert.equal(s.run('selectedFiles.length'),1);assert.equal(s.run("af.sources.get('kaspiAnnual').fileId"),1);assert.equal(s.run('selectedFiles[0].storedDocumentId'),'same');
});
