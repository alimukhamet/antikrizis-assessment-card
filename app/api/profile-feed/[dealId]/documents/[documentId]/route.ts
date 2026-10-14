import { EvidenceRepository, RepositoryError } from '../../../../../../lib/documents/repository';
import { iskOriginalType } from '../../../../../../lib/questionnaire/isk-originals';
import { ProfileSaveRepository } from '../../../../../../lib/questionnaire/profile-save-repository';
import { profileFeedAuthorization, profileFeedFail as fail } from '../../../../../../lib/questionnaire/profile-feed-auth';

/** Read an exact case original; never redirect to storage or expose its key. */
export async function GET(request: Request, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const { env } = await import('cloudflare:workers');
  const runtime = env as typeof env & { DB?: D1Database; FILES?: R2Bucket; PROFILE_FEED_TOKEN?: string };
  const denied = profileFeedAuthorization(request, runtime);
  if (denied) return denied;
  const { dealId, documentId } = await ctx.params;
  if (!/^[1-9]\d{0,11}$/.test(dealId) || !/^[A-Za-z0-9_-]{1,128}$/.test(documentId)) return fail(400, 'INVALID_ORIGINAL_ID');
  if (!runtime.FILES) return fail(503, 'EVIDENCE_STORAGE_NOT_CONFIGURED');
  try {
    const profile = await new ProfileSaveRepository(runtime.DB!).latestVerifiedByDeal(dealId);
    if (!profile) return fail(404, 'PROFILE_NOT_FOUND');
    const repository = new EvidenceRepository(runtime.DB!, runtime.FILES);
    const record = await repository.findCaseByExternal('bitrix', dealId);
    if (!record || record.id !== profile.case_id) return fail(404, 'PROFILE_NOT_FOUND');
    const document = await repository.document(record.id, documentId);
    const contentType = document && iskOriginalType(document);
    if (!document || !contentType) return fail(404, 'ORIGINAL_NOT_FOUND');
    const bytes = await repository.original(document);
    if (bytes.byteLength !== document.byte_size) return fail(503, 'ORIGINAL_INTEGRITY_FAILED');
    return new Response(bytes, { headers: {
      'cache-control': 'no-store', 'content-type': contentType,
      'content-length': String(bytes.byteLength), 'x-content-type-options': 'nosniff',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.original_name)}`,
      'x-original-sha256': document.original_sha256,
    } });
  } catch (error) {
    return fail(error instanceof RepositoryError ? error.status : 503, error instanceof RepositoryError ? error.code : 'ISK_ORIGINAL_UNAVAILABLE');
  }
}
