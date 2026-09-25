import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>{if(n in imports)return imports[n];throw Error(n);},Date,TextEncoder});return exports;}
const rules=load('lib/documents/extract-native.ts',{'./kz-labels.json':JSON.parse(fs.readFileSync('lib/documents/kz-labels.json')),'./power-of-attorney':load('lib/documents/power-of-attorney.ts')});const policy=load('lib/documents/policy.ts');const reader=load('lib/documents/read-pdf.ts',{'unpdf':{}});
const pages=(...texts)=>texts.map((text,i)=>({page:i+1,text,nativeCharacters:text.length,needsOcr:false}));
test('rolling annual statements qualify, with calendar years, leap days, stale and future boundaries checked',()=>{
 for(const dates of [['2025-09-10','2026-09-10','2026-09-12'],['2025-09-01','2026-08-31','2026-09-12'],['2023-03-01','2024-02-29','2024-03-01']])assert.equal(policy.statementPeriod(...dates).length,0);
 for(const dates of [['2025-09-11','2026-09-10','2026-10-01'],['2025-09-12','2026-09-10','2026-09-12'],['2025-09-14','2026-09-14','2026-09-12'],['2025-02-30','2026-02-28','2026-03-01']])assert.equal(policy.statementPeriod(...dates).length,1);
});
test('Kazakh full report accepts only complete ordered page sequences and maps the payment on its actual page',()=>{
 const a='Жеке кредиттік есеп\nЖСН: 991231300003\nБерілген күні: 10.09.2026\nМіндеттеме 1\nСубъектінің рөлі: Қарыз алушы\nКредитор: TEST BANK\nКелісімшарт кезеңі Қолданыстағы\nШарт нөмірі: TEST-1\nКелісімшарттың қолданылу мерзімінің басталу күні: 01.01.2025\nҚаржыландыру түрі: Кредиттік карта\n1 беттің 2 беті';
 const b='Ай сайынғы жарна сомасы/валютасы: 15000.00 KZT\nМерзімі өткен күндер саны: 0\nМерзімі өткен жарналар сомасы/валютасы: 0.00 KZT\nҚалдық (пайдаланылған) сома/валютасы: 30000.00 KZT\n2 беттің 2 беті';
 const r=rules.extractNative(pages(a,b));assert.equal(r.findings.includes('PAGE_COMPLETENESS_UNVERIFIED'),false);const payment=r.credits[0].facts.find(f=>f.key==='monthlyPayment');assert.equal(payment.value,'15000.00');assert.equal(payment.page,2);
 assert.equal(rules.extractNative(pages(a)).findings.includes('PAGE_COMPLETENESS_UNVERIFIED'),true);assert.equal(rules.extractNative(pages(b,a)).findings.includes('PAGE_COMPLETENESS_UNVERIFIED'),true);
});
test('ENPF counts distinct recent contribution payers, excludes returned rows and does not infer salary',()=>{
 const row=(knp,bin,status,period)=>`28.08.2026 28.08.2026 100 28.08.2026 ${knp}\nTEST EMPLOYER\n${bin}\nGOVERNMENT CORPORATION\n12000.00 ${status} ${period}\n`;
 const header='Выдача информации о поступлении и движении средств вкладчика единого накопительного пенсионного фонда\n991231300003\nTEST CLIENT ТАӘ/ФИО:\nЖСН/ИИН:\n';
 const text=header+row('032','111111111111','ВОЗВРАЩЕННЫЕ','082026')+row('010','222222222222','ОБРАБОТАННЫЕ','082026')+row('010','222222222222','ОБРАБОТАННЫЕ','072026')+row('010','333333333333','ОБРАБОТАННЫЕ','042026')+'Стр 1 из 1\n10.09.2026 20:00:00 Алу күні/Дата получения:';
 const r=rules.extractNative(pages(text));assert.equal(r.kind,'enpf');assert.equal(r.identity.iin,'991231300003');assert.equal(r.facts.find(f=>f.key==='employment.payersCount').value,'1');assert.equal(r.facts.some(f=>/salary|netIncome/.test(f.key)),false);
 assert.equal(rules.extractNative(pages(text.replace('12000.00 ОБРАБОТАННЫЕ','??? ОБРАБОТАННЫЕ'))).facts.some(f=>f.key==='employment.payersCount'),false);
});
test('benefits count uses active rows, not historical categories or inferred monthly amounts',()=>{
 const r=rules.extractNative(pages('Информация о пенсионных выплатах и пособиях\nЖСН/ИИН 991231300003\nДействующие выплаты:\nВид выплаты\n1\nМногодетная семья\n86673 10.12.2021 18.10.2034\nТөленген төлемдер / Выплаченные выплаты:\nРождение ребёнка 0\nУход за ребёнком 0\nМногодетная семья 78798\nДата получения: 15.12.2025'));
 assert.equal(r.facts.find(f=>f.key==='benefits.count').value,'1');assert.equal(r.facts.some(f=>f.key.includes('Amount')||f.key.includes('Frequency')),false);assert.ok(r.facts.find(f=>f.key==='benefits.count').source.includes('2025-12-15'));
});
test('unlabelled native ID cards require the card structure, checksum, ministry and machine-readable name',()=>{
 const card='ТЕСТОВА\nКЛАРА\nКАПАШОВНА\n31.12.1999\n991231300003\n123456789\nОБЛАСТЬ\nМИНИСТЕРСТВО ВНУТРЕННИХ ДЕЛ РК\n01.01.2025 - 01.01.2035\nTESTOVA<<KLARA<<<<<<<<<<<<';const r=rules.extractNative(pages(card));assert.equal(r.kind,'identity');assert.equal(r.identity.iin,'991231300003');assert.equal(rules.extractNative(pages(card.replace('991231300003','991231300004'))).identity.iin,null);
});
test('sparse GKB exemption accepts only header images and recognized footer/history text',()=>{
 assert.equal(reader.sparseGkbText('4 беттің 2 беті'),true);assert.equal(reader.sparseGkbText('unreadable financial table\n4 беттің 2 беті'),false);
 const OPS={save:10,restore:11,transform:12,paintImageXObject:85};const op=(y)=>({fnArray:[10,12,85,11],argsArray:[null,[365,0,0,50,56,y],['logo'],null]});
 assert.equal(reader.headerImagesOnly(op(757),OPS,595,842),true);assert.equal(reader.headerImagesOnly(op(400),OPS,595,842),false);assert.equal(reader.headerImagesOnly({...op(757),fnArray:[10,12,85,85,11],argsArray:[null,[365,0,0,50,56,757],['a'],['b'],null]},OPS,595,842),false);
});
test('a full report preserves both the bank contract code and the printed agreement number',()=>{
 const r=rules.extractNative(pages('Персональный кредитный отчет\nОбязательство 1\nРоль субъекта: Заёмщик\nФаза контракта: Действующий\nКредитор: TEST BANK\nКод контракта: CODE-123\nНомер договора: AGREEMENT-456\nСтраница 1 из 1'));
 assert.equal(r.credits[0].contractCode,'CODE-123');assert.equal(r.credits[0].contractNumber,'AGREEMENT-456');
});
test('a next instalment is never relabelled as full debt, even for a defaulted loan',()=>{
 const r=rules.extractNative(pages('Персональный кредитный отчет\nИИН: 991231300003\nОбязательство 1\nРоль субъекта: Заёмщик\nФаза контракта: Действующий\nКредитор: TEST BANK\nКод контракта: CODE-123\nНомер договора: AGREEMENT-456\nСумма предстоящего платежа / валюта: 1806000.00 KZT\nКоличество дней просрочки: 322\nСтраница 1 из 1'));
 const facts=new Map(r.credits[0].facts.map(f=>[f.key,f]));assert.equal(facts.get('contractIdentifier').value,'CODE-123');assert.equal(facts.get('loanStatus').value,'В просрочке — требуют полную сумму');assert.equal(facts.has('debtOutstanding'),false);assert.equal(facts.has('monthlyPayment'),false);assert.equal(r.findings.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'),true);
});
test('named related people keep their exact role, loan and source page; incomplete identity never becomes None',()=>{
 const first='Персональный кредитный отчет\nОбязательство 1\nРоль субъекта: Заёмщик\nФаза контракта: Действующий\nКредитор: TEST BANK\nНомер договора: TEST-LOAN\nСтраница 1 из 2';
 const second='Связанные субъекты\nРоль субъекта: ФИО/Наименование субъекта: ИИН/БИН: Вид документа: Номер документа:\nКепіл беруші ТЕСТОВ ТЕСТ\nТЕСТОВИЧ\n991231300003 Жеке куәлік 123456789\nИнформация о просрочках\nСтраница 2 из 2';
 const r=rules.extractNative(pages(first,second)),fact=r.credits[0].facts.find(f=>f.key==='relatedParties');assert.match(fact.value,/ТЕСТОВ ТЕСТ ТЕСТОВИЧ — Залогодатель/);assert.equal(r.credits[0].contractNumber,'TEST-LOAN');assert.equal(fact.page,2);assert.equal(r.facts.some(f=>f.key==='credits.guarantors'),false);
 const broken=rules.extractNative(pages(first,second.replace('991231300003','991231300004')));assert.equal(broken.credits[0].facts.some(f=>f.key==='relatedParties'),false);assert.equal(broken.credits[0].relatedPartiesNotice,undefined);
});

 test('an explicit five-cell empty participants table supplies No for that loan; a missing table does not',()=>{
 const loan=(n,table)=>`Персональный кредитный отчет\nОбязательство ${n}\nРоль субъекта: Заёмщик\nФаза контракта: Действующий\nКредитор: TEST BANK\nНомер договора: LOAN-${n}\n${table}\nСтраница ${n} из 3`;
 const empty='Байланысты субъектілер\nСубъектінің рөлі: АТӘ/атауы: ЖСН/БСН: Құжат түрі: Құжат нөмірі:\nДеректер жоқ Деректер жоқ Деректер жоқ Деректер жоқ Деректер жоқ\nШарттың валютасындағы күндер саны және мерзімі өткен төлемдер сомасы бойынша деректер *';
 const named='Связанные субъекты\nГарант ТЕСТОВ ТЕСТ ТЕСТОВИЧ 991231300003 Удостоверение 123456789\nИнформация о просрочках';
 const r=rules.extractNative(pages(loan(1,empty),loan(2,named),loan(3,'')));
 assert.equal(r.credits.length,3);const no=r.credits[0].facts.find(f=>f.key==='relatedParties');assert.equal(no.value,'Нет');assert.equal(no.page,1);assert.match(no.source,/Деректер жоқ/);assert.equal(r.credits[0].relatedPartiesNotice,undefined);
 assert.match(r.credits[1].facts.find(f=>f.key==='relatedParties').value,/Гарант/);assert.equal(r.credits[1].facts.find(f=>f.key==='relatedParties').page,2);
 assert.equal(r.credits[2].relatedPartiesNotice,undefined);assert.equal(r.credits[2].facts.some(f=>f.key==='relatedParties'),false);assert.equal(r.facts.some(f=>f.key==='credits.guarantors'),false);
 });

test('partial, unreadable or mixed participants tables never become No',()=>{
 const head='Персональный кредитный отчет\nОбязательство 1\nРоль субъекта: Заёмщик\nФаза контракта: Действующий\nКредитор: TEST BANK\nНомер договора: LOAN-1\nСвязанные субъекты\nРоль субъекта: ФИО: ИИН/БИН: Вид документа: Номер документа:\n';
 for(const row of ['Нет данных '.repeat(4),'Нет данных '.repeat(5)+'неразборчиво','Гарант НЕРАЗБОРЧИВО\n'+'Нет данных '.repeat(5)]){
  const r=rules.extractNative(pages(head+row+'\nИнформация о просрочках\nСтраница 1 из 1'));
  assert.equal(r.credits[0].facts.some(f=>f.key==='relatedParties'),false,row);
 }
});

test('questionnaire loan categories follow financing and the full goods object, including automobile exclusions',()=>{
 const cases=[
  ['Қарыз','Басқалары','Басқалар','Потребительский кредит'],
  ['Заем','Прочие','Прочие','Потребительский кредит'],
  ['Қарыз','Сатып алу','Тұтынушылық тауарлар мен қызметтер\n(автокөліктен басқасы)','Товарный кредит'],
  ['Заем','Приобретение','Потребительские товары и услуги\n(кроме автомобилей)','Товарный кредит'],
  ['Кредиттік карта','Сатып алу','Тұтынушылық тауарлар мен қызметтер','Кредитная карта'],
  ['Қарыз','Сатып алу','Автокөлік','Автокредит'],
  ['Микрокредит','Приобретение','Потребительские товары','Микрозайм'],
  ['Ипотека','Приобретение жилья','Жильё','Ипотека'],
  ['Нет данных','Нет данных','Нет данных',undefined]
 ];
 for(const [financing,purpose,object,expected] of cases){
  const r=rules.extractNative(pages(`Жеке кредиттік есеп\nМіндеттеме 1\nСубъектінің рөлі: Қарыз алушы\nКелісімшарт кезеңі Қолданыстағы\nКредитор: TEST BANK\nШарт нөмірі: TEST-1\nКредиттің мақсаты: ${purpose}\nКредит беру нысаны: ${object}\nҚаржыландыру түрі: ${financing}\n1 беттің 1 беті`));
  const type=r.credits[0].facts.find(f=>f.key==='creditType');assert.equal(type?.value,expected,JSON.stringify({financing,purpose,object}));
  if(type){assert.equal(type.page,1);assert.ok(type.source.includes(purpose));assert.ok(type.source.includes(object.replace(/\s+/g,' ')));}
 }
});

test('salary Halyk is recognised from document content without treating inflows as wages',()=>{
 const text='АО "Народный Банк Казахстана"\nВыписка по счету\nФИО: ТЕСТОВА КЛАРА КАПАШОВНА   Дата формирования выписки: 15.09.2026\nИИН: 991231300003   Период выписки: с 08.09.2025 по 15.09.2026\nТип счета: Текущий счет в карточной базе («Зарплата»)\nВсего: 4390108.83 -4669056.45 -2750.00';
 const r=rules.extractNative(pages(text));assert.equal(r.kind,'salary');assert.equal(r.identity.iin,'991231300003');assert.equal(r.identity.name,'ТЕСТОВА КЛАРА КАПАШОВНА');assert.equal(r.coverage.from,'2025-09-08');assert.equal(r.coverage.to,'2026-09-15');assert.equal(r.facts.some(f=>/salary|income|statement/.test(f.key)),false);
 assert.equal(rules.extractNative(pages(text.replace('«Зарплата»','«Текущий»'))).kind,'unknown');
 assert.equal(policy.salaryStatementPeriod(r.coverage.from,r.coverage.to,'2026-09-15').length,0);
 assert.equal(policy.salaryStatementPeriod('2025-10-01','2026-09-15','2026-09-15').length,1);
});
test('ENPF uses the printed annual coverage; missing and shorter coverage is explicit',()=>{
 const text='Выдача информации о поступлении и движении средств вкладчика единого накопительного пенсионного фонда\n991231300003\nТЕСТОВА КЛАРА КАПАШОВНА ТАӘ/ФИО:\nЖСН/ИИН:\n15.09.2025 - 15.09.2026 Период:\n15.09.2026 11:10:06 Алу күні/Дата получения:';
 const r=rules.extractNative(pages(text));assert.equal(r.coverage.from,'2025-09-15');assert.equal(policy.enpfPeriod(r.coverage.from,r.coverage.to,r.issuedAt,'2026-09-15').length,0);
 assert.equal(policy.enpfPeriod('2025-10-01',r.coverage.to,r.issuedAt,'2026-09-15')[0].code,'ENPF_PERIOD_NOT_ACCEPTABLE');
 assert.equal(policy.enpfPeriod(null,null,r.issuedAt,'2026-09-15')[0].code,'ENPF_PERIOD_UNVERIFIED');
});
test('ENPF all-history headers cover the year without inventing contribution dates',()=>{
 for(const header of ['Период: Барлық кезең / Весь период','Барлық кезең / Весь период\nПериод:','Период:\nВесь период']){
  assert.equal(policy.enpfPeriod(null,null,'2026-09-18','2026-09-21',header).length,0);
  assert.equal(policy.enpfPeriod(null,'2026-09-18','2026-09-18','2026-09-21',header).length,0);
  assert.equal(policy.enpfPeriod(null,null,null,'2026-09-21',header)[0].code,'ENPF_PERIOD_UNVERIFIED');
  assert.equal(policy.enpfPeriod(null,null,'2026-09-22','2026-09-21',header)[0].code,'ENPF_PERIOD_NOT_ACCEPTABLE');
 }
 for(const text of ['Весь период','Период: 01.09.2026 - 18.09.2026','В примечании упоминается весь период'])assert.equal(policy.enpfPeriod(null,null,'2026-09-18','2026-09-21',text)[0].code,'ENPF_PERIOD_UNVERIFIED');
 assert.equal(policy.enpfPeriod('2026-09-01','2026-09-18','2026-09-18','2026-09-21','Период: Весь период')[0].code,'ENPF_PERIOD_NOT_ACCEPTABLE');
});
test('a wrapped creditor name remains complete and stops at the next bureau field',()=>{
 const text='Персональный кредитный отчет\nОбязательство 1\nРоль субъекта: Заёмщик\nКредитор: Товарищество с ограниченной ответственностью\n"Специальная финансовая компания TEST"\nБИН: 111111111111\nНомер договора: TEST-1\nФаза контракта: Действующий\nСтраница 1 из 1';
 const r=rules.extractNative(pages(text));assert.equal(r.credits[0].facts.find(f=>f.key==='creditor').value,'Товарищество с ограниченной ответственностью "Специальная финансовая компания TEST"');
});
