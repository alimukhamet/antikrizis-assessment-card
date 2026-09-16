import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class RepositoryError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
function setup(state,options={}){
 const actor={id:'worker:test',worker:'test',...options.actor},record={id:'case',client_iin:'000000000010',identity_revision:1};
 const files=[{documentId:'doc',name:'synthetic.pdf',sha256:'a'.repeat(64),byteSize:3}],manifest={planHash:'plan',files,baseline:[],scope:options.scope||'documents'};
 let row=state?{state,actor_id:options.owner||actor.id,identity_revision:options.revision??1,manifest_json:JSON.stringify(manifest)}:null,writes=0,reads=0,finishes=0;
 class Manifests{
  async rootForPlan(){return 'root';}async get(caseId){assert.equal(caseId,'case');return row;}
  async finish(caseId,batchId,receipt){finishes++;row={...row,state:'verified',receipt_json:JSON.stringify(receipt)};return row;}
 }
 const imports={
  '../../../staff-access':{requireStaffRequest:async()=>options.denied?new Response(null,{status:401}):null},
  '../../../../../lib/documents/request-context':{boundedJson:r=>r.json(),evidenceContext:async()=>({record,actor,repository:{}}),evidenceError:e=>Response.json({error:e.code},{status:e.status||500})},
  '../../../../../lib/documents/repository':{RepositoryError},
  '../../../../../lib/questionnaire/draft':{validateDraft:p=>p},
  '../../../../../lib/documents/upload-plan':{documentUploadPlan:async()=>({planHash:'plan',batches:[files]}),uploadBatchId:async()=> 'batch'},
  '../../../../../lib/documents/package-check':{checkDocumentPackage:async()=>{writes++;throw Error('Recovery reached upload preparation');}},
  '../../../../../lib/documents/upload-manifest':{UploadManifestRepository:Manifests},
  '../../../../../lib/documents/upload-service':{uploadStoredDocuments:async()=>{writes++;throw Error('Recovery reached upload');}},
  '../../../../../lib/crm/document-download':{createCrmDocumentReader:()=>()=>{},createVerifiedDocumentUploadAdapter:()=>({reconcile:async()=>{reads++;if(options.failure)throw new RepositoryError(options.failure);return{verified:true,files};}})},
  '../../../../../lib/crm/document-upload':{DocumentUploadError:RepositoryError,createDocumentUploadAdapter:()=>({reconcile:async()=>{reads++;if(options.failure)throw new RepositoryError(options.failure);return {verified:true,files};}})},
  'cloudflare:workers':{env:{DB:{}}},
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assessment/[dealId]/uploads/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(!(n in imports))throw Error('Unexpected import '+n);return imports[n];},Response,URL,Headers,fetch,process:{env:{}},console:{warn(){},info(){}}});
 return{run:()=>exports.POST(new Request('https://synthetic.invalid/api/assessment/11665/uploads',{method:'POST',body:JSON.stringify({action:'reconcile',payload:{},requestId:'root',batchIndex:0,identityRevision:1})}),{params:Promise.resolve({dealId:'11665'})}),inspect:()=>exports.GET(new Request('https://synthetic.invalid/api/assessment/11665/uploads?verify=synthetic-batch'),{params:Promise.resolve({dealId:'11665'})}),writes:()=>writes,reads:()=>reads,finishes:()=>finishes};
}
test('automatic upload recovery cannot prepare or write missing, unsent or cancelled work',async()=>{
 for(const state of [null,'prepared','cancelled']){const s=setup(state),response=await s.run();assert.equal(response.status,409);assert.equal((await response.json()).error,'UPLOAD_NOT_STARTED');assert.equal(s.writes(),0);assert.equal(s.reads(),0);}
});
test('automatic upload recovery only reads uncertain work and reuses verified receipts',async()=>{
 for(const state of ['writing','uncertain','verified']){const s=setup(state),response=await s.run();assert.equal(response.status,200);assert.equal((await response.json()).documentsUploaded,true);assert.equal(s.writes(),0);assert.equal(s.reads(),state==='verified'?0:1);}
});
test('read-only inspection verifies existing files for the worker or owner without finishing their submission',async()=>{
 for(const actor of [{id:'worker:test',worker:'test'},{id:'worker:ali',worker:'ali'}]){
  const s=setup('uncertain',{actor,owner:'worker:test'}),r=await s.inspect(),body=await r.json();
  assert.equal(r.status,200);assert.equal(body.verified,true);assert.equal(body.filesVerified,1);assert.equal(s.reads(),1);assert.equal(s.writes(),0);assert.equal(s.finishes(),0);assert.equal(r.headers.get('cache-control'),'no-store');
 }
});
test('inspection refuses other workers, missing uploads, credentials, stale identities and unsent work',async()=>{
 for(const options of [{owner:'worker:other'},{scope:'credentials'},{revision:2},{denied:true}]){
  const s=setup('uncertain',options),r=await s.inspect();assert.ok(r.status>=400);assert.equal(s.reads(),0);assert.equal(s.writes(),0);assert.equal(s.finishes(),0);
 }
 for(const state of [null,'prepared','cancelled']){const s=setup(state),r=await s.inspect();assert.ok(r.status>=400);assert.equal(s.reads(),0);assert.equal(s.finishes(),0);}
});
test('inspection failure stays unverified and does not mutate the worker attempt',async()=>{
 const s=setup('uncertain',{failure:'UPLOAD_CONTENT_READBACK_UNCERTAIN'}),body=await(await s.inspect()).json();assert.equal(body.verified,false);assert.equal(body.error,'UPLOAD_CONTENT_READBACK_UNCERTAIN');assert.equal(s.writes(),0);assert.equal(s.finishes(),0);
});
