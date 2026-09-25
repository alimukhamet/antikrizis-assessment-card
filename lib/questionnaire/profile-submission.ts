import type {CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import {validateDraft} from './draft';
import {checkProfileAnswers, ProfileNotReadyError} from './profile-answers';
import {parseReviewBindings} from './review-bindings';
import {SubmissionRepository, type ProfileSubmissionPayload, type SubmissionRow} from './submission-repository';

/**
 * Prepare a durable profile-only submission.
 *
 * It runs no contract validation, generates no contract or document, touches no
 * EDS material and performs no CRM write. Persistence is atomic and idempotent
 * (request id + content hash); the caller then hands the returned row to the
 * existing signed CRM boundary.
 */
export async function prepareProfileSubmission(
  submissions: SubmissionRepository,
  record: CaseRow,
  actor: Actor,
  requestId: string,
  identityRevision: number,
  raw: unknown,
  rawBindings: unknown,
  day: string,
): Promise<SubmissionRow> {
  if (identityRevision !== record.identity_revision) throw new ProfileNotReadyError([{key: 'identity', label: 'Клиент сделки изменился', code: 'CASE_IDENTITY_CHANGED'}]);
  const draft = validateDraft(raw);
  const bindings = parseReviewBindings(rawBindings);
  const checked = checkProfileAnswers(draft, record.client_iin);
  if (!checked.ready) throw new ProfileNotReadyError(checked.issues);
  const payload: ProfileSubmissionPayload = {
    schemaVersion: 1,
    profileOnly: true,
    draft,
    reviewIds: bindings.map(binding => binding.reviewId).filter((reviewId): reviewId is string => typeof reviewId === 'string' && reviewId.length > 0),
    evidence: [],
    assessmentDay: day,
  };
  return submissions.prepareProfile(record, requestId, payload, actor);
}
