import { requireStaffRequest } from '../staff-access';
import { readSessionCookie, verifySession } from '../../../lib/worker-session';
import { createProfileFieldSetup, ProfileFieldSetupError } from '../../../lib/crm/profile-field-setup';

const headers = { 'cache-control': 'no-store' };
/** Only these workers may create Bitrix fields for the profile backfill. */
const ADMINS = new Set(['ali', 'darkhan']);

async function admin(request: Request) {
  const actor = await verifySession(readSessionCookie(request.headers.get('cookie')), process.env.SITE_SESSION_TOKEN ?? '');
  return actor && ADMINS.has(actor.worker) ? actor : null;
}
function failure(error: unknown) {
  const code = error instanceof ProfileFieldSetupError ? error.code : 'BITRIX_REQUEST_FAILED';
  return Response.json({ error: code }, { status: code === 'BITRIX_NOT_CONFIGURED' ? 503 : code === 'BITRIX_ADMIN_RIGHTS_REQUIRED' ? 403 : 502, headers });
}

export async function GET(request: Request) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  const canCreate = Boolean(await admin(request));
  try {
    // The queue page calls this on open: the first visit creates any missing profile fields
    // (idempotent, create-only), so the documentologist can start without an admin step.
    const setup = createProfileFieldSetup(process.env.BITRIX_WEBHOOK ?? ''), fields = await setup.status();
    if (fields.some(field => !field.exists)) return Response.json({ ...await setup.ensure(), canCreate }, { headers });
    return Response.json({ fields, canCreate }, { headers });
  }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  if (!await admin(request)) return Response.json({ error: 'ADMIN_REQUIRED' }, { status: 403, headers });
  try { return Response.json({ ...await createProfileFieldSetup(process.env.BITRIX_WEBHOOK ?? '').ensure(), canCreate: true }, { headers }); }
  catch (error) { return failure(error); }
}
