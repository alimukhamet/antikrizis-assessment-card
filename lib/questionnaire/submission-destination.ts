import {RepositoryError,type CaseRow} from '../documents/repository';
/** Every outbound step must still target the client staff explicitly saw. */
export function assertSubmissionDestination(record:CaseRow,value:unknown){
 const target=value as Record<string,unknown>|null;
 if(!target||target.dealId!==record.external_id||target.iin!==record.client_iin||!record.client_iin||target.identityRevision!==record.identity_revision)throw new RepositoryError('SUBMISSION_DESTINATION_CHANGED');
}
