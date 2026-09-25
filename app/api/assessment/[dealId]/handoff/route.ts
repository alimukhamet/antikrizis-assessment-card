import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import {HandoffRepository,type HandoffRow} from '../../../../../lib/questionnaire/handoff-repository';
import {validateHandoffDocuments,verifyHandoffDelivery,prepareHandoffTitle,runHandoff} from '../../../../../lib/questionnaire/handoff-service';
import {SubmissionRepository} from '../../../../../lib/questionnaire/submission-repository';
import {createAssessmentAdapter} from '../../../../../lib/crm/assessment-write';
import {UploadManifestRepository} from '../../../../../lib/documents/upload-manifest';
import {createHandoffAdapter,sameHandoffDestination} from '../../../../../lib/crm/lawyer-handoff';
import {createCrmDocumentReader,createVerifiedDocumentUploadAdapter} from '../../../../../lib/crm/document-download';
import {assertSubmissionDestination} from '../../../../../lib/questionnaire/submission-destination';
async function store(){const {env}=await import('cloudflare:workers');const db=(env as typeof env&{DB?:D1Database}).DB;if(!db)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);return{handoffs:new HandoffRepository(db),manifests:new UploadManifestRepository(db),submissions:new SubmissionRepository(db)};}
function view(row:HandoffRow|null){return row?{requestId:row.request_id,state:row.state,outcomeCode:row.outcome_code,destination:JSON.parse(row.payload_json).destination,updatedAt:row.updated_at}:null;}
export async function GET(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const {dealId}=await context.params,{record,repository}=await evidenceContext(request,dealId),stores=await store(),{handoffs}=stores;
  const current=await handoffs.active(record.id);let destination=null,stageError=null;
  if(current&&current.identity_revision!==record.identity_revision)stageError='CASE_IDENTITY_CHANGED';
  else if(!current)try{destination=await createHandoffAdapter(process.env.BITRIX_WEBHOOK??'').discover(dealId,record.client_iin??'');}catch(error){stageError=error instanceof RepositoryError?error.code:'HANDOFF_STAGE_UNVERIFIED';}
  const webhook=process.env.BITRIX_WEBHOOK??'';
  let delivery:{ready:boolean;code?:string;recoveredDraft?:boolean};
  try{const verified=await verifyHandoffDelivery({...stores,repository,assessment:createAssessmentAdapter(webhook),upload:createVerifiedDocumentUploadAdapter(webhook,dealId,record.client_iin??''),readFile:createCrmDocumentReader(webhook,dealId,record.client_iin??'')},record,{verifyBytes:false});delivery={ready:true,...verified};}
  catch(error){delivery={ready:false,code:error instanceof RepositoryError?error.code:'HANDOFF_ASSESSMENT_UNVERIFIED'};}
  if(delivery.code==='HANDOFF_ASSESSMENT_REQUIRED'){
   const {env}=await import('cloudflare:workers');const db=(env as typeof env&{DB?:D1Database}).DB;
   const recovery=db?await db.prepare("SELECT source_hash FROM assessment_draft_recoveries WHERE case_id=? AND identity_revision=? AND state='verified'").bind(record.id,record.identity_revision).first():null;
   if(recovery)delivery.recoveredDraft=true;
  }
  return Response.json({handoff:view(current),destination,stageError,delivery},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,16000),{dealId}=await context.params,{record,repository,actor}=await evidenceContext(request,dealId),stores=await store();
  assertSubmissionDestination(record,body.destination);
  let row=await stores.handoffs.active(record.id);
  if(body.action==='cancel'){
   if(!row||row.request_id!==body.requestId)throw new RepositoryError('HANDOFF_NOT_FOUND',404);
   return Response.json({handoff:view(await stores.handoffs.cancel(record,row,actor))},{headers:{'cache-control':'no-store'}});
  }
  const webhook=process.env.BITRIX_WEBHOOK??'',stages=createHandoffAdapter(webhook);
  const deps={repository,...stores,stages,assessment:createAssessmentAdapter(webhook),upload:createVerifiedDocumentUploadAdapter(webhook,dealId,record.client_iin??''),readFile:createCrmDocumentReader(webhook,dealId,record.client_iin??'')};
  if(row&&row.request_id!==body.requestId)throw new RepositoryError('HANDOFF_ALREADY_PENDING');
  if(!row){
   if(body.action!=='send'||typeof body.requestId!=='string'||typeof body.powerId!=='string'||typeof body.signedId!=='string'||body.signedConfirmed!==true)throw new RepositoryError('HANDOFF_DOCUMENTS_REQUIRED',400);
   const validated=await validateHandoffDocuments(repository,record,body.powerId,body.signedId,operatingDay()),destination=await stages.discover(dealId,record.client_iin??'');
   if(!sameHandoffDestination(body.stage,destination))throw new RepositoryError('HANDOFF_STAGE_CHANGED');
   const naming=await prepareHandoffTitle(deps,record);
   row=await stores.handoffs.prepare(record,body.requestId,{...validated,...naming,destination,powerId:body.powerId,signedId:body.signedId,signedConfirmed:true,confirmedAt:new Date().toISOString()},actor);
  }
  if(!['send','resume'].includes(String(body.action)))throw new RepositoryError('INVALID_HANDOFF_ACTION',400);
  const result=await runHandoff(deps,record,actor,row,operatingDay());
  return Response.json({handoff:view(result)},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
