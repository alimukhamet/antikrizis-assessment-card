import { bitrixHeaders } from './http-headers';
import {
  PROFILE_FIELDS, ZVI_DATE_FIELD, PROCEDURE_FIELD, LEGACY_CARD_FIELD, IIN_FIELD,
  type ProfileField, type ProfileValues, type ProfileBaseline,
} from './profile-fields';

export class ProfileWriteError extends Error {
  constructor(public code: string, public fields: ProfileField[] = [], public notStarted = false) { super(code); }
}

/** Read-only facts shown to the documentologist next to the questionnaire. */
export type ProfileDealContext = {
  dealId: string; title: string; iin: string | null; stageId: string; zviDate: string;
  procedure: string; legacyCard: string; phone: string; baseline: ProfileBaseline;
};

const keys = Object.keys(PROFILE_FIELDS) as ProfileField[];

function decimal(value: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return whole.replace(/^0+(?=\d)/, '') + (trimmed ? '.' + trimmed : '');
}
function normalize(key: ProfileField, value: unknown): string | null {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\r\n/g, '\n');
  if (key === 'debt') return text.trim() === '' ? '' : decimal(text.trim());
  return text;
}
/** Bitrix may store the debt summary rounded to whole tenge. Accept only that projection. */
function roundedDebt(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  return (BigInt(match[1]) + ((match[2]?.[0] || '0') >= '5' ? BigInt(1) : BigInt(0))).toString();
}
export function profileMismatches(current: ProfileBaseline, expected: ProfileBaseline, allowRoundedDebt = false) {
  return keys.filter(key => {
    const left = normalize(key, current[key]), right = normalize(key, expected[key]);
    if (left === null || right === null) return true;
    if (left === right) return false;
    return !(allowRoundedDebt && key === 'debt' && right && left === roundedDebt(right));
  });
}

export function createProfileAdapter(webhook: string, send: typeof fetch = fetch, operationSignal?: AbortSignal) {
  async function call(method: string, body: unknown) {
    if (!webhook) throw new ProfileWriteError('BITRIX_NOT_CONFIGURED');
    operationSignal?.throwIfAborted();
    const response = await send(webhook.replace(/\/?$/, '/') + method + '.json', {
      method: 'POST', headers: bitrixHeaders(webhook), body: JSON.stringify(body), redirect: 'manual', cache: 'no-store',
      signal: operationSignal ? AbortSignal.any([operationSignal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new ProfileWriteError('BITRIX_REQUEST_FAILED');
    const json = await response.json() as { error?: string; result?: unknown };
    if (json.error || json.result === undefined) throw new ProfileWriteError('BITRIX_REQUEST_FAILED');
    return json.result;
  }
  async function deal(dealId: string) {
    if (!/^[1-9]\d*$/.test(dealId)) throw new ProfileWriteError('INVALID_DEAL_ID');
    const result = await call('crm.deal.get', { id: dealId }) as Record<string, unknown>;
    if (!result || String(result.ID) !== dealId) throw new ProfileWriteError('DEAL_NOT_FOUND');
    return result;
  }
  const baselineOf = (row: Record<string, unknown>) =>
    Object.fromEntries(keys.map(key => [key, row[PROFILE_FIELDS[key]] ?? null])) as ProfileBaseline;
  const text = (value: unknown) => Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' || typeof value === 'number' ? String(value) : '';

  async function read(dealId: string) { return baselineOf(await deal(dealId)); }

  async function context(dealId: string): Promise<ProfileDealContext> {
    const row = await deal(dealId);
    let phone = '';
    const contactId = text(row.CONTACT_ID);
    if (/^[1-9]\d*$/.test(contactId)) {
      try {
        const contact = await call('crm.contact.get', { id: contactId }) as { PHONE?: Array<{ VALUE?: string }> };
        phone = (contact.PHONE || []).map(p => String(p.VALUE || '').trim()).filter(Boolean).join(', ');
      } catch { /* The phone is a convenience prefill; the worker can type it. */ }
    }
    const rawIin = text(row[IIN_FIELD]).trim();
    return {
      dealId, title: text(row.TITLE), iin: /^\d{12}$/.test(rawIin) ? rawIin : null, stageId: text(row.STAGE_ID),
      zviDate: text(row[ZVI_DATE_FIELD]), procedure: text(row[PROCEDURE_FIELD]), legacyCard: text(row[LEGACY_CARD_FIELD]),
      phone, baseline: baselineOf(row),
    };
  }

  /** Once-only write with preflight conflict detection and readback. Mirrors the assessment adapter. */
  async function save(dealId: string, expectedIin: string, baseline: ProfileBaseline, values: ProfileValues) {
    const alreadyApplied = await (async () => {
      if (!/^\d{12}$/.test(expectedIin)) throw new ProfileWriteError('CLIENT_IDENTITY_UNVERIFIED');
      if (keys.some(key => typeof values[key] !== 'string' || normalize(key, values[key]) === null)) throw new ProfileWriteError('INVALID_PROFILE_VALUES');
      const row = await deal(dealId);
      if (row[IIN_FIELD] !== expectedIin) throw new ProfileWriteError('CASE_IDENTITY_CHANGED');
      const before = baselineOf(row);
      if (!profileMismatches(before, values, true).length) return true;
      const conflicts = profileMismatches(before, baseline);
      if (conflicts.length) throw new ProfileWriteError('PROFILE_CHANGED_IN_CRM', conflicts);
      return false;
    })().catch(error => {
      throw new ProfileWriteError(
        error instanceof ProfileWriteError ? error.code : 'PROFILE_PREFLIGHT_FAILED',
        error instanceof ProfileWriteError ? error.fields : [], true);
    });
    if (alreadyApplied) return { verified: true as const, alreadyApplied: true };
    const fields = Object.fromEntries(keys.map(key => [PROFILE_FIELDS[key], values[key]]));
    if (operationSignal?.aborted) throw new ProfileWriteError('PROFILE_PREFLIGHT_FAILED', [], true);
    try { await call('crm.deal.update', { id: dealId, fields }); }
    catch { /* A lost response may still mean the write applied. Read back first. */ }
    let after: ProfileBaseline;
    try { after = await read(dealId); }
    catch { throw new ProfileWriteError('PROFILE_SAVE_UNCERTAIN'); }
    const mismatches = profileMismatches(after, values, true);
    if (mismatches.length) throw new ProfileWriteError('PROFILE_READBACK_MISMATCH', mismatches);
    return { verified: true as const, alreadyApplied: false };
  }

  /** Readback only. `untouched` = the deal still holds exactly the pre-save baseline, so the write never applied. */
  async function reconcile(dealId: string, expectedIin: string, values: ProfileValues, baseline: ProfileBaseline) {
    const row = await deal(dealId);
    if (row[IIN_FIELD] !== expectedIin) throw new ProfileWriteError('CASE_IDENTITY_CHANGED');
    const current = baselineOf(row), mismatches = profileMismatches(current, values, true);
    return { verified: mismatches.length === 0, mismatches, untouched: mismatches.length > 0 && profileMismatches(current, baseline).length === 0 };
  }

  return { read, context, save, reconcile };
}
