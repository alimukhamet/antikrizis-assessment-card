import { requireStaffRequest } from '../../../../../staff-access';
import { boundedJson, evidenceContext, evidenceError } from '../../../../../../../lib/documents/request-context';
import { RepositoryError } from '../../../../../../../lib/documents/repository';
import { BrowserOcrRepository, browserOcrSource, validateBrowserOcrPin, BROWSER_OCR_MAX_REQUEST_BYTES } from '../../../../../../../lib/documents/browser-ocr';

type RouteContext = { params: Promise<{ dealId: string; documentId: string }> };
async function context(request: Request, route: RouteContext) {
  const { dealId, documentId } = await route.params;
  const { record, actor, repository } = await evidenceContext(request, dealId);
  const source = await browserOcrSource(repository, record, documentId);
  const { env } = await import('cloudflare:workers');
  const runtime = env as typeof env & { DB?: D1Database };
  if (!runtime.DB) throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED', 503);
  return { source, actor, ocr: new BrowserOcrRepository(runtime.DB) };
}
export async function GET(request: Request, route: RouteContext) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  try {
    const { source, actor, ocr } = await context(request, route), query = new URL(request.url).searchParams;
    const page = query.has('page') ? Number(query.get('page')) : undefined;
    return Response.json(await ocr.status(source, actor, { page, suggestions: query.get('suggestions') !== '0' }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return evidenceError(error); }
}
export async function POST(request: Request, route: RouteContext) {
  const denied = await requireStaffRequest(request); if (denied) return denied;
  try {
    const body = await boundedJson(request, BROWSER_OCR_MAX_REQUEST_BYTES);
    const { source, actor, ocr } = await context(request, route);
    validateBrowserOcrPin(body, source);
    let result;
    if (body.action === 'claim') result = await ocr.claim(source, actor, body.leaseToken);
    else if (body.action === 'renew') result = await ocr.renew(source, actor, body.leaseToken);
    else if (body.action === 'release') result = await ocr.release(source, actor, body.leaseToken);
    else if (body.action === 'page') result = await ocr.savePage(source, actor, body.leaseToken, body.page);
    else throw new RepositoryError('OCR_INVALID_ACTION', 400);
    return Response.json({ ...result, ...await ocr.status(source, actor, { suggestions: body.action === 'page' }) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return evidenceError(error); }
}
