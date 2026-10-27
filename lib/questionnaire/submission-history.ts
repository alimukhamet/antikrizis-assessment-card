import {RepositoryError,type CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import {SubmissionRepository,type SubmissionPayload} from './submission-repository';
import {AssessmentHistoryError,type createAssessmentHistoryAdapter} from '../crm/assessment-history';
export const HISTORY_RETRY_AFTER_MS=10*60*1000;
/** Card save and timeline save have separate durable receipts. */
export async function saveSubmissionHistory(submissions:SubmissionRepository,adapter:ReturnType<typeof createAssessmentHistoryAdapter>,record:CaseRow,actor:Actor,requestId:string){
 const prior=await submissions.get(record.id,requestId);if(!prior)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
 if(prior.identity_revision!==record.identity_revision||prior.actor_id!==actor.id)throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
 if(prior.state!=='verified')throw new RepositoryError('ASSESSMENT_SAVE_NOT_VERIFIED');
 if(prior.history_state==='verified')return prior;
 const payload=JSON.parse(prior.payload_json) as SubmissionPayload;
 const text=payload.historyCard||payload.lawyerCard;
 if(!text||!record.client_iin)throw new RepositoryError('HISTORY_SNAPSHOT_UNAVAILABLE');
 const pending=prior.history_state==='pending';
 if(pending&&!await submissions.claimHistory(record,requestId))return submissions.get(record.id,requestId);
 let receipt;
 try{
  receipt=await (pending?adapter.append:adapter.reconcile)(record.external_id,record.client_iin,prior.id,text);
 }catch(error){
  if(pending&&error instanceof AssessmentHistoryError&&error.notStarted)return submissions.releaseHistoryUnsent(record.id,requestId,error.code);
  return submissions.finishHistory(record.id,requestId,null,error instanceof AssessmentHistoryError?error.code:'HISTORY_OUTCOME_UNCERTAIN');
 }
 // A complete read-back that still finds no comment long after the add means the
 // add never landed (e.g. Bitrix rejected it). Allow one new append after a quiet
 // period; append() reads again first, so a late-arriving comment is never doubled.
 // Keep updated_at untouched until then so repeated clicks do not reset the wait.
 if(!pending&&!receipt){
  if(Date.now()-Date.parse(prior.updated_at)>=HISTORY_RETRY_AFTER_MS)return submissions.releaseHistoryUnsent(record.id,requestId,'HISTORY_NOT_FOUND_AFTER_WAIT');
  return prior;
 }
 return submissions.finishHistory(record.id,requestId,receipt?.commentId??null,receipt?'HISTORY_READBACK_VERIFIED':'HISTORY_OUTCOME_UNCERTAIN');
}
