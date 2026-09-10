import { issueSession, readSessionCookie, verifySession, requestOriginAllowed, SESSION_COOKIE, SESSION_SECONDS } from '../../../lib/worker-session';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
const cookie = (value: string, maxAge: number) => `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
export async function GET(request: Request) {
  const actor = await verifySession(readSessionCookie(request.headers.get('cookie')), process.env.SITE_SESSION_TOKEN ?? '');
  return Response.json(actor ? { ok: true, actor } : { error: 'SIGN_IN_REQUIRED' }, { status: actor ? 200 : 401, headers });
}
export async function POST(request: Request) {
  if (!requestOriginAllowed(request)) return Response.json({ error: 'Запрос отклонён.' }, { status: 403, headers });
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return Response.json({ error: 'Ожидается JSON.' }, { status: 415, headers });
  if ((process.env.SITE_SESSION_TOKEN ?? '').length < 32) return Response.json({ error: 'Вход ещё не настроен. Сообщите Ali.' }, { status: 503, headers });
  let body;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 4096) { await reader.cancel(); return Response.json({ error: 'Запрос слишком большой.' }, { status: 413, headers }); } chunks.push(value); }
    const combined = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder().decode(combined));
  } catch { return Response.json({ error: 'Некорректный запрос.' }, { status: 400, headers }); }
  const worker = typeof body?.worker === 'string' ? body.worker : '';
  if (!['ali','ramazan','nurdaulet','darkhan'].includes(worker) || typeof body?.password !== 'string' || body.password.length > 1024) return Response.json({error:'Неверное имя или пароль.'},{status:401,headers});
  const origin = 'https://antikrizis-payment-control.mukhamet-ali-ma.chatgpt.site';
  let upstream: Response;
  try {
    upstream = await fetch(origin + '/api/session', {method:'POST',redirect:'error',headers:{'content-type':'application/json',origin,'sec-fetch-site':'same-origin'},body:JSON.stringify({worker,password:body.password}),signal:AbortSignal.timeout(15000)});
  } catch {return Response.json({error:'Сервис входа временно недоступен. Повторите позже.'},{status:503,headers});}
  if (!upstream.ok) return Response.json({error:upstream.status===401?'Неверное имя или пароль.':'Сервис входа временно недоступен.'},{status:upstream.status===401?401:503,headers});
  const result = await upstream.json() as {ok?:boolean;data?:{displayName?:string}};
  if(result.ok!==true || !upstream.headers.get('set-cookie')?.includes('antikrizis_payment_session=')) return Response.json({error:'Не удалось подтвердить вход.'},{status:503,headers});
  const actor={worker,displayName:result.data?.displayName};
  const token = await issueSession(actor.worker, process.env.SITE_SESSION_TOKEN ?? '');
  return Response.json({ ok: true, actor }, { headers: { ...headers, 'set-cookie': cookie(token, SESSION_SECONDS) } });
}
export async function DELETE(request: Request) {
  if (!requestOriginAllowed(request)) return Response.json({ error: 'Запрос отклонён.' }, { status: 403, headers });
  return Response.json({ ok: true }, { headers: { ...headers, 'set-cookie': cookie('', 0) } });
}
