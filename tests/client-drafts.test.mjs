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
  if(path==='/api/assessment/11665')return{ok:true,json:async()=>({identityRevision:1,client:{external:{dealId:'11665'},iin:null,title:'SYNTHETIC A'}})};
  if(path.endsWith('/draft')){
   if(options.method==='POST'){
    const body=JSON.parse(options.body);writes.push(body);if(writeGate)await writeGate;
    if(failure||body.expectedRevision!==(store.revision||0))return{ok:false,json:async()=>({error:'DRAFT_CHANGED'})};
    store.payload=body.payload;store.revision=(store.revision||0)+1;return{ok:true,json:async()=>({revision:store.revision,latestRevision:store.revision})};
   }
   if(readGate)await readGate;
   return{ok:true,json:async()=>({draft:store.payload?{payload:store.payload,revision:store.revision,identityRevision:1,updatedAt:'2026-09-12T10:00:00Z'}:null})};
  }
  if(path.endsWith('/submission'))return{ok:true,json:async()=>({submission:null})};
  if(path.endsWith('/credentials'))return{ok:true,json:async()=>({credentials:{verified:false},identityRevision:1})};
  if(path.endsWith('/uploads'))return{ok:true,json:async()=>({unsent:null})};
  if(path==='/api/assessment/clients')return{ok:true,json:async()=>({drafts:[{dealId:'11665',title:'SYNTHETIC A',updatedAt:'2026-09-12',fileCount:0}],recent:[{dealId:'123',title:'<img src=x onerror=alert(1)>',updatedAt:'2026-09-12',fileCount:2}]})};
  throw Error('Unexpected request '+path);
 };
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))run(match[1]);
 for(const file of ['hosted-assessment','assessment-review','server-drafts'])run(fs.readFileSync('public/'+file+'.js','utf8'));
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
 const s=await setup(t);await s.load();s.mountWorkspace();
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
 const s=await setup(t);await s.load();s.mountWorkspace();await s.w.ClientWorkspace.open();assert.equal(s.d.querySelector('.client-dialog img'),null);const search=s.d.querySelector('.client-dialog input');search.value='123';search.dispatchEvent(new s.w.Event('input'));assert.equal(s.d.querySelectorAll('.client-directory-row').length,1);assert.match(s.d.querySelector('.client-directory-row').textContent,/img src=x/);
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
