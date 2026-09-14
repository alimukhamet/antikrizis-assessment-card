import type {CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import {AssessmentWriteError, type createAssessmentAdapter} from '../crm/assessment-write';
import {SubmissionRepository,type SubmissionPayload} from './submission-repository';
/** Internal entry point after final validation; deliberately not a public route. */
export async function submitValidatedAssessment(
 repository:SubmissionRepository, adapter:ReturnType<typeof createAssessmentAdapter>, record:CaseRow,
 requestId:string, payload:SubmissionPayload, actor:Actor,
) {
 const submission=await repository.prepare(record,requestId,payload,actor);
 if(submission.state==='verified')return submission;
 // Writing/uncertain work is never repeated on a timer or browser retry.
 if(!await repository.claim(record,requestId))return repository.get(record.id,requestId);
 try {
  if(!record.client_iin)throw new AssessmentWriteError('CLIENT_IDENTITY_UNVERIFIED');
  await adapter.save(record.external_id,record.client_iin,payload.baseline,payload.values);
 } catch(error) {
  return repository.finish(record.id,requestId,false,error instanceof AssessmentWriteError?error.code:'ASSESSMENT_SAVE_UNCERTAIN');
 }
 // Do not turn an audit-storage failure into an alleged failed CRM write.
 // A surviving 'writing' record then requires explicit reconciliation.
 return repository.finish(record.id,requestId,true,'READBACK_VERIFIED');
}
