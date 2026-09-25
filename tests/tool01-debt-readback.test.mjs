import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Runs Tool 01's real saveAssessmentToBitrix from the template against a fake Bitrix.
const html = await readFile(new URL('../templates/assessment-card.html', import.meta.url), 'utf8');
const source = name => { const start = html.indexOf(name); assert.ok(start > 0, name); return html.slice(start, html.indexOf('\n}\n', start) + 2); };
const DEBT = 'UF_CRM_AI_DEBT', CARD = 'UF_CRM_AI_CARD';

function tool01(stored) {
  const sent = [];
  const bxResult = async (method, body) => {
    if (method === 'crm.deal.update') { sent.push(body.fields); return true; }
    return { ...sent[0], ...stored(sent[0]) };
  };
  return new Function('buildFields', 'bxResult', 'MAP', 'CONTRACT_DATE_FIELD',
    `${source('function debtStoredAsWholeTenge')}\n${source('async function saveAssessmentToBitrix')}\nreturn saveAssessmentToBitrix;`)(
    s => ({ [DEBT]: s.debt, [CARD]: `Общий долг: ${s.debt} ₸`, OPPORTUNITY: 450000 }),
    bxResult, { debt: { bx: DEBT }, months: { bx: 'M' }, payDay: { bx: 'P' }, grafType: { bx: 'G' }, procedure: { bx: 'R' }, grafText: { bx: 'T' }, card: { bx: CARD } }, 'D');
}

test('Tool 01 confirms a fractional debt that Bitrix stored as whole tenge', async () => {
  await tool01(() => ({ [DEBT]: '1250001' }))({ debt: 1250000.5 }, '11665');
  await tool01(() => ({ [DEBT]: 1250000 }))({ debt: 1250000.49 }, '11665');
  await tool01(() => ({}))({ debt: 980000 }, '11665');
});

test('Tool 01 still rejects a debt that is really different', async () => {
  for (const wrong of ['1250000', '1250002', '1250001.5', '', null])
    await assert.rejects(tool01(() => ({ [DEBT]: wrong }))({ debt: 1250000.5 }, '11665'), /Bitrix не подтвердил поле «UF_CRM_AI_DEBT»/);
});

test('Tool 01 keeps the exact debt in the card and compares the card exactly', async () => {
  await assert.rejects(tool01(() => ({ [DEBT]: '1250001', [CARD]: 'Общий долг: 1250001 ₸' }))({ debt: 1250000.5 }, '11665'), /Карточка договора/);
});
