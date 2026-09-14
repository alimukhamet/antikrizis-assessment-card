import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../public/assessment-quality.js',import.meta.url),'utf8');
// Legacy quality-helper unit tests. Active form integration is covered in check-answers.test.mjs.
const ctx=vm.createContext({Date,console});vm.runInContext(code,ctx);const A=ctx.AssessmentQuality;
const date=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
function sample(){return {...Object.fromEntries(A.topics.flatMap(t=>t.keys).map(k=>[k,'Тестовое значение'])),marital:'Холост / не замужем',carSale:'0',ludo:'0',quality:{unknown:[],collector:'Тестовый сотрудник',collectedOn:date(),owner:'Тестовый юрист',due:date(),next:'Сверить все разделы по документам',extra:{livingCosts:'0',loanPayments:'120 000',incomeStability:'Зарплата, среднее за 6 месяцев',assetTransfers:'Не было',creditorDetails:'Тестовый кредитор; 1 000 000; 120 000; 20 дней; без залога; со слов клиента',enforcementStatus:'no',enforcementDetails:'',carSaleDetails:'',gamblingDetails:''},reviews:Object.fromEntries(A.topics.map(t=>[t.id,{status:'reported',source:'',reviewer:'',date:'',note:''}]))}};}

test('unverified statements require an owner, deadline and specific next action',()=>{
 const s=sample();assert.equal(A.issues(s).length,0);
 s.quality.owner='';s.quality.due='';s.quality.next='';
 assert.deepEqual(Array.from(A.issues(s),x=>x.id),['qualityOwner','qualityDue','qualityNext']);
});
test('a verification mark requires source, reviewer and review date',()=>{
 const s=sample();s.quality.reviews.debt.status='matched';
 const ids=Array.from(A.issues(s),x=>x.id);
 assert.ok(ids.includes('source-debt'));assert.ok(ids.includes('reviewer-debt'));assert.ok(ids.includes('date-debt'));
 assert.equal(A.statusText(s,A.topics.find(t=>t.id==='debt')),'Отметка сверки не завершена');
});
test('unknown cannot be verified and is not serialized as zero or no',()=>{
 const s=sample();s.quality.unknown=['livingCosts'];s.quality.extra.livingCosts='';
 s.quality.reviews.income={status:'matched',source:'Тестовая справка',reviewer:'Тест',date:date(),note:''};
 assert.ok(A.issues(s).some(x=>x.id==='review-income'));
 const text=A.summary(s).join('\n');assert.match(text,/Обязательные расходы семьи, ₸\/мес: Неизвестно/);
 assert.doesNotMatch(text,/Обязательные расходы семьи, ₸\/мес: 0/);
});
test('yes requires relevant follow-up; no does not',()=>{
 const s=sample();assert.equal(A.issues(s).length,0);
 s.carSale='1';s.ludo='1';s.quality.extra.enforcementStatus='yes';
 const ids=Array.from(A.issues(s),x=>x.id);
 for(const k of ['carSaleDetails','gamblingDetails','enforcementDetails'])assert.ok(ids.includes(k));
});
test('conflict requires description and is carried to the handoff',()=>{
 const s=sample();s.quality.reviews.debt.status='conflict';
 assert.ok(A.issues(s).some(x=>x.id==='note-debt'));
 s.quality.reviews.debt.note='Клиент назвал другую сумму';
 assert.match(A.summary(s).join('\n'),/Клиент назвал другую сумму/);
});
test('enforcement never inherits a guarantor answer',()=>{
 const s=sample();s.guarantors='Тестовый поручитель';
 assert.equal(A.enforcement(s),'Нет, со слов клиента');
 s.quality.extra.enforcementStatus='unknown';assert.equal(A.enforcement(s),'Неизвестно — уточнить');
 s.quality.extra.enforcementStatus='yes';s.quality.extra.enforcementDetails='Тестовое дело №1';
 assert.equal(A.enforcement(s),'Да — Тестовое дело №1');
});
test('invalid money is rejected and a real zero is retained',()=>{
 const s=sample();assert.match(A.summary(s).join('\n'),/Обязательные расходы семьи, ₸\/мес: 0 ₸/);
 for(const v of ['-100','abc','12.5']){s.quality.extra.livingCosts=v;assert.ok(A.issues(s).some(x=>x.id==='livingCosts'));}
});
test('quality summary includes the follow-up owner',()=>{
 const s=sample();assert.match(A.summary(s).join('\n'),/Тестовый юрист/);
});

 test('empty facts cannot receive a completed verification status',()=>{
 const s=sample();s.debt='';s.quality.reviews.debt={status:'matched',source:'Тестовый отчёт',reviewer:'Тест',date:date(),note:''};
 assert.ok(A.issues(s).some(x=>x.id==='review-debt'));
 assert.equal(A.statusText(s,A.topics.find(t=>t.id==='debt')),'Сведения не собраны полностью');
 });
 test('grouped money retains its amount in the lawyer handoff',()=>{
 const s=sample();s.quality.extra.livingCosts='120.000';
 assert.match(A.summary(s).join('\n'),/120\s000 ₸/);
 });

test('verification fingerprints change for edited facts, another client or another deal',()=>{
 const s=sample();const t=A.topics.find(x=>x.id==='income');const before=A.fingerprint(s,t,'test-deal');
 s.incomeClientOff='90000';assert.notEqual(A.fingerprint(s,t,'test-deal'),before);
 const changed=A.fingerprint(s,t,'test-deal');s.iin='000000000001';assert.notEqual(A.fingerprint(s,t,'test-deal'),changed);
 assert.notEqual(A.fingerprint(s,t,'another-test-deal'),A.fingerprint(s,t,'test-deal'));
});
