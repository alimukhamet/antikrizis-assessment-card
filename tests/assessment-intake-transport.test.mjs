import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = resolve(new URL('..', import.meta.url).pathname);
const secret = 'synthetic-intake-transport-secret-at-least-32-bytes';
const sourceOrigin = 'https://assessment.example.test';
const crmOrigin = 'https://crm.example.test';
const prepareUrl = `${crmOrigin}/api/crm/handovers/assessment-intake/prepare`;
const payload = {
  schemaVersion: 1,
  draft: {
    schemaVersion: 1, answers: [], groups: [],
    docContext: { social: '', salary: '' }, documents: [], pendingFiles: [],
  },
  baseline: {}, values: {}, contractData: {},
  contractRendererVersion: 'synthetic', lawyerCard: 'Synthetic source snapshot.',
  validationVersion: 'synthetic', assessmentDay: '2026-09-15',
  reviewIds: [], evidence: [],
};
const identityRevision = 1;
const actorId = 'synthetic-worker';
const sourceSubmissionId = 'synthetic-verified-submission';
const original = new TextEncoder().encode('%PDF-1.7\nsynthetic transport evidence\n');
const documentHash = createHash('sha256').update(original).digest('hex');
const document = {
  id: 'synthetic-document', case_id: 'synthetic-case', original_sha256: documentHash,
  byte_size: original.byteLength, original_name: 'synthetic.pdf',
};
const sourcePayload = {
  ...payload,
  draft: { ...payload.draft, documents: [{ documentId: document.id, type: 'identity', person: 'client' }] },
  reviewIds: ['synthetic-review'],
  evidence: [{ documentId: document.id, reviewId: 'synthetic-review', documentSha256: documentHash, documentName: document.original_name }],
};
const bundle = {
  case: { id: 'synthetic-case', external_system: 'bitrix', external_id: 'synthetic-deal', identity_revision: identityRevision },
  documents: [document],
  submissions: [{
    id: sourceSubmissionId, case_id: 'synthetic-case', identity_revision: identityRevision,
    state: 'verified', actor_id: actorId, sequence: 1, payload: sourcePayload,
    payload_hash: createHash('sha256').update(JSON.stringify({ payload: sourcePayload, identityRevision, actorId })).digest('hex'),
  }],
};

async function runtimeFor(t, outboundService, allowOriginal = false) {
  const { outputFiles } = await build({
    stdin: {
      contents: `
        import { syncAssessmentIntake } from './lib/crm/assessment-intake-sync.ts';
        const bundle = ${JSON.stringify(bundle)};
        let originalReads = 0;
        const repository = {
          async findCaseByExternal() { return bundle.case; },
          async exportCase() { return bundle; },
          async document() {
            if (!${allowOriginal}) throw new Error('Prepare must not read documents');
            return bundle.documents[0];
          },
          async originalStream() {
            if (!${allowOriginal}) throw new Error('Prepare must not read originals');
            originalReads += 1;
            return new ReadableStream({ start(controller) {
              controller.enqueue(new Uint8Array(${JSON.stringify([...original])}));
              controller.close();
            } });
          },
        };
        export default { async fetch() {
          // Omit fetcher deliberately: this must exercise native Worker fetch,
          // including its receiver and redirect-mode requirements.
          const result = await syncAssessmentIntake({
            dealId: 'synthetic-deal', sourceSubmissionId: ${JSON.stringify(sourceSubmissionId)},
            repository, secret: ${JSON.stringify(secret)},
            crmOrigin: ${JSON.stringify(crmOrigin)}, sourceOrigin: ${JSON.stringify(sourceOrigin)},
          });
          return Response.json({ ...result, originalReads });
        } };
      `,
      resolveDir: root,
      sourcefile: 'synthetic-intake-transport.ts',
      loader: 'ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  const runtime = new Miniflare({
    modules: [{ type: 'ESModule', path: 'worker.js', contents: outputFiles[0].text }],
    compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'],
    outboundService,
  });
  t.after(() => runtime.dispose());
  return runtime;
}

async function recordRequest(request, calls) {
  const body = await request.text();
  const timestamp = request.headers.get('x-antikrizis-timestamp');
  calls.push({ url: request.url, method: request.method, body });
  assert.equal(request.url, prepareUrl);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('x-antikrizis-source-origin'), sourceOrigin);
  assert.equal(request.headers.get('x-antikrizis-signature'),
    `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`);
  assert.equal(JSON.parse(body).sourceSubmissionId, sourceSubmissionId);
}

test('native Worker fetch preserves missing-handover JSON as the actionable pending reason', async (t) => {
  const calls = [];
  const runtime = await runtimeFor(t, async (request) => {
    await recordRequest(request, calls);
    return Response.json({ error: 'assessment_intake_handover_missing' }, { status: 404 });
  });
  const result = await (await runtime.dispatchFetch('https://synthetic.invalid/sync')).json();
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'assessment_intake_handover_missing');
  assert.equal(result.sourceSubmissionId, sourceSubmissionId);
  assert.equal(result.sourceRevision, 1);
  assert.equal(calls.length, 1);
  assert.equal(result.originalReads, 0);
});

test('native Worker fetch rejects redirects without forwarding credentials or making another request', async (t) => {
  const calls = [];
  const runtime = await runtimeFor(t, async (request) => {
    await recordRequest(request, calls);
    return new Response('Redirect must be discarded', {
      status: 307, headers: { location: 'https://untrusted.example.test/collect' },
    });
  });
  const result = await (await runtime.dispatchFetch('https://synthetic.invalid/sync')).json();
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'crm_redirect_forbidden');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls.map(call => call.url), [prepareUrl]);
  assert.equal(result.originalReads, 0);
});

test('native Worker fetch transfers the exact original through prepare, staging and finalize', async (t) => {
  const calls = [];
  const artifactPath = '/api/crm/handovers/synthetic-handover/artifacts/assessment-document%3Asynthetic-document';
  const runtime = await runtimeFor(t, async (request) => {
    calls.push({ url: request.url, method: request.method });
    assert.equal(request.headers.get('x-antikrizis-source-origin'), sourceOrigin);
    assert.match(request.headers.get('x-antikrizis-signature'), /^sha256=[a-f0-9]{64}$/u);
    if (request.url === prepareUrl) {
      const body = await request.json();
      assert.equal(body.artifacts[0].sha256, documentHash);
      return Response.json({ assessmentIntakePrepare: {
        handoverId: 'synthetic-handover',
        artifacts: [{ externalArtifactId: `assessment-document:${document.id}`, path: artifactPath }],
      } });
    }
    if (request.url === `${crmOrigin}${artifactPath}`) {
      assert.equal(request.method, 'PUT');
      assert.equal(request.headers.get('x-antikrizis-file-sha256'), documentHash);
      assert.equal(request.headers.get('content-type'), 'application/pdf');
      assert.deepEqual(new Uint8Array(await request.arrayBuffer()), original);
      return Response.json({ artifact: { duplicate: false } }, { status: 201 });
    }
    assert.equal(request.url, `${crmOrigin}/api/crm/handovers/assessment-intake`);
    const body = await request.json();
    assert.equal(body.sourcePayloadHash, bundle.submissions[0].payload_hash);
    assert.equal(body.assessmentIntake.evidence[0].sha256, documentHash);
    return Response.json({ assessmentIntake: { duplicate: false } }, { status: 201 });
  }, true);
  const result = await (await runtime.dispatchFetch('https://synthetic.invalid/sync')).json();
  assert.equal(result.status, 'synced');
  assert.equal(result.duplicate, false);
  assert.equal(result.originalReads, 1);
  assert.deepEqual(calls.map(call => call.method), ['POST', 'PUT', 'POST']);
  assert.equal(calls.length, 3);
});
