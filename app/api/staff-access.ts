import { readSessionCookie, verifySession, requestOriginAllowed } from '../../lib/worker-session';

export async function requireStaffRequest(request: Request, options: { binary?: boolean } = {}): Promise<Response | null> {
  const actor = await verifySession(readSessionCookie(request.headers.get('cookie')), process.env.SITE_SESSION_TOKEN ?? '');
  const failure = !actor ? { status: 401, error: 'SIGN_IN_REQUIRED' }
    : !requestOriginAllowed(request) ? { status: 403, error: 'INVALID_REQUEST_ORIGIN' }
    : !['GET', 'HEAD'].includes(request.method) && !(request.headers.get('content-type') ?? '').toLowerCase().startsWith(options.binary ? 'application/octet-stream' : 'application/json')
      ? { status: 415, error: 'JSON_REQUIRED' } : null;
  return failure ? Response.json({ error: failure.error }, { status: failure.status, headers: { 'cache-control': 'no-store' } }) : null;
}
