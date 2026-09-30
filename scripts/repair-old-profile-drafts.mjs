// One-time owner-authorized maintenance. Only empty, proven contract IDs in
// existing draft rows can change. Never call profile save/reconcile or reviews.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {validateDraft} from '../.old-profile-validation.mjs';
import {digest, storedPayload, planContractRepair} from './old-profile-contract-repair.mjs';
const allowed = new Set(['5601','7533','8813','9027','10479','11223','12141']);
const ids = [...new Set((process.env.REPAIR_DEAL_IDS || '').split(',').filter(Boolean))];
const apply = process.env.APPLY_DRAFT_REPAIR === 'true';
const pins = JSON.parse(process.env.REPAIR_PLAN_PINS || '{}');
const origin = 'https://assessment.anti-krizis.kz';
const report = {apply, cases: [], failures: [], noProfileSave: true, noReviewWrite: true, noCrmWrite: true};
let cookie = '';
const errorCode = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : String(error.message || 'MAINTENANCE_FAILED').split('\n')[0].slice(0,120);
async function request(path, body) {
  const response = await fetch(origin + path, {method: body ? 'POST' : 'GET',
    headers: {cookie, origin, 'content-type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(60000)});
  if (path === '/api/session') cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || `HTTP_${response.status}`), {code: result.error});
  return result;
}
try {
  assert.ok(ids.length && ids.every(id => allowed.has(id)), 'Exact repair scope required');
  assert.ok(process.env.ASSESSMENT_TEST_PASSWORD, 'Missing verification credential');
  await request('/api/session', {worker: 'ali', password: process.env.ASSESSMENT_TEST_PASSWORD});
  const queue = (await request('/api/profile-queue')).items;
  report.queue = queue.map(item => ({dealId: item.dealId, completed: Boolean(item.profileSavedAt)}));
  for (const dealId of ids) {
    const item = {dealId}; report.cases.push(item);
    try {
      const queued = queue.find(row => row.dealId === dealId);
      if (!queued) { item.skipped = 'OUTSIDE_CURRENT_PROFILE_QUEUE'; continue; }
      if (queued.profileSavedAt) { item.skipped = 'COMPLETED_PROFILE_PRESERVED'; continue; }
      const root = '/api/assessment/' + dealId, context = await request(root);
      const draft = (await request(root + '/draft')).draft;
      assert.ok(draft && !draft.recovery, 'Current draft required');
      item.beforeRevision = draft.revision;
      const documents = draft.payload.documents.filter(doc => doc.documentId && !/ЭЦП|парол/i.test(doc.type || ''));
      const analyses = [];
      for (let start = 0; start < documents.length; start += 8) {
        const result = await request(root + '/documents/analyze', {identityRevision: context.identityRevision,
          documentIds: [...new Set(documents.slice(start, start + 8).map(doc => doc.documentId))]});
        for (const entry of result.results) {
          if (entry.error && documents.some(doc => doc.documentId === entry.documentId && /^ГКБ/.test(doc.type))) throw Error(entry.error);
          if (entry.analysis) analyses.push(entry.analysis);
        }
      }
      const plan = planContractRepair(draft, context, analyses, validateDraft);
      Object.assign(item, {planHash: plan.planHash, beforeHash: plan.beforeHash, afterHash: plan.afterHash,
        changes: plan.changes.map(({row, documentId, extractionId, factKey}) => ({row, documentId, extractionId, factKey})), migratedUnansweredControls:plan.migratedControls, skippedRows: plan.skipped});
      if (!plan.changes.length) { item.unchanged = true; continue; }
      const latest = (await request(root + '/draft')).draft;
      assert.equal(latest.revision, draft.revision, 'Draft changed while planning');
      assert.equal(digest(storedPayload(latest.payload)), plan.beforeHash, 'Draft content changed');
      if (!apply) { item.previewOnly = true; continue; }
      const pin = pins[dealId];
      assert.ok(pin && pin.planHash === plan.planHash && /^[0-9a-f-]{36}$/.test(pin.requestId), 'Exact reviewed plan pin required');
      const active = (await request('/api/profile-activity')).active;
      assert.ok(!active.some(row => row.dealId === dealId), 'Staff currently editing this profile');
      const currentQueue = (await request('/api/profile-queue')).items.find(row => row.dealId === dealId);
      assert.ok(currentQueue && !currentQueue.profileSavedAt, 'Profile scope or completion changed');
      item.requestId = pin.requestId;
      // Exactly one attempt. A lost response requires checking this request's
      // immutable D1 receipt; never resend or loosen the revision guard here.
      item.writeAttempted = true;
      const saved = await request(root + '/draft', {payload: plan.payload, expectedRevision: draft.revision,
        identityRevision: context.identityRevision, requestId: pin.requestId});
      assert.equal(saved.revision, draft.revision + 1);
      const after = (await request(root + '/draft')).draft;
      assert.equal(after.revision, saved.revision, 'Concurrent save after repair');
      assert.equal(digest(storedPayload(after.payload)), plan.afterHash, 'Saved repair did not read back exactly');
      Object.assign(item, {verified: true, afterRevision: saved.revision, changedFields: plan.changes.length});
    } catch (error) {
      item.error = errorCode(error);
      if (item.writeAttempted && !item.verified) item.reconciliationRequired = true;
      report.failures.push({dealId, code: item.error});
    }
  }
} catch (error) { report.failures.push({code: errorCode(error)}); }
report.summary = {cases: report.cases.length, proposedFields: report.cases.reduce((n, c) => n + (c.changes?.length || 0), 0),
  repairedCases: report.cases.filter(c => c.verified).length, changedFields: report.cases.reduce((n, c) => n + (c.changedFields || 0), 0), failures: report.failures.length};
await writeFile('old-profile-repair.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary));
if (report.failures.length) process.exitCode = 1;
