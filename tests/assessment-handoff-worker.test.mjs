import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHmac, createHash } from 'node:crypto';
const root = resolve(new URL('..', import.meta.url).pathname);
const secret = 'synthetic-handoff-secret-at-least-32-bytes';
const origin = 'https://platform.example.test';
const dealId = '11665', iin = '000000000010';
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}` : JSON.stringify(value);

test('built Worker serves signed persisted handoff files without staff cookie or source writes, while surrounding routes stay protected', async t => {
  const persist = mkdtempSync(join(tmpdir(), 'assessment-handoff-worker-'));
  const paths = (await readdir(join(root, 'dist/server'), { recursive: true })).filter(path => /\.m?js$/.test(path)).sort((a,b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b));
  const modules = await Promise.all(paths.map(async path => ({ type: 'ESModule', path, contents: await readFile(join(root, 'dist/server', path), 'utf8') })));
  const contents = new Map(), calls = [];
  const runtime = new Miniflare({ modules, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'handoff-synthetic' }, d1Persist: persist, r2Buckets: { FILES: 'handoff-files' },
    bindings: { ASSESSMENT_INTAKE_HMAC_SECRET: secret, ASSESSMENT_INTAKE_APPROVED_ORIGIN: origin, SITE_SESSION_TOKEN: 'synthetic-session-secret-at-least-32-bytes', BITRIX_WEBHOOK: 'https://crm.example.test/rest/1/test/' },
    outboundService: async request => {
      const url = new URL(request.url); calls.push({ path: url.pathname, method: request.method });
      if (url.pathname === '/rest/1/test/crm.item.get.json' && request.method === 'POST') {
        assert.equal((await request.json()).id, dealId);
        return Response.json({ result: { item: { id: Number(dealId), ufCrmAiIin: iin, ufCrmAnkPrimaryDocs: [...contents.keys()].map(id => ({ id, urlMachine: `https://crm.example.test/rest/crm.controller.item.getFile.json?id=${id}` })) } } });
      }
      assert.equal(url.pathname, '/rest/crm.controller.item.getFile.json'); assert.equal(request.method, 'GET');
      const id = url.searchParams.get('id'), bytes = contents.get(id); assert.ok(bytes);
      return new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-disposition': `attachment; filename="${id === '22' ? 'secret-password-SYNTHETIC.p12' : 'document.pdf'}"` } });
    },
  });
  t.after(async () => { await runtime.dispose(); rmSync(persist, { recursive: true, force: true }); });
  const db = await runtime.getD1Database('DB');
  for (const sql of [
    'CREATE TABLE assessment_cases (id TEXT PRIMARY KEY, external_system TEXT, external_id TEXT, client_iin TEXT, identity_revision INTEGER)',
    'CREATE TABLE assessment_handoffs (case_id TEXT, request_id TEXT, identity_revision INTEGER, payload_json TEXT, payload_hash TEXT, state TEXT)',
    'CREATE TABLE assessment_documents (id TEXT, case_id TEXT, original_sha256 TEXT, byte_size INTEGER)',
    'CREATE TABLE assessment_upload_manifests (id TEXT, case_id TEXT, request_id TEXT, identity_revision INTEGER, actor_id TEXT, manifest_json TEXT, payload_hash TEXT, receipt_json TEXT, state TEXT)',
  ]) await db.prepare(sql).run();
  await db.prepare('INSERT INTO assessment_cases VALUES (?,?,?,?,?)').bind('case', 'bitrix', dealId, iin, 1).run();
  const handoffId = '00000000-0000-0000-0000-000000000001', credentialId = '00000000-0000-0000-0000-000000000002';
  const payload = JSON.stringify({ powerId: 'power', signedId: 'signed', credentialRequestId: credentialId, signedConfirmed: true });
  await db.prepare('INSERT INTO assessment_handoffs VALUES (?,?,?,?,?,?)').bind('case', handoffId, 1, payload, hash(payload), 'verified').run();
  for (const [index, documentId] of ['power', 'signed', 'credential'].entries()) {
    const key = index === 2, bytes = new TextEncoder().encode(key ? 'SYNTHETIC-CREDENTIAL-BYTES' : '%PDF-1.7 synthetic ' + documentId), sha256 = hash(bytes), fileId = String(20 + index);
    const batch = hash(`assessment-upload:${handoffId}:${index}`), requestId = key ? credentialId : `${batch.slice(0,8)}-${batch.slice(8,12)}-${batch.slice(12,16)}-${batch.slice(16,20)}-${batch.slice(20,32)}`;
    contents.set(fileId, bytes);
    const manifest = { version: 1, baseline: [], files: [{ documentId, sha256, byteSize: bytes.length, name: key ? 'NEVER_DISCLOSE_PASSWORD.p12' : 'document.pdf' }], ...(key ? { scope: 'credentials', credentialOwnerConfirmed: true } : { rootRequestId: handoffId, batchIndex: index, planHash: hash('handoff:' + handoffId) }) };
    await db.prepare('INSERT INTO assessment_upload_manifests VALUES (?,?,?,?,?,?,?,?,?)').bind('upload' + index, 'case', requestId, 1, 'synthetic-worker', JSON.stringify(manifest), hash(JSON.stringify({ manifest, identityRevision: 1, actorId: 'synthetic-worker' })), JSON.stringify({ verified: true, files: [{ id: fileId, sha256, name: manifest.files[0].name }], preserved: [] }), 'verified').run();
    if (!key) await db.prepare('INSERT INTO assessment_documents VALUES (?,?,?,?)').bind(documentId, 'case', sha256, bytes.length).run();
  }
  const snapshot = async () => JSON.stringify(await Promise.all(['assessment_cases','assessment_handoffs','assessment_documents','assessment_upload_manifests'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().then(result => result.results))));
  const before = await snapshot();
  let timestamp = Date.now();
  const send = (body, headers = {}) => {
    const raw = canonical(body), time = String(++timestamp);
    return runtime.dispatchFetch(`https://assessment.example.test/api/assessment/${dealId}/crm-handoff`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-antikrizis-source-origin': origin, 'x-antikrizis-timestamp': time, 'x-antikrizis-signature': 'sha256=' + createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex'), ...headers } });
  };
  const listed = await send({ operation: 'assessment-handoff-list', dealId });
  assert.equal(listed.status, 200);
  assert.match(listed.headers.get('content-type'), /application\/json/);
  const dto = await listed.json(); assert.equal(dto.artifacts.length, 3);
  assert.equal(JSON.stringify(dto).includes('NEVER_DISCLOSE'), false);
  for (const descriptor of dto.artifacts) {
    const response = await send({ operation: 'assessment-handoff-artifact', dealId, descriptor });
    assert.equal(response.status, 200, JSON.stringify(descriptor));
    assert.equal(response.headers.get('x-content-sha256'), descriptor.sha256);
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())), descriptor.sha256);
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="${descriptor.filename}"`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls.filter(call => call.method === 'POST').length, 3);
  assert.equal((await send({ operation: 'assessment-handoff-list', dealId }, { 'x-antikrizis-signature': 'sha256=' + '0'.repeat(64) })).status, 401);
  for (const path of [`/api/assessment/${dealId}/crm-handoff`, `/api/assessment/${dealId}/crm-handoff/extra`, `/api/assessment/${dealId}/credentials`, `/api/assessment/${dealId}/handoff`]) {
    const response = await runtime.dispatchFetch('https://assessment.example.test' + path);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'SIGN_IN_REQUIRED');
  }
  assert.equal(await snapshot(), before);
});
