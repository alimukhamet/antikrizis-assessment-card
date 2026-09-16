import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import {validateDraft} from '../../../../../lib/questionnaire/draft';
import {documentUploadPlan,uploadBatchId} from '../../../../../lib/documents/upload-plan';
import {checkDocumentPackage} from '../../../../../lib/documents/package-check';
import {UploadManifestRepository,type UploadManifest,type UploadRow} from '../../../../../lib/documents/upload-manifest';
import {uploadStoredDocuments} from '../../../../../lib/documents/upload-service';
import {createVerifiedDocumentUploadAdapter,createCrmDocumentReader} from '../../../../../lib/crm/document-download';
import {DocumentUploadError,createDocumentUploadAdapter} from '../../../../../lib/crm/document-upload';
export async function GET(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const {dealId}=await context.params,{record,actor}=await evidenceContext(request,dealId);
  const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  const verifyId=new URL(request.url).searchParams.get('verify');
  if(verifyId){
   // Diagnostic readback of an already-attempted upload. It neither uploads nor
   // approves documents, impersonates the worker, or modifies submission state.
   const prior=await new UploadManifestRepository(runtime.DB).get(record.id,verifyId);
   if(!prior||(actor.worker!=='ali'&&prior.actor_id!==actor.id))throw new RepositoryError('UPLOAD_NOT_OWNED',404);
   const manifest=JSON.parse(prior.manifest_json) as UploadManifest;
   if(manifest.scope==='credentials'||!['writing','uncertain','verified'].includes(prior.state)||!record.client_iin||prior.identity_revision!==record.identity_revision)throw new RepositoryError('UPLOAD_NOT_STARTED');
   const started=Date.now(),trace:Array<Record<string,string|number>>=[],webhook=process.env.BITRIX_WEBHOOK??'';
   const rangeProbe=new URL(request.url).searchParams.get('range')==='1';
   const send:typeof fetch=async(input,init)=>{
    if(!rangeProbe||init?.method!=='GET')return fetch(input,init);
    const headers=new Headers(init.headers);headers.set('range','bytes=0-8191');
    const response=await fetch(input,{...init,headers});trace.push({phase:'range-probe',status:response.status,range:response.headers.get('content-range')||''});
    return response.status===206?new Response(response.body,{status:200,headers:response.headers}):response;
   };
   const reader=createCrmDocumentReader(webhook,dealId,record.client_iin,send,{onProgress:event=>{if(trace.length<100)trace.push(event);}}),adapter=createDocumentUploadAdapter(webhook,reader);
   try{const receipt=await adapter.reconcile(dealId,record.client_iin,manifest.baseline,manifest.files,manifest.reused);return Response.json({verified:!rangeProbe,filesVerified:rangeProbe?0:receipt.files.length,elapsedMs:Date.now()-started,trace},{headers:{'cache-control':'no-store'}});}
   catch(error){return Response.json({verified:false,error:error instanceof DocumentUploadError?error.code:'UPLOAD_OUTCOME_UNCERTAIN',elapsedMs:Date.now()-started,trace},{headers:{'cache-control':'no-store'}});}
  }
  return Response.json({unsent:await new UploadManifestRepository(runtime.DB).unsentForActor(record,actor,'documents')},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,256000);
  if(body.action==='cancel'){
   const uploadId=typeof body.uploadId==='string'?body.uploadId:typeof body.requestId==='string'&&Number.isInteger(body.batchIndex)?await uploadBatchId(body.requestId,Number(body.batchIndex)):null;
   if(!uploadId)throw new RepositoryError('INVALID_UPLOAD_REQUEST',400);
   const {dealId}=await context.params,{record,actor}=await evidenceContext(request,dealId);
   const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
   const manifests=new UploadManifestRepository(runtime.DB),prior=await manifests.get(record.id,uploadId);
   if(!prior||JSON.parse(prior.manifest_json).scope==='credentials')throw new RepositoryError('UPLOAD_NOT_OWNED',404);
   const row=await manifests.cancelUnsent(record,uploadId,actor);
   return Response.json({state:row.state},{headers:{'cache-control':'no-store'}});
  }
  const payload=validateDraft(body.payload);
  if(typeof body.requestId!=='string'||!Number.isInteger(body.batchIndex)||!Number.isInteger(body.identityRevision))throw new RepositoryError('INVALID_UPLOAD_REQUEST',400);
  const batchIndex=Number(body.batchIndex);await uploadBatchId(body.requestId,batchIndex);
  const {dealId}=await context.params,{record,repository,actor}=await evidenceContext(request,dealId);
  if(!record.client_iin||body.identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  const plan=await documentUploadPlan(repository,record,payload),batch=plan.batches[batchIndex];if(!batch)throw new RepositoryError('INVALID_UPLOAD_BATCH',400);
  const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  const manifests=new UploadManifestRepository(runtime.DB);
  const requestId=await manifests.rootForPlan(record,plan.planHash,actor)??body.requestId;
  const batchId=await uploadBatchId(requestId,batchIndex),prior=await manifests.get(record.id,batchId);
  for(let index=0;index<batchIndex;index++){const previous=await manifests.get(record.id,await uploadBatchId(requestId,index));if(!previous||previous.state!=='verified'||previous.actor_id!==actor.id||previous.identity_revision!==record.identity_revision||JSON.parse(previous.manifest_json).planHash!==plan.planHash)throw new RepositoryError('UPLOAD_PREVIOUS_BATCH_REQUIRED');}
  let row:UploadRow|null=prior;
  if(prior){const manifest=JSON.parse(prior.manifest_json) as UploadManifest;if(prior.actor_id!==actor.id||prior.identity_revision!==record.identity_revision||manifest.planHash!==plan.planHash||JSON.stringify(manifest.files)!==JSON.stringify(batch))throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');}
  // Recovery must never turn into a fresh upload, even if another request changed state.
  if(body.action==='reconcile'&&(!prior||!['writing','uncertain','verified'].includes(prior.state)))throw new RepositoryError('UPLOAD_NOT_STARTED');
  if(!prior||prior.state==='prepared'){
   const checked=await checkDocumentPackage(repository,record,payload,operatingDay());
   // Credentials are a separate upload action and never enter this PDF upload pipeline.
   if(checked.issues.some(i=>i.code!=='EDS_SEPARATE_UPLOAD_REQUIRED'))throw new RepositoryError('DOCUMENT_PACKAGE_NOT_READY');
   const reviewIds=checked.manuallyReviewed.map(r=>r.reviewId);
   const old=prior?JSON.parse(prior.manifest_json) as UploadManifest:null;
   if(old&&JSON.stringify(old.reviewIds)!==JSON.stringify(reviewIds))throw new RepositoryError('UPLOAD_REVIEW_CHANGED');
   const adapter=createVerifiedDocumentUploadAdapter(process.env.BITRIX_WEBHOOK??'',dealId,record.client_iin);
   const baseline=old?.baseline??(await adapter.read(dealId)).refs;
   const reused=old?old.reused:await manifests.reusableFiles(record,batch,baseline);
   row=await uploadStoredDocuments(repository,manifests,adapter,record,batchId,baseline,batch,actor,{planHash:plan.planHash,rootRequestId:requestId,batchIndex,reviewIds,reused});
  }
  if(prior&&(prior.state==='writing'||prior.state==='uncertain')){
   const manifest=JSON.parse(prior.manifest_json) as UploadManifest;
   const adapter=createVerifiedDocumentUploadAdapter(process.env.BITRIX_WEBHOOK??'',dealId,record.client_iin);
   try{const receipt=await adapter.reconcile(dealId,record.client_iin,manifest.baseline,manifest.files,manifest.reused);row=await manifests.finish(record.id,batchId,receipt,'UPLOAD_READBACK_VERIFIED');}
   catch(error){row=await manifests.finish(record.id,batchId,null,error instanceof DocumentUploadError?error.code:'UPLOAD_OUTCOME_UNCERTAIN');}
  }
  if(!row)throw new RepositoryError('UPLOAD_MANIFEST_NOT_FOUND',404);
  if(row.state!=='verified')console.warn('assessment-document-upload',JSON.stringify({state:row.state,outcomeCode:row.outcome_code,batchIndex}));
  return Response.json({requestId,batchId,batchIndex,batchCount:plan.batches.length,state:row.state,outcomeCode:row.outcome_code,receipt:row.receipt_json?JSON.parse(row.receipt_json):null,nextBatch:row.state==='verified'?batchIndex+1:batchIndex,documentsUploaded:row.state==='verified'&&batchIndex===plan.batches.length-1,credentialsUploaded:false},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error instanceof DocumentUploadError?new RepositoryError(error.code):error);}
}
