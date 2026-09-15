import {
  AssessmentIntakeExportError,
  assessmentIntakeFromExport,
  canonicalJsonStringify,
  selectAssessmentSubmissionFromExport,
  type AssessmentExportBundle,
  type AssessmentIntakeEnvelope,
} from './assessment-intake-export';
import {
  AssessmentIntakeAuthError,
  decodeCanonicalHeader,
  parseCanonicalJson,
  verifyAssessmentIntakeRequest,
  type AssessmentIntakeReplayStore,
} from './assessment-intake-auth';
import type { CaseRow, DocumentRow, EvidenceRepository } from '../documents/repository';

const MAX_SOURCE_REVISION = 2_147_483_647;
const MAX_DOCUMENT_BYTES = 35 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/u;

export type AssessmentIntakeReadEnvironment = {
  secret?: string;
  approvedOrigin?: string;
};

export type AssessmentIntakeReadRepository = Pick<
  EvidenceRepository,
  'findCaseByExternal' | 'exportCase' | 'document' | 'original' | 'originalStream' | 'credentialStatus'
>;

export type AssessmentIntakeReadDependencies = {
  repository: AssessmentIntakeReadRepository;
  environment: AssessmentIntakeReadEnvironment;
  replayStore?: AssessmentIntakeReplayStore;
  now?: number;
};

export class AssessmentIntakeReadError extends Error {
  constructor(public readonly code: string, public readonly status = 409, public readonly details?: unknown) {
    super(code);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AssessmentIntakeAuthError || error instanceof AssessmentIntakeReadError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof AssessmentIntakeExportError) {
    return json({ error: 'assessment_intake_reconciliation_required', reason: error.code }, 409);
  }
  return json({ error: 'assessment_intake_source_unavailable' }, 503);
}

function requiredText(value: unknown, code: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new AssessmentIntakeReadError(code, 400);
  }
  return value;
}

function positiveRevision(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_SOURCE_REVISION) {
    throw new AssessmentIntakeReadError(code, 400);
  }
  return Number(value);
}

function optionalPositiveRevision(value: unknown, code: string): number | undefined {
  return value === undefined ? undefined : positiveRevision(value, code);
}

function optionalHash(value: unknown, code: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !hashPattern.test(value)) throw new AssessmentIntakeReadError(code, 400);
  return value;
}

function sourceCase(repository: AssessmentIntakeReadRepository, dealId: string): Promise<CaseRow | null> {
  return repository.findCaseByExternal('bitrix', dealId);
}

function caseStatus(
  repository: AssessmentIntakeReadRepository,
  record: CaseRow,
  sourceSubmissionId: string,
  expectedIdentityRevision: number,
): Promise<{ record: CaseRow; bundle: AssessmentExportBundle; submission: Record<string, unknown> }> {
  return repository.exportCase(record.id).then(bundle => {
    const submissions = Array.isArray(bundle.submissions) ? bundle.submissions as unknown[] : [];
    const matches = submissions.filter(item => item && typeof item === 'object' && (item as Record<string, unknown>).id === sourceSubmissionId);
    if (matches.length !== 1) {
      if (!submissions.length) throw new AssessmentIntakeReadError('assessment_intake_not_found', 404);
      throw new AssessmentIntakeReadError('assessment_intake_submission_selection_required', 409);
    }
    const submission = matches[0] as Record<string, unknown>;
    if (submission.state !== 'verified') {
      throw new AssessmentIntakeReadError('assessment_intake_submission_pending', 409);
    }
    if (submission.identity_revision !== record.identity_revision || submission.identity_revision !== expectedIdentityRevision) {
      throw new AssessmentIntakeReadError('assessment_intake_identity_reconciliation_required', 409);
    }
    return { record, bundle, submission };
  });
}

function manifestBody(record: CaseRow, result: Awaited<ReturnType<typeof assessmentIntakeFromExport>>) {
  const intake = result.intake;
  return {
    status: 'ready' as const,
    manifest: {
      kind: intake.kind,
      version: intake.version,
      source: intake.source,
      sourceDealId: intake.sourceDealId,
      sourceSubmissionId: intake.sourceSubmissionId,
      identityRevision: record.identity_revision,
      sourceRevision: intake.sourceRevision,
      sourcePayloadHash: result.sourcePayloadHash,
      sourceSubmissionHash: intake.sourceSubmissionHash,
      snapshotHash: intake.snapshotHash,
      assessedAt: intake.assessedAt,
      artifacts: intake.evidence,
    },
    intake,
  };
}

async function readManifest(request: Request, dealId: string, dependencies: AssessmentIntakeReadDependencies): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const raw = await request.text();
  const body = parseCanonicalJson(raw);
  await verifyAssessmentIntakeRequest({
    request,
    body: raw,
    secret: dependencies.environment.secret,
    approvedOrigin: dependencies.environment.approvedOrigin,
    replayStore: dependencies.replayStore,
    now: dependencies.now,
  });
  if (body.operation !== 'assessment-intake-manifest') throw new AssessmentIntakeReadError('assessment_intake_operation_invalid', 400);
  if (body.dealId !== dealId) throw new AssessmentIntakeReadError('assessment_intake_deal_mismatch', 409);
  const sourceSubmissionId = requiredText(body.sourceSubmissionId, 'assessment_intake_submission_id_invalid', 200);
  const identityRevision = positiveRevision(body.identityRevision, 'assessment_intake_identity_revision_invalid');
  const expectedSourceRevision = optionalPositiveRevision(body.sourceRevision, 'assessment_intake_source_revision_invalid');
  const expectedSourcePayloadHash = optionalHash(body.sourcePayloadHash, 'assessment_intake_source_payload_hash_invalid');
  const record = await sourceCase(dependencies.repository, dealId);
  if (!record) return json({ status: 'not_found', reason: 'no_case' }, 404);
  const selected = await caseStatus(dependencies.repository, record, sourceSubmissionId, identityRevision);
  let result: Awaited<ReturnType<typeof assessmentIntakeFromExport>>;
  try {
    result = await assessmentIntakeFromExport(selected.bundle, {
      sourceSubmissionId,
      expectedDealId: dealId,
      sourceUrl: new URL(request.url).origin + `/api/assessment/${encodeURIComponent(dealId)}/crm-intake`,
    });
  } catch (error) {
    if (error instanceof AssessmentIntakeExportError && error.code === 'ASSESSMENT_EXPORT_PAYLOAD_HASH_MISMATCH') {
      throw new AssessmentIntakeReadError('assessment_intake_reconciliation_required', 409);
    }
    throw error;
  }
  if (expectedSourceRevision !== undefined && result.intake.sourceRevision !== expectedSourceRevision) {
    throw new AssessmentIntakeReadError('assessment_intake_source_revision_mismatch', 409);
  }
  if (expectedSourcePayloadHash !== undefined && result.sourcePayloadHash !== expectedSourcePayloadHash) {
    throw new AssessmentIntakeReadError('assessment_intake_source_payload_hash_mismatch', 409);
  }
  if (result.unresolvedEvidence.length) {
    return json({
      status: 'pending',
      reason: 'evidence_reconciliation_required',
      sourceSubmissionId,
      sourceRevision: result.intake.sourceRevision,
      unresolvedEvidence: result.unresolvedEvidence,
    }, 409);
  }
  return json({ ...manifestBody(record, result) }, 200);
}

async function readSelection(request: Request, dealId: string, dependencies: AssessmentIntakeReadDependencies): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const raw = await request.text();
  const body = parseCanonicalJson(raw);
  await verifyAssessmentIntakeRequest({
    request,
    body: raw,
    secret: dependencies.environment.secret,
    approvedOrigin: dependencies.environment.approvedOrigin,
    replayStore: dependencies.replayStore,
    now: dependencies.now,
  });
  if (body.operation !== 'assessment-intake-select') throw new AssessmentIntakeReadError('assessment_intake_operation_invalid', 400);
  if (body.dealId !== dealId) throw new AssessmentIntakeReadError('assessment_intake_deal_mismatch', 409);
  const requestedIdentityRevision = body.identityRevision === undefined
    ? undefined
    : positiveRevision(body.identityRevision, 'assessment_intake_identity_revision_invalid');
  const record = await sourceCase(dependencies.repository, dealId);
  if (!record) return json({ status: 'not_found', reason: 'no_case' }, 404);
  if (requestedIdentityRevision !== undefined && requestedIdentityRevision !== record.identity_revision) {
    return json({ status: 'pending', reason: 'identity_reconciliation', identityRevision: record.identity_revision }, 409);
  }
  const selection = selectAssessmentSubmissionFromExport(await dependencies.repository.exportCase(record.id));
  if (selection.status === 'not_found') return json(selection, 404);
  if (selection.status === 'pending') return json(selection, 409);
  return json({ status: 'ready', selection }, 200);
}

export async function handleAssessmentIntakeManifest(
  request: Request,
  dealId: string,
  dependencies: AssessmentIntakeReadDependencies,
): Promise<Response> {
  try {
    const preview = parseCanonicalJson(await request.clone().text());
    return preview.operation === 'assessment-intake-select'
      ? await readSelection(request, dealId, dependencies)
      : await readManifest(request, dealId, dependencies);
  } catch (error) {
    return errorResponse(error);
  }
}

function fileRequest(body: Record<string, unknown>, dealId: string, documentId: string) {
  if (body.operation !== 'assessment-intake-artifact') throw new AssessmentIntakeReadError('assessment_intake_operation_invalid', 400);
  if (body.dealId !== dealId) throw new AssessmentIntakeReadError('assessment_intake_deal_mismatch', 409);
  if (body.documentId !== documentId) throw new AssessmentIntakeReadError('assessment_intake_document_mismatch', 409);
  return {
    sourceSubmissionId: requiredText(body.sourceSubmissionId, 'assessment_intake_submission_id_invalid', 200),
    identityRevision: positiveRevision(body.identityRevision, 'assessment_intake_identity_revision_invalid'),
    sourceRevision: positiveRevision(body.sourceRevision, 'assessment_intake_source_revision_invalid'),
    sourcePayloadHash: requiredText(body.sourcePayloadHash, 'assessment_intake_source_payload_hash_invalid', 64),
    sourceSubmissionHash: requiredText(body.sourceSubmissionHash, 'assessment_intake_source_submission_hash_invalid', 64),
    sha256: requiredText(body.sha256, 'assessment_intake_document_hash_invalid', 64),
    sizeBytes: positiveRevision(body.sizeBytes, 'assessment_intake_document_size_invalid'),
    originalName: requiredText(body.originalName, 'assessment_intake_document_name_invalid', 500),
  };
}

async function readDocument(request: Request, dealId: string, documentId: string, dependencies: AssessmentIntakeReadDependencies): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const body = decodeCanonicalHeader(request.headers.get('x-antikrizis-assessment-request'));
  await verifyAssessmentIntakeRequest({
    request,
    body: canonicalJsonStringify(body),
    secret: dependencies.environment.secret,
    approvedOrigin: dependencies.environment.approvedOrigin,
    replayStore: dependencies.replayStore,
    now: dependencies.now,
  });
  const requested = fileRequest(body, dealId, documentId);
  if (!hashPattern.test(requested.sourcePayloadHash) || !hashPattern.test(requested.sourceSubmissionHash) || !hashPattern.test(requested.sha256)) {
    throw new AssessmentIntakeReadError('assessment_intake_document_identity_invalid', 400);
  }
  if (requested.sizeBytes > MAX_DOCUMENT_BYTES) throw new AssessmentIntakeReadError('assessment_intake_document_too_large', 413);
  const record = await sourceCase(dependencies.repository, dealId);
  if (!record) throw new AssessmentIntakeReadError('assessment_intake_not_found', 404);
  const selected = await caseStatus(dependencies.repository, record, requested.sourceSubmissionId, requested.identityRevision);
  const result = await assessmentIntakeFromExport(selected.bundle, {
    sourceSubmissionId: requested.sourceSubmissionId,
    expectedDealId: dealId,
  });
  if (result.intake.sourceRevision !== requested.sourceRevision || result.sourcePayloadHash !== requested.sourcePayloadHash
    || result.intake.sourceSubmissionHash !== requested.sourceSubmissionHash) {
    throw new AssessmentIntakeReadError('assessment_intake_source_identity_mismatch', 409);
  }
  const credentialStatus = await dependencies.repository.credentialStatus(record);
  if (credentialStatus?.files?.some(file => file.id === documentId)) {
    throw new AssessmentIntakeReadError('assessment_intake_credential_forbidden', 403);
  }
  const document = await dependencies.repository.document(record.id, documentId);
  if (!document || document.case_id !== record.id) throw new AssessmentIntakeReadError('assessment_intake_document_not_found', 404);
  const declared = result.intake.evidence.find(item => item.sourceDocumentId === document.id);
  if (!declared) throw new AssessmentIntakeReadError('assessment_intake_document_not_declared', 409);
  if (declared.sha256 !== requested.sha256 || declared.sizeBytes !== requested.sizeBytes || declared.originalName !== requested.originalName
    || document.original_sha256 !== requested.sha256 || document.byte_size !== requested.sizeBytes || document.original_name !== requested.originalName) {
    throw new AssessmentIntakeReadError('assessment_intake_document_identity_mismatch', 409);
  }
  const stream = await dependencies.repository.originalStream(document);
  return new Response(stream, {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.original_name)}`,
      'content-length': String(requested.sizeBytes),
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'x-antikrizis-source-sha256': document.original_sha256,
    },
  });
}

export async function handleAssessmentIntakeDocument(
  request: Request,
  dealId: string,
  documentId: string,
  dependencies: AssessmentIntakeReadDependencies,
): Promise<Response> {
  try {
    return await readDocument(request, dealId, documentId, dependencies);
  } catch (error) {
    return errorResponse(error);
  }
}
