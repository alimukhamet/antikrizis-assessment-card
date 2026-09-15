import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],Date,Map,Set});return exports;}
const repo=load('lib/documents/repository.ts'),policy=load('lib/documents/policy.ts');
const review=load('lib/documents/document-review.ts',{'./repository':repo,'./analysis-service':{analysisVersion:'v'},'./policy':policy,'./power-validation':{checkPowerRepresentative:p=>({representativeMatched:p?.representative?.identifier==='synthetic-approved'})}});
const record={id:'case',client_iin:'test-client',identity_revision:2};
const analysis={read:{totalPages:2,pages:[{needsOcr:true},{needsOcr:true}]},extraction:{kind:'unknown',identity:{iin:null}}};
const input=()=>({type:'Удостоверение личности',iin:'test-client',pages:2,complete:true,contentMatches:true,periodChecked:true,reason:'Synthetic inspection of all pages',issuedAt:'2020-01-01',expiresAt:'2030-01-01',from:'',to:''});
const check=v=>review.validateDocumentReview(v,analysis,record,'2026-09-10');
test('employee inspection can record unreadable extraction without approving extracted facts',()=>{const v=check(input());assert.equal(v.iin,'test-client');assert.equal(v.complete,true);assert.equal(v.authorityChecked,false);assert.equal(v.authenticity,undefined);});
test('identity, content, completeness and expiry cannot be bypassed by a checkbox',()=>{for(const [change,error]of [[v=>v.iin='other','DOCUMENT_CLIENT_UNVERIFIED'],[v=>v.pages=1,'DOCUMENT_INSPECTION_INCOMPLETE'],[v=>v.complete=false,'DOCUMENT_INSPECTION_INCOMPLETE'],[v=>v.expiresAt='2026-09-09','DOCUMENT_DATE_NOT_ACCEPTABLE'],[v=>v.issuedAt='2026-09-11','DOCUMENT_DATE_NOT_ACCEPTABLE'],[v=>v.expiresAt='','DOCUMENT_EXPIRY_REQUIRED'],[v=>v.expiresAt='2026-02-30','DOCUMENT_DATE_NOT_ACCEPTABLE']]){const v=input();change(v);assert.throws(()=>check(v),new RegExp(error));}
 assert.throws(()=>review.validateDocumentReview(input(),{...analysis,extraction:{kind:'identity',identity:{iin:'other'}}},record,'2026-09-10'),/DOCUMENT_IDENTITY_CONFLICT/);
 assert.throws(()=>review.validateDocumentReview(input(),{...analysis,extraction:{kind:'gkb_full',identity:{iin:null}}},record,'2026-09-10'),/DOCUMENT_TYPE_CONFLICT/);
});
test('manual review never overrides GKB or separate credential requirements',()=>{for(const type of ['ГКБ — полный отчёт','ЭЦП файл'])assert.throws(()=>check({...input(),type}),/MANUAL_TYPE_NOT_SUPPORTED/);});
test('salary periods and powers retain additional requirements',()=>{const v={...input(),type:'Выписка зарплатного банка',from:'2025-09-01',to:'2026-08-31'};assert.equal(check(v).from,'2025-09-01');assert.equal(check({...v,to:'2026-09-10'}).to,'2026-09-10');assert.throws(()=>check({...v,from:'2025-10-01'}),/STATEMENT_PERIOD_NOT_ACCEPTABLE/);
 const power={...input(),type:'Доверенность',authorityChecked:true,representative:{kind:'person',legalName:'Synthetic person',identifier:'synthetic-approved'}};assert.equal(check(power).authorityChecked,true);assert.throws(()=>check({...power,authorityChecked:false}),/POWER_AUTHORITY_REVIEW_REQUIRED/);assert.throws(()=>check({...power,representative:{...power.representative,identifier:'other'}}),/REPRESENTATIVE_NOT_APPROVED/);
});
test('reviews bind to current case identity, stored extraction and actor',async()=>{let saved;const repository={document:async()=>({id:'doc',original_sha256:'hash'}),cached:async()=>({extraction:{id:'extract'},result:analysis}),appendReview:async(value,actor)=>{saved={value,actor};return{id:'review'};}};
 await review.reviewDocument(repository,record,'doc','request-1234567890',2,input(),{id:'staff'},'2026-09-10');assert.equal(saved.value.extractionId,'extract');assert.equal(saved.value.factKey,review.DOCUMENT_REVIEW_KEY);assert.equal(saved.actor.id,'staff');await assert.rejects(review.reviewDocument(repository,record,'doc','request-1234567890',1,input(),{id:'staff'},'2026-09-10'),/CASE_IDENTITY_CHANGED/);
});
test('saved review is rechecked for expiry and selected type',async()=>{const repository={currentReviews:async()=>[{id:'review',fact_key:review.DOCUMENT_REVIEW_KEY,value_json:JSON.stringify(input())}]};assert.ok(await review.currentDocumentReview(repository,record,'doc','ext',analysis,'Удостоверение личности','2026-09-10'));assert.equal(await review.currentDocumentReview(repository,record,'doc','ext',analysis,'Удостоверение личности','2030-01-02'),null);assert.equal(await review.currentDocumentReview(repository,record,'doc','ext',analysis,'Справка ЕНПФ','2026-09-10'),null);});
test('withdrawal requires a matching document inspection and preserves its extraction scope',async()=>{
 let saved;const previous={id:'review',document_id:'doc',extraction_id:'old-extraction',fact_key:review.DOCUMENT_REVIEW_KEY,identity_revision:2,disposition:'confirmed'};
 const repository={reviewRecord:async()=>previous,appendReview:async(input)=>{saved=input;return{id:'withdrawn'};}};
 await review.withdrawDocumentReview(repository,record,'doc','review','request-1234567890',2,'Synthetic withdrawal',{id:'staff'});assert.equal(saved.expectedReviewId,'review');assert.equal(saved.extractionId,'old-extraction');assert.equal(saved.disposition,'unresolved');assert.equal(saved.value,null);
 await assert.rejects(review.withdrawDocumentReview(repository,record,'other-doc','review','request-1234567890',2,'Synthetic withdrawal',{id:'staff'}),/REVIEW_NOT_IN_DOCUMENT/);
});

test('Kaspi owner inspection retains automatic transaction, page and exact period checks',()=>{
 const statement={read:{totalPages:2,pages:[{needsOcr:false},{needsOcr:false}]},extraction:{kind:'kaspi',identity:{iin:null},bankStatement:{reconciled:true,rowsReadable:true,from:'2025-09-01',to:'2026-08-31'}}};
 const value={...input(),type:'Выписка Kaspi Gold',from:'2025-09-01',to:'2026-08-31'};
 assert.equal(review.validateDocumentReview(value,statement,record,'2026-09-10').type,value.type);
 for(const mutate of [a=>a.extraction.bankStatement.reconciled=false,a=>a.extraction.bankStatement.rowsReadable=false,a=>a.read.pages.pop(),a=>a.read.pages[0].needsOcr=true]){const a=structuredClone(statement);mutate(a);assert.throws(()=>review.validateDocumentReview(value,a,record,'2026-09-10'),/STATEMENT_RECONCILIATION_REQUIRED/);}
 const wrongOwner=structuredClone(statement);wrongOwner.extraction.identity.iin='other';assert.throws(()=>review.validateDocumentReview(value,wrongOwner,record,'2026-09-10'),/DOCUMENT_IDENTITY_CONFLICT/);
 const wrongPeriod=structuredClone(statement);wrongPeriod.extraction.bankStatement.from='2025-10-01';assert.throws(()=>review.validateDocumentReview(value,wrongPeriod,record,'2026-09-10'),/STATEMENT_PERIOD_NOT_ACCEPTABLE/);
 assert.throws(()=>review.validateDocumentReview(value,statement,record,'2026-10-01'),/STATEMENT_PERIOD_NOT_ACCEPTABLE/);
});

test('ENPF accepts annual dated coverage and rechecks incomplete approvals',async()=>{
 const v={...input(),type:'Справка ЕНПФ',issuedAt:'2026-09-10',expiresAt:'',from:'2025-09-10',to:'2026-09-10'};
 assert.equal(check(v).from,'2025-09-10');
 for(const change of [{from:'2025-10-01'},{from:'2025-09-11'},{to:'2026-09-09'},{from:''},{issuedAt:''},{to:'2026-09-11'}])assert.throws(()=>check({...v,...change}),/ENPF_PERIOD_NOT_ACCEPTABLE/);
 const old={...v,from:'',to:''};
 const repository={currentReviews:async()=>[{id:'old',fact_key:review.DOCUMENT_REVIEW_KEY,value_json:JSON.stringify(old)}]};
 assert.equal(await review.currentDocumentReview(repository,record,'doc','ext',analysis,'Справка ЕНПФ','2026-09-10'),null);
 const leap={...v,issuedAt:'2024-02-29',from:'2023-02-28',to:'2024-02-29'};
 assert.equal(review.validateDocumentReview(leap,analysis,record,'2024-02-29').from,'2023-02-28');
});
