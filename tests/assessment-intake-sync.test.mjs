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
  const module = { exports: {} };
  cache.set(filename, module);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
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
    AbortController,
    setTimeout,
    clearTimeout,
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
  }, { filename });
  return module.exports;
}

const converter = load('lib/crm/assessment-intake-export.ts');
const sync = load('lib/crm/assessment-intake-sync.ts');
const secret = 'assessment-intake-source-secret-for-tests-32-bytes';
const dealId = '11665';
const sourceSubmissionId = 'submission-verified';
const identityRevision = 4;
const sourceRevision = 37;
const bytes = new TextEncoder().encode('%PDF-1.7\nsource evidence bytes\n');
const documentHash = createHash('sha256').update(bytes).digest('hex');

const payload = {
  schemaVersion: 1,
  draft: {
    schemaVersion: 1,
    answers: [{ key: 'income', value: '250000', checked: true }],
    groups: [],
    docContext: { social: '', salary: '' },
    documents: [{ documentId: 'doc-1', type: 'identity', person: 'client' }],
    pendingFiles: [],
  },
  baseline: { source: 'assessment' },
  values: { explicit: { income: '250000' } },
  contractData: { reviewed: false },
  contractRendererVersion: 'test-contract',
  lawyerCard: 'Narrative is preserved as source only.',
  historyCard: 'History is preserved as source only.',
  reviewIds: ['review-1'],
  evidence: [{ documentId: 'doc-1', reviewId: 'review-1', documentSha256: documentHash, documentName: 'source.pdf' }],
  validationVersion: 'test-validation',
  assessmentDay: '2026-09-15',
};
const actorId = 'worker:ramazan';
const row = {
  id: sourceSubmissionId,
  case_id: 'case-1',
  identity_revision: identityRevision,
  state: 'verified',
  actor_id: actorId,
  sequence: sourceRevision,
  payload,
  payload_hash: createHash('sha256').update(JSON.stringify({ payload, identityRevision, actorId })).digest('hex'),
};
const bundle = {
  case: { id: 'case-1', external_system: 'bitrix', external_id: dealId, identity_revision: identityRevision },
  documents: [{ id: 'doc-1', case_id: 'case-1', original_sha256: documentHash, byte_size: bytes.byteLength, original_name: 'source.pdf' }],
  submissions: [row],
};

function repository(counters = {}, sourceBundle = bundle, sourceBytes = bytes) {
  const document = sourceBundle.documents[0];
  return {
    async findCaseByExternal(system, externalId) {
      counters.findCase = (counters.findCase ?? 0) + 1;
      return system === 'bitrix' && externalId === dealId
        ? { id: 'case-1', external_system: 'bitrix', external_id: dealId, client_iin: null, identity_revision: identityRevision, title: 'Test', created_at: '', updated_at: '' }
        : null;
    },
    async exportCase() { counters.export = (counters.export ?? 0) + 1; return sourceBundle; },
    async document(caseId, documentId) {
      counters.document = (counters.document ?? 0) + 1;
      return caseId === 'case-1' && documentId === 'doc-1' ? document : null;
    },
    async originalStream() {
      counters.originalStream = (counters.originalStream ?? 0) + 1;
      return new ReadableStream({ start(controller) { controller.enqueue(sourceBytes); controller.close(); } });
    },
  };
}

function prepareBody() {
  return {
    assessmentIntakePrepare: {
      handoverId: 'handover-1',
      artifacts: [{ externalArtifactId: 'assessment-document:doc-1', path: '/api/crm/handovers/handover-1/artifacts/assessment-document%3Adoc-1' }],
    },
  };
}

function jsonResponse(value, status = 200) {
  return Response.json(value, { status });
}

test('keeps a verified Assessment submission retryable when the pending handover is absent', async () => {
  const calls = [];
  const result = await sync.syncAssessmentIntake({
    dealId,
    repository: repository(),
    secret,
    crmOrigin: 'https://crm.example.test',
    sourceOrigin: 'https://assessment.example.test',
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ error: 'assessment_intake_handover_missing' }, 404);
    },
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'assessment_intake_handover_missing');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/assessment-intake\/prepare$/u);
});

test('pushes one exact original artifact through prepare and finalize without Bitrix resubmission', async () => {
  const counters = {};
  const calls = [];
  const result = await sync.syncAssessmentIntake({
    dealId,
    repository: repository(counters),
    secret,
    crmOrigin: 'https://crm.example.test',
    sourceOrigin: 'https://assessment.example.test',
    fetcher: async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      calls.push({ pathname, init });
      if (pathname.endsWith('/prepare')) return jsonResponse(prepareBody());
      if (pathname.includes('/artifacts/')) {
        assert.equal(init.headers['content-type'], 'application/pdf');
        assert.equal(init.headers['x-antikrizis-file-sha256'], documentHash);
        assert.equal(init.redirect, 'error');
        const transferred = new Uint8Array(await new Response(init.body).arrayBuffer());
        assert.deepEqual(transferred, bytes);
        return jsonResponse({ artifact: { duplicate: false } }, 201);
      }
      assert.equal(pathname, '/api/crm/handovers/assessment-intake');
      assert.equal(init.redirect, 'error');
      const final = JSON.parse(init.body);
      assert.equal(final.sourcePayloadHash, row.payload_hash);
      return jsonResponse({ assessmentIntake: { duplicate: false } }, 201);
    },
  });
  assert.equal(result.status, 'synced');
  assert.equal(result.duplicate, false);
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(call => call.pathname.includes('/artifacts/')).length, 1);
  assert.equal(counters.originalStream, 1);
  assert.equal(counters.findCase, 1);
});

test('re-signs a lost finalize response and converges on idempotent retry', async () => {
  const calls = [];
  let finalAttempts = 0;
  let clock = Date.now();
  const options = {
    dealId,
    repository: repository(),
    secret,
    crmOrigin: 'https://crm.example.test',
    sourceOrigin: 'https://assessment.example.test',
    now: () => ++clock,
    fetcher: async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      calls.push({ pathname, init });
      if (pathname.endsWith('/prepare')) return jsonResponse(prepareBody());
      if (pathname.includes('/artifacts/')) {
        await new Response(init.body).arrayBuffer();
        return jsonResponse({ artifact: { duplicate: true } }, 200);
      }
      finalAttempts += 1;
      if (finalAttempts === 1) throw new Error('network lost after commit');
      return jsonResponse({ assessmentIntake: { duplicate: true } }, 200);
    },
  };
  const first = await sync.syncAssessmentIntake(options);
  const second = await sync.syncAssessmentIntake(options);
  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'synced');
  assert.equal(second.duplicate, true);
  assert.equal(finalAttempts, 2);
  assert.equal(calls.filter(call => call.pathname.includes('/artifacts/')).length, 2);
  assert.equal(new Set(calls.filter(call => call.pathname.includes('/artifacts/')).map(call => call.init.headers['x-antikrizis-file-sha256'])).size, 1);
  const timestamps = calls.map(call => call.init.headers['x-antikrizis-timestamp']);
  assert.ok(new Set(timestamps).size > 1);
});

test('sniffs a CMS original named .pdf and preserves it as pkcs7-mime', async () => {
  const der = (tag, ...parts) => {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const lengths = [];
    for (let value = size; value > 0; value = Math.floor(value / 256)) lengths.unshift(value % 256);
    return new Uint8Array([tag, ...(size < 128 ? [size] : [0x80 | lengths.length, ...lengths]), ...parts.flatMap(part => [...part])]);
  };
  const int = der(0x02, new Uint8Array([1]));
  const oid = last => der(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, last]));
  const algorithm = der(0x30, der(0x06, new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01])));
  const content = der(0x30, oid(1), der(0xa0, der(0x04, new TextEncoder().encode('private signed source data'))));
  const signer = der(0x30, int, der(0x80, new Uint8Array([1, 2, 3])), algorithm, algorithm, der(0x04, new Uint8Array([4, 5, 6])));
  const cmsBytes = der(0x30, oid(2), der(0xa0, der(0x30, int, der(0x31, algorithm), content, der(0x31, signer))));
  const cmsHash = createHash('sha256').update(cmsBytes).digest('hex');
  const cmsPayload = { ...payload, evidence: [{ ...payload.evidence[0], documentSha256: cmsHash }] };
  const cmsRow = { ...row, payload: cmsPayload, payload_hash: createHash('sha256').update(JSON.stringify({ payload: cmsPayload, identityRevision, actorId })).digest('hex') };
  const cmsBundle = { ...bundle, documents: [{ ...bundle.documents[0], original_sha256: cmsHash, byte_size: cmsBytes.byteLength }], submissions: [cmsRow] };
  let contentType;
  const result = await sync.syncAssessmentIntake({
    dealId,
    repository: repository({}, cmsBundle, cmsBytes),
    secret,
    crmOrigin: 'https://crm.example.test',
    sourceOrigin: 'https://assessment.example.test',
    fetcher: async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith('/prepare')) return jsonResponse(prepareBody());
      if (pathname.includes('/artifacts/')) {
        contentType = init.headers['content-type'];
        assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), cmsBytes);
        return jsonResponse({ artifact: { duplicate: false } }, 201);
      }
      return jsonResponse({ assessmentIntake: { duplicate: false } }, 201);
    },
  });
  assert.equal(result.status, 'synced');
  assert.equal(contentType, 'application/pkcs7-mime');
});

test('streams a near-35MiB original with bounded pull-ahead and retry deduplication', async () => {
  const size = 35 * 1024 * 1024 - 1024;
  const largeBytes = new Uint8Array(size);
  largeBytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  largeBytes.fill(0x41, 9);
  const largeHash = createHash('sha256').update(largeBytes).digest('hex');
  const largePayload = { ...payload, evidence: [{ ...payload.evidence[0], documentSha256: largeHash, documentName: 'large-source.pdf' }] };
  const largeRow = { ...row, payload: largePayload, payload_hash: createHash('sha256').update(JSON.stringify({ payload: largePayload, identityRevision, actorId })).digest('hex') };
  const largeBundle = { ...bundle, documents: [{ ...bundle.documents[0], original_sha256: largeHash, byte_size: size, original_name: 'large-source.pdf' }], submissions: [largeRow] };
  let produced = 0;
  let consumed = 0;
  let maximumAhead = 0;
  let artifactUploads = 0;
  const logicalVersions = new Set();
  const sourceRepository = repository({}, largeBundle, largeBytes);
  sourceRepository.originalStream = async () => {
    let position = 0;
    const chunkSize = 64 * 1024;
    return new ReadableStream({
      pull(controller) {
        if (position >= size) { controller.close(); return; }
        const chunk = largeBytes.subarray(position, Math.min(size, position + chunkSize));
        position += chunk.byteLength;
        produced += chunk.byteLength;
        maximumAhead = Math.max(maximumAhead, produced - consumed);
        controller.enqueue(chunk);
      },
    });
  };
  const fetcher = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/prepare')) return jsonResponse(prepareBody());
    if (pathname.includes('/artifacts/')) {
      artifactUploads += 1;
      logicalVersions.add('assessment-document:doc-1');
      const actual = createHash('sha256');
      const reader = init.body.getReader();
      let total = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        actual.update(next.value);
        total += next.value.byteLength;
        consumed += next.value.byteLength;
      }
      assert.equal(total, size);
      assert.equal(actual.digest('hex'), largeHash);
      return jsonResponse({ artifact: { duplicate: artifactUploads > 1 } }, artifactUploads > 1 ? 200 : 201);
    }
    return jsonResponse({ assessmentIntake: { duplicate: artifactUploads > 1 } }, artifactUploads > 1 ? 200 : 201);
  };
  const options = { dealId, repository: sourceRepository, secret, crmOrigin: 'https://crm.example.test', sourceOrigin: 'https://assessment.example.test', fetcher };
  const first = await sync.syncAssessmentIntake(options);
  const second = await sync.syncAssessmentIntake(options);
  assert.equal(first.status, 'synced');
  assert.equal(second.status, 'synced');
  assert.equal(artifactUploads, 2);
  assert.equal(logicalVersions.size, 1);
  assert.ok(maximumAhead <= 64 * 1024 * 2);
});
