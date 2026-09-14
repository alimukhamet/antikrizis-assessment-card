import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
function setup(t,purposes=[]){
 const dom=new JSDOM(fs.readFileSync('public/questionnaire.html','utf8'),{runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 w.visibilityRules=()=>{d.querySelectorAll('[data-legacy-answer] input,[data-legacy-answer] select,[data-legacy-answer] textarea').forEach(e=>e.required=false);};
 const rows=d.querySelector('#creditors > .repeat-rows');rows.replaceChildren();
 for(const [purpose,note=''] of purposes){const row=d.querySelector('#creditors > template').content.firstElementChild.cloneNode(true);row.querySelector('[data-purpose]').value=purpose;row.querySelector('[data-purpose-explanation]').value=note;rows.append(row);}
 const run=()=>w.eval(fs.readFileSync('public/debt-purpose.js','utf8'));
 const selected=()=>[...d.querySelectorAll('#debtPurposes input:checked')].map(c=>c.value);
 return {w,d,run,selected,restore(){d.dispatchEvent(new w.Event('assessment-draft-restored'));}};
}
test('one overall purpose question combines existing loan choices and preserves their original answers',t=>{
 const s=setup(t,[['Бизнес'],['Жильё'],['Бизнес'],['Другое','First reason'],['Другое','Second reason'],['Другое','First reason']]);s.run();
 assert.deepEqual(s.selected(),['Жильё','Бизнес','Другое']);assert.equal(s.d.getElementById('debtPurposeOther').value,'First reason\nSecond reason');
 assert.equal(s.d.getElementById('debtPurposeOtherField').classList.contains('hidden'),false);assert.equal(s.d.querySelectorAll('#debtPurposes').length,1);
 assert.ok([...s.d.querySelectorAll('#creditors [data-purpose],#creditors [data-purpose-explanation]')].every(e=>e.closest('[hidden][data-legacy-answer]')&&!e.required));
 assert.deepEqual([...s.d.querySelectorAll('#creditors [data-purpose]')].map(e=>e.value),['Бизнес','Жильё','Бизнес','Другое','Другое','Другое']);
 assert.equal(s.d.getElementById('debtPurposeVersion').value,'1');
});
test('an explicit cleared overall answer stays cleared on draft restore',t=>{
 const s=setup(t,[['Бизнес']]);s.run();s.d.querySelector('#debtPurposes input[value="Бизнес"]').checked=false;s.restore();
 assert.deepEqual(s.selected(),[]);assert.equal(s.d.querySelector('#creditors [data-purpose]').value,'Бизнес');
 // A legacy draft restored after script initialization has no migration marker.
 s.d.getElementById('debtPurposeVersion').value='';s.restore();assert.deepEqual(s.selected(),['Бизнес']);
});
test('blank legacy purposes do not supply an answer; existing overall choices take priority',t=>{
 const s=setup(t,[[''],['']]);s.run();assert.deepEqual(s.selected(),[]);assert.equal(s.d.getElementById('debtPurposeOtherField').classList.contains('hidden'),true);
 s.d.querySelector('#creditors [data-purpose]').value='Бизнес';s.d.getElementById('debtPurposeVersion').value='';
 const other=s.d.querySelector('#debtPurposes input[value="Другое"]');other.checked=true;s.d.getElementById('debtPurposeOther').value='OVERALL EXPLANATION';s.restore();
 assert.deepEqual(s.selected(),['Другое']);assert.equal(s.d.getElementById('debtPurposeOther').value,'OVERALL EXPLANATION');
 other.checked=false;other.dispatchEvent(new s.w.Event('change',{bubbles:true}));assert.equal(s.d.getElementById('debtPurposeOtherField').classList.contains('hidden'),true);assert.equal(s.d.getElementById('debtPurposeOther').value,'OVERALL EXPLANATION');
});
