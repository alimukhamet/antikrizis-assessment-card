import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {JSDOM} from 'jsdom';import {webcrypto} from 'node:crypto';
const html=fs.readFileSync('public/questionnaire.html','utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(t,store={}){
 const dom=new JSDOM(html,{url:'https://test.example/questionnaire.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext());t.after(async()=>{await tick();w.close();});
 w.crypto.randomUUID=()=>webcrypto.randomUUID();w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden')?[{}]:[];};w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 let readGate=null,writeGate=null,failure=false;const writes=[];
 w.fetch=async(path,options={})=>{
  if(path==='/api/assessment/11665')return{ok:true,json:async()=>({identityRevision:store.currentIdentityRevision||1,client:{external:{dealId:'11665'},iin:store.currentIin||null,title:'SYNTHETIC A'}})};
  if(path.endsWith('/draft')){
   if(options.method==='POST'){
    const body=JSON.parse(options.body);writes.push(body);if(writeGate)await writeGate;
    if(failure||body.expectedRevision!==(store.revision||0))return{ok:false,json:async()=>({error:'DRAFT_CHANGED'})};
    store.payload=body.payload;store.revision=(store.revision||0)+1;return{ok:true,json:async()=>({revision:store.revision,latestRevision:store.revision})};
   }
   if(readGate)await readGate;
   return{ok:true,json:async()=>({draft:store.payload?{payload:store.payload,revision:store.revision,identityRevision:store.identityRevision||1,recovery:store.recovery,updatedAt:'2026-09-12T10:00:00Z'}:null})};
  }
  if(path.endsWith('/submission'))return{ok:true,json:async()=>({submission:null})};
  if(path.endsWith('/credentials'))return{ok:true,json:async()=>({credentials:{verified:false},identityRevision:1})};
  if(path.endsWith('/uploads'))return{ok:true,json:async()=>({unsent:null})};
  if(path.startsWith('/api/assessment/clients'))return{ok:true,json:async()=>({drafts:[{dealId:'11665',title:'SYNTHETIC A',updatedAt:'2026-09-12',fileCount:0}],recent:path.includes('?q=')?[{dealId:'123',title:'<img src=x onerror=alert(1)>',updatedAt:'2026-09-12',fileCount:2}]:[]})};
  throw Error('Unexpected request '+path);
 };
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))run(match[1]);
 for(const file of ['loan-status','money-input','hosted-assessment','assessment-review','server-drafts'])run(fs.readFileSync('public/'+file+'.js','utf8'));
 const load=async()=>{d.getElementById('hostDealId').value='11665';await d.getElementById('hostLoadDeal').onclick();await tick();};
 const edit=(id,value)=>{const control=d.getElementById(id);control.value=value;control.dispatchEvent(new w.Event('input',{bubbles:true}));};
 return{w,d,run,writes,store,edit,load,setReadGate:g=>{readGate=g},setWriteGate:g=>{writeGate=g},fail:()=>{failure=true},mountWorkspace(){for(const file of ['document-review','document-upload','credential-upload','submission-flow','server-answer-check'])run(fs.readFileSync('public/'+file+'.js','utf8'));run(fs.readFileSync('public/assessment-workflow.js','utf8'));run(fs.readFileSync('public/client-workspace.js','utf8'));}};
}
test('returning to a client opens their draft automatically and preserves salary and 9 dependents',async t=>{
 const s=await setup(t);await s.load();s.edit('fio','SYNTHETIC A');s.edit('dependents','9');s.edit('needsSalaryDoc','none');await s.w.ServerDrafts.save();
 const b=await setup(t,s.store);await b.load();assert.equal(b.d.getElementById('fio').value,'SYNTHETIC A');assert.equal(b.d.getElementById('dependents').value,'9');assert.equal(b.d.getElementById('needsSalaryDoc').value,'none');assert.equal(b.w.ServerDrafts.isDirty(),false);assert.equal(b.d.querySelector('[data-client-confirmed]'),null);
});
test('autosave persists an edited answer without a save click',async t=>{
 const s=await setup(t);await s.load();s.edit('fio','SYNTHETIC AUTOSAVE');await new Promise(resolve=>setTimeout(resolve,1750));assert.equal(s.writes.length,1);assert.equal(s.store.payload.answers.find(a=>a.key==='fio').value,'SYNTHETIC AUTOSAVE');assert.equal(s.w.ServerDrafts.isDirty(),false);
});
test('older drafts default an unassigned document to the client and retain all explicit owners',async t=>{
 const a=await setup(t);await a.load();const payload=JSON.parse(JSON.stringify(a.w.ServerDrafts.capture()));
 payload.documents=['','Супруг(а)','Ребёнок','Другое'].map((person,i)=>({documentId:'synthetic-'+i,originalName:'synthetic-'+i+'.pdf',type:'Другой документ',person}));
 const s=await setup(t,{payload,revision:1});s.run('afAnalyze=async()=>{}');await s.load();
 assert.deepEqual(Array.from(s.w.ServerDrafts.capture().documents,d=>d.person),['Клиент','Супруг(а)','Ребёнок','Другое']);
 assert.equal(await s.w.ServerDrafts.save(),true);assert.deepEqual(s.store.payload.documents.map(d=>d.person),['Клиент','Супруг(а)','Ребёнок','Другое']);
});
test('CRM import defaults new files to the client without changing an existing family assignment',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();
 s.run("selectedFiles=[{id:1,file:{name:'spouse.pdf'},type:'Другой документ',person:'Супруг(а)',storedDocumentId:'spouse-file'}];fileSequence=1;");
 const originalFetch=s.w.fetch;
 s.w.fetch=async(path,options={})=>{
  if(!path.endsWith('/crm-documents'))return originalFetch(path,options);
  if(options.method!=='POST')return{ok:true,json:async()=>({files:[{id:'1'},{id:'2'}]})};
  const spouse=JSON.parse(options.body).fileId==='2';
  return{ok:true,json:async()=>({client:s.w.HostedAssessment.getContext().client,identityRevision:1,assessmentDay:'2026-09-12',documentId:spouse?'spouse-file':'new-file',extractionId:spouse?'spouse-extraction':'new-extraction',originalName:spouse?'spouse.pdf':'client.pdf',eligibleForAutofill:false,findings:['DOCUMENT_IDENTITY_UNVERIFIED'],document:{totalPages:1,pages:[{text:'SYNTHETIC ONLY'}],extraction:{kind:'other',identity:{iin:null,name:null},facts:[],credits:[]}}})};
 };
 for(let attempt=0;attempt<2;attempt++){
  await s.w.ClientWorkspace.importDocuments();const docs=s.w.ServerDrafts.capture().documents;
  assert.equal(docs.length,2);assert.equal(docs.find(d=>d.documentId==='new-file').person,'Клиент');assert.equal(docs.find(d=>d.documentId==='spouse-file').person,'Супруг(а)');
  assert.equal(s.run('af.sources.size'),0);assert.equal(s.run('missingDocuments().includes("ГКБ — полный отчёт")'),true);
 }
});
test('typing during a save remains dirty and the next save includes the newer value',async t=>{
 const s=await setup(t);await s.load();let finish;s.setWriteGate(new Promise(resolve=>finish=resolve));s.edit('fio','FIRST');const saving=s.w.ServerDrafts.save();await tick();s.edit('fio','SECOND');finish();await saving;
 assert.equal(s.store.payload.answers.find(a=>a.key==='fio').value,'FIRST');assert.equal(s.w.ServerDrafts.isDirty(),true);s.setWriteGate(null);await s.w.ServerDrafts.save();assert.equal(s.store.payload.answers.find(a=>a.key==='fio').value,'SECOND');assert.equal(s.w.ServerDrafts.isDirty(),false);
});
test('a saved draft arriving after typing cannot overwrite the new answers',async t=>{
 const a=await setup(t);await a.load();a.edit('fio','SAVED CLIENT');await a.w.ServerDrafts.save();
 const b=await setup(t,a.store);let finish;b.setReadGate(new Promise(resolve=>finish=resolve));await b.load();b.edit('fio','NEW LOCAL INPUT');finish();await tick();
 assert.equal(b.d.getElementById('fio').value,'NEW LOCAL INPUT');assert.equal(b.w.ServerDrafts.canSwitch(),false);assert.equal(await b.w.ServerDrafts.save(),false);assert.equal(b.writes.length,0);
});
test('a conflicting save blocks switching and leaves the local answer intact',async t=>{
 const s=await setup(t);await s.load();s.edit('fio','LOCAL');s.fail();assert.equal(await s.w.ServerDrafts.save(),false);assert.equal(s.w.ServerDrafts.canSwitch(),false);assert.equal(s.d.getElementById('fio').value,'LOCAL');assert.equal(s.w.ServerDrafts.isDirty(),true);
});
test('editing the deal picker cannot bind old answers to another client; transient files remain in their tab',async t=>{
 const s=await setup(t);await s.load();s.mountWorkspace();s.edit('fio','SYNTHETIC A');s.d.getElementById('hostDealId').value='123';await s.w.ServerDrafts.save();assert.equal(s.writes.length,1);assert.equal(s.w.HostedAssessment.getContext().client.external.dealId,'11665');
 s.run("selectedFiles=[{id:1,file:{name:'SYNTHETIC.pdf'},type:'',person:''}]");await s.w.ClientWorkspace.switchTo('123');assert.equal(s.d.querySelector('dialog a[target="_blank"]').getAttribute('href'),'/assessment-review?dealId=123');assert.equal(s.d.getElementById('fio').value,'SYNTHETIC A');assert.equal(s.d.getElementById('hostDealId').value,'11665');
});
test('client directory renders names as text and filters without mixing draft records',async t=>{
 const s=await setup(t);await s.load();s.mountWorkspace();await s.w.ClientWorkspace.open();assert.equal(s.d.querySelector('.client-dialog img'),null);assert.doesNotMatch(s.d.querySelector('.client-dialog').textContent,/img src=x|Последние сделки/);const search=s.d.querySelector('.client-dialog input');search.value='123';search.dispatchEvent(new s.w.Event('input'));await new Promise(resolve=>setTimeout(resolve,300));assert.equal(s.d.querySelectorAll('.client-directory-row').length,1);assert.match(s.d.querySelector('.client-directory-row').textContent,/img src=x/);assert.equal(s.d.querySelector('.client-dialog img'),null);
 search.value='';search.dispatchEvent(new s.w.Event('input'));assert.doesNotMatch(s.d.querySelector('.client-dialog').textContent,/img src=x/);assert.match(s.d.querySelector('.client-directory-row').textContent,/SYNTHETIC A/);
});
test('an outdated client search cannot replace results after the search is cleared',async t=>{
 const s=await setup(t);await s.load();s.mountWorkspace();await s.w.ClientWorkspace.open();const base=s.w.fetch;let finish;
 s.w.fetch=async(path,options)=>{if(path.includes('/clients?q='))await new Promise(resolve=>{finish=resolve;});return base(path,options);};
 const search=s.d.querySelector('.client-dialog input');search.value='123';search.dispatchEvent(new s.w.Event('input'));await new Promise(resolve=>setTimeout(resolve,300));search.value='';search.dispatchEvent(new s.w.Event('input'));finish();await tick();assert.doesNotMatch(s.d.querySelector('.client-dialog').textContent,/img src=x/);assert.match(s.d.querySelector('.client-directory-row').textContent,/SYNTHETIC A/);
});

test('legacy participant answers and old unknown flags survive without disabling required per-loan answers',async t=>{
 const a=await setup(t);await a.load();a.edit('guarantors','LEGACY ANSWER — no loan association');
 a.run("add(document.getElementById('creditors'))");
 const old=JSON.parse(JSON.stringify(a.w.ServerDrafts.capture()));
 for(const row of old.groups.find(g=>g.id==='creditors').rows)for(let i=row.length-1;i>=0;i--)if(['loanParticipants','unknown:loanParticipants'].includes(row[i].key))row.splice(i,1);
 const b=await setup(t,{payload:old,revision:3});await b.load();b.mountWorkspace();
 assert.equal(b.d.getElementById('guarantors').value,'LEGACY ANSWER — no loan association');assert.equal(b.d.getElementById('legacyLoanParticipants').hidden,false);
 const inputs=[...b.d.querySelectorAll('#creditors textarea[id^="loanParticipants"]')];assert.equal(inputs.length,2);assert.ok(inputs.every(e=>e.value===''));
 inputs[0].value='SYNTHETIC PERSON — Гарант';inputs[0].dispatchEvent(new b.w.Event('input',{bubbles:true}));
 const unknown=b.d.querySelectorAll('#creditors [data-legacy-unknown="loanParticipants"]')[1];assert.equal(b.d.querySelector('#creditors [data-unknown="loanParticipants"]'),null);assert.ok(unknown.closest('[hidden]'));unknown.checked=true;unknown.dispatchEvent(new b.w.Event('change',{bubbles:true}));
 assert.equal(inputs[0].disabled,false);assert.equal(inputs[1].disabled,false);assert.equal(await b.w.ServerDrafts.save(),true);
 const c=await setup(t,b.store);await c.load();const restored=[...c.d.querySelectorAll('#creditors textarea[id^="loanParticipants"]')];
 assert.equal(restored[0].value,'SYNTHETIC PERSON — Гарант');assert.equal(restored[1].value,'');assert.equal(restored[1].disabled,false);assert.equal(c.w.ServerDrafts.capture().groups.find(g=>g.id==='creditors').rows[1].find(a=>a.key==='unknown:loanParticipants').checked,true);
 assert.equal(c.d.getElementById('guarantors').value,'LEGACY ANSWER — no loan association');
});

test('an upload-only draft resumes after an IIN was added and saves under the current identity',async t=>{
 const a=await setup(t);await a.load();const payload=JSON.parse(JSON.stringify(a.w.ServerDrafts.capture()));
 payload.documents=[{documentId:'saved-pdf',originalName:'source.pdf',type:'Справка ЕНПФ',person:'Клиент'}];payload.docContext={social:'0',salary:'0',salaryBank:'none'};
 const s=await setup(t,{payload,revision:8,identityRevision:1,currentIdentityRevision:2,currentIin:'810110300027',recovery:{mode:'documents-only',identityRevision:2}});s.run('afAnalyze=async()=>{}');await s.load();
 assert.equal(s.w.ServerDrafts.capture().documents.length,1);assert.equal(s.d.getElementById('iin').value,'810110300027');assert.equal(s.w.ServerDrafts.canSwitch(),true);
 assert.equal(await s.w.ServerDrafts.save(),true);assert.equal(s.writes[0].expectedRevision,8);assert.equal(s.writes[0].identityRevision,2);assert.equal(s.writes[0].payload.answers.find(a=>a.key==='fio').value,'');
});
test('a different identity cannot silently restore answered drafts or confirmations',async t=>{
 const a=await setup(t);await a.load();a.edit('fio','PREVIOUS PERSON');const payload=JSON.parse(JSON.stringify(a.w.ServerDrafts.capture()));
 const s=await setup(t,{payload,revision:8,identityRevision:1,currentIdentityRevision:2,currentIin:'810110300027'});await s.load();
 assert.equal(s.d.getElementById('fio').value,'');assert.equal(s.w.ServerDrafts.canSwitch(),false);assert.equal(s.writes.length,0);assert.match(s.d.getElementById('draftStatus').textContent,/прежним данным/);
});
test('contracted search results require the explicit archive option and cannot use the ID fallback',async t=>{
 const s=await setup(t);await s.load();s.mountWorkspace();const base=s.w.fetch;s.w.fetch=async(path,options)=>path.includes('/clients')?{ok:true,json:async()=>({drafts:[],recent:path.includes('?q=')?[{dealId:'123',title:'SAVED CONTRACT',hasContract:true,fileCount:3}]:[]})}:base(path,options);
 await s.w.ClientWorkspace.open();const search=s.d.querySelector('.client-dialog input[type=search]');search.value='123';search.dispatchEvent(new s.w.Event('input'));await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(s.d.querySelectorAll('.client-directory-row').length,0);assert.doesNotMatch(s.d.querySelector('.client-dialog').textContent,/Открыть сделку № 123/);
 const archive=s.d.querySelector('.client-archive-toggle input');archive.checked=true;archive.dispatchEvent(new s.w.Event('change'));assert.equal(s.d.querySelectorAll('.client-directory-row').length,1);assert.match(s.d.querySelector('.client-directory-row').textContent,/Договор уже оформлен/);
});

test('each loan defaults into the claim and explicit exclusion survives reopening and source refresh',async t=>{
 const a=await setup(t);await a.load();const first=a.d.querySelector('#creditors [data-loan-claim]');assert.equal(first.checked,true);
 a.run("af.client='test-client';var row=afRow('creditors','test-client|TEST BANK|1');afRowFields(row,{n8038:'TEST BANK',n8040:'100.25'},{fileId:1});var other=add(document.getElementById('creditors'));");
 assert.equal(a.d.querySelectorAll('#creditors > .repeat-rows > .repeat-item').length,2);
 const flags=a.d.querySelectorAll('#creditors [data-loan-claim]');flags[0].checked=false;flags[0].dispatchEvent(new a.w.Event('change',{bubbles:true}));assert.equal(flags[1].checked,true);await a.w.ServerDrafts.save();
 const b=await setup(t,a.store);await b.load();assert.deepEqual([...b.d.querySelectorAll('#creditors [data-loan-claim]')].map(e=>e.checked),[false,true]);
 b.run("afRowFields(afRow('creditors','test-client|TEST BANK|1'),{n8038:'TEST BANK',n8040:'100.25'},{fileId:1})");assert.equal(b.d.querySelector('#creditors [data-loan-claim]').checked,false);
 const legacy=structuredClone(a.store);for(const group of legacy.payload.groups)if(group.id==='creditors')group.rows=group.rows.map(row=>row.filter(answer=>answer.key!=='loanClaimIncluded'));
 const c=await setup(t,legacy);await c.load();assert.ok([...c.d.querySelectorAll('#creditors [data-loan-claim]')].every(e=>e.checked));
});

test('an explicitly discarded unsent filename stays removed after saving and reopening',async t=>{
 const seed=await setup(t);await seed.load();const payload=JSON.parse(JSON.stringify(seed.w.ServerDrafts.capture()));
 payload.pendingFiles=['mistake.pdf','keep.pdf'];payload.answers.find(a=>a.key==='fio').value='KEEP TYPED ANSWERS';
 const s=await setup(t,{payload,revision:1});await s.load();
 assert.equal(s.w.ServerDrafts.forgetPendingFile('not-selected.pdf'),false);
 s.run('af.busy=true');assert.equal(s.w.ServerDrafts.forgetPendingFile('mistake.pdf'),false);s.run('af.busy=false');
 assert.equal(s.w.ServerDrafts.forgetPendingFile('mistake.pdf'),true);
 assert.deepEqual(Array.from(s.w.ServerDrafts.capture().pendingFiles),['keep.pdf']);
 assert.equal(s.d.getElementById('fio').value,'KEEP TYPED ANSWERS');assert.equal(await s.w.ServerDrafts.save(),true);
 const reopened=await setup(t,s.store);await reopened.load();assert.deepEqual(Array.from(reopened.w.ServerDrafts.pendingFiles()),['keep.pdf']);
});
test('a late failed draft save cannot replace the status or readiness of a different client',async t=>{
 const s=await setup(t);await s.load();let finish;s.setWriteGate(new Promise(resolve=>finish=resolve));s.fail();s.edit('fio','SYNTHETIC OLD');
 const saving=s.w.ServerDrafts.save();await tick();const current={...s.w.HostedAssessment.getContext(),client:{external:{dealId:'900002'},title:'SYNTHETIC NEW'}};
 s.w.HostedAssessment.getContext=()=>current;s.d.getElementById('draftStatus').textContent='NEW CLIENT STATUS';finish();assert.equal(await saving,false);
 assert.equal(s.d.getElementById('draftStatus').textContent,'NEW CLIENT STATUS');assert.equal(s.w.ServerDrafts.canSwitch(),true);
});
