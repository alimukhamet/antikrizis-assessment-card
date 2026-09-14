import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import {assertSubmissionDestination} from '../../../../../lib/questionnaire/submission-destination';
import {SubmissionRepository,type SubmissionRow} from '../../../../../lib/questionnaire/submission-repository';
import {prepareFinalSubmission,commitFinalSubmission,reconcileFinalSubmission,cancelFinalPreparation,savedContract} from '../../../../../lib/questionnaire/final-submission';
import {saveSubmissionHistory} from '../../../../../lib/questionnaire/submission-history';
import {createAssessmentHistoryAdapter} from '../../../../../lib/crm/assessment-history';
import {createAssessmentAdapter,AssessmentWriteError} from '../../../../../lib/crm/assessment-write';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,256000);
  if(typeof body.requestId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.requestId)||!['prepare','commit','reconcile','cancel','history','contract'].includes(String(body.action)))throw new RepositoryError('INVALID_SUBMISSION_REQUEST',400);
  const {dealId}=await context.params,{record,repository,actor}=await evidenceContext(request,dealId);
  const {env}=await import('cloudflare:workers');
  const runtime=env as typeof env & {DB?:D1Database};
  if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  if(['prepare','commit','history'].includes(String(body.action)))assertSubmissionDestination(record,body.destination);
  const submissions=new SubmissionRepository(runtime.DB),adapter=createAssessmentAdapter(process.env.BITRIX_WEBHOOK??'');
  if(body.action==='contract')return Response.json({contract:await savedContract(submissions,record,actor,body.requestId)},{headers:{'cache-control':'no-store'}});
  let row:SubmissionRow|null;
  if(body.action==='prepare'){
   if(!Number.isInteger(body.identityRevision))throw new RepositoryError('INVALID_SUBMISSION_REQUEST',400);
   row=await prepareFinalSubmission(repository,submissions,adapter,record,actor,body.requestId,body.identityRevision as number,body.payload,body.bindings,operatingDay());
  }else if(body.action==='reconcile')row=await reconcileFinalSubmission(submissions,adapter,record,actor,body.requestId);
  else if(body.action==='cancel')row=await cancelFinalPreparation(submissions,record,actor,body.requestId);
  else if(body.action==='history')row=await saveSubmissionHistory(submissions,createAssessmentHistoryAdapter(process.env.BITRIX_WEBHOOK??''),record,actor,body.requestId);
  else row=await commitFinalSubmission(repository,submissions,adapter,record,actor,body.requestId,operatingDay());
  if(!row)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
  return Response.json(present(row),{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error instanceof AssessmentWriteError?new RepositoryError(error.code):error);}
}

function present(row:SubmissionRow){
 const payload=JSON.parse(row.payload_json);
 return {requestId:row.request_id,state:row.state,assessmentSaved:row.state==='verified',outcomeCode:row.outcome_code,historySaved:row.history_state==='verified',historyState:row.history_state,historyOutcomeCode:row.history_outcome_code,reviewText:payload.values?.card||'',clientName:payload.values?.fio||'',contractNumber:payload.values?.dognum||'',completed:false,remainingSteps:[...(row.history_state==='verified'?[]:['timeline-history']),'final-contract-download','separate-document-upload']};
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
