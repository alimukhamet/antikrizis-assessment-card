/** Profile checks must compile before advertising readiness; no storage or CRM writes. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function route({complete=true,oversized=false}={}){
 const calls=[],exports={};
 class RepositoryError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
 class ProfileWriteError extends Error{}
 const forbidden=()=>{throw Error('A check must never initialize storage or CRM');};
 const imports={
  '../../../staff-access':{requireStaffRequest:async()=>null},
  '../../../../../lib/documents/request-context':{
   boundedJson:async request=>request.json(),operatingDay:()=> '2026-10-14',
   evidenceContext:async()=>({record:{client_iin:'000000000010'},client:{iin:'000000000010'},actor:{displayName:'Synthetic Worker'}}),
   evidenceError:error=>Response.json({error:error.code},{status:error.status}),
  },
  '../../../../../lib/documents/repository':{RepositoryError},
  '../../../../../lib/crm/profile-write':{ProfileWriteError,createProfileAdapter:forbidden},
  '../../../../../lib/crm/assessment-history':{createAssessmentHistoryAdapter:forbidden},
  '../../../../../lib/questionnaire/profile-save-repository':{ProfileSaveRepository:forbidden},
  '../../../../../lib/questionnaire/draft':{validateDraft:draft=>draft},
  '../../../../../lib/questionnaire/check-answers':{checkAnswers:()=>({answersComplete:complete,issues:complete?[]:[{key:'n8041',code:'ANSWER_REQUIRED'}],unresolved:[]})},
  '../../../../../lib/questionnaire/compile-profile':{compileProfile:(...args)=>{calls.push(args);if(oversized)throw new RepositoryError('PROFILE_TOO_LARGE',413);return {};}}
 };
 const source=fs.readFileSync('app/api/assessment/[dealId]/profile/route.ts','utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name]||{},Date,Response});
 return {calls,check:()=>exports.POST(new Request('https://synthetic.invalid/api/assessment/11665/profile',{method:'POST',body:JSON.stringify({action:'check',requestId:'11111111-1111-4111-8111-111111111111',draft:{schemaVersion:1}})}),{params:Promise.resolve({dealId:'11665'})})};
}

test('complete profile readiness includes compilation and reports a genuine size failure before writes',async()=>{
 const good=route();assert.equal((await (await good.check()).json()).ready,true);assert.equal(good.calls.length,1);assert.equal(good.calls[0][2],'11665');
 const large=route({oversized:true}),response=await large.check();assert.equal(response.status,413);assert.deepEqual(await response.json(),{error:'PROFILE_TOO_LARGE'});assert.equal(large.calls.length,1);
});
test('incomplete profile retains its answer issues without compiling or writing',async()=>{
 const incomplete=route({complete:false,oversized:true}),response=await incomplete.check();assert.equal(response.status,200);const body=await response.json();assert.equal(body.ready,false);assert.equal(body.issues[0].key,'n8041');assert.equal(incomplete.calls.length,0);
});
