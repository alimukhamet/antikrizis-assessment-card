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
  const now = '2026-09-27T10:00:00.000Z', profileJson = JSON.stringify({ schema: 'antikrizis.profile.v1', dealId: '900001', answers: [{ key: 'regAddress', label: 'Адрес прописки', value: 'TEST CITY' }], unresolved: [] });
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
});
