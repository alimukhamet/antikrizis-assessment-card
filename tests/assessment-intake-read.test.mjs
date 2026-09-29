import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, webcrypto } from 'node:crypto';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const cache = new Map();

function resolveModule(parent, specifier) {
  if (!specifier.startsWith('.')) throw new Error(`Unexpected external module ${specifier}`);
  let file = path.resolve(path.dirname(parent), specifier);
  if (!path.extname(file)) file += '.ts';
  return file;
}

function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loadedModule = { exports: {} };
  cache.set(filename, loadedModule);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    module: loadedModule,
    exports: loadedModule.exports,
    require: specifier => load(resolveModule(filename, specifier)),
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Request,
    Response,
    Headers,
    URL,
    ReadableStream,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    Date,
    JSON,
    Object,
    Math,
    Number,
    String,
    RegExp,
    Error,
    TypeError,
    atob,
    btoa,
  };
  vm.runInNewContext(output, context, { filename });
  return loadedModule.exports;
}

const converter = load('lib/crm/assessment-intake-export.ts');
const read = load('lib/crm/assessment-intake-read.ts');
const secret = 'assessment-intake-source-secret-for-tests-32-bytes';
const approvedOrigin = 'https://crm.example.test';
const dealId = '11665';
const identityRevision = 4;
const sourceSubmissionId = 'submission-verified';
const actorId = 'worker:ramazan';
const bytes = new TextEncoder().encode('%PDF-1.7\nsource evidence bytes\n');
const documentHash = createHash('sha256').update(bytes).digest('hex');

const draft = {
  schemaVersion: 1,
  answers: [{ key: 'income', value: '250000', checked: true }],
  groups: [],
  docContext: { social: '', salary: '' },
  documents: [{ documentId: 'doc-1', type: 'identity', person: 'client' }],
  pendingFiles: [],
};
const payload = {
  schemaVersion: 1,
  draft,
  baseline: { source: 'assessment' },
  values: { explicit: { income: '250000' } },
  contractData: { reviewed: false },
  contractRendererVersion: 'test-contract',
  lawyerCard: 'Narrative stays in the source snapshot.',
  historyCard: 'History stays in the source snapshot.',
  reviewIds: ['review-1'],
  evidence: [{ documentId: 'doc-1', reviewId: 'review-1', documentSha256: documentHash, documentName: 'source.pdf' }],
  validationVersion: 'test-validation',
  assessmentDay: '2026-09-15',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const row = {
  id: sourceSubmissionId,
  case_id: 'case-1',
  identity_revision: identityRevision,
  state: 'verified',
  actor_id: actorId,
  sequence: 37,
  payload,
  payload_hash: sha256(JSON.stringify({ payload, identityRevision, actorId })),
};

function bundle(overrides = {}) {
  return {
    case: { id: 'case-1', external_system: 'bitrix', external_id: dealId, identity_revision: identityRevision },
    documents: [{ id: 'doc-1', case_id: 'case-1', original_sha256: documentHash, byte_size: bytes.byteLength, original_name: 'source.pdf' }],
    submissions: [row],
    ...overrides,
  };
}

function repository(overrides = {}) {
  const current = bundle();
  const document = current.documents[0];
  return {
    async findCaseByExternal(system, externalId) {
      if (system !== 'bitrix' || externalId !== dealId || overrides.noCase) return null;
      return { id: 'case-1', external_system: 'bitrix', external_id: dealId, client_iin: null, identity_revision: identityRevision, title: 'Test', created_at: '', updated_at: '' };
    },
    async exportCase() { return overrides.bundle ?? current; },
    async document(caseId, documentId) {
      return caseId === 'case-1' && documentId === 'doc-1' ? document : null;
    },
    async credentialStatus() { return overrides.credentials ? { files: [{ id: 'doc-1' }] } : null; },
    async originalStream() {
      return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    },
  };
}

async function signature(timestamp, body) {
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  return `sha256=${[...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function manifestRequest(body, now = Date.now(), signatureOverride) {
  const raw = converter.canonicalJsonStringify(body);
  const timestamp = String(now);
  return new Request(`https://assessment.example.test/api/assessment/${dealId}/crm-intake`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-antikrizis-source-origin': approvedOrigin,
      'x-antikrizis-timestamp': timestamp,
      'x-antikrizis-signature': signatureOverride ?? await signature(timestamp, raw),
    },
    body: raw,
  });
}

function dependencies(overrides = {}, replayStore = new Map(), now = Date.now()) {
  return { repository: repository(overrides), environment: { secret, approvedOrigin }, replayStore, now };
}

async function readyManifest(overrides = {}) {
  const body = { operation: 'assessment-intake-manifest', dealId, sourceSubmissionId, identityRevision };
  const response = await read.handleAssessmentIntakeManifest(await manifestRequest(body), dealId, dependencies(overrides));
  return { response, body, parsed: await response.json() };
}

test('returns a ready manifest only for the exact current verified submission', async () => {
  const { response, parsed } = await readyManifest();
  assert.equal(response.status, 200);
  assert.equal(parsed.status, 'ready');
  assert.equal(parsed.manifest.sourceRevision, 37);
  assert.equal(parsed.manifest.artifacts[0].sourceDocumentId, 'doc-1');
  assert.deepEqual(parsed.intake.sourceSubmission, payload);
});

test('rejects a bad signature and consumes a signed operation only once', async () => {
  const body = { operation: 'assessment-intake-manifest', dealId, sourceSubmissionId, identityRevision };
  const now = Date.now();
  const store = new Map();
  const valid = await manifestRequest(body, now);
  const first = await read.handleAssessmentIntakeManifest(valid, dealId, dependencies({}, store, now));
  assert.equal(first.status, 200);
  const replay = await read.handleAssessmentIntakeManifest(await manifestRequest(body, now, valid.headers.get('x-antikrizis-signature')), dealId, dependencies({}, store, now));
  assert.equal(replay.status, 409);
  const bad = await read.handleAssessmentIntakeManifest(await manifestRequest(body, now, 'sha256=' + '0'.repeat(64)), dealId, dependencies({}, new Map(), now));
  assert.equal(bad.status, 401);
});

test('distinguishes no case, pending submission, wrong deal, and wrong submission', async () => {
  const noCase = await readyManifest({ noCase: true });
  assert.equal(noCase.response.status, 404);
  assert.deepEqual(noCase.parsed, { status: 'not_found', reason: 'no_case' });

  const pending = await readyManifest({ bundle: bundle({ submissions: [{ ...row, state: 'prepared' }] }) });
  assert.equal(pending.response.status, 409);
  assert.equal(pending.parsed.error, 'assessment_intake_submission_pending');

  const wrongDealBody = { operation: 'assessment-intake-manifest', dealId: 'other-deal', sourceSubmissionId, identityRevision };
  const wrongDeal = await read.handleAssessmentIntakeManifest(await manifestRequest(wrongDealBody), dealId, dependencies());
  assert.equal(wrongDeal.status, 409);
  assert.equal((await wrongDeal.json()).error, 'assessment_intake_deal_mismatch');

  const wrongSubmission = await readyManifest({ bundle: bundle({ submissions: [{ ...row, id: 'other-submission' }] }) });
  assert.equal(wrongSubmission.response.status, 409);
  assert.equal(wrongSubmission.parsed.error, 'assessment_intake_submission_selection_required');
});

function documentRequest(descriptor, now = Date.now(), signatureOverride) {
  const raw = converter.canonicalJsonStringify(descriptor);
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(raw))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  return signature(now, raw).then(value => new Request(`https://assessment.example.test/api/assessment/${dealId}/crm-intake/documents/doc-1`, {
    method: 'GET',
    headers: {
      'x-antikrizis-assessment-request': encoded,
      'x-antikrizis-source-origin': approvedOrigin,
      'x-antikrizis-timestamp': String(now),
      'x-antikrizis-signature': signatureOverride ?? value,
    },
  }));
}

test('serves only the declared same-case original document and denies credential identities', async () => {
  const { parsed } = await readyManifest();
  const descriptor = {
    operation: 'assessment-intake-artifact',
    dealId,
    sourceSubmissionId,
    identityRevision,
    sourceRevision: parsed.manifest.sourceRevision,
    sourcePayloadHash: parsed.manifest.sourcePayloadHash,
    sourceSubmissionHash: parsed.manifest.sourceSubmissionHash,
    documentId: 'doc-1',
    sha256: documentHash,
    sizeBytes: bytes.byteLength,
    originalName: 'source.pdf',
  };
  const served = await read.handleAssessmentIntakeDocument(await documentRequest(descriptor), dealId, 'doc-1', dependencies());
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), bytes);

  const wrongDocument = await read.handleAssessmentIntakeDocument(await documentRequest({ ...descriptor, documentId: 'foreign-doc' }), dealId, 'foreign-doc', dependencies());
  assert.equal(wrongDocument.status, 404);

  const credential = await read.handleAssessmentIntakeDocument(await documentRequest(descriptor), dealId, 'doc-1', dependencies({ credentials: true }));
  assert.equal(credential.status, 403);
});

const poaBytes = new TextEncoder().encode('%PDF-1.7\nclient power of attorney\n');
const poaHash = createHash('sha256').update(poaBytes).digest('hex');
const poaDraft = { ...draft, documents: [...draft.documents, { documentId: 'poa-1', type: 'Доверенность', person: 'Клиент' }, { documentId: 'poa-spouse', type: 'Доверенность', person: 'Супруг(а)' }] };
const poaPayload = { ...payload, draft: poaDraft };
const poaRow = { ...row, payload: poaPayload, payload_hash: sha256(JSON.stringify({ payload: poaPayload, identityRevision, actorId })) };
const poaDocument = { id: 'poa-1', case_id: 'case-1', original_sha256: poaHash, byte_size: poaBytes.byteLength, original_name: 'Document CLIENT.pdf' };
const spouseDocument = { id: 'poa-spouse', case_id: 'case-1', original_sha256: 'a'.repeat(64), byte_size: 10, original_name: 'spouse.pdf' };

function poaRepository(overrides = {}) {
  const current = bundle({ documents: [...bundle().documents, poaDocument, spouseDocument], submissions: [poaRow] });
  return {
    ...repository(overrides),
    async exportCase() { return overrides.bundle ?? current; },
    async document(caseId, documentId) { return current.documents.find(item => item.case_id === caseId && item.id === documentId) ?? null; },
    async credentialStatus() { return overrides.credentials ? { files: [{ id: 'poa-1' }] } : null; },
    async originalStream() { return new ReadableStream({ start(controller) { controller.enqueue(poaBytes); controller.close(); } }); },
  };
}

function poaDependencies(overrides = {}) {
  return { repository: poaRepository(overrides), environment: { secret, approvedOrigin }, replayStore: new Map(), now: Date.now() };
}

async function poaList(overrides = {}) {
  const response = await read.handleAssessmentIntakeManifest(await manifestRequest({ operation: 'assessment-power-of-attorney', dealId }), dealId, poaDependencies(overrides));
  return { response, parsed: await response.json() };
}

test('lists only the client доверенность typed in the current verified submission', async () => {
  const { response, parsed } = await poaList();
  assert.equal(response.status, 200);
  assert.equal(parsed.status, 'ready');
  assert.equal(parsed.sourceSubmissionId, sourceSubmissionId);
  assert.deepEqual(parsed.documents, [{ sourceDocumentId: 'poa-1', sha256: poaHash, sizeBytes: poaBytes.byteLength, originalName: 'Document CLIENT.pdf' }]);

  const none = await read.handleAssessmentIntakeManifest(await manifestRequest({ operation: 'assessment-power-of-attorney', dealId }), dealId, dependencies());
  assert.equal(none.status, 404);
  assert.deepEqual(await none.json(), { status: 'not_found', reason: 'no_power_of_attorney' });

  const credential = await poaList({ credentials: true });
  assert.equal(credential.response.status, 404);

  const noCase = await poaList({ noCase: true });
  assert.deepEqual(noCase.parsed, { status: 'not_found', reason: 'no_case' });
});

test('serves the listed доверенность bytes and nothing outside the list', async () => {
  const { parsed } = await poaList();
  const descriptor = {
    operation: 'assessment-power-of-attorney-artifact',
    dealId,
    documentId: 'poa-1',
    sourceSubmissionId,
    sourcePayloadHash: parsed.sourcePayloadHash,
    sha256: poaHash,
    sizeBytes: poaBytes.byteLength,
    originalName: 'Document CLIENT.pdf',
  };
  const request = (value, documentId = 'poa-1') => documentRequest(value).then(built => new Request(built.url.replace(/doc-1$/u, documentId), { headers: built.headers }));
  const served = await read.handleAssessmentIntakeDocument(await request(descriptor), dealId, 'poa-1', poaDependencies());
  assert.equal(served.status, 200);
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), poaBytes);

  const spouse = await read.handleAssessmentIntakeDocument(await request({ ...descriptor, documentId: 'poa-spouse' }, 'poa-spouse'), dealId, 'poa-spouse', poaDependencies());
  assert.equal(spouse.status, 409);
  assert.equal((await spouse.json()).error, 'assessment_intake_document_not_declared');

  const evidence = await read.handleAssessmentIntakeDocument(await request({ ...descriptor, documentId: 'doc-1' }, 'doc-1'), dealId, 'doc-1', poaDependencies());
  assert.equal(evidence.status, 409);

  const wrongHash = await read.handleAssessmentIntakeDocument(await request({ ...descriptor, sha256: 'b'.repeat(64) }), dealId, 'poa-1', poaDependencies());
  assert.equal(wrongHash.status, 409);
  assert.equal((await wrongHash.json()).error, 'assessment_intake_document_identity_mismatch');

  const credential = await read.handleAssessmentIntakeDocument(await request(descriptor), dealId, 'poa-1', poaDependencies({ credentials: true }));
  assert.equal(credential.status, 409);
});
