/** Route authorization/compatibility; coordinator and CRM calls are intercepted. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class RepositoryError extends Error {constructor(code,status=409){super(code);this.code=code;this.status=status;}}
const id='00000000-0000-0000-0000-000000000001';
function load(file,imports,environment={}){
 const exports={};const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 vm.runInNewContext(result.outputText,{exports,require:n=>{if(!(n in imports))throw Error('Unexpected import '+n);return imports[n];},process:{env:environment},Response,AbortSignal,fetch,setTimeout,clearTimeout});return exports;
}
function fixture(options={}){
 const record={id:'case',external_id:'11665',identity_revision:1,client_iin:'000000000001'},actor={id:'worker:synthetic'};
 const destination={dealId:'11665',identityRevision:1,iin:record.client_iin};
 let contexts=0,operations=0,syncs=0;const legacy=[];let signals=[];
 const row={request_id:id,actor_id:actor.id,identity_revision:1,state:'verified',history_state:'verified',payload_json:JSON.stringify({values:{fio:'SYNTHETIC',dognum:'TEST',card:'TEST'}})};
 const contract={rendererVersion:'a'.repeat(64),data:{client_name:'SYNTHETIC'}};
 const final={};for(const name of ['prepareFinalSubmission','commitFinalSubmission','reconcileFinalSubmission','cancelFinalPreparation'])final[name]=async()=>{legacy.push(name);return row;};final.savedContract=async()=>contract;
 const imports={
  '../../../staff-access':{requireStaffRequest:async()=>options.denied?Response.json({error:'SIGN_IN_REQUIRED'},{status:401}):null},
  '../../../../../lib/documents/request-context':{boundedJson:r=>r.json(),evidenceContext:async()=>{contexts++;return{record:contexts>1&&options.changed?{...record,identity_revision:2}:record,actor:contexts>1&&options.otherActor?{id:'other'}:actor,repository:{}};},evidenceError:e=>Response.json({error:e.code||e.message},{status:e.status||503}),operatingDay:()=> '2026-09-17'},
  '../../../../../lib/documents/repository':{RepositoryError},
  '../../../../../lib/questionnaire/submission-destination':load('lib/questionnaire/submission-destination.ts',{'../documents/repository':{RepositoryError}}),
  '../../../../../lib/questionnaire/submission-repository':{SubmissionRepository:class{get(){return options.missingRow?null:{...row,...options.rowOverride};}}},
  '../../../../../lib/questionnaire/final-submission':final,
  '../../../../../lib/questionnaire/submission-history':{saveSubmissionHistory:async()=>{legacy.push('history');return row;}},
  '../../../../../lib/questionnaire/contract-operation':{completeContractOperation:async opts=>{operations++;assert.equal(opts.requestId,id);await opts.currentRecord();return{row,contract,message:'READY'};}},
  '../../../../../lib/crm/assessment-history':{createAssessmentHistoryAdapter:(url,send,signal)=>{signals.push(signal);return{};}},
  '../../../../../lib/crm/assessment-write':{AssessmentWriteError:class extends Error{},createAssessmentAdapter:(url,send,signal)=>{signals.push(signal);return{};}},
  '../../../../../lib/crm/assessment-intake-sync':{syncAssessmentIntake:async()=>{syncs++;return {status:'synced',sourceSubmissionId:'synthetic'};}},
  '../../../../../lib/questionnaire/submission-recovery':{authorizeSubmissionRecovery:async()=>assert.fail('Ordinary continuations must not invoke owner recovery')},
  '../../../../../lib/questionnaire/repository':{DraftRepository:class{constructor(){assert.fail('Ordinary continuations must not read recovery drafts');}}},
  '../../../../../lib/operations-monitor':{OperationsRepository:class{constructor(){assert.fail('Ordinary continuations must not create owner recovery events');}}},
  '../../../../../lib/assessment-release.json':{default:{version:'assessment-test'}},
  'cloudflare:workers':{env:{DB:{}}},
 };
 const route=load('app/api/assessment/[dealId]/submission/route.ts',imports,options.syncEnabled?{ASSESSMENT_INTAKE_HMAC_SECRET:'synthetic-secret-32-characters-minimum',CRM_ASSESSMENT_INTAKE_ORIGIN:'https://crm.invalid',ASSESSMENT_INTAKE_SOURCE_ORIGIN:'https://assessment.invalid'}:{});
 const run=(body={})=>route.POST(new Request('https://synthetic.invalid/api/assessment/11665/submission',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'complete',requestId:id,destination,...body})}),{params:Promise.resolve({dealId:'11665'})});
 return{run,counts:()=>({contexts,operations}),syncs:()=>syncs,legacy,signals:()=>signals.filter(Boolean)};
}
test('continuation returns one no-store contract result and shares a deadline across both adapters',async()=>{
 const f=fixture(),r=await f.run(),body=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(body.contract.data.client_name,'SYNTHETIC');assert.equal(body.assessmentSaved,true);assert.equal(body.historySaved,true);
 assert.deepEqual(f.counts(),{contexts:2,operations:1});assert.equal(f.signals().length,2);assert.equal(f.signals()[0],f.signals()[1]);
});
test('continuation rejects unsigned users, missing destinations and malformed IDs before execution',async()=>{
 const denied=fixture({denied:true});assert.equal((await denied.run()).status,401);assert.deepEqual(denied.counts(),{contexts:0,operations:0});
 for(const body of [{destination:null},{destination:{dealId:'other'}},{requestId:'bad'},{action:'unknown'}]){
  const f=fixture();assert.ok((await f.run(body)).status>=400);assert.equal(f.counts().operations,0);
 }
});
test('continuation rechecks identity and actor during the request, not just when it starts',async()=>{
 for(const options of [{changed:true},{otherActor:true}]){const f=fixture(options),response=await f.run();assert.equal(response.status,409);assert.equal((await response.json()).contract,undefined);}
});
test('old open tabs retain their individually guarded commit, history, reconcile and download endpoints',async()=>{
 const f=fixture();for(const action of ['commit','history','reconcile','contract'])assert.equal((await f.run({action})).status,200);
 assert.deepEqual(f.legacy,['commitFinalSubmission','history','reconcileFinalSubmission']);assert.equal(f.counts().operations,0);
});

test('CRM transfer retry uses only the existing verified submission and never replays the Bitrix operation',async()=>{
 const f=fixture({syncEnabled:true});
 for(let i=0;i<2;i++){
  const response=await f.run({action:'sync-intake',destination:null});
  assert.equal(response.status,200);
  assert.equal((await response.json()).assessmentIntakeSync.status,'synced');
 }
 assert.equal(f.syncs(),2);
 assert.deepEqual(f.counts(),{contexts:2,operations:0});
 for(const options of [{missingRow:true},{rowOverride:{actor_id:'other'}},{rowOverride:{identity_revision:2}},{rowOverride:{state:'prepared'}},{rowOverride:{history_state:'pending'}}]){
  const invalid=fixture({...options,syncEnabled:true});
  assert.ok((await invalid.run({action:'sync-intake',destination:null})).status>=400);
  assert.equal(invalid.syncs(),0);
  assert.equal(invalid.counts().operations,0);
 }
});
