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
 './policy':policy,'./request-context':{operatingDay:()=> '2026-09-10'},'./repository':{},
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
