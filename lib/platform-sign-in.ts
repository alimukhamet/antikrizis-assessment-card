/**
 * One sign-in (owner, 15 Oct 2026). Platform posts a one-minute Ed25519 ticket for this tool only
 * (Platform `src/sso.ts`); PLATFORM_SSO_WORKERS maps the Platform employee to a worker here.
 * Sessions keep their normal 12-hour lifetime. After one Platform entry, an expired session returns
 * through Platform automatically, so nobody types a password again while signed in there.
 */
export const PLATFORM_ORIGIN = 'https://platform.anti-krizis.kz';
export const PLATFORM_ENTRY_COOKIE = '__Host-antikrizis_platform_entry';
export const PLATFORM_ENTRY_SECONDS = 30 * 24 * 60 * 60;
export type PlatformTicket = {employeeId: string; jti: string; exp: number};
const bytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export function platformSignInUrl(returnTo: string): string {
  return `${PLATFORM_ORIGIN}/sso/assessment?return=${encodeURIComponent(returnTo)}`;
}
export function hasPlatformEntry(cookieHeader: string | null): boolean {
  return (cookieHeader || '').split(';').some(part => part.trim() === PLATFORM_ENTRY_COOKIE + '=1');
}
/** Where an opened login page goes instead: through the Platform after one Platform entry, never after an error. */
export function platformReturn(url: URL, cookieHeader: string | null, destination: (value: unknown) => string): string | null {
  if (url.pathname !== '/login' || url.searchParams.has('error') || !hasPlatformEntry(cookieHeader)) return null;
  return platformSignInUrl(destination(url.searchParams.get('returnTo') ?? undefined));
}
export async function verifyPlatformTicket(raw: string, publicKey: string | undefined, now = Math.floor(Date.now() / 1000)): Promise<PlatformTicket | null> {
  const parts = raw.split('.');
  if (!publicKey || raw.length > 2048 || parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[1])) return null;
  try {
    const key = await crypto.subtle.importKey('raw', bytes(publicKey), {name: 'Ed25519'}, false, ['verify']);
    if (!await crypto.subtle.verify({name: 'Ed25519'}, key, bytes(parts[1]), new TextEncoder().encode(parts[0]))) return null;
    const t = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes(parts[0])));
    if (t?.v !== 1 || t.aud !== 'assessment' || typeof t.sub !== 'string' || !Number.isSafeInteger(t.iat) || t.exp !== t.iat + 60 || t.iat > now + 30 || t.exp <= now
      || typeof t.jti !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t.jti)) return null;
    return {employeeId: t.sub, jti: t.jti, exp: t.exp};
  } catch { return null; }
}
export function mappedWorker(employeeId: string, configuration: string | undefined, workers: Record<string, string>): string | null {
  try {
    const worker = JSON.parse(configuration || '{}')?.[employeeId];
    return typeof worker === 'string' && Object.prototype.hasOwnProperty.call(workers, worker) ? worker : null;
  } catch { return null; }
}
/** Each ticket opens one session: its id is held in the login-attempt table until it would have expired. */
export async function consumePlatformTicket(ticket: PlatformTicket): Promise<boolean> {
  const {env} = await import('cloudflare:workers');
  const db = (env as typeof env & {DB?: D1Database}).DB;
  if (!db) throw Error('LOGIN_RATE_STORAGE_NOT_CONFIGURED');
  const row = await db.prepare('INSERT INTO assessment_login_attempts (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO NOTHING RETURNING key').bind('platform:' + ticket.jti, ticket.exp).first();
  return !!row;
}
