import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import {httpHeaders} from './bitrix-headers-helper.mjs'; function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require(n){if(n==='./http-headers')return httpHeaders;if(n in imports)return imports[n];throw Error(n)},Date,AbortSignal,fetch,JSON});return exports;}
const labels=JSON.parse(fs.readFileSync(new URL('../lib/documents/kz-labels.json',import.meta.url),'utf8'));const rules=load('lib/documents/extract-native.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./kz-labels.json':labels});const crm=load('lib/crm/bitrix.ts',{'../documents/extract-native':rules});
const page=text=>[{page:1,text,nativeCharacters:text.length,needsOcr:false}];
const loan='Персональный кредитный отчет\nДата выдачи: 10.09.2026\nОбязательство 1\nРоль субъекта: Заёмщик\nКредитор: TEST BANK\nФаза контракта: Действующий\nНомер договора: SYNTHETIC 1\nДата начала срока действия контракта: 01.01.2025\nСумма ежемесячного платежа /валюта: 20.00 KZT\nСумма предстоящих платежей /валюта: 100.00 KZT\nСумма просроченных взносов /валюта: 5.00 KZT\nКоличество дней просрочки: 3\nСтраница 1 из 1';
test('native rules preserve defaulted contract evidence and withhold ambiguous payment amounts',()=>{const r=rules.extractNative(page(loan));assert.equal(r.credits.length,1);assert.equal(r.credits[0].contractNumber,'SYNTHETIC 1');assert.equal(r.credits[0].facts.find(f=>f.key==='loanStatus').value,'В просрочке — требуют полную сумму');assert.equal(r.credits[0].facts.some(f=>f.key==='monthlyPayment'),false);assert.equal(r.credits[0].facts.some(f=>f.key==='debtOutstanding'),false);assert.ok(!r.findings.includes('PAGE_COMPLETENESS_UNVERIFIED'));});
test('comparison can add explicit balance components without turning unknown penalties into zero',()=>{
 const text=loan.replace('Страница 1 из 1','Өтелмеген айыппұл сомасы/валюта: 1.25 KZT\nСтраница 1 из 1'),credit=rules.extractNative(page(text)).credits[0];
 assert.equal(credit.comparisonDebt.value,'106.25');assert.match(credit.comparisonDebt.source,/100.00.*5.00.*1.25/);assert.equal(credit.facts.find(f=>f.key==='debtOutstanding').value,'106.25');
 assert.equal(rules.extractNative(page(text.replace('1.25 KZT','Нет данных'))).credits[0].comparisonDebt,undefined);
 assert.equal(rules.extractNative(page(text.replace('Страница 1 из 1','Пеня/валюта: 1.25 KZT\nСтраница 1 из 1'))).credits[0].comparisonDebt,undefined,'itemized and aggregate fees must not be counted twice');
});
test('missing declared pages remain unverified even if PDF itself opens',()=>assert.ok(rules.extractNative(page(loan.replace('Страница 1 из 1','Страница 1 из 2'))).findings.includes('PAGE_COMPLETENESS_UNVERIFIED')));
test('closed contract is not an active obligation',()=>assert.equal(rules.extractNative(page(loan.replace('Фаза контракта: Действующий','Фаза контракта: Завершенный'))).credits.length,0));
test('a borrower who is also a pledgor counts once, regardless of role order',()=>{
 for(const role of ['Залогодатель, Заёмщик','Заёмщик, Залогодатель','Кепіл беруші, Қарыз алушы']){
  const text=loan.replace('Обязательство 1','Действующие обязательства: (2)\nРоль субъекта: Количество\nЗаёмщик 1 KZT\nЗалогодатель 1 KZT\nОбязательство 1').replace('Роль субъекта: Заёмщик','Роль субъекта: '+role),r=rules.extractNative(page(text));
  assert.equal(r.credits.length,1,role);assert.equal(r.creditList.complete,true,role);assert.equal(r.creditList.declared,1);
 }
 const other=rules.extractNative(page(loan.replace('Роль субъекта: Заёмщик','Роль субъекта: Созаемщик')));assert.equal(other.credits.length,0);
});
test('full report cannot claim complete debts when borrower count or identifiers disagree',()=>{
 const r=rules.extractNative(page(loan.replace('Обязательство 1','Действующие обязательства: (2)\nЗаёмщик 2 KZT\nОбязательство 1')));assert.equal(r.creditList.complete,false);
 assert.equal(rules.extractNative(page(loan)).creditList.complete,false);
});
test('unknown IIN is not inferred from filename or issuer ID',()=>{const r=rules.extractNative(page(loan));assert.equal(r.identity.iin,null);assert.ok(r.findings.includes('DOCUMENT_IDENTITY_UNVERIFIED'));assert.equal(rules.validIin('000000000000'),false)});
test('Bitrix adapter takes identity from exact returned deal, never from caller',async()=>{let sent;const c=await crm.readClientContext('11665','https://bitrix.example/rest/',async(url,options)=>{sent=JSON.parse(options.body);return Response.json({result:{ID:'11665',TITLE:'TEST ONLY',UF_CRM_AI_IIN:''}})});assert.equal(sent.id,11665);assert.equal(c.iin,null);assert.equal(c.internalClientId,null);});
test('Bitrix adapter rejects another returned deal and provider errors',async()=>{await assert.rejects(()=>crm.readClientContext('11665','https://bitrix.example/rest/',async()=>Response.json({result:{ID:'999'}})),/DEAL_NOT_FOUND/);await assert.rejects(()=>crm.readClientContext('0','https://bitrix.example/rest/'),/INVALID_DEAL_ID/);});
test('client reads retry transient failures once but never substitute another deal',async()=>{
 let attempts=0;const r=await crm.readClientContext('11665','https://bitrix.example/rest/',async()=>++attempts===1?new Response('',{status:503}):Response.json({result:{ID:'11665',TITLE:'SYNTHETIC'}}));assert.equal(attempts,2);assert.equal(r.external.dealId,'11665');
 attempts=0;await assert.rejects(()=>crm.readClientContext('11665','https://bitrix.example/rest/',async()=>{attempts++;throw Error('network');}),/BITRIX_TEMPORARILY_UNAVAILABLE/);assert.equal(attempts,2);
 attempts=0;await assert.rejects(()=>crm.readClientContext('11665','https://bitrix.example/rest/',async()=>{attempts++;return Response.json({result:{ID:'999'}});}),/DEAL_NOT_FOUND/);assert.equal(attempts,1);
});
const shortReport=(rows,count='2',total='300.75')=>`Персональный кредитный отчет (краткая форма)
Дата выдачи: 10.09.2026
Действующие обязательства: ${count}
Общая сумма задолженности/валюта: Минимальное количество дней просрочки:
${total} KZT   0
Кредитор   Номер договора   Сумма задолженности/валюта
${rows}
Страница 1 из 1`;
const shortRows='АО "Тест\nБанк"   123456   100.25 KZT   0   2026-09-01   50.00 KZT\nТОО "Тестовая\nорганизация"\nABC-2   200.50 KZT   12   Нет данных   Нет данных';
test('short report extracts wrapped creditor rows and exact debt without treating last payment as monthly payment',()=>{
 const r=rules.extractNative(page(shortReport(shortRows)));assert.equal(r.credits.length,2);assert.equal(r.credits[0].contractNumber,'123456');assert.equal(r.credits[0].facts.find(f=>f.key==='creditor').value,'АО "Тест Банк"');assert.equal(r.credits[0].facts.find(f=>f.key==='debtOutstanding').value,'100.25');assert.equal(r.credits[1].facts.find(f=>f.key==='overdueDays').value,'12');assert.equal(r.credits.some(c=>c.facts.some(f=>f.key==='monthlyPayment')),false);assert.equal(r.findings.includes('SHORT_CREDIT_LIST_UNVERIFIED'),false);
});
test('short report cannot silently pass missing rows, an inconsistent total or truncated contract identifiers',()=>{
 for(const text of [shortReport(shortRows,'3'),shortReport(shortRows,'2','301.75'),shortReport(shortRows.replace('ABC-2','ABC-2 ..')),shortReport('').replace('Действующие обязательства: 2','')])assert.ok(rules.extractNative(page(text)).findings.includes('SHORT_CREDIT_LIST_UNVERIFIED'));
});
test('short reports support spelled-out lender entities and Kazakh summary labels',()=>{
 const rows='Акционерное\nобщество «Тест Банк»\n123456   100.25 KZT   0   2026-09-01   50.00 KZT\nТоварищество с\nограниченной\nответственностью «Тест»\nABC-2   200.50 KZT   12   Нет данных   Нет данных';
 const text=shortReport(rows).replace('Действующие обязательства','Қолданыстағы міндеттемелер').replace('Общая сумма задолженности/валюта:','Жалпы қарыз/валюта:');
 const r=rules.extractNative(page(text));assert.equal(r.credits.length,2);assert.equal(r.credits[0].contractNumber,'123456');assert.equal(r.credits[1].contractNumber,'ABC-2');assert.equal(r.findings.includes('SHORT_CREDIT_LIST_UNVERIFIED'),false);
});
test('short report diagnostics distinguish shortened IDs from count and total mismatches',()=>{
 const truncated=rules.extractNative(page(shortReport(shortRows.replace('ABC-2','ABC-2 ..'))));assert.ok(truncated.findings.includes('SHORT_CONTRACT_ID_TRUNCATED'));assert.equal(truncated.findings.includes('SHORT_CREDIT_COUNT_MISMATCH'),false);
 const missing=rules.extractNative(page(shortReport(shortRows,'3','900.00')));assert.ok(missing.findings.includes('SHORT_CREDIT_COUNT_MISMATCH'));assert.ok(missing.findings.includes('SHORT_TOTAL_MISMATCH'));
});
test('duplicate short-report rows have a distinct blocker and cannot masquerade as truncation alone',()=>{
 const r=rules.extractNative(page(shortReport(shortRows+'\n'+shortRows)));
 assert.ok(r.findings.includes('SHORT_DUPLICATE_CREDIT'));assert.ok(r.findings.includes('SHORT_CREDIT_LIST_UNVERIFIED'));
});
const modernShortPages=()=>[
 {page:1,needsOcr:false,nativeCharacters:500,layoutText:'ТАӘ:   ТЕСТОВ ТЕСТ ТЕСТОВИЧ\nЖСН:   991231300003\nБЕРІЛГЕН КҮНІ МЕН УАҚЫТЫ:   15.09.2026   16:28',text:'Дербес\nкредиттік есеп\nқысқаша нысан\nТАӘ:\nЖСН:\nБарлығы - 4\nNo:   Кредитор:\n1\nАО "Тест\nБанк"   CARD-1   KZT   Қарыз алушы   10.09.2026   0   Деректер жоқ   0   0   0   0   Жоқ\n2\nАО "Тест 2"   CARD-2   KZT   Қарыз алушы   10.09.2026   2 000   Деректер жоқ   5 087.79   0   0   0   Жоқ\n1 беттің 2 бет'},
 {page:2,needsOcr:false,nativeCharacters:500,text:'No:   Кредитор:\n3\nАО "Тест 3"   LOAN-3   KZT   Қарыз алушы   10.09.2026   334 537   Ай сайынғы төлемдер - 30 күн   0   12 428 507.75   0   548   Иə\n4\nTOO "Тест\nКомпания"\nLOAN-4   KZT   Қарыз алушы   10.09.2026   0   Мерзімділігі тұрақсыз салымдар   0   1 091 559.40   31 213.23   844   Жоқ\nБарлығы (KZT):   5 087.79   13 520 067.15   31 213.23\n2 беттің 2 бет'},
 {page:3,needsOcr:false,nativeCharacters:500,text:'Электрондық цифрлық қолтаңба — synthetic certificate page'}
];
test('modern short report reads positioned identity and all current loans, reconciles each debt column and preserves zero balances',()=>{
 const r=rules.extractNative(modernShortPages());assert.equal(r.kind,'gkb_short');assert.equal(r.identity.iin,'991231300003');assert.equal(r.identity.name,'ТЕСТОВ ТЕСТ ТЕСТОВИЧ');assert.equal(r.issuedAt,'2026-09-15');assert.deepEqual([...r.findings],[]);assert.equal(r.creditList.complete,true);assert.equal(r.credits.length,4);
 assert.deepEqual(Array.from(r.credits,c=>c.facts.find(f=>f.key==='debtOutstanding').value),['0.00','5087.79','12428507.75','1122772.63']);
 assert.equal(r.credits[2].facts.some(f=>f.key==='monthlyPayment'),false);assert.equal(r.credits[3].facts.some(f=>f.key==='monthlyPayment'),false);assert.equal(r.credits[1].facts.find(f=>f.key==='monthlyPayment').value,'2000.00');assert.equal(r.credits[2].page,2);
});
test('modern short format fails closed on missing rows, totals, role, identity or pages',()=>{
 for(const [from,to,code] of [['LOAN-4   KZT','LOAN-4   USD','SHORT_CREDIT_COUNT_MISMATCH'],['13 520 067.15','13 520 067.16','SHORT_TOTAL_MISMATCH'],['Қарыз алушы','Кепіл беруші','OTHER_BORROWER_ROLE_REQUIRES_REVIEW'],['2 беттің 2 бет','2 беттің 3 бет','PAGE_COMPLETENESS_UNVERIFIED'],['Барлығы (KZT):','TOTAL:','SHORT_SUMMARY_MISSING']]){
  const p=modernShortPages();p[1].text=p[1].text.replace(from,to);const r=rules.extractNative(p);assert.ok(r.findings.includes(code),code);
 }
 const p=modernShortPages();delete p[0].layoutText;const r=rules.extractNative(p);assert.equal(r.identity.iin,null);assert.ok(r.findings.includes('DOCUMENT_IDENTITY_UNVERIFIED'));
});

test('Kazakh legacy short report keeps its own layout when later guidance names the newer report',()=>{
 const text=shortReport(shortRows)
  .replace('Персональный кредитный отчет (краткая форма)','Жеке кредиттік есеп (қысқаша нысан)')
  .replace('Дата выдачи:', 'Тегі: Тестов\nАты: Тест\nӘкесінің аты: Тестович\nЖСН: 991231300003\nБерілген күні:')
  .replace('Действующие обязательства','Қолданыстағы міндеттемелер')
  .replace('Общая сумма задолженности/валюта:','Жалпы қарыз/валюта:')
  .replaceAll('Нет данных','Деректер жоқ');
 const baseline=rules.extractNative(page(text));
 const withGuidance=rules.extractNative(page(text+'\nДербес кредиттік есеп туралы қосымша ақпарат'));
 assert.equal(withGuidance.identity.name,'Тестов Тест Тестович');assert.equal(withGuidance.identity.iin,'991231300003');assert.equal(withGuidance.issuedAt,'2026-09-10');
 assert.equal(withGuidance.credits.length,2);
 assert.equal(withGuidance.creditList.complete,true);
 assert.deepEqual(withGuidance,baseline,'Unrelated report descriptions must not change identity, date, loans or reconciliation');
});
test('bilingual digital ID dates come from its validity range, never birth date or an assumed ten-year term',()=>{
 const card='ТЕСТОВА\nСЫНАҚ\nТЕСТОВНА\n11.07.1991\n991231300003\n123456789\nМИНИСТЕРСТВО ВНУТРЕННИХ ДЕЛ РК\n09.10.2017 - 08.10.2027\nTESTOVA<<SYNAQ<<<<<<<<<<<<';
 const r=rules.extractNative(page(card));assert.equal(r.kind,'identity');assert.equal(r.issuedAt,'2017-10-09');assert.equal(r.expiresAt,'2027-10-08');
 const kz=rules.extractNative(page(card.replace('МИНИСТЕРСТВО ВНУТРЕННИХ ДЕЛ РК','ҚР ІШКІ ІСТЕР МИНИСТРЛІГІ')));assert.equal(kz.kind,'identity');assert.equal(kz.issuedAt,r.issuedAt);assert.equal(kz.expiresAt,r.expiresAt);
 const dates=rules.identityCardDates(page('ЖЕКЕ КУӘЛІК / УДОСТОВЕРЕНИЕ ЛИЧНОСТИ\nТуған күні / Дата рождения: 11.07.1991\nБерілген күні / Дата выдачи: 09.10.2017\nЖарамдылық мерзімі / Действителен до: 08.10.2027'));
 assert.equal(dates.issuedAt,'2017-10-09');assert.equal(dates.expiresAt,'2027-10-08');
 for(const t of ['Туған күні / Дата рождения: 11.07.1991','31.02.2020 - 01.03.2030','01.01.2030 - 01.01.2020','01.01.2020 - 01.01.2030\n02.02.2021 - 02.02.2031'])assert.equal(rules.identityCardDates(page(t)).expiresAt,null,t);
});
