import {RepositoryError, type EvidenceRepository, type CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import type {createAssessmentAdapter} from '../crm/assessment-write';
import type {createAssessmentHistoryAdapter} from '../crm/assessment-history';
import {CONTRACT_RENDERER_VERSION} from '../../public/contract-words.mjs';
import {finalCheck} from './final-check';
import {prepareFinalSubmission, commitFinalSubmission, reconcileFinalSubmission} from './final-submission';
import {saveSubmissionHistory} from './submission-history';
import type {SubmissionRepository} from './submission-repository';

/** File generation is read-only and always validates the CURRENT answers and evidence.
 * It is deliberately not a receipt that anything was saved or signed in the CRM. */
export async function generateCurrentContract(
 repository: EvidenceRepository, record: CaseRow, identityRevision: number,
 raw: unknown, bindings: unknown, day: string,
) {
 if (identityRevision !== record.identity_revision) throw new RepositoryError('CASE_IDENTITY_CHANGED');
 const checked = await finalCheck(repository, record, raw, bindings, day);
 if (!checked.publicResult.readyToSubmit) throw new RepositoryError('ASSESSMENT_NOT_READY');
 const data = checked.publicResult.preview?.contractData;
 if (!data) throw new RepositoryError('CONTRACT_SNAPSHOT_UNAVAILABLE');
 return {data, rendererVersion: CONTRACT_RENDERER_VERSION};
}

type CompletionInput = {
 requestId: string; identityRevision?: number; payload?: unknown; bindings?: unknown;
};

/** One server-owned start/resume operation. A retry resumes its durable receipt.
 * No background promise, lease reset, or blind replay of uncertain external writes. */
export async function completeContractSave(
 repository: EvidenceRepository, submissions: SubmissionRepository,
 adapter: ReturnType<typeof createAssessmentAdapter>, history: ReturnType<typeof createAssessmentHistoryAdapter>,
 record: CaseRow, actor: Actor, input: CompletionInput, day: string,
) {
 let row = Object.hasOwn(input, 'payload')
  ? await prepareFinalSubmission(repository, submissions, adapter, record, actor,
    input.requestId, input.identityRevision as number, input.payload, input.bindings, day)
  : await submissions.get(record.id, input.requestId);
 if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
 if (row.actor_id !== actor.id || row.identity_revision !== record.identity_revision) {
  throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
 }
 if (row.state === 'prepared') {
  row = await commitFinalSubmission(repository, submissions, adapter, record, actor, row.request_id, day);
 }
 if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
 if (row.state === 'writing' || row.state === 'uncertain') {
  // One bounded readback per invocation. Re-clicking may check again, never re-send.
  row = await reconcileFinalSubmission(submissions, adapter, record, actor, row.request_id);
 }
 if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
 if (row.state === 'verified' && row.history_state !== 'verified') {
  row = await saveSubmissionHistory(submissions, history, record, actor, row.request_id);
 }
 if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
 return row;
}
