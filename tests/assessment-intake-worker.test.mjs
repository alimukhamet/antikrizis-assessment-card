import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
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
  const config = join(root, 'dist/server/wrangler.json');
  const schema = join(persist, 'schema.sql');
  writeFileSync(schema, 'CREATE TABLE assessment_cases (id TEXT PRIMARY KEY, external_system TEXT NOT NULL, external_id TEXT NOT NULL, client_iin TEXT, identity_revision INTEGER NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(external_system, external_id));');
  const wrangler = join(root, 'node_modules/.bin/wrangler');
  const seeded = spawnSync(wrangler, ['d1', 'execute', 'DB', '--local', '--persist-to', persist, '--config', config, `--file=${schema}`], { cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  assert.equal(seeded.status, 0, seeded.stderr || seeded.stdout);

  const { unstable_dev } = await import(pathToFileURL(join(root, 'node_modules/wrangler/wrangler-dist/cli.js')).href);
  dev = await unstable_dev(join(root, 'dist/server/index.js'), {
    config,
    local: true,
    persistTo: persist,
    port: 0,
    logLevel: 'none',
    vars: {
      ASSESSMENT_INTAKE_HMAC_SECRET: secret,
      ASSESSMENT_INTAKE_APPROVED_ORIGIN: approvedOrigin,
      SITE_SESSION_TOKEN: 'staff-session-secret-for-tests-32-bytes',
    },
    experimental: { disableExperimentalWarning: true },
  });
  t.after(async () => {
    await dev?.stop();
    rmSync(persist, { recursive: true, force: true });
  });

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
