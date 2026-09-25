import { issueSession, readSessionCookie, verifySession, requestOriginAllowed, SESSION_COOKIE, SESSION_SECONDS, WORKERS, LOCAL_WORKER_PASSWORDS } from '../../../lib/worker-session';
import { authenticateStaff } from '../../../lib/auth-provider';
import { checkLoginRate } from '../../../lib/login-rate';
import { loginDestination, LOGIN_ERRORS } from '../../../lib/login-navigation';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
const cookie = (value: string, maxAge: number) => `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
const redirect = (location: string, extra: Record<string, string> = {}) => new Response(null, {status: 303, headers: {...headers, ...extra, location}});
function loginFailure(code: keyof typeof LOGIN_ERRORS, returnTo: unknown, worker?: unknown) {
  const params = new URLSearchParams({error: code, returnTo: loginDestination(returnTo)});
  if (typeof worker === 'string' && Object.prototype.hasOwnProperty.call(WORKERS, worker)) params.set('worker', worker);
  return '/login?' + params;
}
export async function GET(request: Request) {
  const actor = await verifySession(readSessionCookie(request.headers.get('cookie')), process.env.SITE_SESSION_TOKEN ?? '');
  const params = new URL(request.url).searchParams;
  // Verify the browser retained the cookie before entering the protected page.
  if (params.get('continue') === '1') return redirect(actor
    ? loginDestination(params.get('returnTo'))
    : loginFailure('cookies', params.get('returnTo')));
  return Response.json(actor ? { ok: true, actor } : { error: 'SIGN_IN_REQUIRED' }, { status: actor ? 200 : 401, headers });
}
export async function POST(request: Request) {
  if (!requestOriginAllowed(request)) return Response.json({ error: 'Запрос отклонён.' }, { status: 403, headers });
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const isForm = contentType === 'application/x-www-form-urlencoded';
  if (!isForm && contentType !== 'application/json') return Response.json({ error: 'Ожидается JSON или форма входа.' }, { status: 415, headers });
  let body: Record<string, unknown> = {};
  const fail = (status: number, error: string, code: keyof typeof LOGIN_ERRORS, extra: Record<string, string> = {}) => isForm
    ? redirect(loginFailure(code, body.returnTo, body.worker), extra)
    : Response.json({error}, {status, headers: {...headers, ...extra}});
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 4096) { await reader.cancel(); return fail(413, 'Запрос слишком большой.', 'invalid'); } chunks.push(value); }
    const combined = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    const text = new TextDecoder().decode(combined);
    if (isForm) {
      const form = new URLSearchParams(text);
      for (const name of ['worker', 'password', 'returnTo']) if (form.getAll(name).length > 1) throw Error();
      body = {worker: form.get('worker'), password: form.get('password'), returnTo: form.get('returnTo')};
    } else {
      const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      body = value;
    }
  } catch { return fail(400, 'Некорректный запрос.', 'invalid'); }
  const provider = process.env.AUTH_PROVIDER || 'payment-control';
  if ((provider === 'local' && !process.env.SITE_ACCESS_PASSWORD) || (process.env.SITE_SESSION_TOKEN ?? '').length < 32) return fail(503, LOGIN_ERRORS.configured, 'configured');
  try {
    const rate = await checkLoginRate(request, process.env.SITE_SESSION_TOKEN ?? '');
    if (!rate.allowed) return fail(429, LOGIN_ERRORS.rate, 'rate', {'retry-after': String(rate.retryAfter)});
  } catch { return fail(503, 'Вход временно недоступен. Повторите позже.', 'unavailable'); }
  let actor;
  try { actor = await authenticateStaff(typeof body.worker === 'string' ? body.worker.trim().toLowerCase() : '', typeof body.password === 'string' ? body.password : '', {provider, localPassword: process.env.SITE_ACCESS_PASSWORD, workerPasswords: Object.fromEntries(Object.entries(LOCAL_WORKER_PASSWORDS).map(([worker, name]) => [worker, (process.env as Record<string, string | undefined>)[name as string]]))}); }
  catch { return fail(503, LOGIN_ERRORS.unavailable, 'unavailable'); }
  if (!actor) return fail(401, LOGIN_ERRORS.credentials, 'credentials');
  const token = await issueSession(actor.worker, process.env.SITE_SESSION_TOKEN ?? '');
  const sessionHeaders = {'set-cookie': cookie(token, SESSION_SECONDS)};
  if (isForm) return redirect('/api/session?' + new URLSearchParams({continue: '1', returnTo: loginDestination(body.returnTo)}), sessionHeaders);
  return Response.json({ok: true, actor}, {headers: {...headers, ...sessionHeaders}});
}
export async function DELETE(request: Request) {
  if (!requestOriginAllowed(request)) return Response.json({ error: 'Запрос отклонён.' }, { status: 403, headers });
  return Response.json({ ok: true }, { headers: { ...headers, 'set-cookie': cookie('', 0) } });
}
