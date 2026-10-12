import { ProfileSaveRepository, type ProfileSavePayload } from '../../../../lib/questionnaire/profile-save-repository';
import { sha256 } from '../../../../lib/documents/repository';
import { WORKERS } from '../../../../lib/worker-session';
import type { ProfileJson } from '../../../../lib/questionnaire/compile-profile';

const headers = { 'cache-control': 'no-store' };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers });

function equal(left: string, right: string) {
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

/**
 * Server-to-server feed: historical verified content plus its current completion state.
 * Consumers must require a verified receipt matching contentReceiptId before using completed content.
 * Bearer PROFILE_FEED_TOKEN only (never a staff session); exact deal ID; no listing; nothing logged.
 */
export async function GET(request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { env } = await import('cloudflare:workers');
  const runtime = env as typeof env & { DB?: D1Database; PROFILE_FEED_TOKEN?: string };
  const token = runtime.PROFILE_FEED_TOKEN ?? process.env.PROFILE_FEED_TOKEN ?? '';
  if (token.length < 32 || !runtime.DB) return fail(503, 'PROFILE_FEED_NOT_CONFIGURED');
  const presented = /^Bearer (\S{1,512})$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  if (!equal(presented, token)) return fail(401, 'PROFILE_FEED_UNAUTHORIZED');
  const { dealId } = await ctx.params;
  if (!/^[1-9]\d{0,11}$/.test(dealId)) return fail(400, 'INVALID_DEAL_ID');
  const repository = new ProfileSaveRepository(runtime.DB);
  const [row, receipt] = await Promise.all([
    repository.latestVerifiedByDeal(dealId), repository.latestEffectiveByDeal(dealId),
  ]);
  if (!row && !receipt) return fail(404, 'PROFILE_NOT_FOUND');
  // A reopened-only case has no approved content to expose. Do not resurrect its old payload.
  const emptyProfile: ProfileJson = {
    schema: 'antikrizis.profile.v1', dealId, iin: '', savedAt: '', savedBy: '',
    totalDebt: '', debtComplete: false, answers: [], unresolved: [],
  };
  const profileJson = row
    ? (JSON.parse(row.payload_json) as ProfileSavePayload).values.profileJson
    : JSON.stringify(emptyProfile);
  const worker = row?.actor_id.replace(/^worker:/, '') ?? '';
  return Response.json({
    schema: 'antikrizis.profile-feed.v1', dealId, requestId: row?.request_id ?? '', savedAt: row?.updated_at ?? '',
    savedBy: (WORKERS as Record<string, string>)[worker] ?? row?.actor_id ?? '',
    sha256: await sha256(profileJson), profile: JSON.parse(profileJson),
    contentReceiptId: row?.id ?? null,
    receiptState: receipt?.state ?? null, latestReceiptId: receipt?.id ?? null,
    latestReceiptAt: receipt?.updated_at ?? null,
  }, { headers });
}
