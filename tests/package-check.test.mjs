import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],Date,Map,Set});return exports;}
const policy=load('lib/documents/policy.ts'),{checkDocumentPackage,REQUIRED_DOCUMENTS}=load('lib/documents/package-check.ts',{'./loan-identity':load('lib/documents/loan-identity.ts'),'./analysis-service':{analysisVersion:'current'},'./policy':policy,'./credit-report-match':load('lib/documents/credit-report-match.ts',{'./policy':policy}),'./document-review':{MANUAL_DOCUMENT_TYPES:{'Удостоверение личности':'identity'},currentDocumentReview:async(repository,...args)=>repository.review?.(...args)||null}});
function fixture(){
 const sources=new Map();let reads=0;
 const payload={documents:[],pendingFiles:[],docContext:{social:'0',salary:'0'}};
 function add(id,type,kind,amount='10.00',issuedAt='2026-09-10'){
  payload.documents.push({documentId:id,type,person:'Клиент'});
  sources.set(id,{read:{pages:[{needsOcr:false}]},extraction:{identity:{iin:'test-client'},kind,issuedAt,findings:[],credits:[{contractNumber:'CONTRACT1',facts:[{key:'creditor',value:'TEST BANK'},{key:'monthlyPayment',value:amount}]}]}});
 }
 const repository={document:async(caseId,id)=>sources.has(id)?{id,original_sha256:id}:null,cached:async(caseId,hash,version)=>{reads++;assert.equal(version,'current');return sources.get(hash)?{result:sources.get(hash),extraction:{id:hash}}:null;}};
 return{payload,add,sources,repository,reads:()=>reads,run:()=>checkDocumentPackage(repository,{id:'case',client_iin:'test-client'},payload,'2026-09-10')};
}
test('contract document list excludes handoff files and retains conditional salary/benefit documents',async()=>{assert.equal(REQUIRED_DOCUMENTS.length,6);assert.equal(REQUIRED_DOCUMENTS.includes('ЭЦП файл'),false);assert.equal(REQUIRED_DOCUMENTS.includes('Доверенность'),false);const s=fixture();s.payload.docContext={social:'1',salary:'1'};const r=await s.run();assert.equal(r.required.length,8);assert.ok(r.missing.includes('Выписка зарплатного банка'));assert.equal(r.packageReady,false);assert.equal(r.issues.some(i=>i.code==='EDS_SEPARATE_UPLOAD_REQUIRED'),false);});
test('GKB exactly thirty days old passes structure, thirty-one and future dates fail',async()=>{for(const [date,valid]of[['2026-08-11',true],['2026-08-10',false],['2026-09-11',false]]){const s=fixture();s.add('doc','ГКБ — полный отчёт','gkb_full','10.00',date);const r=await s.run();assert.equal(r.structurallyChecked.includes('ГКБ — полный отчёт'),valid);}});
test('wrong owner, wrong declared type and unreadable pages cannot satisfy a report check',async()=>{for(const change of [s=>s.sources.get('doc').extraction.identity.iin='other',s=>s.payload.documents[0].type='ГКБ — краткий отчёт',s=>s.sources.get('doc').read.pages[0].needsOcr=true]){const s=fixture();s.add('doc','ГКБ — полный отчёт','gkb_full');change(s);assert.equal((await s.run()).structurallyChecked.length,0);}});
test('different report values retain both sources for reconciliation',async()=>{const s=fixture();s.add('full','ГКБ — полный отчёт','gkb_full','10.00');s.add('short','ГКБ — краткий отчёт','gkb_short','12.00');const r=await s.run();assert.equal(r.conflicts.length,1);assert.deepEqual(Array.from(r.conflicts[0].documentIds),['full','short']);assert.deepEqual(Array.from(r.conflicts[0].values),['10.00','12.00']);assert.ok(r.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));});
test('the full report contract code links a different printed number to the short report without hiding amounts',async()=>{
 const s=fixture();s.add('full','ГКБ — полный отчёт','gkb_full','10.00');s.add('short','ГКБ — краткий отчёт','gkb_short','12.00');
 Object.assign(s.sources.get('full').extraction.credits[0],{contractNumber:'PRINTED-NUMBER',contractCode:'CONTRACT1'});
 const r=await s.run();assert.equal(r.conflicts.length,1);assert.equal(r.conflicts[0].contractNumber,'CONTRACT1');assert.ok(r.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));
});
test('duplicate references do not trigger repeated cached extraction reads',async()=>{const s=fixture();s.add('doc','ГКБ — полный отчёт','gkb_full');s.payload.documents.push({...s.payload.documents[0]});const r=await s.run();assert.equal(s.reads(),1);assert.ok(r.issues.some(i=>i.code==='DUPLICATE_DOCUMENT_SELECTION'));});
test('saved document reads run in bounded parallel groups and keep deterministic findings',async()=>{
 let active=0,peak=0,reads=0;
 const payload={documents:Array.from({length:8},(_,i)=>({documentId:String(i),type:'ГКБ — полный отчёт',person:'Клиент'})),pendingFiles:[],docContext:{social:'0',salary:'0'}};
 const repository={document:async(c,id)=>({id,original_sha256:id}),cached:async()=>{
  reads++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;
  return {extraction:{id:'parsed'},result:{read:{pages:[{needsOcr:false}]},extraction:{identity:{iin:'wrong-person'},kind:'gkb_full',findings:[]}}};
 }};
 const result=await checkDocumentPackage(repository,{id:'case',client_iin:'client'},payload,'2026-09-16');
 assert.equal(reads,8);assert.equal(peak,4);
 assert.deepEqual(Array.from(result.issues.filter(i=>i.documentId),i=>i.documentId),['0','1','2','3','4','5','6','7']);
});
test('recognized non-GKB is not claimed fully validated while its rules are unfinished',async()=>{const s=fixture();s.add('id','Удостоверение личности','identity');const r=await s.run();assert.ok(r.issues.some(i=>i.code==='DOCUMENT_RULES_PENDING'));assert.equal(r.structurallyChecked.length,0);assert.equal(r.authenticity,'not_verified');});
test('recognized ENPF asks for period inspection without a false document-type warning',async()=>{const s=fixture();s.add('enpf','Справка ЕНПФ','enpf');const r=await s.run();assert.ok(r.issues.some(i=>i.code==='ENPF_PERIOD_UNVERIFIED'));assert.equal(r.issues.some(i=>i.code==='DOCUMENT_TYPE_UNVERIFIED'),false);});
test('saved all-history ENPF works without reprocessing; identity and unreadable-page gates remain',async()=>{
 for(const problem of [null,'identity','unreadable','unlabelled','future']){
  const s=fixture();s.add('enpf','Справка ЕНПФ','enpf');const analysis=s.sources.get('enpf');
  analysis.extraction.coverage={from:null,to:null};analysis.read.pages[0].text='Барлық кезең / Весь период\nПериод:';
  if(problem==='identity')analysis.extraction.identity.iin='other';
  if(problem==='unreadable')analysis.read.pages[0].needsOcr=true;
  if(problem==='unlabelled')analysis.read.pages[0].text='Весь период';
  if(problem==='future')analysis.extraction.issuedAt='2026-09-11';
  const result=await s.run();assert.equal(result.structurallyChecked.includes('Справка ЕНПФ'),problem===null,problem);
  assert.equal(analysis.extraction.coverage.from,null);
 }
});
test('short report review tells staff when contract numbers are shortened',async()=>{
 const s=fixture();s.add('short','ГКБ — краткий отчёт','gkb_short');s.sources.get('short').extraction.findings=['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'];
 const r=await s.run();assert.equal(r.structurallyChecked.length,0);assert.match(r.issues.find(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED').message,/сокращены номера договоров/);
});
test('shortened IDs can satisfy the package only through one complete matching full report',async()=>{
 for(const fail of [false,true]){
  const s=fixture();s.add('short','ГКБ — краткий отчёт','gkb_short');s.add('full','ГКБ — полный отчёт','gkb_full');
  for(const id of ['short','full']){const c=s.sources.get(id).extraction.credits[0];c.page=id==='short'?1:3;c.contractNumber=id==='short'?'ABC123..':'ABC123456';c.facts=[{key:'creditor',value:'TEST BANK'},{key:'debtOutstanding',value:'100.25'},{key:'overdueDays',value:'0'}];}
  s.sources.get('short').extraction.findings=['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'];
  if(fail)s.sources.get('full').extraction.credits[0].facts[1].value='200.00';
  const r=await s.run();assert.equal(r.structurallyChecked.includes('ГКБ — краткий отчёт'),!fail);assert.equal(r.matchedShortReports.length,fail?0:1);assert.equal(r.packageReady,false); // Other contract documents still required.
  if(!fail){assert.equal(r.matchedShortReports[0].fullDocumentId,'full');assert.equal(r.matchedShortReports[0].matches[0].fullPage,3);}
 }
});
test('conflict evidence keeps each value attached to its document date and page',async()=>{
 const s=fixture();s.add('a','ГКБ — полный отчёт','gkb_full','10.00','2026-09-09');s.add('b','ГКБ — краткий отчёт','gkb_short','12.00');s.add('c','ГКБ — полный отчёт','gkb_full','10.00');
 s.sources.get('a').extraction.credits[0].facts[1].page=2;s.sources.get('b').extraction.credits[0].facts[1].page=5;
 const conflict=(await s.run()).conflicts[0];assert.equal(conflict.creditor,'TEST BANK');assert.equal(conflict.contractNumber,'CONTRACT1');
 assert.deepEqual(JSON.parse(JSON.stringify(conflict.sources)),[{documentId:'a',issuedAt:'2026-09-09',value:'10.00',page:2},{documentId:'b',issuedAt:'2026-09-10',value:'12.00',page:5},{documentId:'c',issuedAt:'2026-09-10',value:'10.00',page:null}]);
});

test('client-confirmed debt keeps conflicting sources but resolves only the matching amount',async()=>{
 const s=fixture();s.add('a','ГКБ — полный отчёт','gkb_full');s.add('b','ГКБ — краткий отчёт','gkb_short');
 for(const [id,value]of [['a','1000'],['b','1200']])s.sources.get(id).extraction.credits[0].facts.push({key:'debtOutstanding',value,page:1});
 s.payload.groups=[{id:'creditors',rowKeys:['creditors|test-client|TEST BANK|CONTRACT1'],rows:[[{key:'n8040',value:'1100',checked:false,clientConfirmed:true}]]}];
 let r=await s.run();assert.equal(r.conflicts.length,1);assert.equal(r.conflicts[0].clientConfirmedAmount,'1100');assert.equal(r.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'),false);
 s.payload.groups[0].rowKeys[0]='creditors|test-client|OTHER|CONTRACT1';r=await s.run();assert.equal(r.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'),true);
});

test('creditor spacing cannot hide differences in an otherwise identical loan',async()=>{
 for(const name of ['TEST  BANK','testbank','ＴＥＳＴ\u00a0ＢＡＮＫ']){const s=fixture();s.add('full','ГКБ — полный отчёт','gkb_full','10.00');s.add('short','ГКБ — краткий отчёт','gkb_short','12.00');s.sources.get('short').extraction.credits[0].facts[0].value=name;const r=await s.run();assert.equal(r.conflicts.length,1,name);assert.ok(r.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));assert.equal(r.packageReady,false);assert.equal(r.conflicts[0].creditor,'TEST BANK');}
});
test('normalization never merges distinct banks or contract identifiers',async()=>{
 for(const [bank,contract] of [['OTHER BANK','CONTRACT1'],['testbank','CONTRACT2'],['testbank','contract1']]){const s=fixture();s.add('a','ГКБ — полный отчёт','gkb_full','10.00');s.add('b','ГКБ — краткий отчёт','gkb_short','12.00');const credit=s.sources.get('b').extraction.credits[0];credit.facts[0].value=bank;credit.contractNumber=contract;assert.equal((await s.run()).conflicts.length,0);}
});
test('normalized client debt confirmation must identify exactly one row',async()=>{
 const s=fixture();s.add('a','ГКБ — полный отчёт','gkb_full');s.add('b','ГКБ — краткий отчёт','gkb_short');
 for(const [id,value] of [['a','1000'],['b','1200']])s.sources.get(id).extraction.credits[0].facts.push({key:'debtOutstanding',value,page:1});
 s.payload.groups=[{id:'creditors',rowKeys:['creditors|test-client|testbank|CONTRACT1'],rows:[[{key:'n8040',value:'1100',clientConfirmed:true}]]}];assert.equal((await s.run()).conflicts[0].clientConfirmedAmount,'1100');
 s.payload.groups[0].rowKeys.push('creditors|test-client|TEST  BANK|CONTRACT1');s.payload.groups[0].rows.push(s.payload.groups[0].rows[0]);assert.ok((await s.run()).issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));
});
test('later benefit answers require their certificate despite an earlier no or blank answer',async()=>{
 for(const social of ['0','']){const s=fixture();s.payload.docContext.social=social;s.payload.answers=[{key:'clientBenefitsCount',value:'1'}];const r=await s.run();assert.ok(r.required.includes('Справка по выплатам пенсии и пособий'));assert.ok(r.missing.includes('Справка по выплатам пенсии и пособий'));assert.equal(r.packageReady,false);}
 const s=fixture();s.payload.groups=[{id:'clientbenefits',rows:[[{key:'clientBenefitType',value:'Пенсия'}]]}];assert.ok((await s.run()).required.includes('Справка по выплатам пенсии и пособий'));
 s.payload.groups=[];s.payload.answers=[{key:'clientBenefitsCount',value:'0'}];assert.equal((await s.run()).required.includes('Справка по выплатам пенсии и пособий'),false);
});
test('a readable annual ENPF and a salary statement covering the year pass the document checks',async()=>{
 for(const [type,kind,from]of [['Справка ЕНПФ','enpf','2025-09-10'],['Выписка зарплатного банка','salary','2025-09-01']]){
  const s=fixture();s.add('doc',type,kind);s.sources.get('doc').extraction.coverage={from,to:'2026-09-10'};
  assert.ok((await s.run()).structurallyChecked.includes(type));
  s.sources.get('doc').extraction.coverage.from='2025-10-01';assert.equal((await s.run()).structurallyChecked.includes(type),false);
 }
});

test('a duplicate with the wrong type cannot hide the saved ID inspection or approve that wrong type',async()=>{
 for(const reverse of [false,true]){
  const s=fixture();s.add('same-pdf','ГКБ — краткий отчёт','unknown');
  s.payload.documents.push({documentId:'same-pdf',type:'Удостоверение личности',person:'Клиент'});
  if(reverse)s.payload.documents.reverse();
  s.sources.get('same-pdf').extraction.identity.iin=null;
  s.repository.review=async(record,id,extractionId,analysis,types)=>{
   assert.ok(types.includes('Удостоверение личности'));
   return {id:'saved-id-review',actorId:'worker:test',reviewedAt:'2026-09-10',value:{type:'Удостоверение личности'}};
  };
  const result=await s.run();assert.equal(result.packageReady,false);
  assert.ok(result.issues.some(i=>i.code==='DUPLICATE_DOCUMENT_SELECTION'));
  assert.equal(result.manuallyReviewed.length,1);assert.equal(result.manuallyReviewed[0].type,'Удостоверение личности');
  assert.equal(result.manuallyReviewed[0].reviewId,'saved-id-review');
 }
});
