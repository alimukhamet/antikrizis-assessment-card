import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

class RepositoryError extends Error {constructor(code,status=409){super(code);this.code=code;this.status=status;}}
function fixture(options={}) {
 const calls=[];
 const record={id:'case',external_id:'10479',identity_revision:1,client_iin:'000000000010'};
 const actor={id:'worker:test'};
 const row={request_id:'00000000-0000-4000-8000-000000000001',state:'uncertain',history_state:'pending',payload_json:JSON.stringify({values:{fio:'SYNTHETIC',dognum:'TEST'}})};
 const imports={
  '../../../staff-access':{requireStaffRequest:async()=>options.denied?new Response(null,{status:401}):null},
  '../../../../../lib/documents/request-context':{
   boundedJson:r=>r.json(),operatingDay:()=> '2026-09-17',
   evidenceContext:async()=>({record,actor,repository:{}}),
   evidenceError:e=>Response.json({error:e.code},{status:e.status||503}),
  },
  '../../../../../lib/documents/repository':{RepositoryError},
  '../../../../../lib/questionnaire/submission-destination':{assertSubmissionDestination:(r,d)=>{calls.push('destination');if(d?.dealId!==r.external_id)throw new RepositoryError('SUBMISSION_DESTINATION_CHANGED');}},
  '../../../../../lib/questionnaire/submission-repository':{SubmissionRepository:class{}},
  '../../../../../lib/questionnaire/final-submission':{},
  '../../../../../lib/questionnaire/submission-history':{},
  '../../../../../lib/crm/assessment-history':{createAssessmentHistoryAdapter:()=>({})},
  '../../../../../lib/crm/assessment-write':{createAssessmentAdapter:()=>{calls.push('crm-adapter');return{};},AssessmentWriteError:class extends Error{}},
  '../../../../../lib/crm/assessment-intake-sync':{},
  '../../../../../lib/questionnaire/contract-action':{
   generateCurrentContract:async(r,c,revision,raw,bindings,day)=>{calls.push('generate');assert.equal(c,record);assert.equal(revision,1);assert.equal(raw.synthetic,true);assert.equal(bindings.length,0);assert.equal(day,'2026-09-17');return {data:{client_name:'SYNTHETIC'},rendererVersion:'a'.repeat(64)};},
   completeContractSave:async(r,s,a,h,c,person,input)=>{calls.push('complete');assert.equal(person,actor);assert.equal(c,record);assert.equal(input.requestId,row.request_id);return row;},
  },
  'cloudflare:workers':{env:{DB:options.noDatabase?null:{}}},
 };
 const exports={},compiled=ts.transpileModule(fs.readFileSync(new URL('../app/api/assessment/[dealId]/submission/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal(compiled.diagnostics.length,0);
 vm.runInNewContext(compiled.outputText,{exports,require:n=>{assert.ok(n in imports,n);return imports[n];},Response,process:{env:{}},setTimeout,clearTimeout});
 const run=overrides=>exports.POST(new Request('https://synthetic.invalid/api/assessment/10479/submission',{method:'POST',body:JSON.stringify({action:'generate',requestId:row.request_id,identityRevision:1,payload:{synthetic:true},bindings:[],destination:{dealId:'10479'},...overrides})}),{params:Promise.resolve({dealId:'10479'})});
 return{run,calls};
}
test('generate is authenticated, no-store, confirms destination and does not enter a CRM adapter',async()=>{
 const f=fixture(),response=await f.run(),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(body.contract.data.client_name,'SYNTHETIC');assert.equal(body.synchronization,'not_checked');
 assert.deepEqual(f.calls,['destination','generate']);
});
test('one complete action exposes an unconfirmed save as unconfirmed, not completion',async()=>{
 const f=fixture(),response=await f.run({action:'complete'}),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.assessmentSaved,false);assert.equal(body.historySaved,false);
 assert.equal(body.completed,false);assert.deepEqual(f.calls,['destination','crm-adapter','complete']);
});
test('neither new action bypasses login, destination, database or revision validation',async()=>{
 for(const action of ['generate','complete']){
  const denied=fixture({denied:true});assert.equal((await denied.run({action})).status,401);assert.equal(denied.calls.length,0);
  const wrong=fixture();assert.equal((await wrong.run({action,destination:{dealId:'other'}})).status,409);assert.deepEqual(wrong.calls,['destination']);
  const missing=fixture({noDatabase:true});assert.equal((await missing.run({action})).status,503);assert.equal(missing.calls.length,0);
  const invalid=fixture();assert.equal((await invalid.run({action,identityRevision:'1'})).status,400);assert.ok(!invalid.calls.includes('generate')&&!invalid.calls.includes('complete'));
 }
});
