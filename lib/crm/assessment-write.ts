import {bitrixHeaders} from './http-headers'; /** Server-only Bitrix adapter. Call only with a validated, persisted submission. */
export const ASSESSMENT_FIELDS = {
  fio: 'UF_CRM_1773669702495', iin: 'UF_CRM_AI_IIN', dognum: 'UF_CRM_AI_DOGNUM',
  marital: 'UF_CRM_AI_MARITAL', procedure: 'UF_CRM_1773655613972', debt: 'UF_CRM_AI_DEBT',
  comment: 'UF_CRM_1782453129677', contractDate: 'UF_CRM_1778499926844',
  months: 'UF_CRM_AI_MONTHS', payDay: 'UF_CRM_AI_PAYDAY', grafType: 'UF_CRM_1781335943568',
  grafText: 'UF_CRM_AI_GRAFTEXT', card: 'UF_CRM_AI_CARD', summa: 'OPPORTUNITY', currency: 'CURRENCY_ID',
} as const;
export type AssessmentField = keyof typeof ASSESSMENT_FIELDS;
export type AssessmentValues = Record<AssessmentField, string>;
export type AssessmentBaseline = Record<AssessmentField, unknown>;
export class AssessmentWriteError extends Error {
  constructor(public code: string, public fields: AssessmentField[] = [], public notStarted = false) { super(code); }
}
const numbers = new Set<AssessmentField>(['debt', 'months', 'payDay', 'summa']);
/** Compare decimal text without floating point rounding or dropping the fraction. */
function decimal(value: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return whole.replace(/^0+(?=\d)/, '') + (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : '');
}
function normalize(key: AssessmentField, value: unknown): string | null {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\r\n/g, '\n');
  if (numbers.has(key)) return text === '' ? '' : decimal(text.trim());
  if (key === 'contractDate') {
    if (!text) return '';
    const iso = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(text);
    const local = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    const day = iso?.[1] || (local ? `${local[3]}-${local[2]}-${local[1]}` : '');
    const date = new Date(day + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : null;
  }
  return text;
}
function changed(a: AssessmentBaseline, b: AssessmentBaseline) {
  return (Object.keys(ASSESSMENT_FIELDS) as AssessmentField[]).filter(key => {
    const left = normalize(key, a[key]), right = normalize(key, b[key]);
    return left === null || right === null || left !== right;
  });
}
export function createAssessmentAdapter(webhook: string, send: typeof fetch = fetch, operationSignal?: AbortSignal) {
  async function call(method: string, body: unknown) {
    if (!webhook) throw new AssessmentWriteError('BITRIX_NOT_CONFIGURED');
    operationSignal?.throwIfAborted();
    const response = await send(webhook.replace(/\/?$/, '/') + method + '.json', {
      method: 'POST', headers: bitrixHeaders(webhook), body: JSON.stringify(body),
      signal: operationSignal ? AbortSignal.any([operationSignal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), cache: 'no-store',
    });
    if (!response.ok) throw new AssessmentWriteError('BITRIX_REQUEST_FAILED');
    const json = await response.json() as {error?: string; result?: unknown};
    if (json.error || json.result === undefined) throw new AssessmentWriteError('BITRIX_REQUEST_FAILED');
    return json.result;
  }
  async function read(dealId: string): Promise<AssessmentBaseline> {
    if (!/^[1-9]\d*$/.test(dealId)) throw new AssessmentWriteError('INVALID_DEAL_ID');
    const deal = await call('crm.deal.get', {id: dealId}) as Record<string, unknown>;
    if (!deal || String(deal.ID) !== dealId) throw new AssessmentWriteError('DEAL_NOT_FOUND');
    return Object.fromEntries(Object.entries(ASSESSMENT_FIELDS).map(([key, field]) => [key, deal[field] ?? null])) as AssessmentBaseline;
  }
  /** The portal's legacy debt summary may round to whole tenge. Accept that
   * storage projection only when every other field AND the exact questionnaire
   * match, and live metadata explicitly proves zero-decimal scalar storage.
   * The precise debt is still sent and retained in the immutable card/snapshot.
   * Baseline conflict detection deliberately does not use this comparison.
   */
  async function readbackMismatches(current: AssessmentBaseline, expected: AssessmentValues) {
    const mismatches = changed(current, expected);
    if (mismatches.length !== 1 || mismatches[0] !== 'debt') return mismatches;
    const totals = [...expected.card.matchAll(/^Общий долг по указанным обязательствам: (\d+(?:\.\d+)?) ₸$/gm)];
    if (totals.length !== 1 || decimal(totals[0][1]) !== decimal(expected.debt)) return mismatches;
    const amount = /^(\d+)(?:\.(\d{1,2}))?$/.exec(expected.debt);
    if (!amount) return mismatches;
    const rounded = (BigInt(amount[1]) + ((amount[2]?.[0] || '0') >= '5' ? BigInt(1) : BigInt(0))).toString();
    if (normalize('debt', current.debt) !== rounded) return mismatches;
    try {
      const result = await call('crm.deal.userfield.list', {filter: {FIELD_NAME: ASSESSMENT_FIELDS.debt}});
      if (!Array.isArray(result) || result.length !== 1) return mismatches;
      const field = result[0];
      if (field?.FIELD_NAME === ASSESSMENT_FIELDS.debt && field.USER_TYPE_ID === 'double' &&
          field.MULTIPLE === 'N' && (field.SETTINGS?.PRECISION === 0 || field.SETTINGS?.PRECISION === '0')) return [];
    } catch { /* Unknown field precision must never weaken confirmation. */ }
    return mismatches;
  }
  async function save(dealId: string, expectedIin: string, baseline: AssessmentBaseline, values: AssessmentValues) {
    // This whole phase is read-only. Only this boundary may prove a retry is safe.
    // Errors after crm.deal.update is invoked are always treated as possibly applied.
    const alreadyApplied = await (async () => {
      if (!/^\d{12}$/.test(expectedIin) || values.iin !== expectedIin) throw new AssessmentWriteError('CLIENT_IDENTITY_UNVERIFIED');
      if ((Object.keys(ASSESSMENT_FIELDS) as AssessmentField[]).some(key => typeof values[key] !== 'string' || normalize(key, values[key]) === null)) throw new AssessmentWriteError('INVALID_ASSESSMENT_VALUES');
      const before = await read(dealId);
      if (before.iin !== expectedIin) throw new AssessmentWriteError('CASE_IDENTITY_CHANGED');
      if (!(await readbackMismatches(before, values)).length) return true;
      const conflicts = changed(before, baseline);
      if (conflicts.length) throw new AssessmentWriteError('ASSESSMENT_CHANGED_IN_CRM', conflicts);
      return false;
    })().catch(error => {
      throw new AssessmentWriteError(
        error instanceof AssessmentWriteError ? error.code : 'ASSESSMENT_PREFLIGHT_FAILED',
        error instanceof AssessmentWriteError ? error.fields : [],
        true,
      );
    });
    if (alreadyApplied) return {verified: true as const, alreadyApplied: true};
    // Bitrix has no conditional deal update. The caller must serialize submissions;
    // this check detects prior edits, but cannot prevent a simultaneous external edit.
    const fields = Object.fromEntries(Object.entries(ASSESSMENT_FIELDS).map(([key, field]) => [field, values[key as AssessmentField]]));
    if (operationSignal?.aborted) throw new AssessmentWriteError('ASSESSMENT_PREFLIGHT_FAILED', [], true);
    try { await call('crm.deal.update', {id: dealId, fields}); }
    catch { /* A lost response may still mean the write applied. Read back first. */ }
    let after: AssessmentBaseline;
    try { after = await read(dealId); }
    catch { throw new AssessmentWriteError('ASSESSMENT_SAVE_UNCERTAIN'); }
    const mismatches = await readbackMismatches(after, values);
    if (mismatches.length) throw new AssessmentWriteError('ASSESSMENT_READBACK_MISMATCH', mismatches);
    return {verified: true as const, alreadyApplied: false};
  }
  async function reconcile(dealId:string,expectedIin:string,values:AssessmentValues){
    if(!/^\d{12}$/.test(expectedIin)||values.iin!==expectedIin)throw new AssessmentWriteError('CLIENT_IDENTITY_UNVERIFIED');
    if((Object.keys(ASSESSMENT_FIELDS) as AssessmentField[]).some(key=>typeof values[key]!=='string'||normalize(key,values[key])===null))throw new AssessmentWriteError('INVALID_ASSESSMENT_VALUES');
    const current=await read(dealId);
    if(current.iin!==expectedIin)throw new AssessmentWriteError('CASE_IDENTITY_CHANGED');
    const mismatches=await readbackMismatches(current,values);
    return {verified:mismatches.length===0,mismatches};
  }
  return {read, save, reconcile};
}
