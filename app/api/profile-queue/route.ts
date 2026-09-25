import { requireStaffRequest } from '../staff-access';
import { readProfileQueue, ProfileQueueError } from '../../../lib/crm/profile-queue';
import { ProfileSaveRepository } from '../../../lib/questionnaire/profile-save-repository';
import { WORKERS } from '../../../lib/worker-session';

/** Read-only work queue for the one-time profile backfill. «Done» comes from the tool's verified saves. */
export async function GET(request: Request) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  const headers = { 'cache-control': 'no-store' };
  try {
    const { env } = await import('cloudflare:workers');
    const db = (env as typeof env & { DB?: D1Database }).DB;
    if (!db) throw new ProfileQueueError('EVIDENCE_STORAGE_NOT_CONFIGURED');
    const savedAt = await new ProfileSaveRepository(db).savedByDeal(WORKERS);
    const items = await readProfileQueue(process.env.BITRIX_WEBHOOK ?? '', savedAt);
    return Response.json({ items, total: items.length, done: items.filter(i => i.profileSavedAt).length }, { headers });
  } catch (error) {
    const code = error instanceof ProfileQueueError ? error.code : 'PROFILE_QUEUE_UNAVAILABLE';
    return Response.json({ error: code }, { status: code === 'BITRIX_NOT_CONFIGURED' || code === 'EVIDENCE_STORAGE_NOT_CONFIGURED' ? 503 : 502, headers });
  }
}
