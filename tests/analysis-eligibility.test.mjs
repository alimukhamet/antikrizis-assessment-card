import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,imports={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],Date,Set});
 return exports;
}
const policy=load('lib/documents/policy.ts');
const {analysisResponse}=load('lib/documents/analysis-service.ts',{
 './read-pdf':{PDF_READER_VERSION:'test'},'./extract-native':{EXTRACTION_VERSION:'test'},
 './analysis-version':{analysisVersion:'test:test'},'./policy':policy,'./request-context':{operatingDay:()=> '2026-09-10'},'./repository':{},
});
async function analyze(findings=[],issuedAt='2026-08-11',iin='test-client') {
 let reviewReads=0;
 const result=await analysisResponse({iin:'test-client'},{id:'case',identity_revision:1},{currentReviews:async()=>{reviewReads++;return [{disposition:'confirmed'}];}},{document:{id:'doc'},extraction:{id:'extraction'},result:{read:{},extraction:{identity:{iin},kind:'gkb_full',issuedAt,findings}}},true);
 return {result,reviewReads};
}
test('cached incomplete, unreadable or unclassified documents cannot autofill or replay confirmations',async()=>{
 for(const code of policy.DOCUMENT_VALIDATION_BLOCKERS){
  const {result,reviewReads}=await analyze([code]);
  assert.equal(result.eligibleForAutofill,false,code);
  assert.equal(result.reviews.length,0,code);
  assert.equal(reviewReads,0,code);
  assert.ok(result.findings.includes(code));
 }
});
test('thirty-day GKB is eligible but thirty-one-day and future reports cannot reuse reviews',async()=>{
 const valid=await analyze();assert.equal(valid.result.eligibleForAutofill,true);assert.equal(valid.reviewReads,1);
 for(const date of ['2026-08-10','2026-09-11']){const {result,reviewReads}=await analyze([],date);assert.equal(result.eligibleForAutofill,false);assert.equal(reviewReads,0);}
});
test('cached extraction is rechecked against the current deal identity',async()=>{
 const {result,reviewReads}=await analyze([],'2026-09-10','different-client');
 assert.equal(result.eligibleForAutofill,false);assert.equal(reviewReads,0);assert.ok(result.findings.includes('WRONG_CLIENT'));
});
test('missing CRM IIN permits only complete readable draft proposals, never reviews or wrong-client bypass',async()=>{
 const run=async({iin=null,findings=[],complete=true,date='2026-09-10',owner='991231300003'}={})=>analysisResponse({iin},{id:'case',identity_revision:1},{currentReviews:async()=>{throw Error('Draft proposals must not replay reviews');}},{document:{id:'doc'},extraction:{id:'parsed'},result:{read:{totalPages:1},extraction:{identity:{iin:owner},kind:'gkb_short',issuedAt:date,findings,creditList:{complete}}}},true);
 const r=await run();assert.equal(r.eligibleForDraftAutofill,true);assert.equal(r.eligibleForAutofill,false);assert.equal(r.reviews.length,0);
 for(const input of [{iin:'different'}, {complete:false},{owner:null},{date:'2020-01-01'},...policy.DOCUMENT_VALIDATION_BLOCKERS.map(code=>({findings:[code]}))])assert.equal((await run(input)).eligibleForDraftAutofill,false,JSON.stringify(input));
});

test('valid employee inspection stays visible on reopen but never approves OCR facts or a different identity',async()=>{
 const repo=load('lib/documents/repository.ts'),manual=load('lib/documents/document-review.ts',{'./repository':repo,'./analysis-version':{analysisVersion:'test:test'},'./policy':policy});
 const {analysisResponse:respond}=load('lib/documents/analysis-service.ts',{'./analysis-version':{analysisVersion:'test:test'},'./policy':policy,'./request-context':{operatingDay:()=> '2026-09-10'},'./repository':repo,'./document-review':manual});
 const review={type:'Удостоверение личности',iin:'test-client',pages:1,complete:true,contentMatches:true,periodChecked:true,reason:'Synthetic complete employee inspection',issuedAt:'2020-01-01',expiresAt:'2030-01-01',from:'',to:''};
 const record={id:'case',client_iin:'test-client',identity_revision:2},stored={document:{id:'pdf'},extraction:{id:'extraction'},result:{read:{totalPages:1,pages:[{needsOcr:true}]},extraction:{kind:'unknown',identity:{iin:null},findings:['OCR_REQUIRED']}}};
 const repository={currentReviews:async(caseId,documentId,extractionId,revision)=>{assert.equal(caseId,'case');assert.equal(documentId,'pdf');assert.equal(extractionId,'extraction');assert.equal(revision,2);return [{id:'review',actor_id:'worker:test',created_at:'2026-09-10',fact_key:manual.DOCUMENT_REVIEW_KEY,value_json:JSON.stringify(review)}];}};
 let r=await respond({iin:'test-client'},record,repository,stored,true);assert.equal(r.documentReview.reviewId,'review');assert.equal(r.documentReview.type,review.type);assert.equal(r.eligibleForAutofill,false);assert.equal(r.reviews.length,0);assert.equal(r.reviewContext.pages,1);assert.equal(r.reviewContext.issuedAt,'2020-01-01');assert.equal(r.reviewContext.expiresAt,'2030-01-01');
 review.expiresAt='2026-09-09';r=await respond({iin:'test-client'},record,repository,stored,true);assert.equal(r.documentReview,null);
 review.expiresAt='2030-01-01';stored.result.extraction.identity.iin='other';r=await respond({iin:'test-client'},record,repository,stored,true);assert.equal(r.documentReview,null);assert.equal(r.eligibleForAutofill,false);
});
