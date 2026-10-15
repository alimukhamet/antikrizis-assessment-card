import { issueSession, SESSION_COOKIE, SESSION_SECONDS, WORKERS } from '../../../../lib/worker-session';
import { loginDestination, LOGIN_ERRORS } from '../../../../lib/login-navigation';
import { PLATFORM_ORIGIN, PLATFORM_ENTRY_COOKIE, PLATFORM_ENTRY_SECONDS, verifyPlatformTicket, mappedWorker, consumePlatformTicket } from '../../../../lib/platform-sign-in';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
function redirect(location: string, cookies: string[] = []) {
  const response = new Headers({...headers, location});
  for (const cookie of cookies) response.append('set-cookie', cookie);
  return new Response(null, {status: 303, headers: response});
}
// The entry mark is cleared on any failure, so the login page never loops back to the Platform.
const failed = (code: keyof typeof LOGIN_ERRORS) => redirect('/login?error=' + code, [`${PLATFORM_ENTRY_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`]);

/** A browser form posted by the Platform with a one-minute ticket for this tool. */
export async function POST(request: Request) {
  if (request.headers.get('origin') !== PLATFORM_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site') return failed('platform');
  if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return failed('platform');
  let form: URLSearchParams;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    let text = '', total = 0; const decoder = new TextDecoder();
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 4096) { await reader.cancel(); throw Error(); } text += decoder.decode(value, {stream: true}); }
    form = new URLSearchParams(text + decoder.decode());
    if (form.getAll('ticket').length !== 1 || form.getAll('return').length > 1) throw Error();
  } catch { return failed('platform'); }
  const ticket = await verifyPlatformTicket(form.get('ticket') ?? '', process.env.PLATFORM_SSO_PUBLIC_KEY);
  if (!ticket) return failed('platform');
  const worker = mappedWorker(ticket.employeeId, process.env.PLATFORM_SSO_WORKERS, WORKERS);
  if (!worker) return failed('platform_access');
  const secret = process.env.SITE_SESSION_TOKEN ?? '';
  if (secret.length < 32) return failed('configured');
  try { if (!await consumePlatformTicket(ticket)) return failed('platform'); }
  catch { return failed('unavailable'); }
  const token = await issueSession(worker, secret);
  return redirect('/api/session?' + new URLSearchParams({continue: '1', returnTo: loginDestination(form.get('return'))}), [
    `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
    `${PLATFORM_ENTRY_COOKIE}=1; Path=/; Max-Age=${PLATFORM_ENTRY_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  ]);
}
