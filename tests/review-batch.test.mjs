import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],Date,Map,Set});return exports;}
const {RepositoryError}=load('lib/documents/repository.ts'),policy=load('lib/documents/policy.ts');
const service=load('lib/documents/review-service.ts',{'./repository':{RepositoryError},'./policy':policy,'./analysis-service':{analysisVersion:'current'}});
const {reviewBatch}=load('lib/documents/review-batch.ts',{'./repository':{RepositoryError},'./review-service':service});
const record={id:'case',identity_revision:1,client_iin:'SYNTHETIC-IIN'},actor={id:'worker:test'};
function setup(){
 const saved=new Map();let reads=0,active=0,peak=0;
 const result={extraction:{identity:{iin:record.client_iin},kind:'gkb_full',issuedAt:'2026-09-16',findings:[],credits:[],facts:Array.from({length:12},(_,i)=>({key:'synthetic.'+i,value:String(i),page:1,source:'SYNTHETIC'}))}};
 const repository={
  async document(caseId,id){assert.equal(caseId,record.id);return id==='doc'?{id,case_id:caseId}:null;},
  async extraction(caseId,documentId,id){return id==='extraction'?{id,document_id:documentId,version:'current'}:null;},
  async readResult(){reads++;return result;},
  async appendReview(input){active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;const old=saved.get(input.requestId);if(old){assert.equal(JSON.stringify(old.input),JSON.stringify(input));return old.review;}const review={id:webcrypto.randomUUID()};saved.set(input.requestId,{input,review});return review;}
 };
 const inputs=result.extraction.facts.map(f=>({documentId:'doc',extractionId:'extraction',identityRevision:1,requestId:webcrypto.randomUUID(),factKey:f.key,value:f.value,disposition:'confirmed',reason:''}));
 return{repository,inputs,result,saved,reads:()=>reads,peak:()=>peak,run:raw=>reviewBatch(repository,record,raw??inputs,actor,'2026-09-16')};
}
test('one batch reads each source once, limits parallel writes and retains retry-safe reviews',async()=>{
 const s=setup(),a=await s.run();assert.equal(a.ok,true);assert.equal(a.outcomes.length,12);assert.equal(s.reads(),1);assert.equal(s.peak(),4);assert.equal(s.saved.size,12);
 const b=await s.run();assert.deepEqual(Array.from(b.outcomes,r=>r.review.id),Array.from(a.outcomes,r=>r.review.id));assert.equal(s.saved.size,12);
});
test('batch preserves exact values, identity, ownership, date and correction gates',async()=>{
 for(const [mutate,code]of [
  [s=>s.inputs[0].value='forged','CONFIRMATION_VALUE_MISMATCH'],
  [s=>s.inputs[0].identityRevision=2,'CASE_IDENTITY_CHANGED'],
  [s=>s.inputs[0].documentId='other-client','DOCUMENT_NOT_IN_CASE'],
  [s=>s.inputs[0].extractionId='other-extraction','EXTRACTION_NOT_IN_DOCUMENT'],
  [s=>s.result.extraction.identity.iin='OTHER','CLIENT_IDENTITY_UNVERIFIED'],
  [s=>s.result.extraction.issuedAt='2026-07-01','GKB_DATE_NOT_ACCEPTABLE'],
  [s=>s.result.extraction.findings=['PAGE_COMPLETENESS_UNVERIFIED'],'DOCUMENT_REQUIRES_VALIDATION'],
  [s=>{s.inputs[0].value='changed';s.inputs[0].disposition='corrected';},'CORRECTION_REQUIRES_VALUE_AND_REASON']
 ]){const s=setup();mutate(s);const result=await s.run([s.inputs[0]]);assert.equal(result.ok,false);assert.equal(result.outcomes[0].error,code);assert.equal(s.saved.size,0);}
});
test('batch rejects malformed or duplicate targets before any write',async()=>{
 const s=setup();for(const raw of [[],Array(101).fill(s.inputs[0]),[s.inputs[0],s.inputs[0]],[s.inputs[0],{}]])await assert.rejects(s.run(raw));
 assert.equal(s.saved.size,0);assert.equal(s.reads(),0);
});
