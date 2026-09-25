import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const script=fs.readFileSync('public/benefit-evidence.js','utf8');
const active=(amount='86673',description='Көп балалы отбасылар / Многодетные семьи')=>'Әрекеттегі төлемдер / Действующие выплаты:\n№ Вид выплаты Сумма выплаты\n1\n'+description+'\n'+amount+'   01.01.2020   09.03.2030\nТөленген төлемдер / Выплаченные выплаты:\n1\nИсторическая выплата\n999999   01.01.2010   01.01.2011';
function setup(t){
 const dom=new JSDOM('<body><div id="clientbenefits"><div class="repeat-rows"><div class="repeat-item"><select data-benefit-type><option>Выплата многодетной семье</option><option>Пенсия</option><option>Другая государственная выплата</option></select><input id="clientBenefitAmount_r1" value="86000"><select id="clientBenefitFrequency_r1"><option>Ежемесячно</option></select></div></div></div><input type="file" data-required-picker="Справка по выплатам пенсии и пособий"></body>',{runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,d=w.document,context=dom.getInternalVMContext();
 const files=[],results=new Map(),opened=[],events=[],steps=[];
 w.selectedFiles=files;w.af={results};w.afSource=source=>opened.push(source);w.HostedAssessment={getContext:()=>({client:{iin:'synthetic-client',external:{dealId:'synthetic-deal'}}})};w.AssessmentWorkflow={show:step=>steps.push(step)};
 d.addEventListener('change',event=>events.push({id:event.target.id,value:event.target.value}));
 vm.runInContext(script,context);
 function add(id='report',text=active()){
  files.push({id,type:'Справка по выплатам пенсии и пособий',person:'Клиент',storedDocumentId:id,file:{name:id+'.pdf'}});
  results.set(id,{type:'Справка по выплатам пенсии и пособий',identity:{iin:'synthetic-client'},server:{dealId:'synthetic-deal',documentId:id},documentReview:{type:'Справка по выплатам пенсии и пособий',reviewId:'checked'},pageText:['Cover page',text]});
 }
 return {w,d,files,results,opened,events,steps,add,api:w.BenefitEvidence,row:d.querySelector('.repeat-item'),amount:d.querySelector('input[id]'),button:text=>[...d.querySelectorAll('button')].find(b=>b.textContent.startsWith(text))};
}

test('bilingual active benefits preserve exact amounts and source pages, ignoring payment history',t=>{
 const s=setup(t);s.add();const parsed=s.api.parseActive(['Cover page',active('86 673,25')]);
 assert.equal(parsed.length,1);assert.equal(parsed[0].amount,86673.25);assert.equal(parsed[0].page,2);assert.equal(parsed[0].type,'Выплата многодетной семье');
 assert.equal(s.api.parseActive([active().replace('09.03.2030','31.02.2030')]),null);
 assert.equal(s.api.parseActive(['Выплаченные выплаты:\n'+active().split('Төленген')[1]]),null);
 const two=active().replace('Төленген төлемдер','2\nМногодетные семьи\n100   01.01.2020   09.03.2030\nТөленген төлемдер');
 assert.equal(s.api.parseActive([two]).length,2);
});
test('a reviewed document still shows an amount mismatch and never silently changes the answer',t=>{
 const s=setup(t);s.add();s.api.refresh();assert.match(s.row.textContent,/Сумма отличается/);assert.match(s.row.textContent,/86\s673/);assert.equal(s.amount.value,'86000');assert.equal(s.events.length,0);
 s.button('Открыть справку').click();assert.equal(s.opened[0].fileId,'report');assert.equal(s.opened[0].page,2);
 s.button('Взять').click();assert.equal(s.amount.value,'86673');assert.equal(s.events.at(-1).value,'86673');assert.doesNotMatch(s.row.textContent,/Сумма отличается/);assert.equal(s.d.querySelector('select[id]').value,'Ежемесячно');
 s.amount.value='86000';s.api.refresh();assert.match(s.row.textContent,/Сумма отличается/);
});
test('a missing certificate asks for a document beside the payment and opens the existing upload control',t=>{
 const s=setup(t);let picked=0;s.d.querySelector('input[type=file]').click=()=>picked++;s.api.refresh();assert.match(s.row.textContent,/Нужна справка/);s.button('Добавить справку').click();assert.equal(picked,1);assert.deepEqual(s.steps,['documents']);assert.equal(s.amount.value,'86000');
});
test('unknown, ambiguous and conflicting evidence never offers an inferred amount',t=>{
 for(const kind of ['unreadable','unknown','two-active','conflict','other-type']){
  const s=setup(t);let text=active();if(kind==='unreadable')text='Unparsed certificate';if(kind==='unknown')text=active('86673','Нераспознанный вид помощи');if(kind==='two-active')text=text.replace('Төленген төлемдер','2\nМногодетные семьи\n100   01.01.2020   09.03.2030\nТөленген төлемдер');s.add('first',text);if(kind==='conflict')s.add('second',active('90000'));if(kind==='other-type')s.row.querySelector('select').value='Пенсия';
  s.api.refresh();assert.equal(s.button('Взять'),undefined,kind);assert.match(s.row.textContent,/сверьте выплату и сумму/,kind);assert.equal(s.amount.value,'86000');
 }
});
test('wrong owner, deal, spouse and unprocessed files cannot propose amounts; removed sources invalidate buttons',t=>{
 for(const kind of ['iin','deal','spouse','pending']){const s=setup(t);s.add();const result=s.results.get('report');if(kind==='iin')result.identity.iin='another-client';if(kind==='deal')result.server.dealId='another-deal';if(kind==='spouse')s.files[0].person='Супруг(а)';if(kind==='pending')result.pending=true;s.api.refresh();assert.equal(s.button('Взять'),undefined,kind);}
 const s=setup(t);s.add();s.api.refresh();const old=s.button('Взять');s.files.length=0;old.click();assert.equal(s.amount.value,'86000');assert.match(s.row.textContent,/Нужна справка/);
});
test('zero remains a real document value, and repeated refresh does not duplicate controls',t=>{
 const s=setup(t);s.add('zero',active('0'));s.amount.value='';s.api.refresh();s.api.refresh();assert.equal(s.d.querySelectorAll('.benefit-evidence').length,1);s.button('Взять').click();assert.equal(s.amount.value,'0');assert.equal(s.button('Взять'),undefined);
});
