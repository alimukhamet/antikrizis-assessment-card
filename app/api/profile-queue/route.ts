import { requireStaffRequest } from '../staff-access';
import { readProfileQueue, ProfileQueueError } from '../../../lib/crm/profile-queue';

/** Read-only work queue for the one-time profile backfill. */
export async function GET(request: Request) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  const headers = { 'cache-control': 'no-store' };
  try {
    const items = await readProfileQueue(process.env.BITRIX_WEBHOOK ?? '');
    return Response.json({ items, total: items.length, done: items.filter(i => i.profileSavedAt).length }, { headers });
  } catch (error) {
    const code = error instanceof ProfileQueueError ? error.code : 'PROFILE_QUEUE_UNAVAILABLE';
    return Response.json({ error: code }, { status: code === 'BITRIX_NOT_CONFIGURED' ? 503 : 502, headers });
  }
}
