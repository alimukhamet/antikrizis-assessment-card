import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=name=>fs.readFileSync('public/'+name+'.js','utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

async function assessment(t){
 const html=fs.readFileSync('public/questionnaire.html','utf8');
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html',runScripts:'outside-only'}),w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext()),calls=[];
 t.after(()=>w.close());w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.fetch=async(path,options={})=>{calls.push({path,method:options.method||'GET'});
  const data=path==='/api/assessment/900001'?{caseId:'test',identityRevision:1,assessmentDay:'2026-09-17',client:{title:'SYNTHETIC',iin:'000000000010',external:{dealId:'900001'}}}:path.endsWith('/draft')?{draft:null}:path.endsWith('/credentials')?{credentials:{verified:false},identityRevision:1}:{};
  return{ok:true,json:async()=>data};};
 for(const script of d.querySelectorAll('script:not([src])'))run(script.textContent);
 for(const name of ['hosted-assessment','assessment-review','server-drafts','credential-upload','document-replacement'])run(source(name));
 d.getElementById('hostDealId').value='900001';await d.getElementById('hostLoadDeal').onclick();await tick();
 // Keep this test read-only: exercise the real capture/dirty/evidence code, no timed draft write.
 w.ServerDrafts.save=async()=>true;
 run(source('file-selection-controls'));await tick();
 return{w,d,run,calls};
}
function choose(s,kind='Доверенность',stored=true){
 s.run(`selectedFiles.push({id:++fileSequence,type:${JSON.stringify(kind)},person:'Клиент',file:new File(['SYNTHETIC'],'wrong.pdf',{type:'application/pdf'}),${stored?"storedDocumentId:'stored-original'":''}});renderDocuments();afRenderResults();FileSelectionControls.refresh();`);
 return s.run('selectedFiles.at(-1)');
}
test('file actions are inside expandable pending, failed and saved file rows',async t=>{
 const s=await assessment(t);choose(s,'Доверенность',false);choose(s,'Справка ЕНПФ');choose(s,'Удостоверение личности');s.run("af.results.set(2,{error:'Unreadable'});afRenderResults();");
 const buttons=[...s.d.querySelectorAll('#afFileResults .file-selection-remove')];assert.equal(buttons.length,3);
 for(const button of buttons){assert.ok(button.closest('details.af-file'));assert.equal(button.closest('details.af-file').open,false);assert.equal(button.disabled,false);}
 assert.equal(s.d.querySelectorAll('.af-file .af-original-name').length,3);
 buttons[0].closest('details.af-file').querySelector('summary').click();buttons[0].click();assert.equal(s.run('selectedFiles.length'),2);
 assert.equal(s.w.ServerDrafts.capture().pendingFiles.length,0);
});
test('removing an analyzed file excludes its original and invalidates sourced answers without erasing typed answers',async t=>{
 const s=await assessment(t),item=choose(s);
 s.d.getElementById('fio').value='KEEP THE ANSWER';
 s.run("af.sources.set('fio',{fileId:1,pending:false,reviewId:'old-review'});af.results.set(1,{identity:{iin:'000000000010'}});af.conflicts.push({id:'fio',src:{fileId:1},value:'OTHER'});");
 assert.equal(s.w.FileSelectionControls.remove(item),true);
 assert.equal(s.w.ServerDrafts.capture().documents.length,0);assert.equal(s.run('af.results.size'),0);assert.equal(s.run('af.conflicts.length'),0);
 assert.equal(s.d.getElementById('fio').value,'KEEP THE ANSWER');assert.equal(s.run("af.sources.get('fio').pending"),true);assert.equal(s.d.getElementById('fio').dataset.sourceReplaced,'true');assert.ok(s.d.getElementById('fio').validationMessage);
 assert.equal(s.calls.some(c=>c.method==='DELETE'||c.path.includes('/api/bitrix')),false);
});
test('removing a selected key clears password and owner approval and cannot retain ready state',async t=>{
 const s=await assessment(t),item=choose(s,'ЭЦП файл',false),password=s.d.getElementById('previewEdsPassword'),owner=password.closest('.field').querySelector('input[type=checkbox]');
 password.value='SYNTHETIC';owner.checked=true;assert.equal(s.w.CredentialUpload.collected(),true);
 assert.equal(s.w.FileSelectionControls.remove(item),true);assert.equal(password.value,'');assert.equal(owner.checked,false);assert.equal(s.w.CredentialUpload.collected(),false);
});
test('file controls refuse changes while analysis or contract save is running, including direct handler calls',async t=>{
 const s=await assessment(t),item=choose(s);
 s.run('af.busy=true');assert.equal(s.w.FileSelectionControls.remove(item),false);s.run('af.busy=false');
 s.d.dispatchEvent(new s.w.CustomEvent('assessment-submission-progress',{detail:{busy:true}}));assert.equal(s.w.FileSelectionControls.remove(item),false);
 s.d.dispatchEvent(new s.w.CustomEvent('assessment-submission-progress',{detail:{busy:false}}));assert.equal(s.w.FileSelectionControls.remove(item),true);
});

async function handoff(t,state=null){
 const dom=new JSDOM('<main class="wrap"><div class="wf-credential"><div data-required-document="ЭЦП файл"><input data-required-picker="ЭЦП файл" type="file"></div><div class="field"><input id="previewEdsPassword"></div></div><div id="require-power" data-required-document="Доверенность"><input data-required-picker="Доверенность" type="file"></div><div id="selectedDocuments"></div></main>',{url:'https://synthetic.invalid/',runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 const context={identityRevision:1,client:{iin:'000000000010',external:{dealId:'900001'}}},stage={fromStageName:'Договор',stageName:'Успех'},calls=[];
 const make=(tag,text,cls)=>{const e=d.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 w.ClientContextUI={mode:'handoff',make,context:()=>context,ready:()=>true,sync(){}};
 w.HostedAssessment={ready:()=>true,getContext:()=>context,requestJson:async(path,opts)=>{calls.push({path,method:opts.method||'GET'});if(path.endsWith('handoff-check'))return{identityRevision:1,documents:{packageReady:true,issues:[]}};return{handoff:state?{requestId:'saved',state,destination:stage}:null,destination:stage,stageError:null};}};
 w.HostedAssessment.analyzeFile=async item=>({...context,documentId:item.storedDocumentId,document:{totalPages:2,extraction:{identity:{iin:context.client.iin}}}});w.HostedAssessment.adapt=a=>({server:{documentId:a.documentId}});
 w.af={busy:false,results:new Map(),conflicts:[]};w.selectedFiles=[{id:1,type:'Подписанный договор',person:'Клиент',storedDocumentId:'signed',file:{name:'signed.pdf'}},{id:2,type:'Доверенность',person:'Клиент',storedDocumentId:'power',file:{name:'power.pdf'}},{id:3,type:'Другой документ',person:'Клиент',storedDocumentId:'keep',file:{name:'keep.pdf'}}];w.af.results.set(2,{server:{documentId:'power'}});
 w.fileSequence=3;w.renderDocuments=()=>{};w.afSource=()=>{};w.afStatus=()=>{};w.afRenderResults=()=>{};w.afRenderConflicts=()=>{};w.afClientChoices=()=>{};w.afRefresh=()=>{};
 w.DocumentReview={open(){},render(){}};w.CredentialUpload={collected:()=>true,verified:()=>true};w.ServerDrafts={save:async()=>true,canSwitch:()=>true};
 for(const name of ['operations','lawyer-handoff','file-selection-controls'])w.eval(source(name));await tick();await tick();
 return{w,d,calls};
}
test('handoff exposes per-file removal and replacement without the hidden file list',async t=>{
 const s=await handoff(t);await s.d.getElementById('handoffPowerCheck').onclick();
 s.d.getElementById('handoffSignedConfirmed').checked=true;await s.d.getElementById('handoffSignedConfirmed').onchange();
 assert.equal(s.d.getElementById('handoffSend').disabled,false);assert.equal(s.d.getElementById('handoffSignedRemove').hidden,false);
 s.d.getElementById('handoffSignedRemove').click();await tick();assert.equal(s.d.getElementById('handoffSignedConfirmed').checked,false);assert.equal(s.d.getElementById('handoffSend').disabled,true);
 assert.deepEqual(s.w.selectedFiles.map(i=>i.id),[2,3]);
 const remove=s.d.querySelector('.file-selection-list [aria-label="Убрать power.pdf"]');assert.ok(remove);remove.click();await tick();assert.deepEqual(s.w.selectedFiles.map(i=>i.id),[3]);
 assert.equal(s.d.getElementById('handoffPowerState').textContent,'Не выбрана');assert.equal(s.calls.some(c=>c.method==='DELETE'||(c.method==='POST'&&!c.path.endsWith('handoff-check'))),false);
});
test('prepared, uncertain and verified handoffs cannot silently remove files from their saved operation',async t=>{
 for(const state of ['prepared','writing','uncertain','verified']){const s=await handoff(t,state);assert.equal(s.d.getElementById('handoffSignedRemove').disabled,true);assert.equal(s.w.FileSelectionControls.remove(s.w.selectedFiles[0]),false);assert.equal(s.w.selectedFiles.length,3);}
});

test('unsent restored filenames have visible dismissal and cannot reappear after removing a reselected file',async t=>{
 const s=await assessment(t);let names=['wrong.pdf','keep.pdf'];
 s.w.ServerDrafts.pendingFiles=()=>names.filter(name=>!s.run('selectedFiles').some(item=>item.file.name===name));
 s.w.ServerDrafts.forgetPendingFile=name=>{const exists=names.includes(name);names=names.filter(n=>n!==name);return exists;};
 s.w.FileSelectionControls.refresh();
 const list=s.d.getElementById('pendingFileSelections');assert.ok(list);assert.equal(list.hidden,false);
 list.querySelector('[aria-label="Убрать из черновика keep.pdf"]').click();assert.deepEqual(names,['wrong.pdf']);
 const item=choose(s,'Доверенность',false);s.w.FileSelectionControls.remove(item);assert.deepEqual(names,[]);assert.equal(list.hidden,true);
});
