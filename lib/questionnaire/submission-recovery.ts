import {RepositoryError, type CaseRow, type EvidenceRepository} from '../documents/repository';
import {WORKERS, type Actor, type WorkerId} from '../worker-session';
import {validateDraft} from './draft';
import type {DraftRow} from './repository';
import type {SubmissionRow, SubmissionPayload} from './submission-repository';

/** Owner continuation of an existing employee intent, never a replacement
 * snapshot. The recovery caller is audited separately; original authorship stays.
 */
export async function authorizeSubmissionRecovery(input:{actor:Actor;record:CaseRow;row:SubmissionRow|null;expectedHash:unknown;latestDraft:DraftRow|null;repository:Pick<EvidenceRepository,'credentialStatus'>}){
 const {actor,record,row,expectedHash,latestDraft,repository}=input;
 if(actor.worker!=='ali')throw new RepositoryError('OWNER_REQUIRED',403);
 if(!row||row.case_id!==record.id)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
 if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash)||row.payload_hash!==expectedHash)throw new RepositoryError('RECOVERY_SNAPSHOT_CHANGED');
 if(row.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(row.state==='cancelled')throw new RepositoryError('SUBMISSION_CANCELLED');
 if(row.state==='prepared'){
  if(!latestDraft||latestDraft.identity_revision!==record.identity_revision)throw new RepositoryError('RECOVERY_DRAFT_CHANGED');
  const saved=JSON.parse(row.payload_json) as SubmissionPayload;
  const credentials=await repository.credentialStatus(record);
  const canonical=(raw:unknown)=>{
   const draft=validateDraft(raw);
   // Older drafts kept the key filename after its separate verified upload.
   // Ordinary pending files and every answer/document remain part of the check.
   if(credentials?.verified&&credentials.passwordStored)draft.pendingFiles=draft.pendingFiles.filter(name=>!/\.(p12|pfx|key|jks)$/i.test(name));
   return JSON.stringify(draft,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
  };
  if(canonical(JSON.parse(latestDraft.payload_json))!==canonical(saved.draft))throw new RepositoryError('RECOVERY_DRAFT_CHANGED');
 }
 const worker=row.actor_id.replace(/^worker:/,'') as WorkerId;
 if(!Object.prototype.hasOwnProperty.call(WORKERS,worker)||row.actor_id!=='worker:'+worker||row.authentication!=='shared-password-worker-selection')throw new RepositoryError('RECOVERY_AUTHOR_UNAVAILABLE');
 return {id:row.actor_id,worker,displayName:WORKERS[worker],authentication:row.authentication} as Actor;
}
