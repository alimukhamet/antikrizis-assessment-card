import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, webcrypto } from 'node:crypto';

function load(file) {
  const exports = {};
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, crypto: webcrypto, TextEncoder, Uint8Array, Set, Map, Date, JSON });
  return exports;
}

const converter = load('lib/crm/assessment-intake-export.ts');
const sha256 = value => createHash('sha256').update(value).digest('hex');

const draft = {
  schemaVersion: 1,
  answers: [
    { key: 'fio', value: 'Синтетический клиент', checked: true },
    { key: 'count-clientjobs', value: '2', checked: true },
    { key: 'future:structured', value: 'сохраняется', checked: true },
  ],
  groups: [{ id: 'clientjobs', rows: [
    [{ key: 'n8001', value: '250000', checked: true }],
    [{ key: 'n8001', value: '125000', checked: true }],
  ], rowKeys: ['clientjobs|1', 'clientjobs|2'] }],
  docContext: { social: '0', salary: '0' },
  documents: [{ documentId: 'assessment-doc-1', type: 'ГКБ', person: 'Клиент' }],
  pendingFiles: [],
};

const payload = {
  schemaVersion: 1,
  draft,
  baseline: { iin: '000000000001', card: 'old' },
  values: { iin: '000000000001', card: 'new' },
  contractData: { source: 'structured snapshot' },
  contractRendererVersion: 'assessment-contract-test',
  lawyerCard: 'Сумма из narrative: не является структурированным фактом.',
  historyCard: 'Полная история ответа сохраняется как источник.',
  reviewIds: ['review-1', 'review-duplicate', 'review-foreign', 'review-missing', 'review-mismatch'],
  evidence: [
    { documentId: 'assessment-doc-1', reviewId: 'review-1', documentSha256: 'a'.repeat(64), documentName: 'GKB.pdf' },
    { documentId: 'assessment-doc-1', reviewId: 'review-duplicate', documentSha256: 'a'.repeat(64), documentName: 'GKB.pdf' },
    { documentId: 'assessment-doc-1', reviewId: 'review-not-selected', documentSha256: 'a'.repeat(64), documentName: 'GKB.pdf' },
    { documentId: 'foreign-doc', reviewId: 'review-foreign', documentSha256: 'b'.repeat(64), documentName: 'foreign.pdf' },
    { documentId: 'missing-doc', reviewId: 'review-missing' },
    { documentId: 'assessment-doc-1', reviewId: 'review-mismatch', documentSha256: 'c'.repeat(64), documentName: 'wrong.pdf' },
  ],
  validationVersion: 'assessment-final-test',
  assessmentDay: '2026-09-15',
};

function row(overrides = {}) {
  const actorId = 'worker:ramazan';
  const identityRevision = 4;
  return {
    id: 'sub-verified', case_id: 'case-1', identity_revision: identityRevision,
    actor_id: actorId, state: 'verified', sequence: 73,
    payload, payload_hash: sha256(JSON.stringify({ payload, identityRevision, actorId })),
    ...overrides,
  };
}

function bundle(overrides = {}) {
  return {
    case: { id: 'case-1', external_system: 'bitrix', external_id: '11665', identity_revision: 4 },
    documents: [
      { id: 'assessment-doc-1', case_id: 'case-1', original_sha256: 'a'.repeat(64), byte_size: 12, original_name: 'GKB.pdf' },
      { id: 'foreign-doc', case_id: 'other-case', original_sha256: 'b'.repeat(64), byte_size: 12, original_name: 'foreign.pdf' },
    ],
    submissions: [row(), { ...row(), id: 'sub-prepared', state: 'prepared', sequence: 74 }],
    ...overrides,
  };
}

test('converts one explicitly selected verified export row and keeps all source fields', async () => {
  const result = await converter.assessmentIntakeFromExport(bundle(), {
    sourceSubmissionId: 'sub-verified', expectedDealId: '11665', sourceUrl: '/api/assessment/11665/export',
  });
  assert.equal(result.intake.sourceSubmissionId, 'sub-verified');
  assert.equal(result.intake.sourceRevision, 73);
  assert.deepEqual(result.intake.sourceSubmission, payload);
  assert.equal(result.sourcePayloadHash, row().payload_hash);
  assert.equal(result.intake.answers.answers.find(answer => answer.key === 'future:structured').value, 'сохраняется');
  assert.deepEqual(JSON.parse(JSON.stringify(result.intake.evidence)), [{
    externalArtifactId: 'assessment-document:assessment-doc-1', sourceDocumentId: 'assessment-doc-1',
    sha256: 'a'.repeat(64), sizeBytes: 12, originalName: 'GKB.pdf', documentId: 'assessment-doc-1', person: 'Клиент',
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.unresolvedEvidence)), [
    { index: 2, documentId: 'assessment-doc-1', reason: 'review_not_selected' },
    { index: 3, documentId: 'foreign-doc', reason: 'foreign_case' },
    { index: 4, documentId: 'missing-doc', reason: 'document_missing' },
    { index: 5, documentId: 'assessment-doc-1', reason: 'identity_mismatch' },
  ]);
});

test('accepts the actual NDJSON row shape and hashes draft and complete payload separately', async () => {
  const source = bundle();
  const rows = [
    { type: 'manifest', schemaVersion: 2, format: 'assessment-ndjson', case: source.case },
    ...source.documents.map(document => ({ type: 'document', ...document })),
    { type: 'assessment-submission', ...source.submissions[0], payload_json: undefined },
    { type: 'complete', documents: source.documents.length, submissions: source.submissions.length },
  ];
  const result = await converter.assessmentIntakeFromExport(rows.map(JSON.stringify).join('\n'), { sourceSubmissionId: 'sub-verified' });
  assert.equal(result.intake.sourceDealId, '11665');
  assert.equal(result.intake.snapshotHash, sha256(converter.canonicalJsonStringify(draft)));
  assert.equal(result.intake.sourceSubmissionHash, sha256(converter.canonicalJsonStringify(payload)));
  assert.notEqual(result.intake.snapshotHash, result.sourcePayloadHash);
});

test('fails closed for missing explicit selection, unverified or foreign submissions, and a changed row hash', async () => {
  await assert.rejects(() => converter.assessmentIntakeFromExport(bundle(), { sourceSubmissionId: 'sub-prepared' }), /ASSESSMENT_EXPORT_SUBMISSION_NOT_VERIFIED/);
  await assert.rejects(() => converter.assessmentIntakeFromExport(bundle(), { sourceSubmissionId: 'not-selected' }), /ASSESSMENT_EXPORT_SUBMISSION_NOT_FOUND/);
  await assert.rejects(() => converter.assessmentIntakeFromExport(bundle({ submissions: [{ ...row(), case_id: 'other-case' }] }), { sourceSubmissionId: 'sub-verified' }), /ASSESSMENT_EXPORT_SUBMISSION_CASE_MISMATCH/);
  await assert.rejects(() => converter.assessmentIntakeFromExport(bundle({ submissions: [{ ...row(), payload_hash: 'd'.repeat(64) }] }), { sourceSubmissionId: 'sub-verified' }), /ASSESSMENT_EXPORT_PAYLOAD_HASH_MISMATCH/);
  await assert.rejects(() => converter.assessmentIntakeFromExport(bundle(), { sourceSubmissionId: 'sub-verified', expectedDealId: '99999' }), /ASSESSMENT_EXPORT_DEAL_MISMATCH/);
  const withoutSequence = row();
  delete withoutSequence.sequence;
  await assert.rejects(() => converter.assessmentIntakeFromExport(bundle({ submissions: [withoutSequence] }), { sourceSubmissionId: 'sub-verified' }), /ASSESSMENT_EXPORT_SEQUENCE_INVALID/);
});

test('selects the greatest current verified sequence and blocks unfinished or stale identities', () => {
  const selected = converter.selectAssessmentSubmissionFromExport(bundle({ submissions: [
    { ...row(), id: 'sub-old', sequence: 71 },
    { ...row(), id: 'sub-new', sequence: 73 },
    { ...row(), id: 'sub-prepared-newest', sequence: 74, state: 'prepared' },
  ] }));
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), {
    status: 'pending', reason: 'submission_pending', caseId: 'case-1', identityRevision: 4,
    sourceSubmissionId: 'sub-prepared-newest',
  });
  const ready = converter.selectAssessmentSubmissionFromExport(bundle({ submissions: [
    { ...row(), id: 'sub-old', sequence: 71 },
    { ...row(), id: 'sub-new', sequence: 73 },
  ] }));
  assert.deepEqual(JSON.parse(JSON.stringify(ready)), {
    status: 'ready', caseId: 'case-1', sourceSubmissionId: 'sub-new', identityRevision: 4,
    sourceRevision: 73, sourcePayloadHash: row().payload_hash,
  });
  const stale = converter.selectAssessmentSubmissionFromExport(bundle({
    case: { ...bundle().case, identity_revision: 5 },
  }));
  assert.equal(stale.status, 'pending');
  assert.equal(stale.reason, 'identity_reconciliation');
});
