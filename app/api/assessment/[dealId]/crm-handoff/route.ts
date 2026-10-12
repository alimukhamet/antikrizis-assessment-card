import { evidenceRepository } from '../../../../../lib/documents/storage';
import { UploadManifestRepository } from '../../../../../lib/documents/upload-manifest';
import { HandoffRepository } from '../../../../../lib/questionnaire/handoff-repository';
import { createCrmDocumentReader } from '../../../../../lib/crm/document-download';
import { handleAssessmentHandoffRead } from '../../../../../lib/crm/assessment-handoff-read';

export async function POST(request: Request, context: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await context.params;
    const { env } = await import('cloudflare:workers');
    const db = (env as typeof env & { DB?: D1Database }).DB;
    if (!db) throw new Error('storage_unavailable');
    return await handleAssessmentHandoffRead(request, dealId, {
      repository: await evidenceRepository(), handoffs: new HandoffRepository(db), manifests: new UploadManifestRepository(db),
      environment: { secret: process.env.ASSESSMENT_INTAKE_HMAC_SECRET, approvedOrigin: process.env.ASSESSMENT_INTAKE_APPROVED_ORIGIN },
      readFile: (record, artifact) => createCrmDocumentReader(process.env.BITRIX_WEBHOOK ?? '', dealId, record.client_iin ?? '', fetch,
        artifact.kind === 'credential' ? { credentialsOnly: true } : { documentsOnly: true })({ id: artifact.fileId }, undefined, { maxBytes: artifact.sizeBytes }),
    });
  } catch {
    return Response.json({ error: 'assessment_handoff_source_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }
}
