import {RepositoryError, type CaseRow, type EvidenceRepository} from '../documents/repository';
import type {Actor} from '../worker-session';
import type {createAssessmentAdapter} from '../crm/assessment-write';
import type {createAssessmentHistoryAdapter} from '../crm/assessment-history';
import type {SubmissionRepository, SubmissionRow} from './submission-repository';
import {prepareFinalSubmission, commitFinalSubmission, reconcileFinalSubmission, savedContract} from './final-submission';
import {saveSubmissionHistory} from './submission-history';

export type CompletionInput = {identityRevision: number; payload: unknown; bindings: unknown};
type Dependencies = {
  repository: EvidenceRepository;
  submissions: SubmissionRepository;
  assessment: ReturnType<typeof createAssessmentAdapter>;
  history: ReturnType<typeof createAssessmentHistoryAdapter>;
};

/** A single owner for the save sequence. This is not a job queue: all work is awaited.
 * A click may attempt each write once. Subsequent attempts in this call are reads.
 * The persisted receipt (not elapsed time) decides whether a later click may send.
 */
export async function completeSubmission(
  deps: Dependencies, record: CaseRow, actor: Actor, requestId: string, day: string,
  input?: CompletionInput, deadlineAt = Date.now() + 80_000,
) {
  const {repository, submissions, assessment, history} = deps;
  async function assertCurrentIdentity() {
    const current = await repository.findCaseByExternal(record.external_system, record.external_id);
    if (!current || current.id !== record.id || current.identity_revision !== record.identity_revision || current.client_iin !== record.client_iin) {
      throw new RepositoryError('CASE_IDENTITY_CHANGED');
    }
  }
  await assertCurrentIdentity();
  let row = input
    ? await prepareFinalSubmission(repository, submissions, assessment, record, actor, requestId,
      input.identityRevision, input.payload, input.bindings, day)
    : await submissions.get(record.id, requestId);
  if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  if (row.case_id !== record.id || row.actor_id !== actor.id || row.identity_revision !== record.identity_revision) {
    throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
  }
  // A reload may have supplied a replacement ID. Only the stored ID is authoritative.
  const durableId = row.request_id;
  if (row.state === 'prepared' && Date.now() < deadlineAt) {
    row = await commitFinalSubmission(repository, submissions, assessment, record, actor, durableId, day);
    if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  }
  // Bounded readback handles eventual consistency. Never loop back into commit.
  for (let attempt = 0; row && ['writing', 'uncertain'].includes(row.state) && attempt < 3 && Date.now() < deadlineAt; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, 400 * attempt));
    if (Date.now() >= deadlineAt) break;
    await assertCurrentIdentity();
    row = await reconcileFinalSubmission(submissions, assessment, record, actor, durableId);
  }
  if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  if (row.state === 'verified' && row.history_state !== 'verified' && Date.now() < deadlineAt) {
    await assertCurrentIdentity();
    row = await saveSubmissionHistory(submissions, history, record, actor, durableId);
    // After an append attempt, only writing/uncertain may be reconciled here.
    // A proven-unsent pending receipt waits for another explicit user click.
    if (row && ['writing', 'uncertain'].includes(row.history_state) && Date.now() < deadlineAt) {
      await assertCurrentIdentity();
      row = await saveSubmissionHistory(submissions, history, record, actor, durableId);
    }
  }
  if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  await assertCurrentIdentity();
  // Observe any concurrently verified result; never manufacture a successful receipt.
  row = await submissions.get(record.id, durableId);
  if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  const workflow = submissionProgress(row);
  const contract = workflow.status === 'ready' ? await savedContract(submissions, record, actor, durableId) : null;
  return {row, workflow, contract};
}

/** All recovery decisions/messages are derived from durable server state. */
export function submissionProgress(row: SubmissionRow) {
  if (row.state === 'cancelled') return {
    status: 'cancelled' as const,
    message: 'Эта подготовка отменена. Нажмите «Скачать договор» для текущей версии ответов.',
  };
  if (row.state === 'verified' && row.history_state === 'verified') return {
    status: 'ready' as const, message: 'Сохранение подтверждено. Договор готов к скачиванию.',
  };
  const cardSaved = row.state === 'verified';
  const reason = String(cardSaved ? row.history_outcome_code : row.outcome_code).replace(/^NOT_SENT:/, '');
  const conflicts: Record<string, string> = {
    ASSESSMENT_CHANGED_IN_CRM: 'Карточка изменилась в Bitrix. Ничего не отправлено. Сверьте изменения в сделке перед новой подготовкой договора.',
    CASE_IDENTITY_CHANGED: 'Клиент сделки изменился. Проверьте получателя договора.',
    CLIENT_IDENTITY_UNVERIFIED: 'Клиент сделки не подтверждён. Проверьте получателя договора.',
    BITRIX_NOT_CONFIGURED: 'Подключение к Bitrix не настроено. Обратитесь к администратору.',
    HISTORY_CONTENT_MISMATCH: 'В истории Bitrix есть конфликт сохранённой записи. Новая запись не отправлена. Нужна проверка администратором.',
    HISTORY_DUPLICATE_REFERENCE: 'В истории Bitrix найдены повторные ссылки на договор. Нужна проверка администратором.',
  };
  if (conflicts[reason]) return {status: 'review' as const, message: conflicts[reason]};
  if (!cardSaved && row.state === 'prepared') return {
    status: 'retry' as const,
    message: 'Карточка ещё не отправлялась: проверка Bitrix не завершилась. Нажмите «Скачать договор» ещё раз. Ответы сохранены.',
  };
  return {
    status: 'retry' as const,
    message: cardSaved
      ? 'Карточка сохранена. Завершение истории ещё не подтверждено. Нажмите «Скачать договор» ещё раз — сервер продолжит ту же операцию.'
      : 'Bitrix пока не подтвердил сохранение карточки. Нажмите «Скачать договор» ещё раз — сервер проверит ту же операцию без повторной отправки.',
  };
}
