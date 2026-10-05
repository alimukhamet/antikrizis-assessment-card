import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash,webcrypto} from 'node:crypto';
class RepositoryError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
class HandoffAssessmentChangedError extends RepositoryError{constructor(fields){super('HANDOFF_ASSESSMENT_CHANGED');this.mismatchedFields=fields;}}
const digest=s=>createHash('sha256').update(s).digest('hex'),payload=JSON.stringify({destination:{}}),hash=digest(payload);
function setup(options={}){
 let reconciles=0,audits=0;const proofs=[];const actor={id:'worker:ali',worker:'ali',...options.actor},record={id:'case',external_id:'900001',client_iin:'000000000010',identity_revision:1};
 const row={case_id:'case',identity_revision:1,request_id:'existing',actor_id:'worker:original',state:'uncertain',payload_json:payload,payload_hash:hash,...options.row};
 const imports={
 '../../../staff-access':{requireStaffRequest:async()=>options.denied?Response.json({},{status:options.denied}):null},
 '../../../../../lib/documents/request-context':{boundedJson:r=>r.json(),evidenceContext:async()=>({record,actor,repository:{}}),evidenceError:e=>Response.json({error:e.code},{status:e.status||500})},
 '../../../../../lib/documents/repository':{RepositoryError,sha256:async s=>digest(s)},
 '../../../../../lib/questionnaire/handoff-repository':{HandoffRepository:class{async active(){return options.missing?null:row;}}},
 '../../../../../lib/documents/upload-manifest':{UploadManifestRepository:class{}},
 '../../../../../lib/questionnaire/submission-repository':{SubmissionRepository:class{}},
 '../../../../../lib/questionnaire/handoff-service':{HandoffAssessmentChangedError,verifyHandoffDelivery:async(_deps,_record,proof)=>{proofs.push(proof);if(options.deliveryReady)return{requestId:'saved',payloadHash:hash,originals:7};throw options.deliveryError;},reconcileHandoffOutcome:async(_deps,_record,value)=>{reconciles++;assert.equal(value.actor_id,'worker:original');return {...value,state:'verified'};},runHandoff:()=>{throw Error('Must never send');}},
 '../../../../../lib/crm/lawyer-handoff':{createHandoffAdapter:()=>({})},
 '../../../../../lib/questionnaire/submission-destination':{assertSubmissionDestination:(r,v)=>{if(v?.dealId!==r.external_id||v?.iin!==r.client_iin||v?.identityRevision!==r.identity_revision)throw new RepositoryError('SUBMISSION_DESTINATION_CHANGED');}},
 '../../../../../lib/crm/assessment-write':{createAssessmentAdapter:()=>({})},'../../../../../lib/crm/document-download':{createVerifiedDocumentUploadAdapter:()=>({}),createCrmDocumentReader:()=>()=>{throw Error('Must never read bytes');}},
 '../../../../../lib/assessment-release.json':{default:{version:'synthetic'}},
 '../../../../../lib/operations-monitor':{OperationsRepository:class{async record(){audits++;return !options.auditFails;}}},
 'cloudflare:workers':{env:{DB:{}}},
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assessment/[dealId]/handoff/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{assert.ok(n in imports,n);return imports[n];},Response,URL,crypto:webcrypto,process:{env:{}}});
 return{get:(query='')=>exports.GET(new Request('https://synthetic.invalid/'+query),{params:Promise.resolve({dealId:'900001'})}),run:extra=>exports.POST(new Request('https://synthetic.invalid/',{method:'POST',body:JSON.stringify({action:'reconcile',requestId:'existing',expectedHash:hash,destination:{dealId:'900001',iin:record.client_iin,identityRevision:1},...extra})}),{params:Promise.resolve({dealId:'900001'})}),proofs,stats:()=>({reconciles,audits})};
}
test('owner reconciliation rejects wrong actor, request, hash, state and identity before reading CRM',async()=>{
 for(const [options,body] of [[{denied:401},{}],[{denied:403},{}],[{actor:{worker:'darkhan'}},{}],[{}, {expectedHash:'b'.repeat(64)}],[{},{requestId:'other'}],[{row:{state:'prepared'}},{}],[{row:{state:'cancelled'}},{}],[{row:{identity_revision:2}},{}],[{row:{payload_json:'changed'}},{}],[{missing:true},{}],[{},{destination:{dealId:'other'}}]]){
  const s=setup(options);assert.ok((await s.run(body)).status>=400);assert.deepEqual(s.stats(),{reconciles:0,audits:0});
 }
});
test('owner can measure the complete byte proof without uploading or moving a completed handoff',async()=>{
 const s=setup({deliveryReady:true,row:{state:'verified'}}),response=await s.get('?verifyBytes=1'),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.byteVerification.verified,true);assert.ok(body.byteVerification.elapsedMs>=0);
 assert.equal(body.handoff.state,'verified');assert.equal(s.proofs[0].verifyBytes,true);assert.deepEqual(s.stats(),{reconciles:0,audits:0});
 const ordinary=setup({deliveryReady:true}),normal=await (await ordinary.get()).json();assert.equal(normal.byteVerification,undefined);assert.equal(ordinary.proofs[0].verifyBytes,false);
 const staff=setup({actor:{worker:'darkhan'},deliveryReady:true});assert.equal((await staff.get('?verifyBytes=1')).status,403);assert.equal(staff.proofs.length,0);
 const failed=setup({deliveryError:new RepositoryError('HANDOFF_ORIGINAL_CHANGED')}),failure=await (await failed.get('?verifyBytes=1')).json();
 assert.equal(failure.byteVerification.verified,false);assert.equal(failure.delivery.code,'HANDOFF_ORIGINAL_CHANGED');assert.deepEqual(failed.stats(),{reconciles:0,audits:0});
});
test('owner readback preserves original author, requires an audit record and cannot send',async()=>{
 const s=setup(),r=await s.run({});assert.equal(r.status,200);assert.equal((await r.json()).handoff.state,'verified');assert.deepEqual(s.stats(),{reconciles:1,audits:1});
 const failed=setup({auditFails:true});assert.equal((await failed.run({})).status,503);assert.equal(failed.stats().reconciles,0);
});

test('staff delivery readback exposes only typed mismatch keys and keeps receipt read-only',async()=>{
 for(const [deliveryError,expected] of [
  [new HandoffAssessmentChangedError(['card','debt']),{ready:false,code:'HANDOFF_ASSESSMENT_CHANGED',mismatchedFields:['card','debt']}],
  [new RepositoryError('HANDOFF_ASSESSMENT_CHANGED'),{ready:false,code:'HANDOFF_ASSESSMENT_CHANGED'}],
  [Object.assign(new Error('SYNTHETIC PRIVATE VALUE'),{mismatchedFields:['SYNTHETIC PRIVATE VALUE']}),{ready:false,code:'HANDOFF_ASSESSMENT_UNVERIFIED'}]
 ]){
  const s=setup({row:{state:'prepared'},deliveryError}),response=await s.get();assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.deepEqual(body.delivery,expected);assert.equal(body.handoff.state,'prepared');
  assert.equal(JSON.stringify(body).includes('SYNTHETIC PRIVATE VALUE'),false);assert.deepEqual(s.stats(),{reconciles:0,audits:0});
 }
 for(const denied of [401,403]){const s=setup({denied});assert.equal((await s.get()).status,denied);assert.deepEqual(s.stats(),{reconciles:0,audits:0});}
});
