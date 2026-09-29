/** Browser-level behavior for the shared spouse social-status controls. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const html=fs.readFileSync(new URL('../public/questionnaire.html',import.meta.url),'utf8');

function setup(t){
 const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];};
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(match[1],dom.getInternalVMContext());
 t.after(()=>dom.window.close());
 return {w,d};
}

const selected=d=>[...d.querySelectorAll('#partnerSocialStatusChips input:checked')].map(input=>input.value);
const choose=(w,d,value)=>{
 const input=d.querySelector(`#partnerSocialStatusChips input[value="${value}"]`);
 input.checked=true;
 input.dispatchEvent(new w.Event('change',{bubbles:true}));
 return input;
};

test('marital toggles preserve spouse status and none/unknown stay exclusive',t=>{
 const {w,d}=setup(t);
 const marital=d.getElementById('marital');
 const field=d.getElementById('partnerSocialStatusField');
 assert.equal(field.closest('#profileOnly'),null,'the shared block is part of the main assessment form');
 assert.equal(field.classList.contains('hidden'),true,'unmarried clients do not see spouse status');

 marital.value='В браке';
 marital.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(field.classList.contains('hidden'),false,'married clients see spouse status');

 choose(w,d,'Пенсионер');
 choose(w,d,'Другое');
 assert.deepEqual(selected(d),['Пенсионер','Другое']);
 choose(w,d,'Нет');
 assert.deepEqual(selected(d),['Нет'],'Нет clears all other choices');
 choose(w,d,'unknown');
 assert.deepEqual(selected(d),['unknown'],'unknown clears Нет');
 choose(w,d,'Инвалид 2 группы');
 assert.deepEqual(selected(d),['Инвалид 2 группы'],'a regular choice clears unknown');

 choose(w,d,'Пенсионер');
 choose(w,d,'Другое');
 assert.equal(d.getElementById('partnerSocialOtherField').classList.contains('hidden'),false);
 d.getElementById('partnerSocialOther').value='Saved spouse detail';
 const beforeToggle=selected(d);
 marital.value='Холост / не замужем';
 marital.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(field.classList.contains('hidden'),true);
 assert.equal(d.getElementById('partnerSocialOtherField').classList.contains('hidden'),true,'inactive spouse detail stays hidden too');
 assert.deepEqual(selected(d),beforeToggle,'hiding spouse controls does not clear saved choices');
 marital.value='В браке';
 marital.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(field.classList.contains('hidden'),false);
 assert.equal(d.getElementById('partnerSocialOtherField').classList.contains('hidden'),false);
 assert.equal(d.getElementById('partnerSocialOther').value,'Saved spouse detail');
 assert.deepEqual(selected(d),beforeToggle,'restoring marriage keeps the prior choices');
});
