import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

test('the browser uses one server synchronization action and does not orchestrate CRM state transitions', async () => {
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
    if (body.action === 'complete') {
      assert.equal(downloads, 1, 'download must precede CRM confirmation');
      row = {requestId: body.requestId, state: 'verified', assessmentSaved: true, historySaved: true};
    }
    if (body.action === 'generate') return {ok: true, json: async () => ({contract: {rendererVersion: 'a'.repeat(64), data: {client_name: 'SYNTHETIC CLIENT'}}})};
    return {ok: true, json: async () => row};
  };

  w.eval(fs.readFileSync(new URL('../public/submission-flow.js', import.meta.url), 'utf8'));
  const flow = w.SubmissionFlow.mount(w.document.getElementById('anchor'), w.document.getElementById('status'));
  flow.checked({readyToSubmit: true, identityRevision: 1}, {
    dealId: '11665', payload, bindings: [], signature: JSON.stringify({payload, bindings: []}),
  });
  const save = w.document.getElementById('saveAssessment');
  await save.onclick();

  assert.deepEqual(calls.map(call => call.action), ['generate', 'complete']);
  assert.equal(calls.filter(call => ['commit','history','reconcile'].includes(call.action)).length, 0, 'Browser must not own CRM transitions');
  assert.equal(downloads, 1);
  assert.match(w.document.getElementById('status').textContent, /Договор готов/);
  dom.window.close();
});
