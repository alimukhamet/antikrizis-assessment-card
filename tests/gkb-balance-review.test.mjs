import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {webcrypto} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],Date,Map,Set,BigInt,Uint8Array,TextEncoder,crypto:webcrypto,JSON});return exports;}
const repositoryModule=load('lib/documents/repository.ts'),{EvidenceRepository}=repositoryModule,policy=load('lib/documents/policy.ts'),identity=load('lib/documents/loan-identity.ts');
const matching=load('lib/documents/credit-report-match.ts',{'./policy':policy,'./loan-identity':identity});
const service=load('lib/documents/gkb-balance-review.ts',{'./repository':repositoryModule,'./analysis-version':{analysisVersion:'v'},'./credit-report-match':matching,'./loan-identity':identity});
const {checkDocumentPackage}=load('lib/documents/package-check.ts',{'./analysis-service':{analysisVersion:'v'},'./credit-report-match':matching,'./gkb-balance-review':service,'./loan-identity':identity,'./policy':policy,'./document-review':{MANUAL_DOCUMENT_TYPES:{},currentDocumentReview:async()=>null}});
const day='2026-09-21',actor={id:'worker:synthetic',authentication:'test'},client={external:{system:'bitrix',dealId:'900001'},iin:'991231300003',title:'Synthetic only'};
const credit=(id,amount,missing=false)=>({contractNumber:id,page:3,facts:[{key:'creditor',value:'ТЕСТ БАНК',page:3},...(!missing?[{key:'debtOutstanding',value:amount,page:3}]:[]),{key:'overdueDays',value:'0',page:3}],components:{remaining:missing?null:amount,arrears:'0.00',penalty:'0.00',interest:null,fine:null}});
function analyses(){return {
 short:{read:{pages:[{page:1,needsOcr:false}]},extraction:{kind:'gkb_short',identity:{iin:client.iin},issuedAt:day,creditList:{declared:2,complete:false},credits:[credit('CONTRACT-A..','1250.25'),credit('CONTRACT-B..','500.00')],findings:['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED']}},
 full:{read:{pages:[{page:1,needsOcr:false}]},extraction:{kind:'gkb_full',identity:{iin:client.iin},issuedAt:day,creditList:{declared:3,complete:true},credits:[credit('CONTRACT-A-123','1250.25',true),credit('CONTRACT-B-123','500.00'),credit('ZERO-LIMIT','0.00')],findings:['TOTAL_DEBT_REQUIRES_RECONCILIATION']}}
};}
async function fixture(t,{twoMissing=false}={}){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const db={prepare(sql){return{bind(...args){const q=sqlite.prepare(sql);return{async first(){return q.get(...args)||null;},async all(){return{results:q.all(...args)};},async run(){q.run(...args);return{success:true};}};}};}};
 const objects=new Map(),files={async put(key,value){objects.set(key,Buffer.from(value));},async get(key){const b=objects.get(key);return b?{text:async()=>b.toString(),arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;}};
 const repo=new EvidenceRepository(db,files),record=await repo.syncCase(client),source=analyses();if(twoMissing)source.full.extraction.credits[1]=credit('CONTRACT-B-123','500.00',true);
 const short=await repo.store(record.id,new Uint8Array([1]),'short.pdf',actor,'v',source.short),full=await repo.store(record.id,new Uint8Array([2]),'full.pdf',actor,'v',source.full);
 const payload={schemaVersion:1,answers:[],docContext:{social:'0',salary:'0'},pendingFiles:[],documents:[{documentId:short.document.id,type:'ГКБ — краткий отчёт',person:'Клиент'},{documentId:full.document.id,type:'ГКБ — полный отчёт',person:'Клиент'}],groups:[{id:'creditors',rowKeys:[null,null,null],rows:source.full.extraction.credits.map((c,i)=>[{key:'n8038',value:'ТЕСТ БАНК'},{key:'loanContractId',value:c.contractNumber},{key:'n8040',value:['1250.25','500.00','0.00'][i]}])}]};
 const input={action:'confirm',shortDocumentId:short.document.id,fullDocumentId:full.document.id,identityRevision:record.identity_revision,requestId:crypto.randomUUID()};
 const inspect=()=>service.inspectGkbBalanceReview(repo,record,short,full,day),check=()=>checkDocumentPackage(repo,record,payload,day);
 return{repo,record,short,full,payload,input,source,inspect,check,sqlite,db,files};
}
test('missing full balance is a review proposal, never an automatic match or zero amount',()=>{
 const {short,full}=analyses(),before=JSON.stringify({short,full});assert.equal(matching.matchShortReport(short,full,client.iin,day),null);
 const plan=matching.shortBalanceReviewPlan(short,full,client.iin,day);assert.equal(plan.balances.length,1);assert.equal(plan.balances[0].amount,'1250.25');assert.equal(plan.activeLoans,3);assert.equal(JSON.stringify({short,full}),before);
 for(const mutate of [s=>s.full.extraction.identity.iin='other',s=>s.full.extraction.issuedAt='2026-09-20',s=>s.full.read.pages[0].needsOcr=true,s=>s.full.extraction.creditList.complete=false,s=>s.short.extraction.creditList.declared=3,s=>s.short.extraction.findings.push('SHORT_TOTAL_MISMATCH'),s=>s.full.extraction.credits[0].components.arrears='1.00',s=>s.full.extraction.credits[0].components.remaining='10.00',s=>s.full.extraction.credits[0].facts.push({key:'debtOutstanding',value:'1250.26'}),s=>s.full.extraction.credits.push(credit('CONTRACT-A-456','0.00')),s=>s.full.extraction.credits[2].facts[1].value='0.01']){const s=analyses();mutate(s);assert.equal(matching.shortBalanceReviewPlan(s.short,s.full,client.iin,day),null);}
});
test('confirmation persists, retries once, carries source evidence and keeps every active loan required',async t=>{
 const f=await fixture(t),before=JSON.stringify(f.payload),plan=await f.inspect();assert.equal(plan.review,null);assert.ok((await f.check()).issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'));
 f.input.planKey=plan.planKey;const receipt=await service.confirmGkbBalanceReview(f.repo,f.record,f.input,f.payload,actor,day),retry=await service.confirmGkbBalanceReview(f.repo,f.record,f.input,f.payload,actor,day);
 assert.equal(receipt.reviewId,retry.reviewId);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,1);
 const reopened=new EvidenceRepository(f.db,f.files),inspection=await service.inspectGkbBalanceReview(reopened,f.record,f.short,f.full,day);assert.equal(inspection.review.reviewId,receipt.reviewId);
 const checked=await checkDocumentPackage(reopened,f.record,f.payload,day);assert.equal(checked.issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'),false);assert.equal(checked.loanCoverage.expected,3);assert.equal(checked.loanCoverage.complete,true);assert.equal(checked.gkbEvidence[0].value,'1250.25');assert.equal(checked.gkbEvidence[0].documentId,f.short.document.id);assert.equal(checked.gkbEvidence[0].reviewActorId,actor.id);assert.equal(JSON.stringify(f.payload),before);
 f.payload.groups[0].rows.pop();assert.equal((await f.check()).loanCoverage.missing,1,'An unused active limit is still required');
});
test('unsaved/different answers and replacement files cannot reuse the confirmation',async t=>{
 const f=await fixture(t),plan=await f.inspect();f.input.planKey=plan.planKey;
 f.payload.groups[0].rows[0][2].value='1.00';await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,f.input,f.payload,actor,day),/GKB_ANSWERS_NOT_SAVED/);
 f.payload.groups[0].rows[0][2].value='1250.25';await service.confirmGkbBalanceReview(f.repo,f.record,f.input,f.payload,actor,day);
 f.payload.groups[0].rows[0][2].value='1250.26';assert.ok((await f.check()).issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'));assert.equal((await f.check()).gkbEvidence.length,0);
 const replacement=await f.repo.store(f.record.id,new Uint8Array([3]),'replacement.pdf',actor,'v',f.source.full);
 const next=await service.inspectGkbBalanceReview(f.repo,f.record,f.short,replacement,day);assert.equal(next.review,null);assert.notEqual(next.planKey,plan.planKey);
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,{...f.input,fullDocumentId:replacement.document.id},f.payload,actor,day),/GKB_REVIEW_CHANGED/);
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,{...f.record,identity_revision:2},f.input,f.payload,actor,day),/CASE_IDENTITY_CHANGED/);
 assert.equal(await service.inspectGkbBalanceReview(f.repo,f.record,f.short,f.full,'2026-10-22'),null);
});
test('withdrawal is durable and retry-safe, and a stale withdrawal cannot cancel a newer confirmation',async t=>{
 const f=await fixture(t),plan=await f.inspect();f.input.planKey=plan.planKey;const first=await service.confirmGkbBalanceReview(f.repo,f.record,f.input,f.payload,actor,day);
 const withdraw={...f.input,action:'withdraw',requestId:crypto.randomUUID(),reviewId:first.reviewId};const a=await service.confirmGkbBalanceReview(f.repo,f.record,withdraw,f.payload,actor,day),b=await service.confirmGkbBalanceReview(f.repo,f.record,withdraw,f.payload,actor,day);assert.equal(a.reviewId,b.reviewId);assert.equal((await f.inspect()).review,null);
 await service.confirmGkbBalanceReview(f.repo,f.record,{...f.input,requestId:crypto.randomUUID()},f.payload,actor,day);
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,{...withdraw,requestId:crypto.randomUUID()},f.payload,actor,day),/REVIEW_CHANGED/);
});

const rowInput=(f,plan,index,decision,extra={})=>({...f.input,fullIndex:index,decision,planKey:plan.planKey,expectedReviewId:plan.rowHeads.find(r=>r.fullIndex===index).reviewId,requestId:crypto.randomUUID(),...extra});
test('per-loan decisions persist separately; corrections retain original source and require saved matching answers',async t=>{
 const f=await fixture(t,{twoMissing:true}),plan=await f.inspect();
 const first=rowInput(f,plan,0,'confirm');const receipt=await service.confirmGkbBalanceReview(f.repo,f.record,first,f.payload,actor,day);assert.deepEqual(await service.confirmGkbBalanceReview(f.repo,f.record,first,f.payload,actor,day),receipt);
 let state=await f.inspect();assert.equal(state.decisions.length,1);assert.equal(state.review,null);assert.ok((await f.check()).issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'));
 const second=rowInput(f,state,1,'correct',{amount:'499.99',reason:'Исправлено по оригиналу, страница 3'});
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,second,f.payload,actor,day),/GKB_ANSWERS_NOT_SAVED/);
 f.payload.groups[0].rows[1][2].value='499.99';await service.confirmGkbBalanceReview(f.repo,f.record,second,f.payload,actor,day);
 const reopened=new EvidenceRepository(f.db,f.files);state=await service.inspectGkbBalanceReview(reopened,f.record,f.short,f.full,day);assert.equal(state.decisions.length,2);assert.ok(state.review);assert.equal(state.plan.balances[1].amount,'500.00');
 const checked=await f.check();assert.equal(checked.issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'),false);assert.equal(checked.gkbReconciliations.length,2);assert.equal(checked.gkbEvidence[1].value,'499.99');assert.equal(checked.gkbEvidence[1].disposition,'corrected');assert.match(checked.gkbEvidence[1].source,/500.00/);assert.equal(checked.loanCoverage.expected,3);
 f.payload.groups[0].rows[1][2].value='499.98';assert.ok((await f.check()).issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'));
});
test('a rejected row overrides a legacy batch confirmation without deleting the loan',async t=>{
 const f=await fixture(t),plan=await f.inspect();await service.confirmGkbBalanceReview(f.repo,f.record,{...f.input,planKey:plan.planKey},f.payload,actor,day);
 const legacy=await f.inspect();assert.equal(legacy.decisions[0].decision,'confirm');const before=JSON.stringify(f.payload);
 await service.confirmGkbBalanceReview(f.repo,f.record,rowInput(f,legacy,0,'reject'),f.payload,actor,day);
 const rejected=await f.inspect();assert.equal(rejected.review,null);assert.equal(rejected.decisions[0].decision,'reject');assert.equal(JSON.stringify(f.payload),before);assert.equal((await f.check()).loanCoverage.complete,true);assert.ok((await f.check()).issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'));
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,{...f.input,requestId:crypto.randomUUID(),planKey:plan.planKey},f.payload,actor,day),/GKB_REVIEW_CHANGED/);
 const confirmed=await service.confirmGkbBalanceReview(f.repo,f.record,rowInput(f,rejected,0,'confirm'),f.payload,actor,day);assert.equal((await f.inspect()).decisions[0].reviewId,confirmed.reviewId);
});
test('stale row edits cannot overwrite a newer decision, including simultaneous first decisions',async t=>{
 const f=await fixture(t),plan=await f.inspect(),first=rowInput(f,plan,0,'confirm'),stale=rowInput(f,plan,0,'reject');
 await service.confirmGkbBalanceReview(f.repo,f.record,first,f.payload,actor,day);
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,stale,f.payload,actor,day),/REVIEW_CHANGED/);
 const current=await f.inspect(),withdraw=rowInput(f,current,0,'confirm',{action:'withdraw'});const receipt=await service.confirmGkbBalanceReview(f.repo,f.record,withdraw,f.payload,actor,day);assert.deepEqual(await service.confirmGkbBalanceReview(f.repo,f.record,withdraw,f.payload,actor,day),receipt);assert.equal((await f.inspect()).review,null);
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,rowInput(f,current,0,'confirm'),f.payload,actor,day),/REVIEW_CHANGED/);
});
test('correction rejects blank, negative, fractional-cent and unsafe amounts or absent explanation',async t=>{
 const f=await fixture(t),plan=await f.inspect();for(const amount of ['', '-1', '2.001', '9007199254740991', 'abc'])await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,rowInput(f,plan,0,'correct',{amount,reason:'По оригиналу'}),f.payload,actor,day),/GKB_CORRECTION_REQUIRED/);
 await assert.rejects(()=>service.confirmGkbBalanceReview(f.repo,f.record,rowInput(f,plan,0,'correct',{amount:'1250.25',reason:''}),f.payload,actor,day),/GKB_CORRECTION_REQUIRED/);
});
