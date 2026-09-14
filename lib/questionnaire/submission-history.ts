import {RepositoryError,type CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import {SubmissionRepository,type SubmissionPayload} from './submission-repository';
import {AssessmentHistoryError,type createAssessmentHistoryAdapter} from '../crm/assessment-history';
/** Card save and timeline save have separate durable receipts. */
export async function saveSubmissionHistory(submissions:SubmissionRepository,adapter:ReturnType<typeof createAssessmentHistoryAdapter>,record:CaseRow,actor:Actor,requestId:string){
 const prior=await submissions.get(record.id,requestId);if(!prior)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
 if(prior.identity_revision!==record.identity_revision||prior.actor_id!==actor.id)throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
 if(prior.state!=='verified')throw new RepositoryError('ASSESSMENT_SAVE_NOT_VERIFIED');
 if(prior.history_state==='verified')return prior;
 const payload=JSON.parse(prior.payload_json) as SubmissionPayload;
 if(!payload.lawyerCard||!record.client_iin)throw new RepositoryError('HISTORY_SNAPSHOT_UNAVAILABLE');
 const pending=prior.history_state==='pending';
 if(pending&&!await submissions.claimHistory(record,requestId))return submissions.get(record.id,requestId);
 let receipt;
 try{
  receipt=await (pending?adapter.append:adapter.reconcile)(record.external_id,record.client_iin,prior.id,payload.lawyerCard);
 }catch(error){return submissions.finishHistory(record.id,requestId,null,error instanceof AssessmentHistoryError?error.code:'HISTORY_OUTCOME_UNCERTAIN');}
 return submissions.finishHistory(record.id,requestId,receipt?.commentId??null,receipt?'HISTORY_READBACK_VERIFIED':'HISTORY_OUTCOME_UNCERTAIN');
}
