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
 for(const file of ['loan-status','money-input','hosted-assessment','assessment-review','intake-data','enforcement-editor','server-drafts'])run(fs.readFileSync('public/'+file+'.js','utf8'));
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
test('restoring saved documents merges a generic selection by immutable ID and keeps same-name originals',async t=>{
 const seed=await setup(t);await seed.load();seed.edit('fio','KEEP ANSWER');const payload=JSON.parse(JSON.stringify(seed.w.ServerDrafts.capture()));
 payload.documents=[
  {documentId:'same-source',originalName:'enpf.pdf',type:'Другой документ',person:''},
  {documentId:'same-source',originalName:'enpf.pdf',type:'Справка ЕНПФ',person:'Клиент'},
  {documentId:'different-source-a',originalName:'same-name.pdf',type:'Другой документ',person:'Клиент'},
  {documentId:'different-source-b',originalName:'same-name.pdf',type:'Другой документ',person:'Клиент'},
  {documentId:'conflicting-type',originalName:'conflict.pdf',type:'Справка ЕНПФ',person:'Клиент'},
  {documentId:'conflicting-type',originalName:'conflict.pdf',type:'Удостоверение личности',person:'Клиент'},
  {documentId:'conflicting-person',originalName:'person.pdf',type:'Справка ЕНПФ',person:'Клиент'},
  {documentId:'conflicting-person',originalName:'person.pdf',type:'Справка ЕНПФ',person:'Супруг(а)'}
 ];
 payload.documentReviewDrafts=[{documentId:'same-source',type:'Справка ЕНПФ',values:{issuedAt:'2020-01-02'}}];
 const s=await setup(t,{payload,revision:4});s.run('afAnalyze=async()=>{}');await s.load();
 assert.equal(s.d.getElementById('fio').value,'KEEP ANSWER');assert.equal(s.w.ServerDrafts.isDirty(),true);
 const selected=JSON.parse(JSON.stringify(s.run("selectedFiles.map(item=>({documentId:item.storedDocumentId,name:item.file.name,type:item.type,person:item.person}))")));
 assert.equal(selected.filter(item=>item.documentId==='same-source').length,1);
 assert.deepEqual(selected.find(item=>item.documentId==='same-source'),{documentId:'same-source',name:'enpf.pdf',type:'Справка ЕНПФ',person:'Клиент'});
 assert.equal(selected.filter(item=>item.name==='same-name.pdf').length,2);
 assert.equal(selected.filter(item=>item.documentId==='conflicting-type').length,2);
 assert.equal(selected.filter(item=>item.documentId==='conflicting-person').length,2);
 assert.equal(s.w.ServerDrafts.getDocumentReviewDraft('same-source','Справка ЕНПФ').issuedAt,'2020-01-02');
 assert.equal(await s.w.ServerDrafts.save(),true);
 const reopened=await setup(t,s.store);reopened.run('afAnalyze=async()=>{}');await reopened.load();
 const reopenedDocs=JSON.parse(JSON.stringify(reopened.w.ServerDrafts.capture().documents));
 assert.equal(reopened.d.getElementById('fio').value,'KEEP ANSWER');assert.equal(reopenedDocs.filter(item=>item.documentId==='same-source').length,1);assert.equal(reopenedDocs.filter(item=>item.documentId==='conflicting-type').length,2);assert.equal(reopenedDocs.filter(item=>item.documentId==='conflicting-person').length,2);assert.equal(reopened.w.ServerDrafts.getDocumentReviewDraft('same-source','Справка ЕНПФ').issuedAt,'2020-01-02');
});
test('dedup keeps the fresh result, never revives withdrawn approvals, and preserves answer provenance',async t=>{
 for(const scenario of [{oldExtraction:'old',currentExtraction:'current',changed:true},{oldExtraction:'current',currentExtraction:'current',changed:false},{oldExtraction:'current',currentExtraction:'current',changed:false,approved:true}]){
  const s=await setup(t);await s.load();s.edit('fio','KEEP EMPLOYEE ANSWER');
  s.run(`selectedFiles=[{id:1,file:{name:'source.pdf'},type:'Другой документ',person:'Клиент',storedDocumentId:'shared-source'},{id:2,file:{name:'source.pdf'},type:'Справка ЕНПФ',person:'Клиент',storedDocumentId:'shared-source'}];
   af.results.set(1,{server:{documentId:'shared-source',extractionId:${JSON.stringify(scenario.currentExtraction)},identityRevision:2},${scenario.approved?"documentReview:{type:'Справка ЕНПФ',reviewId:'current-review'},":''}});
   af.results.set(2,{server:{documentId:'shared-source',extractionId:${JSON.stringify(scenario.oldExtraction)},identityRevision:2},documentReview:{type:'Справка ЕНПФ',reviewId:'old-review'}});
   af.sources.set('fio',{fileId:1,value:'KEEP EMPLOYEE ANSWER',server:{documentId:'shared-source',extractionId:${JSON.stringify(scenario.oldExtraction)},identityRevision:2},reviewId:'answer-review',pending:false});afMergeDuplicateSelections(new Set([1]));`);
  assert.equal(s.run('selectedFiles.length'),1);assert.equal(s.run('selectedFiles[0].type'),'Справка ЕНПФ');
  assert.equal(s.run("af.sources.get('fio').fileId"),2);assert.equal(s.run("af.results.get(2).server.extractionId"),'current');
  assert.equal(s.run("af.results.get(2).documentReview?.reviewId"),scenario.approved?'current-review':undefined);
  assert.equal(s.run("Boolean(af.sources.get('fio').stale)"),scenario.changed);assert.equal(s.run("af.sources.get('fio').pending"),scenario.changed);
  assert.equal(s.run("af.sources.get('fio').reviewId"),'answer-review');assert.equal(s.d.getElementById('fio').value,'KEEP EMPLOYEE ANSWER');
 }
});
test('reload promotes an unclassified saved selection when the current cached result has a recognized type',async t=>{
 const seed=await setup(t);await seed.load();const payload=JSON.parse(JSON.stringify(seed.w.ServerDrafts.capture()));payload.documents=[{documentId:'recognized-source',originalName:'source.pdf',type:'Другой документ',person:'Клиент'},{documentId:'explicit-source',originalName:'second.pdf',type:'Удостоверение личности',person:'Клиент'}];
 const s=await setup(t,{payload,revision:2});s.w.HostedAssessment.analyzeFile=async(item)=>({client:s.w.HostedAssessment.getContext().client,identityRevision:1,assessmentDay:'2026-09-12',documentId:item.storedDocumentId,extractionId:'current-extraction',eligibleForAutofill:false,findings:[],document:{totalPages:1,pages:[{text:'SYNTHETIC ONLY'}],extraction:{kind:'enpf',identity:{iin:null,name:null},facts:[],credits:[]}}});await s.load();
 assert.equal(s.run('selectedFiles[0].type'),'Справка ЕНПФ');assert.equal(s.run('selectedFiles[1].type'),'Удостоверение личности');assert.match(s.run('afDocumentAttention(selectedFiles[1]).message'),/Справка ЕНПФ/);
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
test('CRM import merges an existing generic row by document ID without merging a same-name original',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();
 s.run("selectedFiles=[{id:1,file:{name:'same.pdf',size:1,type:'application/pdf'},type:'Другой документ',person:'Клиент',storedDocumentId:'shared-import'},{id:2,file:{name:'same.pdf',size:1,type:'application/pdf'},type:'Справка ЕНПФ',person:'Клиент',storedDocumentId:'shared-import'}];fileSequence=2;");
 const originalFetch=s.w.fetch, payload=documentId=>({client:s.w.HostedAssessment.getContext().client,identityRevision:1,assessmentDay:'2026-09-12',documentId,extractionId:documentId+'-extraction',originalName:'same.pdf',eligibleForAutofill:false,findings:[],document:{totalPages:1,pages:[{text:'SYNTHETIC ONLY'}],extraction:{kind:'enpf',identity:{iin:null,name:null},facts:[],credits:[]}}});
 s.w.fetch=async(path,options={})=>{if(!path.endsWith('/crm-documents'))return originalFetch(path,options);if(options.method!=='POST')return{ok:true,json:async()=>({files:[{id:'1'},{id:'2'}]})};return{ok:true,json:async()=>payload(JSON.parse(options.body).fileId==='1'?'shared-import':'different-import')};};
 await s.w.ClientWorkspace.importDocuments();
 const selected=JSON.parse(JSON.stringify(s.run("selectedFiles.map(item=>({documentId:item.storedDocumentId,name:item.file.name,type:item.type,person:item.person}))")));
 assert.equal(selected.filter(item=>item.documentId==='shared-import').length,1);
 assert.equal(selected.filter(item=>item.documentId==='different-import').length,1);
 assert.equal(selected.filter(item=>item.name==='same.pdf').length,2);
 assert.equal(selected.find(item=>item.documentId==='shared-import').type,'Справка ЕНПФ');
});
test('CRM reimport preserves an explicit employee type and exposes a recognition conflict',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();
 s.run("selectedFiles=[{id:1,file:{name:'source.pdf',size:1,type:'application/pdf'},type:'Ф6 об отсутствии имущества',person:'Супруг(а)',storedDocumentId:'source'}];fileSequence=1;");
 const originalFetch=s.w.fetch;
 s.w.fetch=async(path,options={})=>{if(!path.endsWith('/crm-documents'))return originalFetch(path,options);if(options.method!=='POST')return{ok:true,json:async()=>({files:[{id:'1'}]})};return{ok:true,json:async()=>({client:s.w.HostedAssessment.getContext().client,identityRevision:1,assessmentDay:'2026-09-12',documentId:'source',extractionId:'current',originalName:'source.pdf',eligibleForAutofill:false,findings:[],document:{totalPages:1,pages:[{text:'SYNTHETIC ONLY'}],extraction:{kind:'enpf',identity:{iin:null,name:null},facts:[],credits:[]}}})};};
 await s.w.ClientWorkspace.importDocuments();assert.equal(s.run('selectedFiles.length'),1);assert.equal(s.run('selectedFiles[0].type'),'Ф6 об отсутствии имущества');assert.equal(s.run('selectedFiles[0].person'),'Супруг(а)');assert.match(s.run('afDocumentAttention(selectedFiles[0]).message'),/Справка ЕНПФ/);
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

test('completed CRM PDFs are checkpointed while other downloads run and survive leaving midway',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.edit('fio','KEEP MY ANSWER');s.mountWorkspace();let secondStarted;const started=new Promise(r=>secondStarted=r);let finish;const gate=new Promise(r=>finish=r),originalFetch=s.w.fetch;
 const payload=id=>({client:s.w.HostedAssessment.getContext().client,identityRevision:1,assessmentDay:'2026-09-29',documentId:id,extractionId:id,originalName:id+'.pdf',eligibleForAutofill:false,findings:[],document:{totalPages:1,pages:[],extraction:{kind:'other',identity:{iin:null},facts:[],credits:[]}}});
 s.w.fetch=async(path,options={})=>{if(!path.endsWith('/crm-documents'))return originalFetch(path,options);if(options.method!=='POST')return{ok:true,json:async()=>({files:[{id:'1'},{id:'2'}]})};const id=JSON.parse(options.body).fileId;if(id==='2'){secondStarted();await gate;}return{ok:true,json:async()=>payload('doc-'+id)};};
 const importing=s.w.ClientWorkspace.importDocuments();await started;for(let n=0;n<50&&!s.store.payload?.documents.length;n++)await new Promise(r=>setTimeout(r,10));
 assert.equal(s.run('af.busy'),true);assert.equal(s.store.payload.documents.length,1);assert.equal(s.store.payload.documents[0].documentId,'doc-1');assert.equal(s.store.payload.answers.find(a=>a.key==='fio').value,'KEEP MY ANSWER');assert.equal(await s.w.ServerDrafts.save(),false,'ordinary save still waits during import');
 const reopen=await setup(t,structuredClone(s.store));reopen.run('afAnalyze=async()=>{}');await reopen.load();assert.equal(reopen.run('selectedFiles[0].storedDocumentId'),'doc-1');assert.equal(reopen.d.getElementById('fio').value,'KEEP MY ANSWER');finish();await importing;assert.equal(s.store.payload.documents.length,2);
});
test('fill missing fields uses cached evidence and preserves employee answers, zero and existing reviews',async t=>{
 const s=await setup(t);await s.load();s.edit('iin','991231300003');s.edit('fio','EMPLOYEE NAME');s.edit('dependents','0');
 s.run(`HostedAssessment.getContext().client.iin='991231300003';selectedFiles=[{id:1,file:{name:'report.pdf'},type:'ГКБ — полный отчёт',person:'Клиент',storedDocumentId:'saved'}];af.results.set(1,{identity:{iin:'991231300003',fio:'SOURCE NAME'},fields:[{key:'fio',value:'SOURCE NAME',page:1},{key:'dependents',value:'4',page:1},{key:'clientPhone',value:'87000000000',page:1}],loans:[],properties:[],notes:[],server:{dealId:'11665',documentId:'saved',extractionId:'source'},kind:'gkbFull'});af.sources.set('fio',{fileId:1,reviewId:'employee-review',pending:false,value:'EMPLOYEE NAME'});afClientChoices();`);
 const before=s.writes.length;assert.equal(s.d.getElementById('afApply').style.display,'inline-block');assert.match(s.d.getElementById('afApply').textContent,/пропуски/);await s.d.getElementById('afApply').onclick();
 assert.equal(s.d.getElementById('fio').value,'EMPLOYEE NAME');assert.equal(s.d.getElementById('dependents').value,'0');assert.equal(s.d.getElementById('clientPhone').value,'87000000000');assert.equal(s.run("af.sources.get('fio').reviewId"),'employee-review');assert.equal(s.run('af.conflicts.length'),0);assert.equal(s.writes.length,before+1);assert.equal(s.run('af.fillingMissing'),false);
});

for(const reverse of [false,true])test(`new loan autofill uses the newest report independent of selection order (${reverse})`,async t=>{
 const s=await setup(t);await s.load();s.edit('iin','991231300003');
 s.run(`HostedAssessment.getContext().client.iin='991231300003';
 const loan=(number,amount)=>({key:'SYNTHETIC BANK|'+number,aliases:['SYNTHETIC BANK|'+number],page:1,fields:{n8038:'SYNTHETIC BANK',loanContractId:number,n8040:amount,loanStatus:'В просрочке — требуют полную сумму'}});
 const source=(id,kind,date,loans)=>({kind,date,identity:{iin:'991231300003',fio:'SYNTHETIC'},fields:[],loans,properties:[],notes:[],server:{dealId:'11665',documentId:'doc-'+id,extractionId:'extract-'+id}});
 selectedFiles=[{id:1,file:{name:'older-short.pdf'},type:'ГКБ — краткий отчёт',person:'Клиент',storedDocumentId:'doc-1'},{id:2,file:{name:'newer-full.pdf'},type:'ГКБ — полный отчёт',person:'Клиент',storedDocumentId:'doc-2'}];
 const sources=[[1,source(1,'gkbShort','2026-07-23',[loan('CURRENT','90.00'),loan('OLDER-ONLY','20.00')])],[2,source(2,'gkbFull','2026-08-03',[loan('CURRENT','100.00')])]];
 af.results=new Map(${reverse}?[...sources].reverse():sources);afClientChoices();`);
 await s.d.getElementById('afApply').onclick();
 const rows=s.w.ServerDrafts.capture().groups.find(g=>g.id==='creditors').rows;
 assert.equal(rows.length,1);assert.equal(rows[0].find(a=>a.key==='loanContractId').value,'CURRENT');assert.equal(rows[0].find(a=>a.key==='n8040').value,'100.00');
 assert.equal(s.run("[...af.sources.values()].find(s=>s.fileId===2)!==undefined"),true);
 assert.equal(s.w.ServerDrafts.capture().documents.length,2,'older original remains selected for comparison');
 const before=s.writes.length;await s.d.getElementById('afApply').onclick();assert.equal(s.w.ServerDrafts.capture().groups.find(g=>g.id==='creditors').rows.length,1);assert.equal(s.writes.length,before,'repeat fill is idempotent');
});

test('parallel CRM import bounds downloads, checkpoints in completion order and never races draft revisions',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();
 const pending=new Map(),started=[];let active=0,peak=0;const original=s.w.fetch;
 const waitFor=async fn=>{for(let n=0;n<100&&!fn();n++)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
 s.w.fetch=async(path,options={})=>{
  if(!path.endsWith('/crm-documents'))return original(path,options);
  if(options.method!=='POST')return{ok:true,json:async()=>({files:['1','2','3','4','5'].map(id=>({id}))})};
  const id=JSON.parse(options.body).fileId;started.push(id);peak=Math.max(peak,++active);await new Promise(r=>pending.set(id,r));active--;
  return{ok:true,json:async()=>({client:s.w.HostedAssessment.getContext().client,identityRevision:1,documentId:'doc-'+(id==='5'?'2':id),extractionId:id,originalName:id+'.pdf',eligibleForAutofill:false,findings:[],document:{totalPages:1,pages:[],extraction:{kind:'other',identity:{iin:null},facts:[],credits:[]}}})};
 };
 const importing=s.w.ClientWorkspace.importDocuments();await waitFor(()=>pending.size===3);assert.equal(peak,3);
 pending.get('2')();await waitFor(()=>pending.has('4'));assert.equal(s.store.payload.documents[0].documentId,'doc-2');
 pending.get('3')();pending.get('4')();await waitFor(()=>pending.has('5'));pending.get('1')();pending.get('5')();await importing;
 assert.equal(peak,3);assert.deepEqual(s.store.payload.documents.map(d=>d.documentId),['doc-1','doc-2','doc-3','doc-4']);assert.deepEqual(s.writes.map(w=>w.expectedRevision),s.writes.map((_,i)=>i));assert.equal(s.run('af.busy'),false);
});
test('a failed import checkpoint stops scheduling more files and preserves the completed file on screen',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();s.fail();
 const original=s.w.fetch;let started=0;
 s.w.fetch=async(path,options={})=>{
  if(!path.endsWith('/crm-documents'))return original(path,options);
  if(options.method!=='POST')return{ok:true,json:async()=>({files:['1','2','3','4','5','6'].map(id=>({id}))})};
  const id=JSON.parse(options.body).fileId;started++;
  if(id!=='1')await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('Cancelled')),{once:true}));
  return{ok:true,json:async()=>({client:s.w.HostedAssessment.getContext().client,identityRevision:1,documentId:'doc-1',extractionId:'extraction',originalName:'synthetic.pdf',eligibleForAutofill:false,findings:[],document:{totalPages:1,pages:[],extraction:{kind:'other',identity:{iin:null},facts:[],credits:[]}}})};
 };
 await s.w.ClientWorkspace.importDocuments();assert.equal(started,3);assert.equal(s.writes.length,1);assert.equal(s.run('selectedFiles.length'),1);assert.equal(s.store.revision,undefined);assert.match(s.d.getElementById('crmImportErrors').textContent,/не удалось сохранить черновик/);assert.equal(s.run('af.busy'),false);
});

test('CRM lost-response recovery reads the existing receipt once and preserves answers after reload',async t=>{
 const s=await setup(t);await s.load();s.edit('fio','KEEP SAVED ANSWER');s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();
 const originalFetch=s.w.fetch,calls=[],settings=[],request=s.w.HostedAssessment.requestJson;
 s.w.HostedAssessment.requestJson=(path,options,config)=>{if(options?.method==='POST'&&path.endsWith('/crm-documents'))settings.push(config);return request(path,options,config);};
 const payload={client:s.w.HostedAssessment.getContext().client,identityRevision:1,assessmentDay:'2026-09-29',documentId:'recovered',extractionId:'extract',crmFileId:'123',originalName:'synthetic.pdf',eligibleForAutofill:false,findings:[],document:{totalPages:1,pages:[{text:'SYNTHETIC ONLY'}],extraction:{kind:'enpf',identity:{iin:null,name:null},facts:[],credits:[]}}};
 s.w.fetch=async(path,options={})=>{if(!path.includes('/crm-documents'))return originalFetch(path,options);calls.push({path,method:options.method||'GET'});if(options.method==='POST')throw new s.w.TypeError('Lost network response');return{ok:true,json:async()=>path.includes('?fileId=')?payload:{files:[{id:'123'}]}};};
 await s.w.ClientWorkspace.importDocuments();assert.deepEqual(settings.map(s=>s.timeoutMs),[180000]);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.filter(c=>c.path.includes('?fileId=')).length,1);
 assert.equal(s.store.payload.documents[0].documentId,'recovered');assert.equal(s.store.payload.answers.find(a=>a.key==='fio').value,'KEEP SAVED ANSWER');
 const restored=await setup(t,s.store);restored.run('afAnalyze=async()=>{}');await restored.load();assert.equal(restored.w.ServerDrafts.capture().documents[0].documentId,'recovered');assert.equal(restored.d.getElementById('fio').value,'KEEP SAVED ANSWER');
});
test('pending import recovery is bounded and never repeats the POST or adds an unverified selection',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();const originalFetch=s.w.fetch,timer=s.w.setTimeout.bind(s.w);s.w.setTimeout=(fn,ms,...args)=>timer(fn,ms===1500?0:ms,...args);let posts=0,reads=0;
 s.w.fetch=async(path,options={})=>{if(!path.includes('/crm-documents'))return originalFetch(path,options);if(options.method==='POST'){posts++;throw Object.assign(new s.w.Error('Timed out'),{code:'REQUEST_TIMEOUT'});}return{ok:true,json:async()=>path.includes('?fileId=')?(reads++,{pending:true,crmFileId:'123'}):{files:[{id:'123'}]}};};
 await s.w.ClientWorkspace.importDocuments();assert.equal(posts,1);assert.equal(reads,3);assert.equal(s.run('selectedFiles.length'),0);assert.equal(s.writes.length,0);assert.match(s.d.getElementById('crmImportErrors').textContent,/пока не подтверждено/);
});
test('CRM recovery rejects a changed client before applying or saving the recovered file',async t=>{
 const s=await setup(t);await s.load();s.edit('needsSocialDoc','0');s.edit('needsSalaryDoc','none');s.mountWorkspace();const originalFetch=s.w.fetch,context=s.w.HostedAssessment.getContext();let posts=0;
 s.w.fetch=async(path,options={})=>{if(!path.includes('/crm-documents'))return originalFetch(path,options);if(options.method==='POST'){posts++;throw new s.w.TypeError('Lost response');}return{ok:true,json:async()=>{if(!path.includes('?fileId='))return{files:[{id:'123'}]};s.w.HostedAssessment.getContext=()=>({...context,identityRevision:2});return{documentId:'wrong',crmFileId:'123',identityRevision:1};}};};
 await s.w.ClientWorkspace.importDocuments();assert.equal(posts,1);assert.equal(s.run('selectedFiles.length'),0);assert.equal(s.writes.length,0);assert.match(s.d.getElementById('crmImportStatus').textContent,/Клиент изменился/);
});
