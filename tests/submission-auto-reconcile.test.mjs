import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

test('browser renders the completed server result without orchestrating individual CRM actions', async () => {
  const dom = new JSDOM('<button id="anchor">Check</button><p id="status"></p>', {
    url: 'https://assessment.example', runScripts: 'outside-only',
  });
  const w = dom.window;
  const payload = {answers: ['INITIAL']};
  const calls = [];
  let row = null;
  let downloads = 0;

  w.HostedAssessment = {
    ready: () => true,
    getContext: () => ({client: {title: 'SYNTHETIC CLIENT', external: {dealId: '11665'}}}),
  };
  w.ServerDrafts = {capture: () => payload, reviewBindings: () => []};
  w.SubmissionDestination = {confirm: async () => ({dealId: '11665', iin: '000000000001', identityRevision: 1})};
  w.ContractRenderers = {
    ['a'.repeat(64)]: {render: async () => new w.Blob(['SYNTHETIC CONTRACT'])},
  };
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => { downloads++; };
  w.fetch = async (url, options) => {
    if (!options?.method) return {ok: true, json: async () => ({submission: row})};
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.action === 'prepare') row = {requestId: body.requestId, state: 'prepared', assessmentSaved: false, historySaved: false, contractNumber: 'TEST'};
    if (body.action === 'complete') row = {...row,state:'verified',assessmentSaved:true,historySaved:true,assessmentIntakeSync:{status:'pending'},contract:{rendererVersion:'a'.repeat(64),data:{client_name:'SYNTHETIC CLIENT'}}};
    if (body.action === 'sync-intake') row = {...row, assessmentIntakeSync:{status:'synced'}};
    return {ok: true, json: async () => row};
  };

  w.eval(fs.readFileSync(new URL('../public/submission-flow.js', import.meta.url), 'utf8'));
  const flow = w.SubmissionFlow.mount(w.document.getElementById('anchor'), w.document.getElementById('status'));
  flow.checked({readyToSubmit: true, identityRevision: 1}, {
    dealId: '11665', payload, bindings: [], signature: JSON.stringify({payload, bindings: []}),
  });
  const save = w.document.getElementById('saveAssessment');
  await save.onclick();

  assert.deepEqual(calls.map(call => call.action), ['prepare', 'complete']);
  assert.equal(calls.filter(call => call.action === 'complete').length, 1, 'Browser must make only one continuation request');
  assert.equal(downloads, 1);
  assert.match(w.document.getElementById('status').textContent, /Договор готов/);
  assert.match(w.document.getElementById('status').textContent, /пока не подтверждена/);
  const retry = w.document.getElementById('retryAssessmentIntake');
  assert.equal(retry.hidden,false);
  await retry.onclick();
  assert.deepEqual(calls.map(call => call.action), ['prepare','complete','sync-intake']);
  assert.equal(retry.hidden,true);
  assert.match(w.document.getElementById('status').textContent, /передача в юридическую CRM подтверждена/i);
  row = {...row, assessmentIntakeSync: undefined};
  w.document.dispatchEvent(new w.CustomEvent('assessment-case-opened'));
  await new Promise(setImmediate);
  assert.equal(retry.hidden,true,'A receipt-only refresh must preserve the confirmed transfer result');
  dom.window.close();
});

function intakeFixture(sync) {
  const dom = new JSDOM('<button id="anchor">Check</button><p id="status"></p>', {
    url: 'https://assessment.example', runScripts: 'outside-only',
  });
  const w = dom.window, payload = {answers: ['SYNTHETIC']}, calls = [], monitor = [];
  let dealId = '12663', row = null;
  w.HostedAssessment = {ready: () => true, getContext: () => ({client: {external: {dealId}}})};
  w.ServerDrafts = {capture: () => payload, reviewBindings: () => []};
  w.SubmissionDestination = {confirm: async () => ({dealId, iin: '000000000001', identityRevision: 1})};
  w.ContractRenderers = {['a'.repeat(64)]: {render: async () => new w.Blob(['SYNTHETIC CONTRACT'])}};
  w.OperationsMonitor = {record: code => monitor.push(code)};
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.fetch = async (url, options) => {
    // The real GET serializes the saved submission without running intake sync.
    if (!options?.method) {
      const saved = row && {...row};
      if (saved) delete saved.assessmentIntakeSync;
      return {ok: true, json: async () => ({submission: saved})};
    }
    const body = JSON.parse(options.body);
    calls.push(body.action);
    if (body.action === 'prepare') row = {requestId: body.requestId, state: 'prepared', historySaved: false};
    if (body.action === 'complete') row = {...row, state: 'verified', assessmentSaved: true, historySaved: true, assessmentIntakeSync: sync, contract: {rendererVersion: 'a'.repeat(64), data: {client_name: 'SYNTHETIC'}}};
    if (body.action === 'sync-intake') row = {...row, assessmentIntakeSync: sync};
    return {ok: true, json: async () => row};
  };
  w.eval(fs.readFileSync(new URL('../public/submission-flow.js', import.meta.url), 'utf8'));
  const flow = w.SubmissionFlow.mount(w.document.getElementById('anchor'), w.document.getElementById('status'));
  const check = () => flow.checked({readyToSubmit: true, identityRevision: 1}, {dealId, payload, bindings: [], signature: JSON.stringify({payload, bindings: []})});
  return {
    w, calls, monitor, check,
    retry: w.document.getElementById('retryAssessmentIntake'),
    status: w.document.getElementById('status'),
    save: () => w.document.getElementById('saveAssessment').onclick(),
    refresh: async () => {w.document.dispatchEvent(new w.CustomEvent('assessment-case-opened')); await new Promise(setImmediate);},
    restoreSavedReceipt: () => {row = {requestId: '00000000-0000-0000-0000-000000000001', state: 'verified', historySaved: true};},
    replaceReceipt: () => {row = {...row, requestId: '00000000-0000-0000-0000-000000000002'};},
    changeDeal: () => {dealId = 'OTHER';},
  };
}

test('missing lawyer handover explains the next business step without an intake retry loop', async () => {
  const f = intakeFixture({status: 'pending', reason: 'assessment_intake_handover_missing'});
  f.check();
  await f.save();
  await f.refresh();
  assert.equal(f.retry.hidden, true);
  assert.match(f.status.textContent, /ожидает передачи дела юристам через «Передать юристам»/);
  assert.doesNotMatch(f.status.textContent, /не подтверждена|Нажмите «Проверить передачу/);
  assert.deepEqual(f.monitor, []);
  await f.retry.onclick();
  assert.deepEqual(f.calls, ['prepare', 'complete'], 'Waiting cannot create a handover or re-run intake');
  f.w.close();
});

test('fresh saved-state recovery offers an optional intake check without claiming a failure', async () => {
  const f = intakeFixture({status: 'pending', reason: 'assessment_intake_handover_missing'});
  f.restoreSavedReceipt();
  await f.refresh();
  assert.equal(f.retry.hidden, false);
  assert.equal(f.status.textContent, '');
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.monitor, []);
  await f.retry.onclick();
  assert.deepEqual(f.calls, ['sync-intake']);
  assert.equal(f.retry.hidden, true);
  assert.match(f.status.textContent, /ожидает передачи дела юристам/);
  f.w.close();
});

test('a retryable timeout and genuine intake failures stay visible after receipt refresh', async () => {
  for (const sync of [
    {status: 'pending', reason: 'assessment_intake_sync_timeout'},
    {status: 'failed', reason: 'crm_prepare_failed'},
    {status: 'disabled', reason: 'assessment_intake_sync_not_configured'},
    {status: 'failed', reason: 'assessment_intake_handover_missing'},
  ]) {
    const f = intakeFixture(sync);
    f.check();
    await f.save();
    await f.refresh();
    assert.equal(f.retry.hidden, false);
    assert.match(f.status.textContent, /не подтверждена/);
    assert.doesNotMatch(f.status.textContent, /ожидает передачи дела/);
    assert.equal(f.monitor.includes('CRM_INTAKE_FAILED'), sync.status !== 'pending');
    await f.retry.onclick();
    assert.deepEqual(f.calls, ['prepare', 'complete', 'sync-intake']);
    f.w.close();
  }
});

test('another receipt or deal does not inherit the previous transfer state', async () => {
  for (const sync of [{status: 'synced'}, {status: 'pending', reason: 'assessment_intake_handover_missing'}]) {
    for (const replacement of ['replaceReceipt', 'changeDeal']) {
      const f = intakeFixture(sync);
      f.check();
      await f.save();
      await f.refresh();
      assert.equal(f.retry.hidden, true);
      f[replacement]();
      await f.refresh();
      assert.equal(f.retry.hidden, false, 'Unknown intake state offers a check for the newly loaded receipt');
      await f.retry.onclick();
      assert.deepEqual(f.calls, ['prepare', 'complete', 'sync-intake']);
      f.w.close();
    }
  }
});
