import { requireStaffRequest } from '../../../staff-access';
import { boundedJson, evidenceContext, evidenceError, operatingDay } from '../../../../../lib/documents/request-context';
import { RepositoryError } from '../../../../../lib/documents/repository';
import { createProfileAdapter, ProfileWriteError } from '../../../../../lib/crm/profile-write';
import { createAssessmentHistoryAdapter } from '../../../../../lib/crm/assessment-history';
import { compileProfile } from '../../../../../lib/questionnaire/compile-profile';
import { validateDraft } from '../../../../../lib/questionnaire/draft';
import { checkAnswers } from '../../../../../lib/questionnaire/check-answers';
import { ProfileSaveRepository, type ProfileSavePayload, type ProfileSaveRow } from '../../../../../lib/questionnaire/profile-save-repository';
import type { ProfileBaseline } from '../../../../../lib/crm/profile-fields';

const headers = { 'cache-control': 'no-store' };
const requestPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof ProfileWriteError) {
    const status = error.code === 'BITRIX_NOT_CONFIGURED' ? 503
      : ['PROFILE_CHANGED_IN_CRM', 'CASE_IDENTITY_CHANGED', 'CLIENT_IDENTITY_UNVERIFIED'].includes(error.code) ? 409 : 502;
    return Response.json({ error: error.code, fields: error.fields }, { status, headers });
  }
  return evidenceError(error);
}
async function storage() {
  const { env } = await import('cloudflare:workers');
  const runtime = env as typeof env & { DB?: D1Database };
  if (!runtime.DB) throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED', 503);
  return new ProfileSaveRepository(runtime.DB);
}
function present(row: ProfileSaveRow, history?: { ok: boolean }) {
  const payload = JSON.parse(row.payload_json) as ProfileSavePayload;
  return { requestId: row.request_id, state: row.state, outcome: row.outcome_code, savedAt: row.updated_at,
    unresolvedCount: payload.unresolvedCount, historyCommentId: row.history_comment_id, ...(history ? { historySaved: history.ok } : {}) };
}
const asText = (value: unknown) => value === null || value === undefined || value === false ? '' : String(value);

/** Prefill for the documentologist: Bitrix facts, the legacy card and any previous profile save. */
export async function GET(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  try {
    const { dealId } = await ctx.params, { record } = await evidenceContext(request, dealId);
    const deal = await createProfileAdapter(process.env.BITRIX_WEBHOOK ?? '').context(dealId);
    const repo = await storage(), [active, verified] = await Promise.all([repo.active(record.id), repo.latestVerified(record.id)]);
    // The timeline comment is the only full profile copy in Bitrix: retry it when an earlier save could not add it.
    const latest = verified && !verified.history_comment_id && record.client_iin ? (await appendHistory(dealId, record.client_iin, verified, repo, record)).row : verified;
    return Response.json({
      dealId, title: deal.title, iin: deal.iin, zviDate: deal.zviDate, procedure: deal.procedure, phone: deal.phone,
      legacyCard: deal.legacyCard,
      current: { fio: asText(deal.baseline.fio), marital: asText(deal.baseline.marital) },
      active: active ? present(active) : null, latest: latest ? present(latest) : null,
    }, { headers });
  } catch (error) { return failure(error); }
}

async function appendHistory(dealId: string, iin: string, row: ProfileSaveRow, repo: ProfileSaveRepository, record: Parameters<ProfileSaveRepository['history']>[0]) {
  if (row.history_comment_id) return { ok: true, row };
  const payload = JSON.parse(row.payload_json) as ProfileSavePayload, before = payload.baseline;
  const text = [payload.values.profileCard, '', 'ЗНАЧЕНИЯ СДЕЛКИ ДО СОХРАНЕНИЯ ПРОФИЛЯ',
    `• ФИО: ${asText(before.fio) || '—'}`, `• Семейное положение: ${asText(before.marital) || '—'}`,
    `• Общий долг: ${asText(before.debt) || '—'}`].join('\n');
  try {
    const saved = await createAssessmentHistoryAdapter(process.env.BITRIX_WEBHOOK ?? '').append(dealId, iin, row.request_id, text);
    return { ok: true, row: await repo.history(record, row, saved.commentId) };
  } catch { return { ok: false, row }; }
}

/** One profile save = one guarded Bitrix write + a timeline comment with the previous values. */
export async function POST(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  try {
    const body = await boundedJson(request, 256000);
    if (typeof body.requestId !== 'string' || !requestPattern.test(body.requestId) || !['check', 'save', 'reconcile'].includes(String(body.action)))
      throw new RepositoryError('INVALID_PROFILE_REQUEST', 400);
    const { dealId } = await ctx.params, { record, client, actor } = await evidenceContext(request, dealId);
    if (!client.iin || client.iin !== record.client_iin) throw new RepositoryError('DEAL_IDENTITY_UNVERIFIED', 409);
    if (body.action === 'check') {
      const checked = checkAnswers(validateDraft(body.draft), client.iin, operatingDay(), { profile: true });
      return Response.json({ ready: checked.answersComplete, issues: checked.issues, unresolved: checked.unresolved.map(a => ({ key: a.key, label: a.label, group: a.group, row: a.row })) }, { headers });
    }
    const repo = await storage(), adapter = createProfileAdapter(process.env.BITRIX_WEBHOOK ?? '');
    const prior = await repo.get(record.id, body.requestId);

    if (body.action === 'reconcile' || (prior && ['writing', 'uncertain'].includes(prior.state))) {
      if (!prior) throw new RepositoryError('PROFILE_SAVE_NOT_FOUND', 404);
      if (prior.actor_id !== actor.id) throw new RepositoryError('PROFILE_SAVE_OWNED_BY_ANOTHER_WORKER', 409);
      if (!['writing', 'uncertain'].includes(prior.state)) return Response.json(present(prior), { headers });
      const payload = JSON.parse(prior.payload_json) as ProfileSavePayload;
      const result = await adapter.reconcile(dealId, client.iin, payload.values, payload.baseline);
      // Bitrix still holds the exact pre-save values: nothing was written. Release the case so the
      // worker can save again with a fresh preflight; the uncertain request itself is never re-sent.
      if (result.untouched) return Response.json({ ...present(await repo.finish(record, prior, 'failed', 'PROFILE_NOT_APPLIED')), error: 'PROFILE_NOT_APPLIED' }, { headers });
      if (!result.verified) return Response.json({ ...present(await repo.finish(record, prior, 'uncertain', 'PROFILE_READBACK_MISMATCH')), mismatches: result.mismatches }, { headers });
      const verified = await repo.finish(record, prior, 'verified', 'READBACK_RECONCILED');
      const history = await appendHistory(dealId, client.iin, verified, repo, record);
      return Response.json(present(history.row, history), { headers });
    }
    if (prior) return Response.json(present(prior), { headers });

    const active = await repo.active(record.id);
    if (active) return Response.json({ error: 'PROFILE_SAVE_PENDING', pendingRequestId: active.request_id }, { status: 409, headers });
    if (body.identityRevision !== record.identity_revision) throw new RepositoryError('CASE_IDENTITY_CHANGED');

    const draft = validateDraft(body.draft), deal = await adapter.context(dealId);
    if (deal.iin !== client.iin) throw new RepositoryError('CASE_IDENTITY_CHANGED');
    const at = new Date().toISOString();
    const compiled = compileProfile(draft, client.iin, dealId, { name: actor.displayName, at }, operatingDay());
    const baseline: ProfileBaseline = deal.baseline;
    // Never replace a known total with a partial one, or a name with nothing.
    const values = { ...compiled.values,
      debt: compiled.debtComplete ? compiled.values.debt : asText(baseline.debt),
      fio: compiled.values.fio || asText(baseline.fio) };
    const payload: ProfileSavePayload = { schemaVersion: 1, dealId, draft, baseline, values, unresolvedCount: compiled.unresolved.length };
    const row = await repo.begin(record, body.requestId, payload, actor);
    let finished: ProfileSaveRow;
    try {
      await adapter.save(dealId, client.iin, baseline, values);
      finished = await repo.finish(record, row, 'verified', 'READBACK_VERIFIED');
    } catch (error) {
      const writeError = error instanceof ProfileWriteError ? error : new ProfileWriteError('PROFILE_SAVE_UNCERTAIN');
      finished = await repo.finish(record, row, writeError.notStarted ? 'failed' : 'uncertain', writeError.code);
      return Response.json({ ...present(finished), error: writeError.code, fields: writeError.fields }, { status: writeError.notStarted ? 409 : 502, headers });
    }
    const history = await appendHistory(dealId, client.iin, finished, repo, record);
    return Response.json(present(history.row, history), { headers });
  } catch (error) { return failure(error); }
}
