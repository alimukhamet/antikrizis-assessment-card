import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

test('earnings totals switch histories without changing current accrual or losing owner actions', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://site.test/my-earnings' });
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const month = { id: '2026-08', ongoing: false, earned: 140000, baseSalary: 100000, contractBonus: 0, commission: 40000, count: 4, volume: 2000000, missing: 0, paid: 50000, owed: 90000, periods: [], commissionDeals: [] };
  const report = { person: 'ramazan', canChoosePerson: true, name: 'Рамазан', periods: [], futurePlans: [], earningsMonths: [{ ...month, id: '2026-09', ongoing: true, earned: 0, baseSalary: 0, commission: 0, performanceCommission: 64000, paid: 0, owed: 0 }, { ...month, performanceCommission: 40000 }], payments: [{ id: 'payment-1', month: '2026-08', amount: 50000, paidAt: '2026-09-02', note: 'Kaspi 89' }], earned: 140000, paid: 50000, owed: 90000, today: '2026-09-21', generatedAt: '2026-09-21T10:00:00Z' };
  const context = vm.createContext({ exports: {}, Intl, Date, AbortController, setTimeout, clearTimeout, crypto: globalThis.crypto, fetch: async () => ({ ok: true, json: async () => report }), require: name => name === 'react' ? React : name === 'next/link' ? { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) } : (() => { throw Error(name); })() });
  const source = await readFile(new URL('../app/PersonalSales.tsx', import.meta.url), 'utf8');
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText.replace('"use strict";', '"use strict"; const React = require("react");'), context);
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(context.exports.default, { mode: 'earnings' })));
    const current = document.querySelector('.ps-current-earnings');
    assert.match(current.textContent, /Комиссия за текущий месяц64.000 ₸/);
    assert.match(current.textContent, /Будет начислена в конце месяца/);
    assert.ok(current.compareDocumentPosition(document.querySelector('.ps-overall')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.match(document.getElementById('ps-earnings-history').textContent, /История начислений/);
    assert.equal(document.querySelectorAll('.ps-payment-row').length, 0);
    const controls = [...document.querySelectorAll('.ps-overall button')];
    await act(async () => controls[1].click());
    assert.equal(controls[1].getAttribute('aria-pressed'), 'true');
    assert.match(document.getElementById('ps-earnings-history').textContent, /История выплат.*Kaspi 89/);
    assert.doesNotMatch(document.getElementById('ps-earnings-history').textContent, /за август/);
    assert.equal(document.querySelectorAll('#ps-earnings-history .ps-row').length, 0);
    await act(async () => controls[2].click());
    assert.match(document.getElementById('ps-earnings-history').textContent, /Остаток по месяцам.*Платежи зачтены от старых месяцев/);
    assert.equal(document.querySelectorAll('#ps-earnings-history .ps-row').length, 2);
    await act(async () => controls[0].click());
    assert.match(document.getElementById('ps-earnings-history').textContent, /История начислений/);
    assert.equal(document.querySelectorAll('#ps-earnings-history .ps-row').length, 1);
    await act(async () => document.querySelector('.ps-action').click());
    assert.match(document.querySelector('.ps-entry').textContent, /Выплата · Рамазан/);
    assert.match(current.textContent, /Комиссия за текущий месяц64.000 ₸/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
