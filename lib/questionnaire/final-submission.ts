import {RepositoryError,type EvidenceRepository,type CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import {finalCheck,FINAL_VALIDATION_VERSION} from './final-check';
import {SubmissionRepository,type SubmissionPayload} from './submission-repository';
import type {createAssessmentAdapter} from '../crm/assessment-write';
import {submitValidatedAssessment} from './submission-service';
import {parseReviewBindings} from './review-bindings';
import {CONTRACT_RENDERER_VERSION} from '../../public/contract-words.mjs';
import {validateDraft} from './draft';
import {historySnapshot} from './history-snapshot';
type Adapter=ReturnType<typeof createAssessmentAdapter>;
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
/** Prepare an immutable server snapshot. No CRM write occurs during preparation. */
export async function prepareFinalSubmission(evidenceRepository:EvidenceRepository,submissions:SubmissionRepository,adapter:Adapter,record:CaseRow,actor:Actor,requestId:string,identityRevision:number,raw:unknown,rawBindings:unknown,day:string){
 if(identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 const draft=validateDraft(raw),bindings=parseReviewBindings(rawBindings),prior=await submissions.get(record.id,requestId);
 if(prior){
  const payload=JSON.parse(prior.payload_json) as SubmissionPayload;
  if(prior.identity_revision!==record.identity_revision||prior.actor_id!==actor.id||!same(payload.draft,draft)||!same(parseReviewBindings(payload.evidence),bindings))throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');
  return prior;
 }
 const checked=await finalCheck(evidenceRepository,record,draft,bindings,day);
 if(!checked.publicResult.readyToSubmit||!checked.compiled)throw new RepositoryError('ASSESSMENT_NOT_READY');
 const baseline=await adapter.read(record.external_id);
 if(baseline.iin!==record.client_iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 const originals=await Promise.all(checked.payload.documents.map(d=>evidenceRepository.document(record.id,d.documentId)));
 const historyCard=historySnapshot(record,actor,checked.compiled.values.card,checked.payload.documents,originals.filter(d=>d!==null),new Date().toISOString());
 const payload:SubmissionPayload={historyCard,schemaVersion:1,draft:checked.payload,baseline,values:checked.compiled.values,contractData:checked.publicResult.preview!.contractData!,contractRendererVersion:CONTRACT_RENDERER_VERSION,lawyerCard:checked.compiled.lawyerCard,reviewIds:checked.reviewIds,evidence:checked.publicResult.evidence.approved,validationVersion:FINAL_VALIDATION_VERSION,assessmentDay:day};
 return submissions.prepare(record,requestId,payload,actor);
}
/** Recheck evidence immediately before claiming the one permitted external write. */
export async function commitFinalSubmission(evidenceRepository:EvidenceRepository,submissions:SubmissionRepository,adapter:Adapter,record:CaseRow,actor:Actor,requestId:string,day:string){
 const prior=await submissions.get(record.id,requestId);if(!prior)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
 if(prior.identity_revision!==record.identity_revision||prior.actor_id!==actor.id)throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
 if(prior.state!=='prepared')return prior;
 const payload=JSON.parse(prior.payload_json) as SubmissionPayload;
 if(payload.validationVersion!==FINAL_VALIDATION_VERSION||payload.contractRendererVersion!==CONTRACT_RENDERER_VERSION)throw new RepositoryError('SUBMISSION_VALIDATION_CHANGED');
 const checked=await finalCheck(evidenceRepository,record,payload.draft,payload.evidence,day);
 if(!checked.publicResult.readyToSubmit||!checked.compiled)throw new RepositoryError('ASSESSMENT_NOT_READY');
 if(!same(checked.publicResult.preview?.contractData,payload.contractData)||checked.compiled.lawyerCard!==payload.lawyerCard||!same(checked.compiled.values,payload.values)||!same(checked.reviewIds,payload.reviewIds)||!same(checked.publicResult.evidence.approved,payload.evidence))throw new RepositoryError('SUBMISSION_EVIDENCE_CHANGED');
 return submitValidatedAssessment(submissions,adapter,record,requestId,payload,actor);
}

/** Resolve an uncertain write from readback only; never resend or recompile the snapshot. */
export async function reconcileFinalSubmission(submissions:SubmissionRepository,adapter:Adapter,record:CaseRow,actor:Actor,requestId:string){
 const prior=await submissions.get(record.id,requestId);if(!prior)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
 if(prior.identity_revision!==record.identity_revision||prior.actor_id!==actor.id)throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
 if(!['writing','uncertain'].includes(prior.state))return prior;
 const payload=JSON.parse(prior.payload_json) as SubmissionPayload;
 if(!record.client_iin)throw new RepositoryError('CLIENT_IDENTITY_UNVERIFIED');
 const result=await adapter.reconcile(record.external_id,record.client_iin,payload.values);
 return submissions.finish(record.id,requestId,result.verified,result.verified?'READBACK_RECONCILED':'ASSESSMENT_READBACK_MISMATCH');
}

/** An unused preparation can be cancelled, even after identity changes; attempted writes cannot. */
export async function cancelFinalPreparation(submissions:SubmissionRepository,record:CaseRow,actor:Actor,requestId:string){
 const prior=await submissions.get(record.id,requestId);if(!prior)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
 if(prior.actor_id!==actor.id)throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
 return submissions.cancelPrepared(record.id,requestId,actor.id);
}

/** Download data comes only from the saved snapshot after both Bitrix receipts are verified. */
export async function savedContract(submissions:SubmissionRepository,record:CaseRow,actor:Actor,requestId:string){
 const row=await submissions.get(record.id,requestId);if(!row)throw new RepositoryError('SUBMISSION_NOT_FOUND',404);
 if(row.identity_revision!==record.identity_revision||row.actor_id!==actor.id)throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
 if(row.state!=='verified'||row.history_state!=='verified')throw new RepositoryError('SUBMISSION_NOT_FINISHED');
 const payload=JSON.parse(row.payload_json) as SubmissionPayload;
 if(!payload.contractData||!/^[a-f0-9]{64}$/.test(payload.contractRendererVersion))throw new RepositoryError('CONTRACT_SNAPSHOT_UNAVAILABLE');
 return {data:payload.contractData,rendererVersion:payload.contractRendererVersion};
}
