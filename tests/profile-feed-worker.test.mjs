/** Platform CRM profile feed through the built worker. Synthetic data only; no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const root = fileURLToPath(new URL('..', import.meta.url));
const token = 'profile-feed-token-for-tests-only-32-bytes';

test('profile feed: bearer token only, exact deal, verified profile with its hash', async t => {
  const persist = mkdtempSync(join(tmpdir(), 'profile-feed-'));
  const paths = (await readdir(join(root, 'dist/server'), { recursive: true })).filter(p => /\.m?js$/.test(p)).sort((a, b) => a === 'index.js' ? -1 : b === 'index.js' ? 1 : a.localeCompare(b));
  const modules = await Promise.all(paths.map(async path => ({ type: 'ESModule', path, contents: await readFile(join(root, 'dist/server', path), 'utf8') })));
  const runtime = new Miniflare({ modules, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'profile-feed' }, d1Persist: persist, r2Buckets: { FILES: 'profile-feed-files' },
    bindings: { PROFILE_FEED_TOKEN: token, SITE_SESSION_TOKEN: 'staff-session-secret-for-tests-32-bytes' },
    outboundService: () => { throw Error('No outbound service is authorized in this test'); } });
  t.after(async () => { await runtime.dispose(); rmSync(persist, { recursive: true, force: true }); });
  const db = await runtime.getD1Database('DB');
  for (const name of (await readdir(join(root, 'drizzle'))).filter(n => n.endsWith('.sql')).sort())
    for (const statement of (await readFile(join(root, 'drizzle', name), 'utf8')).split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(statement).run();
  const now = '2026-09-27T10:00:00.000Z', profileJson = JSON.stringify({ schema: 'antikrizis.profile.v1', dealId: '900001', iin: '991231300003', answers: [{ key: 'regAddress', label: 'Адрес прописки', value: 'TEST CITY' }], unresolved: [] });
  await db.prepare("INSERT INTO assessment_cases (id,external_system,external_id,client_iin,identity_revision,title,created_at,updated_at) VALUES ('case-1','bitrix','900001','000000000010',1,'SYNTHETIC',?,?)").bind(now, now).run();
  const save = (id, request, state, at, json) => db.prepare("INSERT INTO assessment_profile_saves (id,case_id,request_id,identity_revision,actor_id,authentication,payload_json,payload_hash,state,created_at,updated_at) VALUES (?,'case-1',?,1,'worker:azhar','shared-password-worker-selection',?,'x',?,?,?)")
    .bind(id, request, JSON.stringify({ schemaVersion: 1, values: { profileJson: json } }), state, at, at).run();
  await save('s1', 'req-old', 'verified', '2026-09-26T10:00:00.000Z', '{"old":true}');
  await save('s2', 'req-new', 'verified', now, profileJson);
  await save('s3', 'req-uncertain', 'uncertain', '2026-09-27T11:00:00.000Z', '{"uncertain":true}');
  const get = (path, auth, method = 'GET') => runtime.dispatchFetch('https://synthetic.invalid' + path, { method, headers: auth ? { authorization: 'Bearer ' + auth } : {} });

  assert.equal((await get('/api/profile-feed/900001')).status, 401);
  assert.equal((await get('/api/profile-feed/900001', 'wrong-token-wrong-token-wrong-token-00')).status, 401);
  assert.equal((await get('/api/profile-feed/900002', token)).status, 404);
  // Only the exact single-deal GET bypasses staff auth; everything else stays behind the session.
  for (const path of ['/api/profile-feed', '/api/profile-feed/', '/api/profile-feed/abc', '/api/profile-feed/900001/x']) assert.equal((await get(path, token)).status, 401, path);
  assert.equal((await get('/api/profile-feed/900001', token, 'POST')).status, 401);
  assert.equal((await get('/api/profile-queue', token)).status, 401);

  const response = await get('/api/profile-feed/900001', token);
  assert.equal(response.status, 200);assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.schema, 'antikrizis.profile-feed.v1');assert.equal(body.requestId, 'req-new');assert.equal(body.savedBy, 'Azhar');assert.equal(body.savedAt, now);
  assert.deepEqual(body.profile, JSON.parse(profileJson));
  assert.equal(body.sha256, createHash('sha256').update(profileJson).digest('hex'));
  assert.equal(body.receiptState, 'verified');
  assert.equal(body.contentReceiptId, 's2');
  assert.equal(body.latestReceiptId, 's2');
  assert.equal(body.latestReceiptAt, now);

  await t.test('opt-in original catalog and downloads preserve data, authenticate and enforce exact case and hash', async () => {
    const files = await runtime.getR2Bucket('FILES');
    const bytes = new TextEncoder().encode('%PDF-1.7 synthetic original only');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await files.put('private/original', bytes);
    const insert = (id, name, key = 'private/original', sha = hash, size = bytes.length) => db.prepare("INSERT INTO assessment_documents (id,case_id,original_sha256,original_key,original_name,byte_size,uploaded_by,created_at) VALUES (?,'case-1',?,?,?,?, 'test',?)").bind(id, sha, key, name, size, now).run();
    await insert('original-1', 'Synthetic original.pdf');
    await insert('credential-1', 'private.p12.pdf', 'private/credential', 'a'.repeat(64));
    const before = await db.prepare("SELECT * FROM assessment_documents ORDER BY id").all();
    const snapshot = await db.prepare("SELECT * FROM assessment_profile_saves ORDER BY id").all();
    assert.equal('iskOriginals' in body, false);
    const included = await (await get('/api/profile-feed/900001?include=isk-originals', token)).json();
    assert.equal(included.sha256, body.sha256);
    assert.deepEqual(included.profile, body.profile);
    assert.deepEqual(included.iskOriginals, { schema: 'antikrizis.isk-originals.v1', documents: [{id:'original-1', original_name:'Synthetic original.pdf', content_type:'application/pdf', size_bytes:bytes.length, sha256:hash}], loanDates:[] });
    assert.equal(JSON.stringify(included).includes('private/original'), false);
    const sourceText = 'Дата начала срока действия контракта: 17.04.2023';
    const retained = {read:{pages:[{page:1,text:sourceText,needsOcr:false}]},extraction:{version:'rules-native-32',kind:'gkb_full',identity:{iin:'991231300003'},credits:[{contractNumber:'NUMBER-ONLY-TEST',contractCode:'CODE-ONLY-TEST',contractStartDate:{key:'contractStartDate',value:'2023-04-17',page:1,source:sourceText}}]}};
    const retainedText = JSON.stringify(retained);
    await files.put('private/analysis',retainedText);
    await db.prepare("INSERT INTO assessment_extractions (id,document_id,version,result_key,result_sha256,created_at) VALUES ('extraction-test','original-1','native-pdf-5:rules-native-32','private/analysis',?,?)").bind(createHash('sha256').update(retainedText).digest('hex'),now).run();
    const withDates = await (await get('/api/profile-feed/900001?include=isk-originals',token)).json();
    assert.deepEqual(withDates.iskOriginals.loanDates,[{documentId:'original-1',sha256:hash,subjectIin:'991231300003',contractCode:'CODE-ONLY-TEST',contractNumber:'NUMBER-ONLY-TEST',startDate:'2023-04-17',disbursementDate:null,page:1,quote:sourceText,evidenceVersion:'rules-native-32',sourceExtractionId:'extraction-test'}]);
    await files.put('private/analysis',JSON.stringify({...retained,corrupt:true}));
    assert.equal((await get('/api/profile-feed/900001?include=isk-originals',token)).status,503);
    assert.equal((await get('/api/profile-feed/900001',token)).status,200);
    await files.put('private/analysis',retainedText);
    await db.prepare("INSERT INTO assessment_cases (id,external_system,external_id,client_iin,identity_revision,title,created_at,updated_at) VALUES ('case-foreign','bitrix','900003','000000000020',1,'SYNTHETIC',?,?)").bind(now,now).run();
    await db.prepare("INSERT INTO assessment_profile_saves (id,case_id,request_id,identity_revision,actor_id,authentication,payload_json,payload_hash,state,created_at,updated_at) VALUES ('foreign-save','case-foreign','foreign-request',1,'worker:azhar','test','{}','x','verified',?,?)").bind(now,now).run();
    assert.equal((await get('/api/profile-feed/900003/documents/original-1',token)).status,404);

    const path = '/api/profile-feed/900001/documents/original-1';
    assert.equal((await get(path)).status, 401);
    assert.equal((await get(path, 'wrong')).status, 401);
    assert.equal((await get(path, token, 'POST')).status, 401);
    assert.equal((await get('/api/profile-feed/900002/documents/original-1', token)).status, 404);
    assert.equal((await get('/api/profile-feed/900001/documents/credential-1', token)).status, 404);
    assert.equal((await get('/api/profile-feed/900001/documents/missing', token)).status, 404);
    const original = await get(path, token);
    assert.equal(original.status, 200);
    assert.equal(original.headers.get('cache-control'), 'no-store');
    assert.equal(original.headers.get('x-original-sha256'), hash);
    assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
    await files.put('private/original', new TextEncoder().encode('corrupt'));
    assert.equal((await get(path, token)).status, 503);
    await files.put('private/original', bytes);
    assert.deepEqual((await db.prepare("SELECT * FROM assessment_documents ORDER BY id").all()).results, before.results);
    assert.deepEqual((await db.prepare("SELECT * FROM assessment_profile_saves WHERE case_id='case-1' ORDER BY id").all()).results, snapshot.results);
  });

  await t.test('newer reopened receipt invalidates completion while retaining historical verified content', async () => {
    const reopenedAt = '2026-09-28T10:00:00.000Z';
    await save('s4', 'req-reopened', 'reopened', reopenedAt, '{"mustNotBeExposed":true}');
    await save('s5', 'req-failed', 'failed', '2026-09-29T10:00:00.000Z', '{}');
    // A later history update on an older save must not undo a reopen.
    await db.prepare("UPDATE assessment_profile_saves SET updated_at='2026-10-01T10:00:00.000Z' WHERE id='s2'").run();
    const current = await (await get('/api/profile-feed/900001', token)).json();
    assert.equal(current.receiptState, 'reopened');
    assert.equal(current.latestReceiptId, 's4');
    assert.equal(current.contentReceiptId, 's2');
    assert.equal(current.latestReceiptAt, reopenedAt);
    assert.equal(current.requestId, 'req-new');
    assert.deepEqual(current.profile, JSON.parse(profileJson));
    assert.equal(current.sha256, body.sha256);

    // Created-at ties use rowid, exactly as completion reporting does.
    const newerProfileJson = JSON.stringify({ ...JSON.parse(profileJson), answers: [{ key: 'regAddress', label: 'Адрес прописки', value: 'NEW TEST CITY' }] });
    await save('s6', 'req-reverified', 'verified', reopenedAt, newerProfileJson);
    const reverified = await (await get('/api/profile-feed/900001', token)).json();
    assert.equal(reverified.receiptState, 'verified');
    assert.equal(reverified.latestReceiptId, 's6');
    assert.equal(reverified.contentReceiptId, 's2');
    assert.notEqual(reverified.contentReceiptId, reverified.latestReceiptId);
    assert.deepEqual(reverified.profile, JSON.parse(profileJson));
  });

  await t.test('a reopened-only case exposes empty compatible content, not the revoked payload', async () => {
    await db.prepare("INSERT INTO assessment_cases (id,external_system,external_id,client_iin,identity_revision,title,created_at,updated_at) VALUES ('case-2','bitrix','900002','000000000020',1,'SYNTHETIC',?,?)").bind(now, now).run();
    await db.prepare("INSERT INTO assessment_profile_saves (id,case_id,request_id,identity_revision,actor_id,authentication,payload_json,payload_hash,state,created_at,updated_at) VALUES ('reopened-only','case-2','revoked',1,'worker:azhar','test',?,'x','reopened',?,?)")
      .bind(JSON.stringify({ values: { profileJson: JSON.stringify({ answers: [{ value: 'REVOKED' }] }) } }), now, now).run();
    const response = await get('/api/profile-feed/900002', token);
    assert.equal(response.status, 200);
    const current = await response.json();
    assert.equal(current.schema, 'antikrizis.profile-feed.v1');
    assert.equal(current.receiptState, 'reopened');
    assert.equal(current.latestReceiptId, 'reopened-only');
    assert.equal(current.contentReceiptId, null);
    assert.equal(current.latestReceiptAt, now);
    assert.equal(current.requestId, '');
    assert.equal(current.savedAt, '');
    assert.equal(current.savedBy, '');
    assert.deepEqual(current.profile, { schema: 'antikrizis.profile.v1', dealId: '900002', iin: '', savedAt: '', savedBy: '', totalDebt: '', debtComplete: false, answers: [], unresolved: [] });
    assert.equal(current.sha256, createHash('sha256').update(JSON.stringify(current.profile)).digest('hex'));
  });
});
