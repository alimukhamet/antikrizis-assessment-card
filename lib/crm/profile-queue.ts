import { bitrixHeaders } from './http-headers';
import {
  PROFILE_CATEGORY_ID, ZVI_DATE_FIELD, PROCEDURE_FIELD, LEGACY_CARD_FIELD, IIN_FIELD,
  isProfileBackfillStage,
} from './profile-fields';

export type ProfileQueueItem = {
  dealId: string; title: string; stageName: string; zviDate: string; procedure: string;
  hasIin: boolean; hasLegacyCard: boolean; profileSavedAt: string;
};
export class ProfileQueueError extends Error { constructor(public code: string) { super(code); } }

const MAX_PAGES = 60; // 60 × 50 = 3000 deals; the backfill scope is far smaller.

/** Read-only: every deal in category 1 whose stage is «ЗВИ…» or «В ожидании». */
/** `savedAt`: deal ID → «time · worker» of its latest verified profile save (kept in the tool, not Bitrix). */
export async function readProfileQueue(webhook: string, savedAt: Map<string, string> = new Map(), send: typeof fetch = fetch) {
  if (!webhook) throw new ProfileQueueError('BITRIX_NOT_CONFIGURED');
  async function call(method: string, body: unknown) {
    const response = await send(webhook.replace(/\/?$/, '/') + method + '.json', {
      method: 'POST', headers: bitrixHeaders(webhook), body: JSON.stringify(body), redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new ProfileQueueError('BITRIX_REQUEST_FAILED');
    const json = await response.json() as { result?: unknown; next?: unknown; error?: string };
    if (json.error || json.result === undefined) throw new ProfileQueueError('BITRIX_REQUEST_FAILED');
    return json;
  }
  const entityId = `DEAL_STAGE_${PROFILE_CATEGORY_ID}`;
  const [statusPayload, fieldPayload] = await Promise.all([
    call('crm.status.list', { filter: { ENTITY_ID: entityId } }),
    call('crm.deal.fields', {}),
  ]);
  const stages = (Array.isArray(statusPayload.result) ? statusPayload.result : [])
    .filter((s: Record<string, unknown>) => String(s.ENTITY_ID) === entityId && isProfileBackfillStage(String(s.NAME || '')));
  if (!stages.length) throw new ProfileQueueError('PROFILE_STAGES_NOT_FOUND');
  const stageNames = new Map<string, string>(stages.map((s: Record<string, unknown>) => [String(s.STATUS_ID), String(s.NAME)]));
  const procedureItems = ((fieldPayload.result as Record<string, { items?: Array<Record<string, unknown>> }>)?.[PROCEDURE_FIELD]?.items) || [];
  const procedures = new Map(procedureItems.map(item => [String(item.ID ?? ''), String(item.VALUE ?? '')]));

  const deals: Record<string, unknown>[] = [];
  let start = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await call('crm.deal.list', {
      filter: { CATEGORY_ID: PROFILE_CATEGORY_ID, STAGE_ID: [...stageNames.keys()] },
      order: { ID: 'ASC' },
      select: ['ID', 'TITLE', 'STAGE_ID', ZVI_DATE_FIELD, PROCEDURE_FIELD, IIN_FIELD, LEGACY_CARD_FIELD],
      start,
    });
    if (!Array.isArray(json.result)) throw new ProfileQueueError('BITRIX_REQUEST_FAILED');
    deals.push(...json.result);
    if (json.next === undefined || json.next === null) break;
    if (!Number.isInteger(json.next) || Number(json.next) <= start) throw new ProfileQueueError('BITRIX_PAGINATION_UNVERIFIED');
    start = Number(json.next);
    if (page === MAX_PAGES - 1) throw new ProfileQueueError('PROFILE_QUEUE_TOO_LARGE');
  }
  const text = (value: unknown) => Array.isArray(value) ? String(value[0] ?? '') : value === null || value === undefined || value === false ? '' : String(value);
  const items: ProfileQueueItem[] = deals.filter(d => /^[1-9]\d*$/.test(String(d.ID))).map(d => ({
    dealId: String(d.ID), title: text(d.TITLE), stageName: stageNames.get(text(d.STAGE_ID)) || text(d.STAGE_ID),
    zviDate: text(d[ZVI_DATE_FIELD]), procedure: procedures.get(text(d[PROCEDURE_FIELD])) || text(d[PROCEDURE_FIELD]),
    hasIin: /^\d{12}$/.test(text(d[IIN_FIELD]).trim()), hasLegacyCard: Boolean(text(d[LEGACY_CARD_FIELD]).trim()),
    profileSavedAt: savedAt.get(String(d.ID)) || '',
  }));
  return sortProfileQueue(items);
}

/** Unfinished first, then the most recent ZVI date, then newest deal. */
export function sortProfileQueue(items: ProfileQueueItem[]) {
  const time = (value: string) => { const t = value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : -Infinity; };
  return [...items].sort((a, b) =>
    Number(Boolean(a.profileSavedAt)) - Number(Boolean(b.profileSavedAt)) ||
    time(b.zviDate) - time(a.zviDate) || Number(b.dealId) - Number(a.dealId));
}
