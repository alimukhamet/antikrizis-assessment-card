/** Portable actor/session boundary; no Bitrix identifiers are part of authentication. */
export const WORKERS = { ali: 'Ali', ramazan: 'Ramazan', nurdaulet: 'Nurdaulet', darkhan: 'Darkhan', azhar: 'Azhar' } as const;
/** Workers without a payment-control account: each signs in with her own Worker secret. */
export const LOCAL_WORKER_PASSWORDS: Partial<Record<string, string>> = { azhar: 'AZHAR_PASSWORD' };
export const SESSION_COOKIE = '__Host-antikrizis_assessment_session';
export const SESSION_SECONDS = 12 * 60 * 60;
export type WorkerId = keyof typeof WORKERS;
export type Actor = { id: string; worker: WorkerId; displayName: string; authentication: 'shared-password-worker-selection' };
const audience = 'antikrizis-assessment';
const encoder = new TextEncoder();
function actor(worker: string): Actor | null {
  if (!Object.prototype.hasOwnProperty.call(WORKERS, worker)) return null;
  return { id: `worker:${worker}`, worker: worker as WorkerId, displayName: WORKERS[worker as WorkerId], authentication: 'shared-password-worker-selection' };
}
function equal(a: string, b: string): boolean {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}
function b64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function bytes(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
async function key(secret: string) {
  if (secret.length < 32) throw new Error('SESSION_SECRET_NOT_CONFIGURED');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export function authenticateWorker(worker: string, password: string, configuredPassword: string): Actor | null {
  if (!configuredPassword || password.length > 1024 || !equal(password, configuredPassword)) return null;
  return actor(worker);
}
export async function issueSession(worker: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (!actor(worker)) throw new Error('UNKNOWN_WORKER');
  const payload = b64(encoder.encode(JSON.stringify({ v: 1, aud: audience, sub: worker, iat: now, exp: now + SESSION_SECONDS })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload)));
  return `${payload}.${b64(signature)}`;
}
export async function verifySession(token: string | null, secret: string, now = Math.floor(Date.now() / 1000)): Promise<Actor | null> {
  if (!token || token.length > 2048 || secret.length < 32) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await key(secret), bytes(parts[1]), encoder.encode(parts[0]))) return null;
    const p = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    if (p.v !== 1 || p.aud !== audience || !Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.iat > now + 30 || p.exp <= now || p.exp - p.iat !== SESSION_SECONDS) return null;
    return actor(p.sub);
  } catch { return null; }
}
export function readSessionCookie(header: string | null): string | null {
  const prefix = SESSION_COOKIE + '=';
  const matches = (header || '').split(';').map(s => s.trim()).filter(s => s.startsWith(prefix));
  if (matches.length !== 1) return null;
  try { return decodeURIComponent(matches[0].slice(prefix.length)); } catch { return null; }
}
export function requestOriginAllowed(request: Request): boolean {
  if (['GET', 'HEAD'].includes(request.method)) return true;
  const site = request.headers.get('sec-fetch-site');
  return (!site || site === 'same-origin' || site === 'none') && request.headers.get('origin') === new URL(request.url).origin;
}
