import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class RepositoryError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
const hash='a'.repeat(64);
function setup(options={}){
 let contexts=0,reads=0,runs=0;const actor={worker:'ali',id:'worker:ali',authentication:'test',...options.actor};
 const submission=options.missing?null:{payload_hash:hash};
 const imports={
 '../../../staff-access':{requireStaffRequest:async()=>options.denied?Response.json({},{status:options.denied}):null},
 '../../../../../lib/worker-session':{readSessionCookie:()=>'',verifySession:async()=>actor},
 '../../../../../lib/documents/request-context':{boundedJson:r=>r.json(),evidenceContext:async()=>{contexts++;return {record:{id:'case',client_iin:'000000000001'},actor,repository:{}};},evidenceError:e=>Response.json({error:e.code},{status:e.status||500})},
 '../../../../../lib/documents/repository':{RepositoryError},
 '../../../../../lib/documents/upload-manifest':{UploadManifestRepository:class{}},
 '../../../../../lib/questionnaire/submission-repository':{SubmissionRepository:class{async latestForCase(){return submission;}}},
 '../../../../../lib/questionnaire/handoff-service':{verifyHandoffDelivery:async()=>({requestId:'r',payloadHash:hash})},
 '../../../../../lib/questionnaire/title-repair-repository':{TitleRepairRepository:class{}},
 '../../../../../lib/questionnaire/title-repair-service':{inspectTitleRepair:async()=>{reads++;return{status:'PROPOSED'};},runTitleRepair:async(_deps,_record,s,_actor,input)=>{assert.equal(s,submission);runs++;return{status:'VERIFIED',action:input.action};}},
 '../../../../../lib/crm/title-repair':{createTitleRepairAdapter:()=>({})},
 '../../../../../lib/crm/assessment-write':{createAssessmentAdapter:()=>({})},
 '../../../../../lib/crm/document-download':{createVerifiedDocumentUploadAdapter:()=>({}),createCrmDocumentReader:()=>({})},
 'cloudflare:workers':{env:{DB:{}}},
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assessment/[dealId]/title-repair/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{assert.ok(n in imports,n);return imports[n];},Response,process:{env:{}}});
 return{run:body=>exports.POST(new Request('https://synthetic.invalid/api/assessment/900001/title-repair',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({dealId:'900001'})}),stats:()=>({contexts,reads,runs})};
}
test('title repair rejects unauthenticated, cross-origin and non-owner calls before case or CRM access',async()=>{
 for(const options of [{denied:401},{denied:403},{actor:{worker:'darkhan',id:'worker:darkhan'}}]){
  const s=setup(options);assert.ok((await s.run({action:'repair',expectedSubmissionHash:hash})).status>=400);assert.deepEqual(s.stats(),{contexts:0,reads:0,runs:0});
 }
});
test('all title maintenance actions require the exact latest saved submission hash',async()=>{
 for(const action of ['inspect','repair','reconcile'])for(const expectedSubmissionHash of [undefined,'b'.repeat(64),'bad']){
  const s=setup(),response=await s.run({action,expectedSubmissionHash});assert.equal(response.status,409);assert.equal((await response.json()).error,'TITLE_REPAIR_SUBMISSION_CHANGED');assert.equal(s.stats().reads+s.stats().runs,0);
 }
});
test('inspection is read-only and repair/reconciliation dispatch separately with private responses',async()=>{
 for(const action of ['inspect','repair','reconcile']){
  const s=setup(),response=await s.run({action,expectedSubmissionHash:hash,requestId:'pinned',expectedProposalHash:hash});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(s.stats(),{contexts:1,reads:action==='inspect'?1:0,runs:action==='inspect'?0:1});
 }
 const s=setup();assert.equal((await s.run({action:'rename',expectedSubmissionHash:hash})).status,400);assert.equal(s.stats().runs,0);
});
