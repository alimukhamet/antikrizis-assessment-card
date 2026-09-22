import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import type {EvidenceRepository} from '../../../../../lib/documents/repository';
import {assertSubmissionDestination} from '../../../../../lib/questionnaire/submission-destination';
import {SubmissionRepository,type SubmissionRow} from '../../../../../lib/questionnaire/submission-repository';
import {prepareFinalSubmission,commitFinalSubmission,reconcileFinalSubmission,cancelFinalPreparation,savedContract} from '../../../../../lib/questionnaire/final-submission';
import {saveSubmissionHistory} from '../../../../../lib/questionnaire/submission-history';
import {completeContractOperation} from '../../../../../lib/questionnaire/contract-operation';
import {createAssessmentHistoryAdapter} from '../../../../../lib/crm/assessment-history';
import {createAssessmentAdapter,AssessmentWriteError} from '../../../../../lib/crm/assessment-write';
import {syncAssessmentIntake,type AssessmentIntakeSyncResult} from '../../../../../lib/crm/assessment-intake-sync';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,256000);
  if(typeof body.requestId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.requestId)||!['prepare','complete','commit','reconcile','cancel','history','contract','sync-intake'].includes(String(body.action)))throw new RepositoryError('INVALID_SUBMISSION_REQUEST',400);
  const {dealId}=await context.params,{record,repository,actor}=await evidenceContext(request,dealId);
  const {env}=await import('cloudflare:workers');
  const runtime=env as typeof env & {DB?:D1Database};
  if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  if(['prepare','complete','commit','history'].includes(String(body.action)))assertSubmissionDestination(record,body.destination);
  const submissions=new SubmissionRepository(runtime.DB),adapter=createAssessmentAdapter(process.env.BITRIX_WEBHOOK??'');
  if(body.action==='contract')return Response.json({contract:await savedContract(submissions,record,actor,body.requestId)},{headers:{'cache-control':'no-store'}});
  if(body.action==='sync-intake'){
   const row=await submissions.get(record.id,body.requestId);
   if(!row||row.actor_id!==actor.id)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
   if(row.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED',409);
   if(row.state!=='verified'||row.history_state!=='verified')throw new RepositoryError('ASSESSMENT_NOT_READY',409);
   const assessmentIntakeSync=await boundedVerifiedAssessmentIntakeSync(repository,dealId,row);
   return Response.json(present(row,assessmentIntakeSync),{headers:{'cache-control':'no-store'}});
  }
  if(body.action==='complete'){
   const signal=AbortSignal.timeout(90_000);
   const result=await completeContractOperation({repository,submissions,record,actor,requestId:body.requestId,day:operatingDay(),signal,
    adapter:createAssessmentAdapter(process.env.BITRIX_WEBHOOK??'',fetch,signal),
    historyAdapter:createAssessmentHistoryAdapter(process.env.BITRIX_WEBHOOK??'',fetch,signal),
    currentRecord:async()=>{
     const fresh=await evidenceContext(request,dealId);
     if(fresh.actor.id!==actor.id)throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
     assertSubmissionDestination(fresh.record,body.destination);
     return fresh.record;
    },
   }).catch(error=>{if(signal.aborted)throw new RepositoryError('CONTRACT_OPERATION_TIMEOUT',503);throw error;});
   const assessmentIntakeSync=result.contract?await boundedVerifiedAssessmentIntakeSync(repository,dealId,result.row):undefined;
   return Response.json({...present(result.row,assessmentIntakeSync),contract:result.contract,message:result.message},{headers:{'cache-control':'no-store'}});
  }
  let row:SubmissionRow|null;
  if(body.action==='prepare'){
   if(!Number.isInteger(body.identityRevision))throw new RepositoryError('INVALID_SUBMISSION_REQUEST',400);
   row=await prepareFinalSubmission(repository,submissions,adapter,record,actor,body.requestId,body.identityRevision as number,body.payload,body.bindings,operatingDay());
  }else if(body.action==='reconcile')row=await reconcileFinalSubmission(submissions,adapter,record,actor,body.requestId);
  else if(body.action==='cancel')row=await cancelFinalPreparation(submissions,record,actor,body.requestId);
  else if(body.action==='history')row=await saveSubmissionHistory(submissions,createAssessmentHistoryAdapter(process.env.BITRIX_WEBHOOK??''),record,actor,body.requestId);
  else row=await commitFinalSubmission(repository,submissions,adapter,record,actor,body.requestId,operatingDay());
  if(!row)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
  const assessmentIntakeSync=row.state==='verified'?await boundedVerifiedAssessmentIntakeSync(repository,dealId,row):undefined;
  return Response.json(present(row,assessmentIntakeSync),{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error instanceof AssessmentWriteError?new RepositoryError(error.code):error);}
}

async function verifiedAssessmentIntakeSync(repository:EvidenceRepository,dealId:string,row:SubmissionRow):Promise<AssessmentIntakeSyncResult>{
 const secret=process.env.ASSESSMENT_INTAKE_HMAC_SECRET,crmOrigin=process.env.CRM_ASSESSMENT_INTAKE_ORIGIN,sourceOrigin=process.env.ASSESSMENT_INTAKE_SOURCE_ORIGIN;
 if(!secret||!crmOrigin||!sourceOrigin)return {status:'disabled',reason:'assessment_intake_sync_not_configured'};
 try{return await syncAssessmentIntake({dealId,repository,sourceSubmissionId:row.id,secret,crmOrigin,sourceOrigin});}
 catch{return {status:'pending',reason:'assessment_intake_sync_retryable',sourceSubmissionId:row.id};}
}

const ASSESSMENT_INTAKE_SYNC_TIMEOUT_MS=5_000;
async function boundedVerifiedAssessmentIntakeSync(repository:EvidenceRepository,dealId:string,row:SubmissionRow):Promise<AssessmentIntakeSyncResult>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<AssessmentIntakeSyncResult>(resolve=>{timer=setTimeout(()=>resolve({status:'pending',reason:'assessment_intake_sync_timeout',sourceSubmissionId:row.id}),ASSESSMENT_INTAKE_SYNC_TIMEOUT_MS);});
 try{return await Promise.race([verifiedAssessmentIntakeSync(repository,dealId,row),timeout]);}
 finally{if(timer!==undefined)clearTimeout(timer);}
}

function present(row:SubmissionRow,assessmentIntakeSync?:AssessmentIntakeSyncResult){
 const payload=JSON.parse(row.payload_json);
 return {requestId:row.request_id,state:row.state,assessmentSaved:row.state==='verified',outcomeCode:row.outcome_code,historySaved:row.history_state==='verified',historyState:row.history_state,historyOutcomeCode:row.history_outcome_code,reviewText:payload.values?.card||'',clientName:payload.values?.fio||'',contractNumber:payload.values?.dognum||'',completed:false,remainingSteps:[...(row.history_state==='verified'?[]:['timeline-history']),'final-contract-download','separate-document-upload'],...(assessmentIntakeSync?{assessmentIntakeSync}:{})};
}
export async function GET(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const {dealId}=await context.params,{record,actor}=await evidenceContext(request,dealId);
  const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  const row=await new SubmissionRepository(runtime.DB).latest(record.id,actor.id);
  return Response.json({submission:row?present(row):null},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
