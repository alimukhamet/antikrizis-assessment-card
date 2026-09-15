import {
  assessmentIntakeFromExport,
  canonicalJsonStringify,
  selectAssessmentSubmissionFromExport,
  type AssessmentIntakeEnvelope,
  type AssessmentSubmissionSelection,
} from './assessment-intake-export';
import { signedAssessmentIntakeHeaders } from './assessment-intake-auth';
import type { CaseRow, EvidenceRepository } from '../documents/repository';

const MAX_DOCUMENT_BYTES = 35 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const hashPattern = /^[a-f0-9]{64}$/u;

export type AssessmentIntakeSyncRepository = Pick<
  EvidenceRepository,
  'findCaseByExternal' | 'exportCase' | 'document' | 'originalStream'
>;

export type AssessmentIntakeSyncOptions = {
  dealId: string;
  repository: AssessmentIntakeSyncRepository;
  secret?: string;
  crmOrigin?: string;
  sourceOrigin?: string;
  sourceSubmissionId?: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  requestTimeoutMs?: number;
};

export type AssessmentIntakeSyncResult = {
  status: 'disabled' | 'not_found' | 'pending' | 'synced' | 'failed';
  reason?: string;
  sourceSubmissionId?: string;
  sourceRevision?: number;
  requestHash?: string;
  idempotencyKey?: string;
  duplicate?: boolean;
};

class AssessmentIntakeSyncError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

function allowedOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !loopbackHttp) || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function endpoint(origin: string, pathname: string): string {
  const url = new URL(pathname, `${origin}/`);
  if (url.origin !== origin) throw new AssessmentIntakeSyncError('crm_origin_mismatch');
  return url.href;
}

function sourceContentType(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'p7m' || extension === 'p7s') return 'application/pkcs7-mime';
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'doc') return 'application/msword';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'xls') return 'application/vnd.ms-excel';
  if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (extension === 'zip') return 'application/zip';
  if (extension === 'rar') return 'application/vnd.rar';
  if (extension === '7z') return 'application/x-7z-compressed';
  return 'application/octet-stream';
}

async function replaySourceStream(input: ReadableStream<Uint8Array>, name: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  const reader = input.getReader();
  const initial: Uint8Array[] = [];
  const prefix = new Uint8Array(4);
  let prefixSize = 0;
  try {
    while (prefixSize < prefix.length) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value.byteLength) continue;
      const chunk = next.value;
      const take = Math.min(prefix.length - prefixSize, chunk.byteLength);
      prefix.set(chunk.subarray(0, take), prefixSize);
      prefixSize += take;
      if (take) initial.push(chunk.subarray(0, take));
      if (take < chunk.byteLength) initial.push(chunk.subarray(take));
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }
  const isPdf = prefixSize >= 4 && prefix[0] === 0x25 && prefix[1] === 0x50 && prefix[2] === 0x44 && prefix[3] === 0x46;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = isPdf
    ? 'application/pdf'
    : ['pdf', 'p7m', 'p7s'].includes(extension)
      ? 'application/pkcs7-mime'
      : sourceContentType(name);
  let initialIndex = 0;
  let finished = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        if (initialIndex < initial.length) {
          controller.enqueue(initial[initialIndex++]);
          return;
        }
        const next = await reader.read();
        if (next.done) {
          finished = true;
          controller.close();
          release();
        } else if (next.value.byteLength) {
          controller.enqueue(next.value);
        }
      } catch (error) {
        finished = true;
        controller.error(error);
        release();
      }
    },
    async cancel(reason) {
      finished = true;
      await reader.cancel(reason).catch(() => undefined);
      release();
    },
  });
  return { body, contentType };
}

function headerBase64(value: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(canonicalJsonStringify(value))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function signedRequest(input: {
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  url: string;
  method: string;
  body: string | ReadableStream<Uint8Array>;
  signatureBody?: string;
  secret: string;
  sourceOrigin: string;
  now: () => number;
  requestTimeoutMs?: number;
  headers?: Record<string, string>;
}): Promise<Response> {
  const auth = await signedAssessmentIntakeHeaders({ secret: input.secret, body: input.signatureBody ?? (typeof input.body === 'string' ? input.body : ''), sourceOrigin: input.sourceOrigin, now: input.now() });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
  const release = () => clearTimeout(timeout);
  try {
    const response = await input.fetcher(input.url, {
      method: input.method,
      headers: { ...auth, ...(input.headers ?? {}) },
      body: input.body as BodyInit,
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.body) {
      release();
      return response;
    }
    const reader = response.body.getReader();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      release();
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const next = await reader.read();
          if (next.done) {
            streamController.close();
            finish();
          } else {
            streamController.enqueue(next.value);
          }
        } catch (error) {
          streamController.error(error);
          finish();
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
        finish();
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    release();
    throw error;
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.length > 4_000_000) throw new AssessmentIntakeSyncError('crm_response_too_large');
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new AssessmentIntakeSyncError('crm_response_invalid'); }
}

function pendingFromSelection(selection: AssessmentSubmissionSelection): AssessmentIntakeSyncResult {
  if (selection.status === 'not_found') return { status: 'not_found', reason: selection.reason };
  if (selection.status === 'pending') return {
    status: 'pending',
    reason: selection.reason,
    sourceSubmissionId: selection.sourceSubmissionId,
    sourceRevision: undefined,
  };
  return { status: 'failed', reason: 'unexpected_selection_state' };
}

function sourceMetadata(intake: AssessmentIntakeEnvelope, sourcePayloadHash: string, artifact: AssessmentIntakeEnvelope['evidence'][number]) {
  return {
    source: 'assessment-card',
    sourceDealId: intake.sourceDealId,
    sourceSubmissionId: intake.sourceSubmissionId,
    sourceRevision: intake.sourceRevision,
    snapshotHash: intake.snapshotHash,
    sourceSubmissionHash: intake.sourceSubmissionHash,
    sourcePayloadHash,
    externalArtifactId: artifact.externalArtifactId,
    sourceDocumentId: artifact.sourceDocumentId,
    sourceSha256: artifact.sha256,
    sourceSizeBytes: artifact.sizeBytes,
    sourceOriginalName: artifact.originalName,
  };
}

function targetPath(value: unknown, origin: string, handoverId: string, artifactId: string): string {
  if (typeof value === 'string' && value) {
    const url = new URL(value, `${origin}/`);
    if (url.origin !== origin) throw new AssessmentIntakeSyncError('crm_artifact_target_origin_mismatch');
    return url.href;
  }
  return endpoint(origin, `/api/crm/handovers/${encodeURIComponent(handoverId)}/artifacts/${encodeURIComponent(artifactId)}`);
}

async function selectSource(input: AssessmentIntakeSyncOptions): Promise<{
  record: CaseRow;
  selection: Extract<AssessmentSubmissionSelection, { status: 'ready' }>;
  bundle: unknown;
  intake: AssessmentIntakeEnvelope;
  sourcePayloadHash: string;
}> {
  const record = await input.repository.findCaseByExternal('bitrix', input.dealId);
  if (!record) throw new AssessmentIntakeSyncError('no_case');
  const bundle = await input.repository.exportCase(record.id);
  let selection: AssessmentSubmissionSelection;
  if (input.sourceSubmissionId) {
    const selected = (bundle.submissions as Array<Record<string, unknown>>).find(row => row.id === input.sourceSubmissionId);
    if (!selected) throw new AssessmentIntakeSyncError('submission_not_found');
    if (selected.identity_revision !== record.identity_revision || selected.state !== 'verified') {
      throw new AssessmentIntakeSyncError(selected.identity_revision === record.identity_revision ? 'submission_pending' : 'identity_reconciliation');
    }
    if (!Number.isSafeInteger(selected.sequence) || typeof selected.payload_hash !== 'string' || !hashPattern.test(selected.payload_hash)) {
      throw new AssessmentIntakeSyncError('identity_reconciliation');
    }
    selection = {
      status: 'ready', caseId: record.id, sourceSubmissionId: input.sourceSubmissionId,
      identityRevision: record.identity_revision, sourceRevision: Number(selected.sequence), sourcePayloadHash: selected.payload_hash,
    };
  } else {
    selection = selectAssessmentSubmissionFromExport(bundle);
    if (selection.status !== 'ready') throw new AssessmentIntakeSyncError(selection.status === 'not_found' ? selection.reason : selection.reason);
  }
  const converted = await assessmentIntakeFromExport(bundle, {
    sourceSubmissionId: selection.sourceSubmissionId,
    expectedDealId: input.dealId,
  });
  if (converted.unresolvedEvidence.length) throw new AssessmentIntakeSyncError('evidence_reconciliation');
  if (converted.intake.sourceRevision !== selection.sourceRevision || converted.sourcePayloadHash !== selection.sourcePayloadHash) {
    throw new AssessmentIntakeSyncError('source_revision_reconciliation');
  }
  return { record, selection, bundle, intake: converted.intake, sourcePayloadHash: converted.sourcePayloadHash };
}

/**
 * Push one already-verified Assessment submission to a pending CRM handover.
 * This function only reads the immutable Assessment export and talks to the
 * dedicated CRM boundary.  It never retries or replays the Bitrix submission.
 */
export async function syncAssessmentIntake(input: AssessmentIntakeSyncOptions): Promise<AssessmentIntakeSyncResult> {
  if (!input.secret || input.secret.length < 32 || !input.crmOrigin || !input.sourceOrigin) {
    return { status: 'disabled', reason: 'assessment_intake_sync_not_configured' };
  }
  const crmOrigin = allowedOrigin(input.crmOrigin);
  const sourceOrigin = allowedOrigin(input.sourceOrigin);
  if (!crmOrigin || !sourceOrigin) return { status: 'failed', reason: 'assessment_intake_origin_invalid' };
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? (() => Date.now());
  let selected: Awaited<ReturnType<typeof selectSource>>;
  try {
    selected = await selectSource(input);
  } catch (error) {
    const reason = error instanceof AssessmentIntakeSyncError ? error.reason : 'source_reconciliation_required';
    if (['no_case', 'submission_not_found', 'no_submissions', 'no_active_submission'].includes(reason)) return { status: 'not_found', reason };
    if (['submission_pending', 'identity_reconciliation', 'selection_required', 'evidence_reconciliation', 'source_revision_reconciliation'].includes(reason)) return { status: 'pending', reason, sourceSubmissionId: input.sourceSubmissionId };
    return { status: 'failed', reason };
  }
  const { intake, sourcePayloadHash } = selected;
  const idempotencyKey = `assessment-intake:${input.dealId}:${intake.sourceSubmissionId}:${intake.sourceRevision}`.slice(0, 200);
  // The source envelope may carry display-only evidence fields such as
  // `documentId` and `person`.  CRM's signed boundary canonicalizes declared
  // artifact identities to these fields, so use the same bounded projection
  // for prepare, staging, request hashing, and finalize.  The full evidence
  // references remain preserved inside `assessmentIntake`.
  const artifacts = intake.evidence.map(({ externalArtifactId, sourceDocumentId, sha256, sizeBytes, originalName }) => ({
    externalArtifactId,
    sourceDocumentId,
    sha256,
    sizeBytes,
    originalName,
  }));
  const intakeIdentity = { ...intake } as Record<string, unknown>;
  delete intakeIdentity.sourceUrl;
  const requestHash = await sha256Hex(canonicalJsonStringify({
    externalDealId: input.dealId,
    sourceSubmissionId: intake.sourceSubmissionId,
    sourceRevision: intake.sourceRevision,
    sourceSubmissionHash: intake.sourceSubmissionHash,
    assessmentIntake: intakeIdentity,
    artifacts,
  }));
  const preparePayload = {
    operation: 'prepare_assessment_intake',
    externalDealId: input.dealId,
    sourceSubmissionId: intake.sourceSubmissionId,
    identityRevision: selected.selection.identityRevision,
    sourceRevision: intake.sourceRevision,
    sourcePayloadHash,
    sourceSubmissionHash: intake.sourceSubmissionHash,
    snapshotHash: intake.snapshotHash,
    artifacts,
    idempotencyKey,
    requestHash,
  };
  let prepared: Record<string, unknown>;
  try {
    const response = await signedRequest({ fetcher, url: endpoint(crmOrigin, '/api/crm/handovers/assessment-intake/prepare'), method: 'POST', body: canonicalJsonStringify(preparePayload), secret: input.secret, sourceOrigin, now, requestTimeoutMs: input.requestTimeoutMs });
    const body = await responseJson(response);
    if (!response.ok) {
      if (response.status === 404 || response.status === 409) return { status: 'pending', reason: typeof body.reason === 'string' ? body.reason : typeof body.error === 'string' ? body.error : 'handover_pending', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
      return { status: 'failed', reason: typeof body.error === 'string' ? body.error : 'crm_prepare_failed', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
    }
    const candidate = body.assessmentIntakePrepare;
    if (candidate !== undefined && (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))) {
      return { status: 'failed', reason: 'crm_prepare_response_invalid', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
    }
    prepared = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : body;
  } catch (error) {
    return { status: 'pending', reason: error instanceof AssessmentIntakeSyncError ? error.reason : 'crm_prepare_retryable', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
  }
  const handoverId = typeof prepared.handoverId === 'string' ? prepared.handoverId : typeof (prepared.handover as Record<string, unknown> | undefined)?.id === 'string' ? String((prepared.handover as Record<string, unknown>).id) : '';
  if (!handoverId) return { status: 'failed', reason: 'crm_prepare_target_invalid', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
  const targets = Array.isArray(prepared.artifacts) ? prepared.artifacts as Array<Record<string, unknown>> : [];
  try {
    for (const artifact of artifacts) {
      const document = await input.repository.document(selected.record.id, artifact.sourceDocumentId);
      if (!document || document.case_id !== selected.record.id || document.original_sha256 !== artifact.sha256 || document.byte_size !== artifact.sizeBytes || document.original_name !== artifact.originalName) {
        throw new AssessmentIntakeSyncError('source_document_identity_mismatch');
      }
      if (artifact.sizeBytes > MAX_DOCUMENT_BYTES) throw new AssessmentIntakeSyncError('source_document_too_large');
      const metadata = sourceMetadata(intake, sourcePayloadHash, artifact);
      const streamed = await replaySourceStream(await input.repository.originalStream(document), artifact.originalName);
      const contentType = streamed.contentType;
      const declaration = canonicalJsonStringify({ operation: 'stage_handover_artifact', handoverId, externalArtifactId: artifact.externalArtifactId, artifactKind: 'document', originalName: artifact.originalName, contentType, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256, metadata });
      const target = targets.find(item => item.externalArtifactId === artifact.externalArtifactId);
      const response = await signedRequest({
        fetcher,
        url: targetPath(target?.path ?? target?.url, crmOrigin, handoverId, artifact.externalArtifactId),
        method: 'PUT',
        body: streamed.body,
        signatureBody: declaration,
        secret: input.secret,
        sourceOrigin,
        now,
        requestTimeoutMs: input.requestTimeoutMs,
        headers: {
          'content-type': contentType,
          'x-antikrizis-artifact-kind': 'document',
          'x-antikrizis-artifact-name': encodeURIComponent(artifact.originalName),
          'x-antikrizis-artifact-metadata': headerBase64(metadata),
          'x-antikrizis-file-size': String(artifact.sizeBytes),
          'x-antikrizis-file-sha256': artifact.sha256,
          'x-antikrizis-signature-body': declaration,
          'x-antikrizis-assessment-declaration': declaration,
        },
      });
      // The artifact body is streamed; the signed declaration authenticates
      // its exact identity without buffering the original bytes.
      const artifactResponseBody = await response.text();
      if (artifactResponseBody.length > 4_000_000) throw new AssessmentIntakeSyncError('crm_response_too_large');
      if (!response.ok) return { status: 'pending', reason: response.status === 409 ? 'artifact_pending' : 'artifact_transfer_retryable', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
    }
    const finalPayload = canonicalJsonStringify({ externalDealId: input.dealId, sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, sourcePayloadHash, assessmentIntake: intake, artifacts, idempotencyKey, requestHash });
    const finalResponse = await signedRequest({ fetcher, url: endpoint(crmOrigin, '/api/crm/handovers/assessment-intake'), method: 'POST', body: finalPayload, secret: input.secret, sourceOrigin, now, requestTimeoutMs: input.requestTimeoutMs });
    const finalBody = await responseJson(finalResponse);
    if (!finalResponse.ok) return { status: finalResponse.status === 409 ? 'pending' : 'failed', reason: typeof finalBody.error === 'string' ? finalBody.error : 'crm_finalize_failed', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
    return { status: 'synced', duplicate: finalResponse.status === 200 || (finalBody.assessmentIntake as Record<string, unknown> | undefined)?.duplicate === true, sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
  } catch (error) {
    return { status: 'pending', reason: error instanceof AssessmentIntakeSyncError ? error.reason : 'crm_transfer_retryable', sourceSubmissionId: intake.sourceSubmissionId, sourceRevision: intake.sourceRevision, requestHash, idempotencyKey };
  }
}
