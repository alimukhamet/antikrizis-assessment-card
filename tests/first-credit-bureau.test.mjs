import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require(n){if(n in imports)return imports[n];throw Error(n);},Date,JSON});return exports;}
const {extractNative}=load('lib/documents/extract-native.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./kz-labels.json':JSON.parse(fs.readFileSync(new URL('../lib/documents/kz-labels.json',import.meta.url)))});
const header=(count=1)=>`ПОЛНЫЙ ПЕРСОНАЛЬНЫЙ КРЕДИТНЫЙ ОТЧЕТ ID 12345 03.08.2026 13:42:44
СЫНАҚ ТЕСТОВ ТЕСТОВИЧ (31.12.1999 г.)
ИИН/БИН : 991231300003
ДОГОВОРЫ В КРЕДИТНОЙ ИСТОРИИ
${count} Действующие договоры без просрочки*
0 Действующие договоры с просрочкой*
4 Завершенные договоры без просрочки*
На сайте 1cb.kz`;
const card=(number='SYNTH-1')=>`КОНТРАКТ 1
Баланс
Источник\nинформации\n(Кредитор) АО «Тест Банк»
Сумма кредитного лимита 1000 KZT Сумма просроченных взносов: 0 KZT Сумма неустойки (штраф, пеня): 0 KZT
Информация по состоянию на: 02.08.2026 Использованная сумма (подлежащая\nпогашению): 123.45 KZT Количество дней просрочки: 0 Минимальный платеж: 10.00 KZT
Вид финансирования: Кредитная карта
Источник финансирования: -
Роль субъекта: Заёмщик
Цель кредита: Прочие
Объект кредитования: Прочие
Тип источника информации (кредитора): Банк второго уровня
ДОГОВОР
Код контракта: CODE-${number}
Дата заявки: -
Номер договора: ${number}
Дата начала срока\nдействия договора: 15.08.2020
Дата окончания срока действия договора: 15.08.2030
Дата фактического завершения: -
СОСТОЯНИЕ
Фаза договора: Действующий
Статус договора: Стандартные кредиты
ДЕТАЛИЗАЦИЯ БАЛАНСА (ОСТАТОК)
Непросроченный основной долг: 120.00 KZT
Непогашенное вознаграждение: 3.45 KZT
Просроченный основной долг: 0.00 KZT
Просроченное вознаграждение: 0.00 KZT
Списанный основной долг: 0.00 KZT
Списанное вознаграждение: 0.00 KZT
Непогашенная неустойка (штраф, пеня): 0.00 KZT
ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ:
ЗАЛОГИ : Вид обеспечения Стоимость обеспечения
Бланковые 0Тенге
Максимальное количество дней просрочки с начала действия договора: 900 Сумма просроченных взносов: 999 KZT
Платежная дисциплина за 24 месяца`;
const pages=(texts)=>texts.map((text,i)=>({page:i+1,text:`${text}\nПолный персональный кредитный отчет - СЫНАҚ ТЕСТОВ ТЕСТОВИЧ - ID 12345 - 03.08.2026 13:42:44 ${i+1} / ${texts.length}`,nativeCharacters:text.length,needsOcr:false}));
const extract=(body=card())=>extractNative(pages([header(),`ДЕЙСТВУЮЩИЕ ДОГОВОРА\n${body}`]));
const fields=e=>Object.fromEntries(e.credits[0].facts.map(f=>[f.key,f.value]));
test('1cb report reads its owner, issue date and active borrower card without historical maximums',()=>{
 const e=extract();assert.equal(e.kind,'gkb_full');assert.equal(e.identity.iin,'991231300003');assert.equal(e.identity.name,'СЫНАҚ ТЕСТОВ ТЕСТОВИЧ');assert.equal(e.issuedAt,'2026-08-03');assert.deepEqual({...e.creditList},{complete:true,declared:1});assert.deepEqual([...e.findings],[]);
 assert.deepEqual(fields(e),{creditor:'АО «Тест Банк»',contractIdentifier:'CODE-SYNTH-1',startedAtMonth:'2020-08',overdueDays:'0',loanStatus:'Платится по графику',monthlyPayment:'10.00',creditType:'Кредитная карта',debtOutstanding:'123.45'});
 assert.equal(e.credits[0].facts.some(f=>f.key==='relatedParties'),false);assert.ok(e.credits[0].facts.every(f=>f.page===2));
});
test('wrapped contract IDs and field pages survive a card split across physical pages',()=>{
 const c=card('SYNTH-\n001'),cut=c.indexOf('Номер договора');const e=extractNative(pages([header(),`ДЕЙСТВУЮЩИЕ ДОГОВОРА\n${c.slice(0,cut)}`,c.slice(cut)]));
 assert.equal(e.credits[0].contractNumber,'SYNTH-001');assert.equal(fields(e).contractIdentifier,'CODE-SYNTH-001');assert.equal(e.credits[0].facts.find(f=>f.key==='startedAtMonth').page,3);assert.equal(e.credits[0].facts.find(f=>f.key==='monthlyPayment').page,2);assert.equal(e.creditList.complete,true);
});
test('completed and guarantee-role cards cannot become client borrower debts',()=>{
 const e=extract(`${card()}\nЗАВЕРШЕННЫЕ ДОГОВОРЫ\n${card('CLOSED').replace('Фаза договора: Действующий','Фаза договора: Завершен досрочно')}`);assert.equal(e.credits.length,1);
 const g=extract(card().replace('Роль субъекта: Заёмщик','Роль субъекта: Гарант'));assert.equal(g.credits.length,0);assert.equal(g.creditList.complete,false);assert.ok(g.findings.includes('OTHER_BORROWER_ROLE_REQUIRES_REVIEW'));
});
test('older cards without a phase use explicit section boundaries, never a completed section',()=>{
 const c=card().replace('Фаза договора: Действующий\n','');const e=extract(`${c}\nЗАВЕРШЕННЫЕ ДОГОВОРЫ\n${c.replaceAll('SYNTH-1','CLOSED')}`);assert.equal(e.credits.length,1);assert.equal(e.creditList.complete,true);
});
test('unknown fees, written-off balances and contradictory details stay unresolved on overdue cards',()=>{
 const overdue=card().replace('Количество дней просрочки: 0','Количество дней просрочки: 5').replace('Сумма просроченных взносов: 0 KZT','Сумма просроченных взносов: 2 KZT').replace('Просроченный основной долг: 0.00','Просроченный основной долг: 2.00');
 const e=extract(overdue);assert.equal(fields(e).debtOutstanding,'125.45');assert.equal(fields(e).monthlyPayment,undefined);
 for(const c of [overdue.replace('Сумма неустойки (штраф, пеня): 0 KZT','Сумма неустойки (штраф, пеня): -'),overdue.replace('Непросроченный основной долг: 120.00','Непросроченный основной долг: 999.00'),overdue.replace('Списанный основной долг: 0.00','Списанный основной долг: 50.00')]){const x=extract(c);assert.equal(fields(x).debtOutstanding,undefined);assert.ok(x.findings.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'));}
});
test('missing current fields cannot pick up historical amounts or dates from the next contract',()=>{
 const e=extract(card().replace('Количество дней просрочки: 0','Количество дней просрочки: -').replace('Номер договора: SYNTH-1','Номер договора: -'));assert.equal(e.credits.length,0);assert.equal(e.creditList.complete,false);assert.ok(e.findings.includes('INCOMPLETE_CONTRACT'));
 const x=extract(card().replace('Минимальный платеж: 10.00 KZT','Минимальный платеж: -'));assert.equal(fields(x).monthlyPayment,undefined);assert.equal(fields(x).overdueDays,'0');
});
test('missing, duplicate or mixed report pages never pass completeness',()=>{
 const p=pages([header(),`ДЕЙСТВУЮЩИЕ ДОГОВОРА\n${card()}`]);for(const bad of [[p[1]],p.map((x,i)=>i?{...x,text:x.text.replace('2 / 2','1 / 2')}:x),p.map((x,i)=>i?{...x,text:x.text.replace('ID 12345','ID 99999')}:x)])assert.ok(extractNative(bad).findings.includes('PAGE_COMPLETENESS_UNVERIFIED'));
 const duplicate=extract(`${card()}\n${card()}`);assert.equal(duplicate.creditList.complete,false);
 const absent=extractNative(pages([header(2),`ДЕЙСТВУЮЩИЕ ДОГОВОРА\n${card()}`]));assert.equal(absent.creditList.complete,false);
});
test('explicit related parties preserve their role but an absent table never means no guarantor',()=>{
 const r='СВЯЗАННЫЕ\nСУБЪЕКТЫ:\nРоль субъекта ФИО/Наименование : ИИН/БИН\nГарант СЫНАҚ ТЕСТОВ ТЕСТОВИЧ 991231300003\n';
 const e=extract(card().replace('Максимальное количество дней',r+'Максимальное количество дней'));assert.equal(fields(e).relatedParties,'СЫНАҚ ТЕСТОВ ТЕСТОВИЧ — Гарант');
 const invalid=extract(card().replace('Максимальное количество дней',r.replace('991231300003','991231300004')+'Максимальное количество дней'));assert.equal(fields(invalid).relatedParties,undefined);
});

test('scheduled headline balance cannot override a known conflicting penalty or partial principal detail',()=>{
 for(const c of [card().replace('Непогашенная неустойка (штраф, пеня): 0.00 KZT','Непогашенная неустойка (штраф, пеня): 100.00 KZT'),card().replace('Непросроченный основной долг: 120.00 KZT','Непросроченный основной долг: 999.00 KZT').replace('Непогашенное вознаграждение: 3.45 KZT','Непогашенное вознаграждение: -')]){const e=extract(c);assert.equal(fields(e).debtOutstanding,undefined);assert.ok(e.findings.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'));}
});

const kzHeader=`ТОЛЫҚ ДЕРБЕС НЕСИЕЛІК ЕСЕП ID 12345 21.08.2026 12:10:39
СЫНАҚ ТЕСТОВ ТЕСТОВИЧ (31.12.1999 ж.)
ЖСН/БСН : 991231300003
0 Қолданыстағы кешігусіз келісім-шарттар*
1 Қолданыстағы кешігуі бар келісім-шарттар*
1cb.kz`;
const kzCard=`КЕЛІСІМ-ШАРТ 1
Баланс
Ақпарат көзі (несиелендіруші) АО «Тест Банк» Несие лимиті 1000 KZT Мерзімі өткен жарналар сомасы: 5 KZT Тұрақсыздық айыбы (айыппұл, өсімпұл): 1 KZT
Қалдық сома: 123.45 KZT Мерзімін өткізген күндер саны: 50 Ең төмен төлем: 10 KZT
Қаржыландыру түрі: Несие картасы
Субъектінің рөлі: Қарызгер
Несиенің мақсаты: Өзге
Несиелендіру объектісі: Өзге
Ақпарат көзінің (несиелендірушінің) түрі: Екінші деңгейлі банк
КЕЛІСІМ-ШАРТ
Шарт коды: CODE-KZ-1
Өтінім күні: -
Келісім-шарт нөмірі: TEST-KZ-1
Несиенің нақты берілген күні: 16.11.2020
М Ə РТЕБЕСІ
Шарт фазасы: Қолданыстағы
Шарт м ə ртебесі: 31 ден 60 күнге дейін қарыз мерзімін өткізу
БАЛАНС ТУРАЛЫ М Ə ЛІМЕТТЕР (ҚАЛДЫҚ)
Мерзімі өтпеген негізгі қарыз: 120.00 KZT
Өтелмеген сыйақы: 3.45 KZT
Мерзімі өткен негізгі қарыз: 4 KZT
Мерзімі өткен сыйақы: 1 KZT
Есептен шығарылған негізгі қарыз: 0 KZT
Есептен шығарылған сыйақы: 0 KZT
Өтелмеген тұрақсыздық айыбы (айыппұл, өсімпұл): 1 KZT
ҚОСЫМША М Ə ЛІМЕТ:
КЕПІЛДЕР: Бланкілік
Келісімшарт басталғаннан мерзімінен кешіктірілген максималды күндер: 999
Мерзімі өткен жарналар сомасы: 999 KZT`;
const kzPages=texts=>texts.map((text,i)=>({page:i+1,text:`${text}\nТОЛЫҚ ДЕРБЕС НЕСИЕЛІК ЕСЕП - СЫНАҚ ТЕСТОВ ТЕСТОВИЧ - ID 12345 - 21.08.2026 12:10:39 ${i+1} / ${texts.length}`,nativeCharacters:text.length,needsOcr:false}));
const kzExtract=(card=kzCard)=>extractNative(kzPages([kzHeader,'ҚОЛДАНЫСТАҒЫ ШАРТ\n'+card]));
test('Kazakh 1cb contract cards reconcile active loans and retain original language quotes',()=>{
 const e=kzExtract();assert.equal(e.kind,'gkb_full');assert.equal(e.identity.iin,'991231300003');assert.equal(e.identity.name,'СЫНАҚ ТЕСТОВ ТЕСТОВИЧ');assert.equal(e.issuedAt,'2026-08-21');assert.equal(e.creditList.complete,true);
 assert.deepEqual(fields(e),{creditor:'АО «Тест Банк»',contractIdentifier:'CODE-KZ-1',startedAtMonth:'2020-11',overdueDays:'50',loanStatus:'В просрочке — требуют полную сумму',creditType:'Кредитная карта',debtOutstanding:'129.45'});assert.ok(e.credits[0].facts.every(f=>f.page===2&&f.source.includes('оригинал:')));assert.ok(e.credits[0].facts.find(f=>f.key==='overdueDays').source.includes('Мерзімін өткізген күндер саны: 50'));assert.equal(e.credits[0].facts.some(f=>f.key==='relatedParties'),false);
});
test('Kazakh closed contracts, other roles, missing pages and unknown fees remain guarded',()=>{
 const closed=kzCard.replaceAll('KZ-1','CLOSED').replace('Шарт фазасы: Қолданыстағы','Шарт фазасы: Мерзімінен бұрын өтелді');assert.equal(kzExtract(kzCard+'\nАЯҚТАЛҒАН ШАРТТАР\n'+closed).credits.length,1);
 const other=kzExtract(kzCard.replace('Субъектінің рөлі: Қарызгер','Субъектінің рөлі: Кепіл беруші'));assert.equal(other.creditList.complete,false);assert.equal(other.credits.length,0);
 const missing=kzPages([kzHeader,'ҚОЛДАНЫСТАҒЫ ШАРТ\n'+kzCard]);missing[1].text=missing[1].text.replace('2 / 2','1 / 2');assert.ok(extractNative(missing).findings.includes('PAGE_COMPLETENESS_UNVERIFIED'));
 const fees=kzExtract(kzCard.replace('Тұрақсыздық айыбы (айыппұл, өсімпұл): 1 KZT','Тұрақсыздық айыбы (айыппұл, өсімпұл): -'));assert.equal(fields(fees).debtOutstanding,undefined);assert.ok(fees.findings.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'));
});

test('Kazakh labels support a normal Ә glyph as well as the PDF spaced schwa encoding',()=>{
 const e=kzExtract(kzCard.replaceAll('М Ə ','МӘ'));assert.equal(e.creditList.complete,true);assert.equal(fields(e).debtOutstanding,'129.45');assert.ok(e.credits[0].facts.find(f=>f.key==='debtOutstanding').source.includes('БАЛАНС ТУРАЛЫ МӘЛІМЕТТЕР'));
});
