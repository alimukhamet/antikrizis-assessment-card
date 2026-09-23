import { requireStaffRequest } from '../../../staff-access';
import { boundedJson, evidenceContext, evidenceError } from '../../../../../lib/documents/request-context';
import { RepositoryError } from '../../../../../lib/documents/repository';
import { UploadManifestRepository } from '../../../../../lib/documents/upload-manifest';
import { SubmissionRepository } from '../../../../../lib/questionnaire/submission-repository';
import { verifyHandoffDelivery } from '../../../../../lib/questionnaire/handoff-service';
import { TitleRepairRepository } from '../../../../../lib/questionnaire/title-repair-repository';
import { inspectTitleRepair, runTitleRepair } from '../../../../../lib/questionnaire/title-repair-service';
import { createTitleRepairAdapter } from '../../../../../lib/crm/title-repair';
import { createAssessmentAdapter } from '../../../../../lib/crm/assessment-write';
import { createCrmDocumentReader, createVerifiedDocumentUploadAdapter } from '../../../../../lib/crm/document-download';
import { readSessionCookie, verifySession } from '../../../../../lib/worker-session';

/** Explicit owner maintenance only. Scheduled monitoring never calls this route. */
export async function POST(request: Request, context: { params: Promise<{ dealId: string }> }) {
  const denied = await requireStaffRequest(request);
  if (denied) return denied;
  try {
    const owner = await verifySession(readSessionCookie(request.headers.get('cookie')), process.env.SITE_SESSION_TOKEN ?? '');
    if (owner?.worker !== 'ali') throw new RepositoryError('FORBIDDEN', 403);
    const { dealId } = await context.params;
    const { record, actor, repository } = await evidenceContext(request, dealId);
    if (actor.worker !== 'ali') throw new RepositoryError('FORBIDDEN', 403);
    const body = await boundedJson(request, 4096);
    if (!['inspect', 'repair', 'reconcile'].includes(String(body.action)))
      throw new RepositoryError('INVALID_TITLE_REPAIR_ACTION', 400);
    const { env } = await import('cloudflare:workers');
    const db = (env as typeof env & { DB?: D1Database }).DB;
    if (!db) throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED', 503);
    const submissions = new SubmissionRepository(db), submission = await submissions.latestForCase(record.id);
    if (!submission) throw new RepositoryError('HANDOFF_ASSESSMENT_REQUIRED');
    if (typeof body.expectedSubmissionHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.expectedSubmissionHash) || submission.payload_hash !== body.expectedSubmissionHash)
      throw new RepositoryError('TITLE_REPAIR_SUBMISSION_CHANGED');
    const webhook = process.env.BITRIX_WEBHOOK ?? '';
    const deps = {
      repository: new TitleRepairRepository(db),
      crm: createTitleRepairAdapter(webhook),
      verifyDelivery: () => verifyHandoffDelivery({
        repository, submissions, manifests: new UploadManifestRepository(db),
        assessment: createAssessmentAdapter(webhook),
        upload: createVerifiedDocumentUploadAdapter(webhook, dealId, record.client_iin ?? ''),
        readFile: createCrmDocumentReader(webhook, dealId, record.client_iin ?? ''),
      }, record, { verifyBytes: false }),
    };
    const repair = body.action === 'inspect'
      ? await inspectTitleRepair(deps, record, submission)
      : await runTitleRepair(deps, record, submission, actor, {
        action: body.action as 'repair' | 'reconcile',
        requestId: typeof body.requestId === 'string' ? body.requestId : '',
        expectedProposalHash: typeof body.expectedProposalHash === 'string' ? body.expectedProposalHash : '',
      });
    return Response.json({ repair }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) { return evidenceError(error); }
}
