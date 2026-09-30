import { buildSync } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
function moduleAt(path) {
  const compiled = buildSync({ entryPoints: [path], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['cloudflare:workers'] }).outputFiles[0].text;
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require, crypto: webcrypto, Uint8Array, TextEncoder, TextDecoder, Date, JSON, URL, btoa, atob });
  return loaded.exports;
}
const ocrModule = moduleAt('lib/documents/browser-ocr.ts');
const { BrowserOcrRepository, browserOcrSource, validateBrowserOcrPage, validateBrowserOcrPin, BROWSER_OCR_ENGINE_VERSION } = ocrModule;
const { EvidenceRepository, RepositoryError, sha256 } = moduleAt('lib/documents/repository.ts');
const { analysisVersion } = moduleAt('lib/documents/analysis-version.ts');
const { analysisVersionForFormat } = moduleAt('lib/documents/analysis-service.ts');
const { readImage } = moduleAt('lib/documents/read-image.ts');
const { extractNative } = moduleAt('lib/documents/extract-native.ts');
const { issueSession, SESSION_COOKIE } = moduleAt('lib/worker-session.ts');
const a = { id: 'worker:ramazan', worker: 'ramazan', displayName: 'Ramazan', authentication: 'shared-password-worker-selection' };
const b = { id: 'worker:nurdaulet', worker: 'nurdaulet', displayName: 'Nurdaulet', authentication: 'shared-password-worker-selection' };
const token = () => webcrypto.randomUUID();
const plain = value => JSON.parse(JSON.stringify(value));

async function setup({ pages = 3, native = [1], scanText = '', textLength = 0 } = {}) {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync('drizzle/' + migration, 'utf8'));
  const db = { prepare(sql) { return { bind(...args) { const q = sqlite.prepare(sql); return {
    async run() { const result = q.run(...args); return { success: true, meta: { changes: result.changes } }; },
    async first() { return q.get(...args) || null; },
    async all() { return { results: q.all(...args), success: true }; },
  }; } }; } };
  const objects = new Map(), files = { async put(key, value) { objects.set(key, Buffer.from(value)); }, async get(key) { const bytes = objects.get(key); return bytes ? { text: async () => bytes.toString(), arrayBuffer: async () => Uint8Array.from(bytes).buffer } : null; } };
  const evidence = new EvidenceRepository(db, files), record = await evidence.syncCase({ external: { system: 'bitrix', dealId: 'test-ocr' }, iin: 'test-owner', title: 'SYNTHETIC ONLY' });
  const bytes = new Uint8Array([37, 80, 68, 70, 45]), hash = await sha256(bytes);
  const read = { readerVersion: 'native-pdf-3', originalSha256: hash, pdfSha256: hash, totalPages: pages, readAllPhysicalPages: true, signature: 'not_checked',
    pages: Array.from({ length: pages }, (_, i) => ({ page: i + 1, text: native.includes(i + 1) ? 'Already extracted native text '.repeat(textLength || 6) : scanText, nativeCharacters: native.includes(i + 1) ? 160 : 0, needsOcr: !native.includes(i + 1) })) };
  const analysis = { read, extraction: extractNative(read.pages) };
  const stored = await evidence.store(record.id, bytes, 'synthetic.pdf', a, analysisVersion, analysis);
  const source = await browserOcrSource(evidence, record, stored.document.id);
  let now = 1000;
  const ocr = new BrowserOcrRepository(db, () => now);
  return { sqlite, db, files, objects, evidence, record, source, ocr, stored, advance: ms => { now += ms; }, now: () => now };
}
function page(number = 2, text = 'Распознанный текст документа', confidence = 0.95) {
  return { page: number, text, confidence, width: 1600, height: 2200,
    lines: text ? text.split('\n').map((text, i) => ({ text, confidence, bbox: { x0: 10, y0: 10 + i * 10, x1: 500, y1: 19 + i * 10 } })) : [] };
}
const pin = source => ({ identityRevision: source.record.identity_revision, originalSha256: source.document.original_sha256, engineVersion: BROWSER_OCR_ENGINE_VERSION });

test('atomic document lease has one winner across employees and across tabs of the same employee', async () => {
  const s = await setup(), x = token(), y = token();
  const results = await Promise.all([s.ocr.claim(s.source, a, x), s.ocr.claim(s.source, b, y)]);
  assert.equal(results.filter(result => result.claimed).length, 1);
  const owner = results[0].claimed ? a : b, winning = results[0].claimed ? x : y;
  assert.equal((await s.ocr.claim(s.source, owner, winning)).claimed, true);
  assert.equal((await s.ocr.claim(s.source, owner, token())).claimed, false);
  const status = await s.ocr.status(s.source, owner, { suggestions: false });
  assert.equal(status.lease.actorId, owner.id); assert.equal(status.lease.mine, true);
  assert.equal(status.lease.displayName, owner.displayName);
  assert.equal('leaseToken' in status, false); assert.equal('token_hash' in status.lease, false);
  assert.equal(s.sqlite.prepare('SELECT count(*) n FROM assessment_browser_ocr_leases').get().n, 1);
});

test('status is read only; expired lease can be taken over and old actor/token cannot save or renew', async () => {
  const s = await setup(), first = token(), next = token();
  await s.ocr.claim(s.source, a, first);
  const expiry = s.sqlite.prepare('SELECT expires_at FROM assessment_browser_ocr_leases').get().expires_at;
  s.advance(60_000); await s.ocr.status(s.source, a); assert.equal(s.sqlite.prepare('SELECT expires_at FROM assessment_browser_ocr_leases').get().expires_at, expiry);
  await assert.rejects(() => s.ocr.savePage(s.source, b, first, page()), /OCR_LEASE_LOST/);
  await assert.rejects(() => s.ocr.renew(s.source, b, first), /OCR_LEASE_LOST/);
  s.advance(60_001); assert.equal((await s.ocr.status(s.source, a)).lease, null);
  await assert.rejects(() => s.ocr.renew(s.source, a, first), /OCR_LEASE_LOST/);
  assert.equal((await s.ocr.claim(s.source, b, next)).claimed, true);
  await assert.rejects(() => s.ocr.savePage(s.source, a, first, page()), /OCR_LEASE_LOST/);
  await assert.rejects(() => s.ocr.release(s.source, a, first), /OCR_LEASE_LOST/);
  await s.ocr.renew(s.source, b, next); await s.ocr.savePage(s.source, b, next, page());
  await s.ocr.release(s.source, b, next); assert.equal((await s.ocr.status(s.source, a)).lease, null);
  assert.equal((await s.ocr.claim(s.source, a, token())).claimed, true);
});

test('per-page checkpoints survive reopening and a lost response; completed text cannot be changed', async () => {
  const s = await setup(), t = token(); await s.ocr.claim(s.source, a, t);
  const saved = await s.ocr.savePage(s.source, a, t, page());
  s.advance(130_000);
  const resumed = new BrowserOcrRepository(s.db, s.now);
  assert.equal((await resumed.savePage(s.source, a, t, page())).reused, true);
  await assert.rejects(() => resumed.savePage(s.source, a, t, page(2, 'DIFFERENT')), /OCR_PAGE_IMMUTABLE/);
  await assert.rejects(() => resumed.savePage(s.source, b, t, page()), /OCR_PAGE_ALREADY_COMPLETED/);
  const status = await resumed.status(s.source, b, { page: 2 });
  assert.deepEqual(plain(status.pendingPages), [3]); assert.equal(status.pages[0].resultSha256, saved.page.resultSha256);
  assert.equal(status.pages[0].reviewNeeded, true); assert.equal(status.suggestions.reviewNeeded, true);
  assert.equal(status.suggestions.eligibleForAutofill, false); assert.equal(status.suggestions.complete, false);
  assert.equal(s.sqlite.prepare('SELECT count(*) n FROM assessment_browser_ocr_pages').get().n, 1);
});

test('zero-word and low-confidence pages finish as needs_manual, without endless retries or false completeness', async () => {
  const s = await setup(), t = token(); await s.ocr.claim(s.source, a, t);
  await s.ocr.savePage(s.source, a, t, page(2, '', 0));
  await s.ocr.savePage(s.source, a, t, page(3, 'Слабый текст', 0.4));
  const status = await s.ocr.status(s.source, b);
  assert.equal(status.complete, true); assert.deepEqual(plain(status.pendingPages), []);
  assert.deepEqual(plain(status.completedPages.map(page => page.state)), ['needs_manual', 'needs_manual']);
  assert.equal(status.suggestions.complete, false); assert.ok(status.suggestions.extraction.findings.includes('OCR_INCOMPLETE'));
  assert.equal((await s.ocr.claim(s.source, b, token())).claimed, false);
});

test('identity change invalidates every stale operation and keeps old pages out of new identity results', async () => {
  const s = await setup(), t = token(); await s.ocr.claim(s.source, a, t); await s.ocr.savePage(s.source, a, t, page());
  s.sqlite.prepare('UPDATE assessment_cases SET identity_revision=2,client_iin=? WHERE id=?').run('other-test-owner', s.record.id);
  for (const operation of [() => s.ocr.status(s.source, a), () => s.ocr.claim(s.source, a, t), () => s.ocr.renew(s.source, a, t), () => s.ocr.release(s.source, a, t), () => s.ocr.savePage(s.source, a, t, page())]) await assert.rejects(operation, /CASE_IDENTITY_CHANGED/);
  const record = { ...s.record, identity_revision: 2 }, source = await browserOcrSource(s.evidence, record, s.stored.document.id);
  assert.deepEqual(plain((await s.ocr.status(source, b)).pendingPages), [2, 3]);
  assert.equal((await s.ocr.claim(source, b, token())).claimed, true);
  assert.equal(s.sqlite.prepare('SELECT count(*) n FROM assessment_browser_ocr_pages').get().n, 1);
});

test('identity change between the authorization read and SQL insert cannot write a stale OCR page', async () => {
  const s = await setup(), t = token(); await s.ocr.claim(s.source, a, t);
  const prepare = s.db.prepare.bind(s.db); let changed = false;
  s.db.prepare = sql => { const statement = prepare(sql); return { bind(...args) {
    const query = statement.bind(...args);
    return !sql.startsWith('INSERT INTO assessment_browser_ocr_pages') ? query : { ...query, async run() {
      changed = true; s.sqlite.prepare('UPDATE assessment_cases SET identity_revision=2 WHERE id=?').run(s.record.id);
      return query.run();
    } };
  } }; };
  await assert.rejects(() => s.ocr.savePage(s.source, a, t, page()), /CASE_IDENTITY_CHANGED/);
  assert.equal(changed, true); assert.equal(s.sqlite.prepare('SELECT count(*) n FROM assessment_browser_ocr_pages').get().n, 0);
});

test('concurrent conflicting saves preserve exactly one immutable page and return a conflict for the loser', async () => {
  const s = await setup(), t = token(); await s.ocr.claim(s.source, a, t);
  const attempts = await Promise.allSettled([s.ocr.savePage(s.source, a, t, page(2, 'Первый результат')), s.ocr.savePage(s.source, a, t, page(2, 'Другой результат'))]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(attempts.find(result => result.status === 'rejected').reason.message, /OCR_PAGE_IMMUTABLE/);
  assert.equal(s.sqlite.prepare('SELECT count(*) n FROM assessment_browser_ocr_pages').get().n, 1);
});

test('native analysis, reviews, source bytes, drafts and answers are preserved when generating OCR suggestions', async () => {
  const s = await setup({ pages: 1, native: [] }), t = token();
  await s.evidence.appendReview({ caseId: s.record.id, documentId: s.stored.document.id, extractionId: s.stored.extraction.id, identityRevision: 1, requestId: 'synthetic-review', factKey: 'saved.native', value: 'preserved', disposition: 'confirmed', reason: '' }, a);
  const tables = ['assessment_documents', 'assessment_extractions', 'assessment_reviews', 'assessment_draft_versions', 'assessment_submissions', 'assessment_profile_saves'];
  const before = tables.map(table => s.sqlite.prepare('SELECT * FROM ' + table).all());
  const originals = [...s.objects].map(([key, value]) => [key, value.toString('hex')]);
  await s.ocr.claim(s.source, a, t);
  await s.ocr.savePage(s.source, a, t, page(1, 'Дата выдачи: 15.01.2024\nДействителен до: 15.01.2034'));
  const status = await s.ocr.status(s.source, a);
  assert.equal(status.suggestions.source, 'native-and-browser-ocr'); assert.ok(status.suggestions.extraction.findings.includes('OCR_UNVERIFIED'));
  assert.deepEqual(tables.map(table => s.sqlite.prepare('SELECT * FROM ' + table).all()), before);
  assert.deepEqual([...s.objects].map(([key, value]) => [key, value.toString('hex')]), originals);
  assert.deepEqual(plain((await s.evidence.cached(s.record.id, s.stored.document.original_sha256, analysisVersion)).result), plain(s.source.analysis));
});

test('source membership, physical page sequence, native-read integrity and eligible page lists are authoritative', async () => {
  const s = await setup();
  const other = await s.evidence.syncCase({ external: { system: 'bitrix', dealId: 'other' }, iin: 'other', title: 'SYNTHETIC' });
  await assert.rejects(() => browserOcrSource(s.evidence, other, s.stored.document.id), /DOCUMENT_NOT_IN_CASE/);
  assert.throws(() => validateBrowserOcrPage(page(1), s.source), /OCR_PAGE_NOT_ELIGIBLE/);
  for (const bad of [{ totalPages: 4 }, { readAllPhysicalPages: false }, { pdfSha256: 'wrong' }, { originalSha256: '0'.repeat(64) }, { pages: [{ ...s.source.analysis.read.pages[0], page: 2 }, ...s.source.analysis.read.pages.slice(1)] }]) {
    const fake = { document: async () => s.stored.document, cached: async () => ({ result: { ...s.source.analysis, read: { ...s.source.analysis.read, ...bad } } }) };
    await assert.rejects(() => browserOcrSource(fake, s.record, s.stored.document.id), /OCR_NATIVE_READ_INCOMPLETE/);
  }
  s.objects.set(s.stored.extraction.result_key, Buffer.from('{}'));
  await assert.rejects(() => browserOcrSource(s.evidence, s.record, s.stored.document.id), /EVIDENCE_INTEGRITY_FAILED/);
});

test('input pins, control characters, out-of-page geometry, text/line mismatch and oversized results are rejected', async () => {
  const s = await setup();
  for (const [change, error] of [[{ identityRevision: 2 }, 'CASE_IDENTITY_CHANGED'], [{ originalSha256: '0'.repeat(64) }, 'OCR_DOCUMENT_CHANGED'], [{ engineVersion: 'invented' }, 'OCR_ENGINE_CHANGED']]) assert.throws(() => validateBrowserOcrPin({ ...pin(s.source), ...change }, s.source), new RegExp(error));
  for (const input of [page(0), page(4), { ...page(), confidence: NaN }, { ...page(), width: 20_001 }, { ...page(), text: 'different' }, page(2, 'control\u0000'), page(2, 'direction\u202e'), { ...page(), lines: [{ ...page().lines[0], bbox: { x0: 10, y0: 5, x1: 1601, y1: 10 } }] }, { ...page(), lines: [{ ...page().lines[0], bbox: { x0: 10, y0: 5, x1: 5, y1: 10 } }] }, page(2, 'x'.repeat(100_001))]) assert.throws(() => validateBrowserOcrPage(input, s.source), /OCR_/);
  await assert.rejects(() => s.ocr.claim(s.source, a, 'not-random'), /OCR_INVALID_LEASE_TOKEN/);
});

test('status details are bounded while every page of a 1000-page scan remains resumable and individually readable', async () => {
  const s = await setup({ pages: 1000, native: [] }), t = token(); await s.ocr.claim(s.source, a, t);
  const longText = Array.from({ length: 16 }, () => 'Ж'.repeat(3500)).join('\n');
  await s.ocr.savePage(s.source, a, t, page(1, longText));
  await s.ocr.savePage(s.source, a, t, page(1000));
  const status = await s.ocr.status(s.source, b);
  assert.equal(status.totalPages, 1000); assert.equal(status.pendingPages.length, 998); assert.equal(status.completedPages.length, 2);
  assert.equal(status.pagesTruncated, true);
  assert.equal((await s.ocr.status(s.source, b, { page: 1000 })).pages[0].page, 1000);
  assert.equal((await s.ocr.status(s.source, b, { page: 1 })).pages[0].text.length, longText.length);
  for (const number of [2, 3, 4]) await s.ocr.savePage(s.source, a, t, page(number, longText));
  const large = await s.ocr.status(s.source, b);
  assert.equal(large.suggestions, null); assert.equal(large.suggestionsUnavailable, 'OCR_SUGGESTIONS_SIZE_LIMIT');
  assert.equal(large.pendingPages.length, 995);
  assert.equal((await s.ocr.status(s.source, b, { page: 4 })).pages[0].text.length, longText.length);
});

test('saved OCR corruption is detected on read, rather than being turned into profile suggestions', async () => {
  const s = await setup(), t = token(); await s.ocr.claim(s.source, a, t); await s.ocr.savePage(s.source, a, t, page());
  s.sqlite.prepare('UPDATE assessment_browser_ocr_pages SET result_json=?').run('{}');
  await assert.rejects(() => s.ocr.status(s.source, a), /OCR_RESULT_INTEGRITY_FAILED/);
});

test('1000 short/empty saved pages use bounded bulk preview reads, keeping all summaries and full explicit page access', async () => {
  const s = await setup({ pages: 1000, native: [] }), t = token(); await s.ocr.claim(s.source, a, t);
  for (let number = 1; number <= 1000; number++) await s.ocr.savePage(s.source, a, t, page(number, number % 2 ? 'Короткая строка' : '', number % 2 ? 0.9 : 0));
  const prepare = s.db.prepare.bind(s.db), reads = [];
  s.db.prepare = sql => { const statement = prepare(sql); return { bind(...args) {
    const query = statement.bind(...args);
    return { ...query, async first() { reads.push(sql); return query.first(); }, async all() { reads.push(sql); return query.all(); } };
  } }; };
  const status = await s.ocr.status(s.source, b);
  assert.equal(status.completedPages.length, 1000); assert.deepEqual(plain(status.pendingPages), []);
  assert.equal(status.pages.length, 32); assert.equal(status.pages[0].page, 1); assert.equal(status.pages[31].page, 32);
  assert.equal(status.pagesTruncated, true); assert.equal(status.suggestions.ocrPages.length, 1000);
  assert.ok(reads.length <= 6, `status issued ${reads.length} reads for 1000 short pages`);
  assert.equal(reads.filter(sql => sql.startsWith('SELECT * FROM assessment_browser_ocr_pages')).length, 2);
  reads.length = 0;
  const last = await s.ocr.status(s.source, b, { page: 999, suggestions: false });
  assert.equal(last.pagesTruncated, false); assert.equal(last.pages.length, 1); assert.equal(last.pages[0].page, 999);
  assert.equal(last.pages[0].text, 'Короткая строка'); assert.equal(last.pages[0].resultSha256, status.completedPages[998].resultSha256);
  assert.ok(reads.length <= 5); assert.equal(last.suggestions, null);
});

test('image OCR status reports the stored image reader version and MIME format while retaining exact content pins', async () => {
  const s = await setup();
  const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64'));
  const read = await readImage(bytes);
  const stored = await s.evidence.store(s.record.id, bytes, 'synthetic.png', a, analysisVersionForFormat(read.format), { read, extraction: extractNative(read.pages) });
  const source = await browserOcrSource(s.evidence, s.record, stored.document.id), status = await s.ocr.status(source, a);
  assert.equal(status.format, 'image/png'); assert.equal(status.nativeAnalysisVersion, stored.extraction.version);
  assert.match(status.nativeAnalysisVersion, /^native-image-/); assert.equal(status.pdfSha256, stored.document.original_sha256);
  assert.deepEqual(plain(status.pendingPages), [1]);
  const pdfStatus = await s.ocr.status(s.source, a); assert.equal(pdfStatus.format, 'application/pdf'); assert.equal(pdfStatus.nativeAnalysisVersion, analysisVersion);
});

// Exercise the actual route and actual session/origin gate against SQLite.
async function routeSetup() {
  const s = await setup(), secret = 'test-session-secret-not-used-in-production';
  const env = { SITE_SESSION_TOKEN: secret }, staff = { exports: {} };
  const staffSource = buildSync({ entryPoints: ['app/api/staff-access.ts'], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
  vm.runInNewContext(staffSource, { module: staff, exports: staff.exports, process: { env }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob, Response, URL });
  const exports = {}; let contextReads = 0;
  const deps = {
    '../../../../../staff-access': staff.exports,
    '../../../../../../../lib/documents/repository': { RepositoryError },
    '../../../../../../../lib/documents/browser-ocr': ocrModule,
    '../../../../../../../lib/documents/request-context': {
      boundedJson: async (request, max) => { const text = await request.text(); if (new TextEncoder().encode(text).length > max) throw new RepositoryError('BODY_TOO_LARGE', 413); return JSON.parse(text); },
      evidenceContext: async () => { contextReads++; return { record: s.record, actor: a, repository: s.evidence }; },
      evidenceError: error => Response.json({ error: error.code || error.message }, { status: error.status || 500 }),
    },
    'cloudflare:workers': { env: { DB: s.db } },
  };
  const source = fs.readFileSync('app/api/assessment/[dealId]/documents/[documentId]/ocr/route.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => { if (!(name in deps)) throw new Error('Unexpected ' + name); return deps[name]; }, Response, URL });
  const cookie = SESSION_COOKIE + '=' + await issueSession(a.worker, secret);
  const call = (method = 'GET', body, headers = {}, documentId = s.stored.document.id, query = '') => exports[method](new Request('https://synthetic.invalid/api/assessment/test-ocr/documents/' + documentId + '/ocr' + query, {
    method, headers: { cookie, ...(method === 'POST' ? { 'content-type': 'application/json', origin: 'https://synthetic.invalid' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  }), { params: Promise.resolve({ dealId: 'test-ocr', documentId }) });
  return { ...s, call, reads: () => contextReads };
}
test('HTTP route rejects unsigned and cross-origin access before reading any document; wrong case membership and stale pins fail', async () => {
  const s = await routeSetup();
  assert.equal((await s.call('GET', null, { cookie: '' })).status, 401);
  assert.equal((await s.call('POST', { action: 'claim' }, { origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await s.call('POST', { action: 'claim' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal(s.reads(), 0);
  assert.equal((await s.call('GET', null, {}, 'missing')).status, 404);
  const status = await s.call(); assert.equal(status.status, 200); assert.equal(status.headers.get('cache-control'), 'no-store');
  const t = token(), body = { ...pin(s.source), action: 'claim', leaseToken: t };
  const claimed = await s.call('POST', body); assert.equal(claimed.status, 200); assert.equal((await claimed.json()).claimed, true);
  assert.equal((await s.call('POST', { ...body, identityRevision: 999 })).status, 409);
  assert.equal((await s.call('POST', { ...body, engineVersion: 'old' })).status, 409);
  assert.equal((await s.call('POST', { ...body, action: 'page', page: page(1) })).status, 400);
  const saved = await s.call('POST', { ...body, action: 'page', page: page(2) }); assert.equal(saved.status, 200); assert.equal((await saved.json()).saved, true);
  const details = await (await s.call('GET', null, {}, s.stored.document.id, '?page=2&suggestions=0')).json();
  assert.equal(details.pages[0].page, 2); assert.equal(details.suggestions, null);
});
