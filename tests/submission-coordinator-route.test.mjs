/** Real HTTP handler/auth/destination checks; coordinator and network are synthetic. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file,imports={},extra={}){
 const exports={},compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 vm.runInNewContext(compiled.outputText,{exports,require:name=>imports[name],Date,Response,Request,AbortSignal,TextDecoder,setTimeout,clearTimeout,...extra});
 return exports;
}
const evidence=load('lib/documents/repository.ts');
const destination=load('lib/questionnaire/submission-destination.ts',{'../documents/repository':evidence});
const context=load('lib/documents/request-context.ts',{'./repository':evidence});
const id='00000000-0000-0000-0000-000000000001';
function fixture({denied=false}={}){
 let calls=0,legacy=0,argumentsSeen;
 const record={id:'case',external_id:'10479',external_system:'bitrix',client_iin:'000000000001',identity_revision:1};
 const actor={id:'worker:test'},row={request_id:id,state:'verified',history_state:'verified',payload_json:JSON.stringify({values:{fio:'SYNTHETIC',dognum:'TEST'}})};
 class Submissions{async latest(){return row;}}
 class AssessmentWriteError extends Error{}
 const prefix='../../../../../lib/';
 const imports={
  '../../../staff-access':{requireStaffRequest:async()=>denied?Response.json({error:'SIGN_IN_REQUIRED'},{status:401}):null},
  [prefix+'documents/request-context']:{...context,operatingDay:()=> '2026-09-17',evidenceContext:async()=>({record,actor,repository:{}})},
  [prefix+'documents/repository']:evidence,
  [prefix+'questionnaire/submission-destination']:destination,
  [prefix+'questionnaire/submission-repository']:{SubmissionRepository:Submissions},
  [prefix+'questionnaire/complete-submission']:{completeSubmission:async(...args)=>{calls++;argumentsSeen=args;return{row,workflow:{status:'ready'},contract:{data:{test:'IMMUTABLE'},rendererVersion:'a'.repeat(64)}};}},
  [prefix+'questionnaire/final-submission']:{prepareFinalSubmission:async()=>{legacy++;return row;}},
  [prefix+'crm/assessment-write']:{AssessmentWriteError,createAssessmentAdapter:()=>({})},
  [prefix+'crm/assessment-history']:{createAssessmentHistoryAdapter:()=>({})},
  'cloudflare:workers':{env:{DB:{}}},
 };
 const route=load('app/api/assessment/[dealId]/submission/route.ts',imports,{process:{env:{}},fetch:()=>assert.fail('No network in route tests')});
 const target={dealId:'10479',iin:record.client_iin,identityRevision:1};
 const send=body=>route.POST(new Request('https://synthetic.invalid/api/assessment/10479/submission',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}),{params:Promise.resolve({dealId:'10479'})});
 return{send,target,calls:()=>calls,legacy:()=>legacy,args:()=>argumentsSeen,id};
}
test('complete and resume retain the staff authentication gate',async()=>{
 const f=fixture({denied:true});for(const action of ['complete','resume'])assert.equal((await f.send({action,requestId:id,destination:f.target})).status,401);assert.equal(f.calls(),0);
});
test('complete and resume require a matching confirmed destination',async()=>{
 const f=fixture();for(const action of ['complete','resume']){
  const response=await f.send({action,requestId:id,destination:{...f.target,dealId:'900001'},identityRevision:1,payload:{}});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'SUBMISSION_DESTINATION_CHANGED');
 }assert.equal(f.calls(),0);
});
test('complete rejects missing payload and invalid identity revision before coordination',async()=>{
 const f=fixture();for(const extra of [{identityRevision:1},{payload:{},identityRevision:'1'}]){
  const response=await f.send({action:'complete',requestId:id,destination:f.target,...extra});assert.equal(response.status,400);
 }assert.equal(f.calls(),0);
});
test('complete returns one coordinated response with contract and both receipt states',async()=>{
 const f=fixture(),response=await f.send({action:'complete',requestId:id,destination:f.target,identityRevision:1,payload:{answers:[]},bindings:[]});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json();
 assert.equal(data.workflow.status,'ready');assert.equal(data.contract.data.test,'IMMUTABLE');assert.equal(data.assessmentSaved,true);assert.equal(data.historySaved,true);assert.equal(f.calls(),1);assert.equal(f.args()[5].identityRevision,1);
});
test('explicit resume uses stored snapshot rather than accepting replacement answers',async()=>{
 const f=fixture(),response=await f.send({action:'resume',requestId:id,destination:f.target,payload:{answers:['REPLACEMENT']}});
 assert.equal(response.status,200);assert.equal(f.args()[5],undefined);assert.equal(f.calls(),1);
});
test('legacy prepare endpoint remains compatible with already open browser tabs',async()=>{
 const f=fixture(),response=await f.send({action:'prepare',requestId:id,destination:f.target,identityRevision:1,payload:{}});
 assert.equal(response.status,200);assert.equal(f.legacy(),1);assert.equal(f.calls(),0);
});
