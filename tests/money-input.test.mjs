import {test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import{JSDOM}from'jsdom';
test('money controls group large amounts while preserving exact numeric values',async t=>{
 const html=fs.readFileSync('public/questionnaire.html','utf8'),dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,run=code=>vm.runInContext(code,dom.getInternalVMContext());t.after(()=>w.close());
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))run(match[1]);run(fs.readFileSync('public/loan-status.js','utf8'));run(fs.readFileSync('public/money-input.js','utf8'));
 const source=w.document.getElementById('n8040'),editor=source.nextElementSibling.shadowRoot.querySelector('input');source.value='1806000.00';source.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(editor.value,'1 806 000');assert.equal(source.value,'1806000.00');assert.match(editor.getAttribute('aria-label'),/Сумма задолженности/);
 editor.value='2 345 678,90';editor.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(source.value,'2345678.90');editor.dispatchEvent(new w.Event('blur'));assert.equal(editor.value,'2 345 678,90');
 run("add(document.getElementById('creditors'))");await Promise.resolve();const added=[...w.document.querySelectorAll('#creditors input[id^="n8041"]')].at(-1);assert.equal(added.nextElementSibling.tagName,'MONEY-INPUT');
});

test('focusing a formatted money value preserves its saved precision and does not invalidate checks',t=>{
 const dom=new JSDOM('<section id="questionnaireStep"><div class="field"><label class="lbl">Сумма ₸</label><input type="number" id="amount" step="0.01" value="1806000.00"></div></section>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;t.after(()=>w.close());w.eval(fs.readFileSync('public/money-input.js','utf8'));
 const source=w.document.getElementById('amount'),editor=source.nextElementSibling.shadowRoot.querySelector('input');let changes=0;source.addEventListener('change',()=>changes++);
 editor.focus();editor.blur();assert.equal(source.value,'1806000.00');assert.equal(changes,0);
 editor.focus();editor.value='2 000 000,50';editor.dispatchEvent(new w.Event('input',{bubbles:true}));editor.blur();assert.equal(source.value,'2000000.50');assert.equal(changes,1);
});
