import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHmac } from 'node:crypto';

const root = resolve(new URL('..', import.meta.url).pathname);
const secret = 'assessment-intake-source-secret-for-tests-32-bytes';
const approvedOrigin = 'https://crm.example.test';
const dealId = 'bridge-unknown-worker-test';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function signedHeaders(body, timestamp = String(Date.now()), key = secret, origin = approvedOrigin) {
  return {
    'content-type': 'application/json',
    'x-antikrizis-source-origin': origin,
    'x-antikrizis-timestamp': timestamp,
    'x-antikrizis-signature': `sha256=${createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex')}`,
  };
}

function encoded(value) {
  return Buffer.from(canonical(value)).toString('base64url');
}

let dev;
let persist;

test('built worker exposes only the signed Assessment machine routes before staff auth', async (t) => {
  persist = mkdtempSync(join(tmpdir(), 'assessment-intake-worker-'));
  const modulePaths=(await readdir(join(root,'dist/server'),{recursive:true})).filter(path=>/\.m?js$/.test(path)).sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
  const modules=await Promise.all(modulePaths.map(async path=>({type:'ESModule',path,contents:await readFile(join(root,'dist/server',path),'utf8')})));
  // Use the same pinned, explicitly disposed local Worker runtime as recovery tests.
  const runtime=new Miniflare({modules,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],
    d1Databases:{DB:'synthetic-intake'},d1Persist:persist,r2Buckets:{FILES:'synthetic-files'},
    bindings:{ASSESSMENT_INTAKE_HMAC_SECRET:secret,ASSESSMENT_INTAKE_APPROVED_ORIGIN:approvedOrigin,SITE_SESSION_TOKEN:'staff-session-secret-for-tests-32-bytes'},
    outboundService:()=>{throw Error('No outbound service is authorized in this test');}
  });
  t.after(async()=>{await runtime.dispose();rmSync(persist,{recursive:true,force:true});});
  const db=await runtime.getD1Database('DB');
  await db.prepare('CREATE TABLE assessment_cases (id TEXT PRIMARY KEY, external_system TEXT NOT NULL, external_id TEXT NOT NULL, client_iin TEXT, identity_revision INTEGER NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(external_system, external_id))').run();
  dev={fetch:(path,options)=>runtime.dispatchFetch(new URL(path,'https://synthetic.invalid'),options)};

  const manifest = {
    dealId,
    identityRevision: 1,
    operation: 'assessment-intake-manifest',
    sourceSubmissionId: 'submission-unknown',
  };
  const manifestBody = canonical(manifest);
  const validManifest = await dev.fetch(`/api/assessment/${dealId}/crm-intake`, {
    method: 'POST',
    headers: signedHeaders(manifestBody),
    body: manifestBody,
  });
  assert.equal(validManifest.status, 404);
  assert.deepEqual(await validManifest.json(), { status: 'not_found', reason: 'no_case' });

  const unsigned = await dev.fetch(`/api/assessment/${dealId}/crm-intake`, { method: 'POST', body: manifestBody, headers: { 'content-type': 'application/json', 'x-antikrizis-source-origin': approvedOrigin } });
  assert.equal(unsigned.status, 401);
  assert.equal((await unsigned.json()).error, 'assessment_intake_signature_invalid');

  const wrongKey = await dev.fetch(`/api/assessment/${dealId}/crm-intake`, { method: 'POST', headers: signedHeaders(manifestBody, String(Date.now()), 'wrong-assessment-secret-32-bytes-xxxxxxxx'), body: manifestBody });
  assert.equal(wrongKey.status, 401);
  assert.equal((await wrongKey.json()).error, 'assessment_intake_signature_invalid');

  const wrongOrigin = await dev.fetch(`/api/assessment/${dealId}/crm-intake`, { method: 'POST', headers: signedHeaders(manifestBody, String(Date.now()), secret, 'https://evil.example.test'), body: manifestBody });
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await wrongOrigin.json()).error, 'assessment_intake_origin_forbidden');

  const artifact = {
    dealId,
    documentId: 'document-unknown',
    identityRevision: 1,
    operation: 'assessment-intake-artifact',
    originalName: 'source.pdf',
    sha256: 'a'.repeat(64),
    sizeBytes: 16,
    sourcePayloadHash: 'b'.repeat(64),
    sourceRevision: 1,
    sourceSubmissionHash: 'c'.repeat(64),
    sourceSubmissionId: 'submission-unknown',
  };
  const artifactBody = canonical(artifact);
  const validArtifact = await dev.fetch(`/api/assessment/${dealId}/crm-intake/documents/${artifact.documentId}`, {
    method: 'GET',
    headers: {
      'x-antikrizis-assessment-request': encoded(artifact),
      ...signedHeaders(artifactBody),
    },
  });
  assert.equal(validArtifact.status, 404);
  assert.equal((await validArtifact.json()).error, 'assessment_intake_not_found');

  for (const [path, method] of [
    [`/api/assessment/${dealId}/crm-intake/near`, 'GET'],
    [`/api/assessment/${dealId}/crm-intake/documents/${artifact.documentId}`, 'POST'],
    [`/api/assessment/${dealId}/credentials`, 'GET'],
    [`/api/assessment/${dealId}/uploads`, 'GET'],
    [`/api/assessment/${dealId}`, 'GET'],
  ]) {
    const response = await dev.fetch(path, { method });
    assert.equal(response.status, 401, path);
    assert.equal((await response.json()).error, 'SIGN_IN_REQUIRED', path);
  }
});
