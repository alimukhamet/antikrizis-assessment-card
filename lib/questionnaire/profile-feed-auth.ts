export const profileFeedHeaders = { 'cache-control': 'no-store' };
export const profileFeedFail = (status: number, error: string) => Response.json({ error }, { status, headers: profileFeedHeaders });

/** Only the existing server credential authorizes this case-scoped feed. */
export function profileFeedAuthorization(request: Request, runtime: { DB?: D1Database; PROFILE_FEED_TOKEN?: string }) {
  const token = runtime.PROFILE_FEED_TOKEN ?? process.env.PROFILE_FEED_TOKEN ?? '';
  if (token.length < 32 || !runtime.DB) return profileFeedFail(503, 'PROFILE_FEED_NOT_CONFIGURED');
  const presented = /^Bearer (\S{1,512})$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  let difference = presented.length ^ token.length;
  for (let i = 0; i < Math.max(presented.length, token.length); i += 1) difference |= (presented.charCodeAt(i) || 0) ^ (token.charCodeAt(i) || 0);
  return difference ? profileFeedFail(401, 'PROFILE_FEED_UNAUTHORIZED') : null;
}
