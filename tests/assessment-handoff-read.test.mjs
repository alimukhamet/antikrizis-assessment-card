import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createHash, createHmac, webcrypto } from 'node:crypto';
import { httpHeaders } from './bitrix-headers-helper.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value);
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => imports[name], crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, URL, Headers, Map, Set, Date, atob, btoa, AbortSignal, AbortController, ReadableStream, TransformStream, console: { warn() {} } });
  return exports;
}
const repo = { sha256: async value => hash(value) };
const convert = { canonicalJsonStringify: canonical };
const auth = load('lib/crm/assessment-intake-auth.ts', { './assessment-intake-export': convert });
const plan = load('lib/documents/upload-plan.ts', { './repository': repo });
const { handleAssessmentHandoffRead } = load('lib/crm/assessment-handoff-read.ts', { './assessment-intake-export': convert, './assessment-intake-auth': auth, '../documents/repository': repo, '../documents/upload-plan': plan });
const upload = load('lib/crm/document-upload.ts', { '../documents/repository': repo, './http-headers': httpHeaders });
const { createCrmDocumentReader } = load('lib/crm/document-download.ts', { './document-upload': upload, './http-headers': httpHeaders });
const secret = 'synthetic-handoff-machine-secret-32-bytes';
const approvedOrigin = 'https://platform.example.test';
const dealId = '11665';
const handoffId = '00000000-0000-0000-0000-000000000001';
const keyId = '00000000-0000-0000-0000-000000000002';
async function fixture() {
  const record = { id: 'synthetic-case', external_system: 'bitrix', external_id: dealId, client_iin: '000000000010', identity_revision: 1 };
  const payload = { powerId: 'power', signedId: 'signed', credentialRequestId: keyId, signedConfirmed: true };
  const handoff = { case_id: record.id, identity_revision: 1, request_id: handoffId, state: 'verified', payload_json: JSON.stringify(payload), payload_hash: hash(JSON.stringify(payload)) };
  const rows = new Map(), documents = new Map(), contents = new Map();
  for (const [index, kind] of ['power', 'signed', 'key'].entries()) {
    const credential = index === 2;
    const bytes = new TextEncoder().encode(credential ? 'synthetic credential bytes' : `%PDF-1.7 synthetic ${kind}`);
    const sha256 = hash(bytes), fileId = String(index + 20), requestId = credential ? keyId : await plan.uploadBatchId(handoffId, index);
    const name = credential ? '26 ЭЦП пароль NEVER_DISCLOSE.p12' : `${kind}.pdf`;
    const manifest = { version: 1, baseline: [], files: [{ documentId: kind, sha256, byteSize: bytes.length, name }], ...(credential ? { scope: 'credentials', credentialOwnerConfirmed: true } : { rootRequestId: handoffId, batchIndex: index, planHash: hash('handoff:' + handoffId) }) };
    rows.set(requestId, { case_id: record.id, request_id: requestId, actor_id: 'synthetic-worker', identity_revision: 1, state: 'verified', manifest_json: JSON.stringify(manifest), payload_hash: hash(JSON.stringify({ manifest, identityRevision: 1, actorId: 'synthetic-worker' })), receipt_json: JSON.stringify({ verified: true, files: [{ id: fileId, sha256, name }], preserved: [] }) });
    documents.set(kind, { id: kind, case_id: record.id, original_sha256: sha256, byte_size: bytes.length });
    contents.set(fileId, bytes);
  }
  const currentCredential = { requestId: keyId, verified: true, identityRevision: 1 };
  let reads = 0;
  const dependencies = {
    repository: { findCaseByExternal: async (system, id) => system === 'bitrix' && id === dealId ? { ...record } : null, document: async (id, doc) => id === record.id ? documents.get(doc) : null, credentialStatus: async () => currentCredential },
    handoffs: { active: async () => handoff }, manifests: { get: async (id, request) => id === record.id ? rows.get(request) : null },
    environment: { secret, approvedOrigin }, replayStore: new Map(), now: Date.now(),
    readFile: async (_record, artifact) => { reads++; return contents.get(artifact.fileId); },
  };
  async function call(body = { operation: 'assessment-handoff-list', dealId }, options = {}) {
    const raw = canonical(body), time = String(++dependencies.now);
    const request = new Request(`https://assessment.example.test/api/assessment/${dealId}/crm-handoff`, { method: 'POST', body: raw, headers: { 'x-antikrizis-source-origin': approvedOrigin, 'x-antikrizis-timestamp': time, 'x-antikrizis-signature': `sha256=${createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex')}`, ...options.headers } });
    return handleAssessmentHandoffRead(request, dealId, dependencies);
  }
  async function list() { return (await call()).json(); }
  const artifact = descriptor => call({ operation: 'assessment-handoff-artifact', dealId, descriptor });
  function manifestChange(row, change) {
    const manifest = JSON.parse(row.manifest_json); change(manifest);
    row.manifest_json = JSON.stringify(manifest);
    row.payload_hash = hash(JSON.stringify({ manifest, identityRevision: row.identity_revision, actorId: row.actor_id }));
  }
  return { record, handoff, rows, documents, contents, currentCredential, dependencies, call, list, artifact, manifestChange, reads: () => reads };
}

test('lists and downloads only the verified handoff receipts; names, DTO and headers never expose source secrets', async () => {
  const f = await fixture(), listed = await f.list();
  assert.equal(listed.status, 'ready');
  assert.deepEqual(listed.artifacts.map(item => item.kind), ['power-of-attorney', 'signed-contract', 'credential']);
  assert.equal(JSON.stringify(listed).includes('NEVER_DISCLOSE'), false);
  for (const descriptor of listed.artifacts) {
    const { descriptorHash, ...plain } = descriptor;
    assert.equal(descriptorHash, hash(canonical(plain)));
    const response = await f.artifact(descriptor);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.contents.get(descriptor.fileId));
    assert.equal(response.headers.get('x-content-sha256'), descriptor.sha256);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-disposition').includes('NEVER_DISCLOSE'), false);
  }
  assert.equal(f.reads(), 3);
});

test('HMAC, origin, operation and deal are checked before source reads; replay fails', async () => {
  const f = await fixture();
  let lookups = 0;
  f.dependencies.repository.findCaseByExternal = async () => { lookups++; return null; };
  for (const [body, headers, status] of [
    [{ operation: 'assessment-handoff-list', dealId }, { 'x-antikrizis-signature': 'sha256=' + '0'.repeat(64) }, 401],
    [{ operation: 'assessment-handoff-list', dealId }, { 'x-antikrizis-source-origin': 'https://evil.test' }, 403],
    [{ operation: 'assessment-intake-manifest', dealId }, {}, 400],
    [{ operation: 'assessment-handoff-list', dealId: '22' }, {}, 400],
  ]) assert.equal((await f.call(body, { headers })).status, status);
  assert.equal(lookups, 0);
  const raw = canonical({ operation: 'assessment-handoff-list', dealId }), time = String(f.dependencies.now);
  const build = () => new Request('https://assessment.test', { method: 'POST', body: raw, headers: { 'x-antikrizis-source-origin': approvedOrigin, 'x-antikrizis-timestamp': time, 'x-antikrizis-signature': 'sha256=' + createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex') } });
  f.dependencies.replayStore.clear();
  assert.equal((await handleAssessmentHandoffRead(build(), dealId, f.dependencies)).status, 404);
  assert.equal((await handleAssessmentHandoffRead(build(), dealId, f.dependencies)).status, 409);
});

test('pending, stale identity, altered handoff, replacement keys and unconfirmed owners fail without downloading', async () => {
  const changes = [
    f => { f.handoff.state = 'prepared'; }, f => { f.handoff.identity_revision = 2; },
    f => { f.handoff.payload_hash = '0'.repeat(64); }, f => { f.record.client_iin = null; },
    f => { f.currentCredential.verified = false; }, f => { f.currentCredential.requestId = 'replacement'; },
    f => { f.currentCredential.identityRevision = 2; },
    f => { f.rows.get(keyId).state = 'uncertain'; }, f => { f.rows.get(keyId).identity_revision = 2; },
    f => f.manifestChange(f.rows.get(keyId), m => { m.credentialOwnerConfirmed = false; }),
    f => f.manifestChange(f.rows.get(keyId), m => { m.files[0].byteSize = 2 * 1024 * 1024 + 1; }),
    f => f.manifestChange(f.rows.get(keyId), m => { m.files[0].name = 'NEVER_DISCLOSE.pdf'; }),
    f => { f.documents.get('power').original_sha256 = '0'.repeat(64); },
  ];
  for (const change of changes) {
    const f = await fixture(); change(f);
    const response = await f.call();
    assert.equal(response.status, 409);
    assert.equal(f.reads(), 0);
    assert.equal(JSON.stringify(await response.json()).includes('NEVER_DISCLOSE'), false);
  }
});

test('caller cannot widen or substitute a descriptor; exact immutable upload changes invalidate previous links', async () => {
  const f = await fixture(), original = (await f.list()).artifacts[2];
  for (const change of [{ fileId: 'foreign' }, { kind: 'signed-contract' }, { identityRevision: 2 }, { sizeBytes: 1 }, { sha256: '0'.repeat(64) }, { filename: 'NEVER_DISCLOSE.p12' }, { descriptorHash: '0'.repeat(64) }, { arbitrary: true }]) {
    assert.equal((await f.artifact({ ...original, ...change })).status, 409);
  }
  assert.equal(f.reads(), 0);
  f.manifestChange(f.rows.get(keyId), m => { m.origin = 'bitrix-existing'; });
  assert.equal((await f.artifact(original)).status, 409);
});

test('changed bytes and concurrent credential/identity changes fail closed; errors are sanitized', async () => {
  for (const variant of ['bytes', 'key', 'identity', 'exception']) {
    const f = await fixture(), descriptor = (await f.list()).artifacts[2];
    f.dependencies.readFile = async () => {
      if (variant === 'bytes') return new Uint8Array([1]);
      if (variant === 'exception') throw Error('NEVER_DISCLOSE source url and password');
      if (variant === 'key') f.currentCredential.requestId = 'new-key';
      if (variant === 'identity') f.record.client_iin = '000000000011';
      return f.contents.get(descriptor.fileId);
    };
    const response = await f.artifact(descriptor);
    assert.equal(response.status, variant === 'exception' ? 503 : 409);
    assert.equal(JSON.stringify(await response.json()).includes('NEVER_DISCLOSE'), false);
  }
});

test('production download adapter checks fresh Bitrix identity/membership/redirects, byte ceiling and exact hash without a write', async () => {
  for (const variant of ['valid', 'identity', 'membership', 'redirect', 'oversize', 'hash']) {
    const f = await fixture(), descriptor = (await f.list()).artifacts[2];
    const calls = [], portal = 'https://crm.example.test';
    f.dependencies.readFile = (record, artifact) => createCrmDocumentReader(portal + '/rest/1/test/', dealId, record.client_iin, async (url, options) => {
      calls.push(url);
      if (options.method === 'POST') {
        assert.match(url, /crm.item.get.json$/);
        return Response.json({ result: { item: { id: Number(dealId), ufCrmAiIin: variant === 'identity' ? '000000000011' : record.client_iin, ufCrmAnkPrimaryDocs: variant === 'membership' ? [] : [{ id: descriptor.fileId, urlMachine: portal + '/rest/crm.controller.item.getFile.json?token=private' }] } } });
      }
      if (variant === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://untrusted.example.test/private' } });
      const bytes = variant === 'hash' ? new Uint8Array(descriptor.sizeBytes) : f.contents.get(descriptor.fileId);
      return new Response(bytes, { headers: { 'content-disposition': 'attachment; filename="credential password NEVER_DISCLOSE.p12"', 'content-length': String(variant === 'oversize' ? descriptor.sizeBytes + 1 : bytes.length) } });
    }, { credentialsOnly: true })({ id: artifact.fileId }, undefined, { maxBytes: artifact.sizeBytes });
    const response = await f.artifact(descriptor);
    assert.equal(response.status, variant === 'valid' ? 200 : variant === 'hash' ? 409 : 503, variant);
    assert.equal(calls.some(url => url.includes('untrusted')), false);
    if (['identity','membership'].includes(variant)) assert.equal(calls.length, 1);
  }
});

test('multiple confirmed keys remain separate bounded artifacts and invalid receipt mappings are rejected', async () => {
  const f = await fixture(), bytes = new TextEncoder().encode('second synthetic key'), sha256 = hash(bytes), row = f.rows.get(keyId);
  f.manifestChange(row, manifest => manifest.files.push({ documentId: 'eds:' + sha256, sha256, byteSize: bytes.length, name: 'private password SECOND.pfx' }));
  const receipt = JSON.parse(row.receipt_json); receipt.files.push({ id: '23', sha256, name: 'NEVER_DISCLOSE.pfx' }); row.receipt_json = JSON.stringify(receipt);
  f.contents.set('23', bytes);
  const listed = await f.list();
  assert.equal(listed.artifacts.length, 4);
  assert.equal(listed.artifacts.filter(file => file.kind === 'credential').length, 2);
  assert.equal(new Set(listed.artifacts.map(file => file.descriptorHash)).size, 4);
  assert.equal((await f.artifact(listed.artifacts.at(-1))).status, 200);
  receipt.files[1].sha256 = receipt.files[0].sha256; row.receipt_json = JSON.stringify(receipt);
  assert.equal((await f.call()).status, 409);
});
