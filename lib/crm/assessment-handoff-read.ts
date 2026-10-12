import { canonicalJsonStringify } from './assessment-intake-export';
import { AssessmentIntakeAuthError, parseCanonicalJson, verifyAssessmentIntakeRequest, type AssessmentIntakeReplayStore } from './assessment-intake-auth';
import { sha256, type CaseRow, type EvidenceRepository } from '../documents/repository';
import { uploadBatchId } from '../documents/upload-plan';
import type { UploadManifest, UploadManifestRepository, UploadReceipt, UploadRow } from '../documents/upload-manifest';
import type { HandoffPayload, HandoffRepository } from '../questionnaire/handoff-repository';

const MAX_DOCUMENT_BYTES = 35 * 1024 * 1024;
const MAX_KEY_BYTES = 2 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[1-9]\d*$/u;
export type HandoffArtifact = {
  kind: 'power-of-attorney' | 'signed-contract' | 'credential';
  dealId: string;
  identityRevision: number;
  handoffRequestId: string;
  handoffPayloadHash: string;
  uploadRequestId: string;
  uploadPayloadHash: string;
  fileId: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  descriptorHash: string;
};
export type HandoffReadDependencies = {
  repository: Pick<EvidenceRepository, 'findCaseByExternal' | 'document' | 'credentialStatus'>;
  handoffs: Pick<HandoffRepository, 'active'>;
  manifests: Pick<UploadManifestRepository, 'get'>;
  environment: { secret?: string; approvedOrigin?: string };
  replayStore?: AssessmentIntakeReplayStore;
  now?: number;
  /** Production adapter refreshes Bitrix identity/membership and enforces this artifact's size ceiling. */
  readFile: (record: CaseRow, artifact: HandoffArtifact) => Promise<Uint8Array>;
};
class HandoffReadError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
function fail(code: string, status = 409): never { throw new HandoffReadError(`assessment_handoff_${code}`, status); }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
} });

async function verifiedUpload(row: UploadRow | null, record: CaseRow, credential: boolean) {
  if (!row || row.case_id !== record.id || row.identity_revision !== record.identity_revision || row.state !== 'verified' || !row.receipt_json) fail('upload_unverified');
  const manifest = JSON.parse(row.manifest_json) as UploadManifest;
  const receipt = JSON.parse(row.receipt_json) as UploadReceipt;
  if (!hashPattern.test(row.payload_hash) || await sha256(JSON.stringify({ manifest, identityRevision: row.identity_revision, actorId: row.actor_id })) !== row.payload_hash) fail('upload_changed');
  if (manifest.version !== 1 || (credential ? manifest.scope !== 'credentials' || manifest.credentialOwnerConfirmed !== true : manifest.scope !== undefined) || receipt.verified !== true) fail('upload_unverified');
  if (!Array.isArray(manifest.files) || !Array.isArray(receipt.files) || !manifest.files.length || manifest.files.length > (credential ? 10 : 1) || receipt.files.length !== manifest.files.length) fail('upload_invalid');
  if (new Set(manifest.files.map(file => file.sha256)).size !== manifest.files.length || new Set(receipt.files.map(file => file.id)).size !== receipt.files.length) fail('upload_invalid');
  let total = 0;
  for (const file of manifest.files) {
    if (!hashPattern.test(file.sha256) || !Number.isSafeInteger(file.byteSize) || file.byteSize <= 0 || file.byteSize > (credential ? MAX_KEY_BYTES : MAX_DOCUMENT_BYTES)) fail('upload_invalid');
    const matches = receipt.files.filter(ref => ref.sha256 === file.sha256 && idPattern.test(ref.id));
    if (matches.length !== 1) fail('upload_invalid');
    total += file.byteSize;
  }
  if (credential && total > MAX_KEY_BYTES) fail('upload_invalid');
  return { row, manifest, receipt };
}

/** Read-only selection: never sync a case, recover a receipt, or invoke the handoff service. */
async function selection(dealId: string, dependencies: HandoffReadDependencies) {
  const { repository, handoffs, manifests } = dependencies;
  const record = await repository.findCaseByExternal('bitrix', dealId);
  if (!record) fail('not_found', 404);
  if (record.external_system !== 'bitrix' || record.external_id !== dealId || !/^\d{12}$/u.test(record.client_iin ?? '') || !Number.isSafeInteger(record.identity_revision) || record.identity_revision < 1) fail('identity_changed');
  const handoff = await handoffs.active(record.id);
  if (!handoff) fail('not_found', 404);
  if (handoff.case_id !== record.id || handoff.identity_revision !== record.identity_revision || handoff.state !== 'verified') fail('not_verified');
  if (!hashPattern.test(handoff.payload_hash) || await sha256(handoff.payload_json) !== handoff.payload_hash) fail('changed');
  const payload = JSON.parse(handoff.payload_json) as HandoffPayload;
  if (!payload.powerId || !payload.signedId || payload.powerId === payload.signedId || !payload.credentialRequestId || payload.signedConfirmed !== true) fail('invalid');
  const credentials = await repository.credentialStatus(record);
  if (!credentials?.verified || credentials.identityRevision !== record.identity_revision || credentials.requestId !== payload.credentialRequestId) fail('credentials_changed');
  const artifacts: HandoffArtifact[] = [];
  const common = { dealId, identityRevision: record.identity_revision, handoffRequestId: handoff.request_id, handoffPayloadHash: handoff.payload_hash };
  async function append(upload: Awaited<ReturnType<typeof verifiedUpload>>, file: UploadManifest['files'][number], kind: HandoffArtifact['kind'], filename: string) {
    const ref = upload.receipt.files.find(item => item.sha256 === file.sha256)!;
    const descriptor = { ...common, kind, uploadRequestId: upload.row.request_id, uploadPayloadHash: upload.row.payload_hash, fileId: ref.id, sha256: file.sha256, sizeBytes: file.byteSize, filename };
    artifacts.push({ ...descriptor, descriptorHash: await sha256(canonicalJsonStringify(descriptor)) });
  }
  const ordinary = [
    { documentId: payload.powerId, kind: 'power-of-attorney' as const, filename: 'power-of-attorney.pdf' },
    { documentId: payload.signedId, kind: 'signed-contract' as const, filename: 'signed-contract-trustme.pdf' },
  ];
  for (const [index, selected] of ordinary.entries()) {
    const requestId = await uploadBatchId(handoff.request_id, index);
    const upload = await verifiedUpload(await manifests.get(record.id, requestId), record, false);
    const document = await repository.document(record.id, selected.documentId);
    const file = upload.manifest.files[0];
    if (upload.row.request_id !== requestId || upload.manifest.rootRequestId !== handoff.request_id || upload.manifest.batchIndex !== index || upload.manifest.planHash !== await sha256('handoff:' + handoff.request_id) || !document || document.case_id !== record.id || file.documentId !== document.id || file.sha256 !== document.original_sha256 || file.byteSize !== document.byte_size) fail('documents_changed');
    await append(upload, file, selected.kind, selected.filename);
  }
  const keys = await verifiedUpload(await manifests.get(record.id, payload.credentialRequestId), record, true);
  if (keys.row.request_id !== payload.credentialRequestId) fail('credentials_changed');
  for (const file of keys.manifest.files) {
    const extension = /\.(p12|pfx|key|jks)$/iu.exec(file.name)?.[0].toLowerCase();
    if (!extension) fail('credential_invalid');
    const ref = keys.receipt.files.find(item => item.sha256 === file.sha256)!;
    // Legacy source names can contain passwords. No source name enters this boundary.
    await append(keys, file, 'credential', `credential-${ref.id}${extension}`);
  }
  if (new Set(artifacts.map(item => item.fileId)).size !== artifacts.length) fail('upload_invalid');
  return { record, ...common, artifacts };
}

export async function handleAssessmentHandoffRead(request: Request, dealId: string, dependencies: HandoffReadDependencies): Promise<Response> {
  try {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const raw = await request.text();
    const body = parseCanonicalJson(raw);
    await verifyAssessmentIntakeRequest({ request, body: raw, secret: dependencies.environment.secret, approvedOrigin: dependencies.environment.approvedOrigin, replayStore: dependencies.replayStore, now: dependencies.now });
    if (!idPattern.test(dealId) || body.dealId !== dealId) fail('deal_mismatch', 400);
    if (body.operation !== 'assessment-handoff-list' && body.operation !== 'assessment-handoff-artifact') fail('operation_invalid', 400);
    const selected = await selection(dealId, dependencies);
    if (body.operation === 'assessment-handoff-list') return json({ status: 'ready', identityRevision: selected.identityRevision, handoffRequestId: selected.handoffRequestId, handoffPayloadHash: selected.handoffPayloadHash, artifacts: selected.artifacts });
    if (!body.descriptor || typeof body.descriptor !== 'object' || Array.isArray(body.descriptor)) fail('descriptor_invalid', 400);
    const descriptor = canonicalJsonStringify(body.descriptor);
    const artifact = selected.artifacts.find(item => canonicalJsonStringify(item) === descriptor);
    if (!artifact) fail('descriptor_changed');
    const bytes = await dependencies.readFile(selected.record, artifact);
    if (bytes.byteLength !== artifact.sizeBytes || await sha256(bytes) !== artifact.sha256) fail('content_changed');
    // Credentials or identity may have changed while the remote file was read.
    const after = await selection(dealId, dependencies);
    if (after.record.id !== selected.record.id || after.record.client_iin !== selected.record.client_iin || !after.artifacts.some(item => canonicalJsonStringify(item) === descriptor)) fail('descriptor_changed');
    return new Response(new Uint8Array(bytes).buffer, { headers: {
      'content-type': artifact.kind === 'credential' ? 'application/octet-stream' : 'application/pdf',
      'content-disposition': `attachment; filename="${artifact.filename}"`,
      'content-length': String(bytes.byteLength),
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-content-sha256': artifact.sha256,
    } });
  } catch (error) {
    if (error instanceof HandoffReadError || error instanceof AssessmentIntakeAuthError) return json({ error: error.code }, error.status);
    // Never forward source filenames, signed links, manifests or exception messages.
    return json({ error: 'assessment_handoff_source_unavailable' }, 503);
  }
}
