/**
 * Convert the authenticated Assessment export shape into the CRM handover
 * envelope.  This module is deliberately a pure boundary adapter: it never
 * reads a file, calls Bitrix, or turns a card/narrative into a fact.
 *
 * `sourceSubmissionId` is an explicit selector.  A timestamp is not a source
 * identity.  The immutable SQLite row sequence is required and becomes the
 * CRM source revision; a case identity revision alone can collide across
 * multiple verified submissions and is therefore not accepted.
 */

export const ASSESSMENT_INTAKE_KIND = 'assessment-intake' as const;
export const ASSESSMENT_INTAKE_VERSION = 1 as const;
const MAX_SOURCE_REVISION = 2_147_483_647;

export type AssessmentAnswerSnapshot = {
  key: string;
  value: string;
  checked: boolean;
  clientConfirmed?: true;
  sourceReplaced?: true;
};

export type AssessmentAnswersSnapshot = {
  schemaVersion: 1;
  answers: AssessmentAnswerSnapshot[];
  groups: Array<{
    id: string;
    rows: AssessmentAnswerSnapshot[][];
    rowKeys: (string | null)[];
  }>;
  docContext: {
    social: string;
    salary: string;
    salaryBank?: 'kaspi' | 'other' | 'none' | '';
  };
  documents: Array<{ documentId: string; type: string; person: string }>;
  pendingFiles: string[];
};

export type AssessmentEvidenceReference = {
  externalArtifactId: string;
  sourceDocumentId: string;
  sha256: string;
  sizeBytes: number;
  originalName: string;
  documentId?: string;
  person?: string;
};

export type AssessmentIntakeEnvelope = {
  kind: typeof ASSESSMENT_INTAKE_KIND;
  version: typeof ASSESSMENT_INTAKE_VERSION;
  source: 'assessment-card';
  sourceDealId: string;
  sourceSubmissionId: string;
  sourceSubmission: Record<string, unknown>;
  sourceSubmissionHash: string;
  sourceRevision: number;
  snapshotHash: string;
  assessedAt: string;
  sourceUrl?: string;
  answers: AssessmentAnswersSnapshot;
  evidence: AssessmentEvidenceReference[];
};

export type UnresolvedAssessmentEvidence = {
  index: number;
  documentId: string;
  reason: 'document_missing' | 'foreign_case' | 'identity_mismatch' | 'duplicate_identity' | 'review_not_selected';
};

export type AssessmentIntakeExportResult = {
  intake: AssessmentIntakeEnvelope;
  /** The immutable submission-row hash, verified independently of intake hashes. */
  sourcePayloadHash: string;
  unresolvedEvidence: UnresolvedAssessmentEvidence[];
};

type UnknownRecord = Record<string, unknown>;

export type AssessmentExportCase = {
  id: string;
  external_system: string;
  external_id: string;
  identity_revision: number;
};

export type AssessmentExportDocument = {
  id: string;
  case_id: string;
  original_sha256: string;
  byte_size: number;
  original_name: string;
};

export type AssessmentExportSubmission = {
  id: string;
  case_id: string;
  identity_revision: number;
  state: string;
  actor_id: string;
  payload_hash: string;
  sequence: number;
  /** Present on new rows; absent/`contract` on legacy rows. */
  kind?: string;
  payload?: unknown;
  payload_json?: string;
};

export type AssessmentExportBundle = {
  case: AssessmentExportCase;
  documents: AssessmentExportDocument[];
  submissions: AssessmentExportSubmission[];
};

export type AssessmentIntakeExportOptions = {
  sourceSubmissionId: string;
  expectedDealId?: string;
  sourceUrl?: string;
};

export type AssessmentSubmissionSelection =
  | { status: 'not_found'; reason: 'no_submissions' | 'no_active_submission' }
  | { status: 'pending'; reason: 'identity_reconciliation' | 'submission_pending' | 'selection_required'; caseId: string; identityRevision: number; sourceSubmissionId?: string }
  | { status: 'ready'; caseId: string; sourceSubmissionId: string; identityRevision: number; sourceRevision: number; sourcePayloadHash: string };

export class AssessmentIntakeExportError extends Error {
  constructor(public code: string, message = code) {
    super(message);
  }
}

const isObject = (value: unknown): value is UnknownRecord =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function fail(code: string, message = code): never {
  throw new AssessmentIntakeExportError(code, message);
}

function requiredText(value: unknown, code: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(code);
  return value;
}

function optionalText(value: unknown, code: string, max: number): void {
  if (value !== undefined && (typeof value !== 'string' || value.length > max)) fail(code);
}

function boundedRevision(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_SOURCE_REVISION) fail(code);
  return Number(value);
}

/** Match the canonical CRM serializer without importing the CRM application. */
export function canonicalJsonStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJsonStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function parseJson(value: string, code: string): unknown {
  try { return JSON.parse(value); } catch { fail(code); }
}

function answer(value: unknown, path: string): AssessmentAnswerSnapshot {
  if (!isObject(value)) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', path);
  const key = requiredText(value.key, 'ASSESSMENT_SUBMISSION_DRAFT_INVALID', 160);
  if (typeof value.value !== 'string' || value.value.length > 8_000 || typeof value.checked !== 'boolean') {
    fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', path);
  }
  if (value.clientConfirmed !== undefined && value.clientConfirmed !== true) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', path);
  if (value.sourceReplaced !== undefined && value.sourceReplaced !== true) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', path);
  return {
    key,
    value: value.value,
    checked: value.checked,
    ...(value.clientConfirmed === true ? { clientConfirmed: true } : {}),
    ...(value.sourceReplaced === true ? { sourceReplaced: true } : {}),
  };
}

function answerList(value: unknown, path: string): AssessmentAnswerSnapshot[] {
  if (!Array.isArray(value) || value.length > 300) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', path);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const parsed = answer(item, `${path}[${index}]`);
    if (seen.has(parsed.key)) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', path);
    seen.add(parsed.key);
    return parsed;
  });
}

function draft(value: unknown): AssessmentAnswersSnapshot {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.groups) || value.groups.length > 64) {
    fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
  }
  const groupIds = new Set<string>();
  const groups = value.groups.map((raw, index) => {
    if (!isObject(raw)) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', `groups[${index}]`);
    const id = requiredText(raw.id, 'ASSESSMENT_SUBMISSION_DRAFT_INVALID', 120);
    if (groupIds.has(id) || !Array.isArray(raw.rows) || raw.rows.length > 200) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
    groupIds.add(id);
    const rows = raw.rows.map((row, rowIndex) => answerList(row, `groups[${index}].rows[${rowIndex}]`));
    const rowKeys = raw.rowKeys === undefined ? rows.map(() => null) : raw.rowKeys;
    if (!Array.isArray(rowKeys) || rowKeys.length !== rows.length) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
    const usedKeys = new Set<string>();
    const normalizedRowKeys = rowKeys.map(key => {
      if (key === null) return null;
      if (typeof key !== 'string' || key.length > 500 || !key.startsWith(`${id}|`) || usedKeys.has(key)) {
        fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
      }
      usedKeys.add(key);
      return key;
    });
    return { id, rows, rowKeys: normalizedRowKeys };
  });
  if (!isObject(value.docContext) || typeof value.docContext.social !== 'string' || typeof value.docContext.salary !== 'string') {
    fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
  }
  const salaryBank = value.docContext.salaryBank;
  if (salaryBank !== undefined && !['kaspi', 'other', 'none', ''].includes(String(salaryBank))) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
  if (!Array.isArray(value.documents) || value.documents.length > 300 || !Array.isArray(value.pendingFiles) || value.pendingFiles.length > 300) {
    fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
  }
  const documents = value.documents.map((raw, index) => {
    if (!isObject(raw) || typeof raw.documentId !== 'string' || typeof raw.type !== 'string' || typeof raw.person !== 'string') {
      fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID', `documents[${index}]`);
    }
    return { documentId: raw.documentId, type: raw.type, person: raw.person };
  });
  if (value.pendingFiles.some(file => typeof file !== 'string' || file.length > 240)) fail('ASSESSMENT_SUBMISSION_DRAFT_INVALID');
  return {
    schemaVersion: 1,
    answers: answerList(value.answers, 'answers'),
    groups,
    docContext: { social: value.docContext.social, salary: value.docContext.salary, ...(salaryBank !== undefined ? { salaryBank: salaryBank as AssessmentAnswersSnapshot['docContext']['salaryBank'] } : {}) },
    documents,
    pendingFiles: value.pendingFiles,
  };
}

function payload(value: unknown): UnknownRecord {
  // A profile-only submission is an explicit, additive shape: it carries the
  // validated draft and provenance but no contract, renderer, EDS or document
  // data. Anything that claims `profileOnly` must satisfy exactly this shape.
  if (isObject(value) && value.profileOnly === true) {
    if (value.schemaVersion !== 1 || !isObject(value.draft)) fail('ASSESSMENT_SUBMISSION_PAYLOAD_INVALID');
    draft(value.draft);
    if (typeof value.assessmentDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.assessmentDay))) fail('ASSESSMENT_SUBMISSION_PAYLOAD_INVALID');
    if (!Array.isArray(value.reviewIds) || value.reviewIds.length > 1_500 || value.reviewIds.some(id => typeof id !== 'string' || !id || id.length > 160)) {
      fail('ASSESSMENT_SUBMISSION_PAYLOAD_INVALID');
    }
    if (!Array.isArray(value.evidence) || value.evidence.length > 1_500) fail('ASSESSMENT_SUBMISSION_EVIDENCE_INVALID');
    for (const ref of value.evidence) {
      if (!isObject(ref) || typeof ref.documentId !== 'string' || !ref.documentId || ref.documentId.length > 200 || typeof ref.reviewId !== 'string' || !ref.reviewId) {
        fail('ASSESSMENT_SUBMISSION_EVIDENCE_INVALID');
      }
      optionalText(ref.documentSha256, 'ASSESSMENT_SUBMISSION_EVIDENCE_INVALID', 64);
      optionalText(ref.documentName, 'ASSESSMENT_SUBMISSION_EVIDENCE_INVALID', 500);
    }
    return value;
  }
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.baseline) || !isObject(value.values) || !isObject(value.contractData)) {
    fail('ASSESSMENT_SUBMISSION_PAYLOAD_INVALID');
  }
  draft(value.draft);
  for (const key of ['contractRendererVersion', 'lawyerCard', 'validationVersion', 'assessmentDay']) {
    if (typeof value[key] !== 'string' || !value[key] || value[key].length > (key === 'lawyerCard' ? 250_000 : 500)) fail('ASSESSMENT_SUBMISSION_PAYLOAD_INVALID');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.assessmentDay))) fail('ASSESSMENT_SUBMISSION_PAYLOAD_INVALID');
  if (!Array.isArray(value.reviewIds) || value.reviewIds.length > 1_500 || value.reviewIds.some(id => typeof id !== 'string' || !id || id.length > 160)) {
    fail('ASSESSMENT_SUBMISSION_PAYLOAD_INVALID');
  }
  if (!Array.isArray(value.evidence) || value.evidence.length > 1_500) fail('ASSESSMENT_SUBMISSION_EVIDENCE_INVALID');
  for (const ref of value.evidence) {
    if (!isObject(ref) || typeof ref.documentId !== 'string' || !ref.documentId || ref.documentId.length > 200 || typeof ref.reviewId !== 'string' || !ref.reviewId) {
      fail('ASSESSMENT_SUBMISSION_EVIDENCE_INVALID');
    }
    optionalText(ref.documentSha256, 'ASSESSMENT_SUBMISSION_EVIDENCE_INVALID', 64);
    optionalText(ref.documentName, 'ASSESSMENT_SUBMISSION_EVIDENCE_INVALID', 500);
  }
  return value;
}

function rowsFromInput(input: unknown): { case: UnknownRecord; documents: unknown[]; submissions: unknown[] } {
  if (typeof input === 'string') {
    const rows = input.split(/\r?\n/).filter(Boolean).map(line => parseJson(line, 'ASSESSMENT_EXPORT_INVALID'));
    return rowsFromInput(rows);
  }
  if (Array.isArray(input)) {
    const manifest = input.find(row => isObject(row) && row.type === 'manifest') as UnknownRecord | undefined;
    const caseRow = manifest?.case;
    if (!isObject(caseRow)) fail('ASSESSMENT_EXPORT_CASE_MISSING');
    return {
      case: caseRow,
      documents: input.filter(row => isObject(row) && row.type === 'document'),
      submissions: input.filter(row => isObject(row) && row.type === 'assessment-submission'),
    };
  }
  if (!isObject(input)) fail('ASSESSMENT_EXPORT_INVALID');
  if (Array.isArray(input.rows)) return rowsFromInput(input.rows);
  if (!isObject(input.case) || !Array.isArray(input.documents) || !Array.isArray(input.submissions)) fail('ASSESSMENT_EXPORT_INVALID');
  return { case: input.case, documents: input.documents, submissions: input.submissions };
}

function documentRow(value: unknown): AssessmentExportDocument {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.case_id !== 'string' || typeof value.original_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.original_sha256) || !Number.isSafeInteger(value.byte_size) || Number(value.byte_size) <= 0 ||
    typeof value.original_name !== 'string' || !value.original_name || value.original_name.length > 500) fail('ASSESSMENT_EXPORT_DOCUMENT_INVALID');
  return { id: value.id, case_id: value.case_id, original_sha256: value.original_sha256, byte_size: Number(value.byte_size), original_name: value.original_name };
}

function submissionRow(value: unknown): AssessmentExportSubmission {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id || value.id.length > 200 || typeof value.case_id !== 'string' ||
    !Number.isSafeInteger(value.identity_revision) || Number(value.identity_revision) < 1 || typeof value.state !== 'string' ||
    typeof value.actor_id !== 'string' || !value.actor_id || value.actor_id.length > 200 ||
    typeof value.payload_hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.payload_hash)) {
    fail('ASSESSMENT_EXPORT_SUBMISSION_INVALID');
  }
  if (value.sequence === undefined) fail('ASSESSMENT_EXPORT_SEQUENCE_INVALID');
  boundedRevision(value.sequence, 'ASSESSMENT_EXPORT_SEQUENCE_INVALID');
  if (value.payload !== undefined && !isObject(value.payload)) fail('ASSESSMENT_EXPORT_SUBMISSION_INVALID');
  if (value.payload_json !== undefined && (typeof value.payload_json !== 'string' || value.payload_json.length > 1_500_000)) fail('ASSESSMENT_EXPORT_SUBMISSION_INVALID');
  if (value.payload === undefined && value.payload_json === undefined) fail('ASSESSMENT_EXPORT_PAYLOAD_MISSING');
  return value as unknown as AssessmentExportSubmission;
}

function sourceRevision(row: AssessmentExportSubmission, identityRevision: number): number {
  // The argument remains part of the call so the case revision check cannot
  // be accidentally removed while changing the export projection.
  boundedRevision(identityRevision, 'ASSESSMENT_EXPORT_REVISION_INVALID');
  return boundedRevision(row.sequence, 'ASSESSMENT_EXPORT_SEQUENCE_INVALID');
}

/**
 * Select the source-owned committed row for a handover-first sync.  This is
 * intentionally sequence based: timestamps and SubmissionRepository.latest
 * can prefer an unfinished row and are not a source identity.
 */
export function selectAssessmentSubmissionFromExport(input: unknown): AssessmentSubmissionSelection {
  const parsed = rowsFromInput(input);
  const sourceCase = parsed.case;
  if (typeof sourceCase.id !== 'string' || !sourceCase.id || sourceCase.external_system !== 'bitrix'
    || typeof sourceCase.external_id !== 'string' || !sourceCase.external_id) {
    throw new AssessmentIntakeExportError('ASSESSMENT_EXPORT_CASE_INVALID');
  }
  const identityRevision = Number(sourceCase.identity_revision);
  if (!Number.isSafeInteger(identityRevision) || identityRevision < 1 || identityRevision > MAX_SOURCE_REVISION) {
    throw new AssessmentIntakeExportError('ASSESSMENT_EXPORT_REVISION_INVALID');
  }
  if (!parsed.submissions.length) return { status: 'not_found', reason: 'no_submissions' };
  const rows = parsed.submissions.filter(isObject);
  const active = rows.filter(row => row.state !== 'cancelled');
  if (!active.length) return { status: 'not_found', reason: 'no_active_submission' };
  const current = active.filter(row => row.identity_revision === identityRevision);
  if (!current.length) {
    return { status: 'pending', reason: 'identity_reconciliation', caseId: sourceCase.id, identityRevision };
  }
  const sequenced = current.every(row => Number.isSafeInteger(row.sequence) && Number(row.sequence) >= 1 && Number(row.sequence) <= MAX_SOURCE_REVISION);
  if (!sequenced) return { status: 'pending', reason: 'identity_reconciliation', caseId: sourceCase.id, identityRevision };
  // A contract submission always wins over a profile-only one. A profile save
  // must never displace the contract snapshot the existing flow produced; it is
  // only selected when no contract submission exists for this revision.
  const contractRows = current.filter(row => row.kind !== 'profile');
  const profileRows = current.filter(row => row.kind === 'profile');
  const selectable = contractRows.length ? contractRows : profileRows;
  const newest = [...selectable].sort((left, right) => Number(right.sequence) - Number(left.sequence))[0];
  if (newest.state === 'prepared' || newest.state === 'writing' || newest.state === 'uncertain') {
    return { status: 'pending', reason: 'submission_pending', caseId: sourceCase.id, identityRevision, sourceSubmissionId: typeof newest.id === 'string' ? newest.id : undefined };
  }
  if (newest.state !== 'verified') {
    return { status: 'pending', reason: 'selection_required', caseId: sourceCase.id, identityRevision };
  }
  const verified = selectable.filter(row => row.state === 'verified' && typeof row.id === 'string' && row.id
    && typeof row.payload_hash === 'string' && /^[a-f0-9]{64}$/.test(row.payload_hash)
    && typeof row.actor_id === 'string' && row.actor_id && (row.payload !== undefined || row.payload_json !== undefined))
    .sort((left, right) => Number(right.sequence) - Number(left.sequence));
  const selected = verified[0];
  if (!selected) return { status: 'pending', reason: 'identity_reconciliation', caseId: sourceCase.id, identityRevision };
  return {
    status: 'ready',
    caseId: sourceCase.id,
    sourceSubmissionId: String(selected.id),
    identityRevision,
    sourceRevision: Number(selected.sequence),
    sourcePayloadHash: String(selected.payload_hash),
  };
}

/**
 * Select and convert one explicitly named committed submission.  Unresolved
 * evidence remains in `sourceSubmission.evidence`; only exact same-case
 * document identities enter the reusable CRM `evidence` list.
 */
export async function assessmentIntakeFromExport(input: unknown, options: AssessmentIntakeExportOptions): Promise<AssessmentIntakeExportResult> {
  const selectedId = requiredText(options.sourceSubmissionId, 'ASSESSMENT_SUBMISSION_ID_INVALID', 200);
  const parsed = rowsFromInput(input);
  const sourceCase = parsed.case;
  if (typeof sourceCase.id !== 'string' || !sourceCase.id || typeof sourceCase.external_system !== 'string' || sourceCase.external_system !== 'bitrix' ||
    typeof sourceCase.external_id !== 'string' || !sourceCase.external_id || sourceCase.external_id.length > 160) fail('ASSESSMENT_EXPORT_CASE_INVALID');
  if (options.expectedDealId !== undefined && sourceCase.external_id !== options.expectedDealId) fail('ASSESSMENT_EXPORT_DEAL_MISMATCH');
  const identityRevision = boundedRevision(sourceCase.identity_revision, 'ASSESSMENT_EXPORT_REVISION_INVALID');
  const submissions = parsed.submissions.map(submissionRow);
  const selected = submissions.filter(row => row.id === selectedId);
  if (selected.length !== 1) fail(selected.length ? 'ASSESSMENT_EXPORT_SUBMISSION_DUPLICATE' : 'ASSESSMENT_EXPORT_SUBMISSION_NOT_FOUND');
  const submission = selected[0];
  if (submission.case_id !== sourceCase.id) fail('ASSESSMENT_EXPORT_SUBMISSION_CASE_MISMATCH');
  if (submission.identity_revision !== identityRevision) fail('ASSESSMENT_EXPORT_SUBMISSION_REVISION_MISMATCH');
  if (submission.state !== 'verified') fail('ASSESSMENT_EXPORT_SUBMISSION_NOT_VERIFIED');
  const sourceSubmission = submission.payload !== undefined ? submission.payload : parseJson(String(submission.payload_json), 'ASSESSMENT_EXPORT_PAYLOAD_INVALID');
  const parsedPayload = payload(sourceSubmission);
  const sourceSubmissionJson = canonicalJsonStringify(parsedPayload);
  if (sourceSubmissionJson.length > 1_500_000) fail('ASSESSMENT_EXPORT_SOURCE_SUBMISSION_TOO_LARGE');
  const sourcePayloadHash = await sha256Hex(JSON.stringify({ payload: parsedPayload, identityRevision: submission.identity_revision, actorId: submission.actor_id }));
  if (sourcePayloadHash !== submission.payload_hash) fail('ASSESSMENT_EXPORT_PAYLOAD_HASH_MISMATCH');
  const answers = draft(parsedPayload.draft) as AssessmentAnswersSnapshot;
  const sourceSubmissionHash = await sha256Hex(sourceSubmissionJson);
  const snapshotHash = await sha256Hex(canonicalJsonStringify(answers));
  const documents = parsed.documents.map(documentRow);
  const sameCase = new Map<string, AssessmentExportDocument>();
  const foreignIds = new Set<string>();
  for (const document of documents) {
    if (document.case_id === sourceCase.id) {
      if (sameCase.has(document.id)) fail('ASSESSMENT_EXPORT_DOCUMENT_DUPLICATE');
      sameCase.set(document.id, document);
    } else foreignIds.add(document.id);
  }
  const personByDocument = new Map(answers.documents.map(document => [document.documentId, document.person]));
  const unresolvedEvidence: UnresolvedAssessmentEvidence[] = [];
  const evidence: AssessmentEvidenceReference[] = [];
  const seenArtifactIds = new Set<string>();
  const selectedReviewIds = new Set(parsedPayload.reviewIds as string[]);
  for (const [index, raw] of (parsedPayload.evidence as UnknownRecord[]).entries()) {
    const ref = raw as UnknownRecord;
    const documentId = String(ref.documentId);
    if (!selectedReviewIds.has(String(ref.reviewId))) {
      unresolvedEvidence.push({ index, documentId, reason: 'review_not_selected' });
      continue;
    }
    const document = sameCase.get(documentId);
    if (!document) {
      unresolvedEvidence.push({ index, documentId, reason: foreignIds.has(documentId) ? 'foreign_case' : 'document_missing' });
      continue;
    }
    const hashMismatch = ref.documentSha256 !== undefined && ref.documentSha256 !== document.original_sha256;
    const nameMismatch = ref.documentName !== undefined && ref.documentName !== document.original_name;
    const sizeMismatch = ref.sizeBytes !== undefined && ref.sizeBytes !== document.byte_size;
    if (hashMismatch || nameMismatch || sizeMismatch) {
      unresolvedEvidence.push({ index, documentId, reason: 'identity_mismatch' });
      continue;
    }
    const externalArtifactId = `assessment-document:${document.id}`;
    if (seenArtifactIds.has(externalArtifactId)) {
      // One staged source artifact serves every selected fact-level reference
      // to the same exact document. The complete list remains in the raw
      // sourceSubmission snapshot.
      continue;
    }
    seenArtifactIds.add(externalArtifactId);
    evidence.push({
      externalArtifactId,
      sourceDocumentId: document.id,
      sha256: document.original_sha256,
      sizeBytes: document.byte_size,
      originalName: document.original_name,
      documentId: document.id,
      ...(personByDocument.get(document.id) ? { person: personByDocument.get(document.id) } : {}),
    });
  }
  const sourceUrl = options.sourceUrl;
  if (sourceUrl !== undefined && (sourceUrl.length > 2_000 || !/^(https?:|\/)/.test(sourceUrl))) fail('ASSESSMENT_EXPORT_SOURCE_URL_INVALID');
  return {
    intake: {
      kind: ASSESSMENT_INTAKE_KIND,
      version: ASSESSMENT_INTAKE_VERSION,
      source: 'assessment-card',
      sourceDealId: sourceCase.external_id,
      sourceSubmissionId: submission.id,
      sourceSubmission: parsedPayload,
      sourceSubmissionHash,
      sourceRevision: sourceRevision(submission, identityRevision),
      snapshotHash,
      assessedAt: String(parsedPayload.assessmentDay),
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      answers,
      evidence,
    },
    sourcePayloadHash,
    unresolvedEvidence,
  };
}
