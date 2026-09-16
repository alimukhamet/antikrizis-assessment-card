import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import {HandoffRepository,type HandoffRow} from '../../../../../lib/questionnaire/handoff-repository';
import {validateHandoffDocuments,runHandoff} from '../../../../../lib/questionnaire/handoff-service';
import {UploadManifestRepository} from '../../../../../lib/documents/upload-manifest';
import {createHandoffAdapter} from '../../../../../lib/crm/lawyer-handoff';
import {createCrmDocumentReader,createVerifiedDocumentUploadAdapter} from '../../../../../lib/crm/document-download';
import {assertSubmissionDestination} from '../../../../../lib/questionnaire/submission-destination';
async function store(){const {env}=await import('cloudflare:workers');const db=(env as typeof env&{DB?:D1Database}).DB;if(!db)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);return{handoffs:new HandoffRepository(db),manifests:new UploadManifestRepository(db)};}
function view(row:HandoffRow|null){return row?{requestId:row.request_id,state:row.state,outcomeCode:row.outcome_code,destination:JSON.parse(row.payload_json).destination,updatedAt:row.updated_at}:null;}
export async function GET(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const {dealId}=await context.params,{record}=await evidenceContext(request,dealId),{handoffs}=await store();
  const current=await handoffs.active(record.id);let destination=null,stageError=null;
  if(current&&current.identity_revision!==record.identity_revision)stageError='CASE_IDENTITY_CHANGED';
  else if(!current)try{destination=await createHandoffAdapter(process.env.BITRIX_WEBHOOK??'').discover(dealId,record.client_iin??'');}catch(error){stageError=error instanceof RepositoryError?error.code:'HANDOFF_STAGE_UNVERIFIED';}
  return Response.json({handoff:view(current),destination,stageError},{headers:{'cache-control':'no-store'}});
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
  if(row&&row.request_id!==body.requestId)throw new RepositoryError('HANDOFF_ALREADY_PENDING');
  if(!row){
   if(body.action!=='send'||typeof body.requestId!=='string'||typeof body.powerId!=='string'||typeof body.signedId!=='string'||body.signedConfirmed!==true)throw new RepositoryError('HANDOFF_DOCUMENTS_REQUIRED',400);
   const validated=await validateHandoffDocuments(repository,record,body.powerId,body.signedId,operatingDay()),destination=await stages.discover(dealId,record.client_iin??'');
   if(JSON.stringify(body.stage)!==JSON.stringify(destination))throw new RepositoryError('HANDOFF_STAGE_CHANGED');
   row=await stores.handoffs.prepare(record,body.requestId,{...validated,destination,powerId:body.powerId,signedId:body.signedId,signedConfirmed:true,confirmedAt:new Date().toISOString()},actor);
  }
  if(!['send','resume'].includes(String(body.action)))throw new RepositoryError('INVALID_HANDOFF_ACTION',400);
  const reader=createCrmDocumentReader(webhook,dealId,record.client_iin??'');
  const result=await runHandoff({repository,...stores,stages,upload:createVerifiedDocumentUploadAdapter(webhook,dealId,record.client_iin??''),readFile:reader},record,actor,row,operatingDay());
  return Response.json({handoff:view(result)},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
