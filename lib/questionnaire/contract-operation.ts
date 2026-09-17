import {RepositoryError, type CaseRow, type EvidenceRepository} from '../documents/repository';
import type {Actor} from '../worker-session';
import type {createAssessmentAdapter} from '../crm/assessment-write';
import type {createAssessmentHistoryAdapter} from '../crm/assessment-history';
import {SubmissionRepository, type SubmissionRow} from './submission-repository';
import {commitFinalSubmission, reconcileFinalSubmission, savedContract} from './final-submission';
import {saveSubmissionHistory} from './submission-history';

type Operation = {
  repository: EvidenceRepository;
  submissions: SubmissionRepository;
  adapter: ReturnType<typeof createAssessmentAdapter>;
  historyAdapter: ReturnType<typeof createAssessmentHistoryAdapter>;
  record: CaseRow;
  actor: Actor;
  requestId: string;
  day: string;
  /** Reauthorize and refresh the destination between stages, as separate requests did. */
  currentRecord: () => Promise<CaseRow>;
  signal?: AbortSignal;
};

/** One server-owned continuation of an already frozen, reviewed snapshot.
 * A continuation attempts each write at most once. Only reconciliation is repeated.
 * Existing durable claims serialize concurrent callers and survive a lost response.
 */
export async function completeContractOperation(operation: Operation) {
  const {repository, submissions, adapter, historyAdapter, record, actor, requestId, day, signal} = operation;
  async function current() {
    signal?.throwIfAborted();
    const fresh = await operation.currentRecord();
    if (fresh.id !== record.id || fresh.external_id !== record.external_id ||
        fresh.identity_revision !== record.identity_revision || fresh.client_iin !== record.client_iin) {
      throw new RepositoryError('SUBMISSION_DESTINATION_CHANGED');
    }
    signal?.throwIfAborted();
    return fresh;
  }
  let row = await submissions.get(record.id, requestId);
  if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  if (row.actor_id !== actor.id || row.identity_revision !== record.identity_revision) {
    throw new RepositoryError('SUBMISSION_ACTOR_OR_IDENTITY_CHANGED');
  }
  if (row.state === 'prepared') {
    row = await commitFinalSubmission(repository, submissions, adapter, await current(), actor, requestId, day);
  }
  if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  // An old/lost write must never be converted into another commit. Three bounded
  // reads handle a briefly stale Bitrix readback without a browser retry loop.
  for (let check = 0; check < 3 && ['writing', 'uncertain'].includes(row.state); check++) {
    if (check) await new Promise<void>(resolve => setTimeout(resolve, check * 500));
    row = await reconcileFinalSubmission(submissions, adapter, await current(), actor, requestId);
    if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
  }
  if (row.state !== 'verified') return {row, contract: null, message: pendingMessage(row)};

  if (row.history_state !== 'verified') {
    row = await saveSubmissionHistory(submissions, historyAdapter, await current(), actor, requestId);
    if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
    // Re-enter only uncertain/writing history: its service performs reads, not adds.
    if (['writing', 'uncertain'].includes(row.history_state)) {
      row = await saveSubmissionHistory(submissions, historyAdapter, await current(), actor, requestId);
      if (!row) throw new RepositoryError('SUBMISSION_NOT_FOUND', 404);
    }
  }
  if (row.history_state !== 'verified') return {row, contract: null, message: pendingMessage(row)};
  const contract = await savedContract(submissions, await current(), actor, requestId);
  return {row, contract, message: 'Карточка и история сохранены. Договор готов к скачиванию.'};
}

function pendingMessage(row: SubmissionRow): string {
  if (row.state === 'cancelled') return 'Эта подготовка отменена. Нажмите «Скачать договор» для текущей версии ответов.';
  const code = row.state === 'verified' ? row.history_outcome_code : row.outcome_code;
  const reason = String(code || '').replace(/^NOT_SENT:/, '');
  if (reason === 'ASSESSMENT_CHANGED_IN_CRM') return 'Карточка изменилась в Bitrix. Ничего не отправлено. Сверьте изменения в сделке перед новой подготовкой договора.';
  if (['CASE_IDENTITY_CHANGED', 'CLIENT_IDENTITY_UNVERIFIED'].includes(reason)) return 'Клиент сделки изменился. Откройте правильную сделку и проверьте получателя.';
  if (reason === 'BITRIX_NOT_CONFIGURED') return 'Подключение к Bitrix не настроено. Ничего не отправлено. Обратитесь к администратору.';
  if (['HISTORY_CONTENT_MISMATCH', 'HISTORY_DUPLICATE_REFERENCE'].includes(reason)) return 'В истории Bitrix есть конфликт сохранённой записи. Новая запись не отправлена. Нужна проверка администратором.';
  if (row.state === 'prepared') return 'Карточка ещё не отправлялась: проверка Bitrix не завершилась. Нажмите «Скачать договор» ещё раз. Ответы сохранены.';
  if (row.state !== 'verified') return 'Bitrix пока не подтвердил карточку. Нажмите «Скачать договор» ещё раз без изменения ответов: система проверит результат, не отправляя карточку повторно.';
  if (row.history_state === 'pending') return 'Карточка сохранена. Запись в историю ещё не отправлялась. Нажмите «Скачать договор» ещё раз, чтобы продолжить.';
  return 'Карточка сохранена. Bitrix пока не подтвердил запись в истории. Нажмите «Скачать договор» ещё раз: система проверит существующую запись без повторной отправки.';
}
