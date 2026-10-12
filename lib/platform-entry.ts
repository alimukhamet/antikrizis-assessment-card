import type { Actor } from './worker-session';

const PLATFORM_ORIGIN = 'https://platform.anti-krizis.kz';
const SALES_WORKERS = new Set(['darkhan', 'ramazan', 'nurdaulet']);
const encoder = new TextEncoder();
const base64url = (value: Uint8Array) => btoa(String.fromCharCode(...value))
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export function canEnterPlatform(actor: Actor): boolean {
  return SALES_WORKERS.has(actor.worker);
}

export async function issuePlatformEntry(actor: Actor, secret: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!canEnterPlatform(actor)) throw new Error('PLATFORM_ENTRY_FORBIDDEN');
  if (encoder.encode(secret).length < 32) throw new Error('PLATFORM_ENTRY_NOT_CONFIGURED');
  const payload = base64url(encoder.encode(JSON.stringify({
    v: 1, aud: 'antikrizis-platform-entry', sub: actor.worker,
    iat: now, exp: now + 60, jti: crypto.randomUUID(),
  })));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

/** Only the authenticated server reveals this form; a public asset grants no access. */
export function platformEntryLauncher(html: string, actor: Actor): string {
  return html.replace(/<form data-platform-entry(?:="")? hidden(?:="")?[\s\S]*?<\/form>/g,
    form => canEnterPlatform(actor) ? form.replace(/ hidden(?:="")?/, '') : '');
}

export async function platformEntryResponse(request: Request, actor: Actor, secret: string): Promise<Response> {
  const nonce = crypto.randomUUID();
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    // Preserve Origin on the cross-origin POST; Referer contains only the issuer origin.
    'referrer-policy': 'strict-origin',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self' ${PLATFORM_ORIGIN}; base-uri 'none'; frame-ancestors 'none'`,
  };
  const page = (body: string, status = 200) => new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сделки · Антикризис</title><body>${body}</body></html>`, { status, headers });
  if (!canEnterPlatform(actor)) return page('<p>Этот вход доступен только отделу продаж.</p>', 403);
  if (request.method === 'GET') return page('<form method="post" action="/platform-entry"><button type="submit">Открыть сделки</button></form>');
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, POST' } });
  if (encoder.encode(secret).length < 32) return page('<p>Вход в сделки пока недоступен. Повторите позже.</p>', 503);
  const ticket = await issuePlatformEntry(actor, secret);
  return page(`<form id="entry" method="post" action="${PLATFORM_ORIGIN}/api/auth/assessment-entry"><input type="hidden" name="ticket" value="${ticket}"><button type="submit">Открыть сделки</button></form><script nonce="${nonce}">document.getElementById('entry').submit();</script>`);
}
