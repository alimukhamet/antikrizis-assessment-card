import type {CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import {AssessmentWriteError, type createAssessmentAdapter} from '../crm/assessment-write';
import {SubmissionRepository,type SubmissionPayload} from './submission-repository';

/** Internal entry point after final validation. The durable snapshot owns the operation;
 * the browser's replacement request ID is never used to claim or finish another record. */
export async function submitValidatedAssessment(
 repository:SubmissionRepository, adapter:ReturnType<typeof createAssessmentAdapter>, record:CaseRow,
 requestId:string, payload:SubmissionPayload, actor:Actor,
) {
 const submission=await repository.prepare(record,requestId,payload,actor);
 if(submission.state==='verified')return submission;
 const durableRequestId=submission.request_id;
 // Writing/uncertain work is never repeated on a timer or browser retry.
 if(!await repository.claim(record,durableRequestId))return repository.get(record.id,durableRequestId);
 const saved=JSON.parse(submission.payload_json) as SubmissionPayload;
 try {
  if(!record.client_iin)throw new AssessmentWriteError('CLIENT_IDENTITY_UNVERIFIED',[],true);
  await adapter.save(record.external_id,record.client_iin,saved.baseline,saved.values);
 } catch(error) {
  if(error instanceof AssessmentWriteError&&error.notStarted){
   return repository.releaseUnsent(record.id,durableRequestId,error.code);
  }
  return repository.finish(record.id,durableRequestId,false,error instanceof AssessmentWriteError?error.code:'ASSESSMENT_SAVE_UNCERTAIN');
 }
 // A failed receipt write must not be confused with a failed CRM update. A surviving
 // writing record is recovered through read-only reconciliation, never a second send.
 return repository.finish(record.id,durableRequestId,true,'READBACK_VERIFIED');
}
