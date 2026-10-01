import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
const compiled=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const rules={exports:{}};vm.runInNewContext(compiled,{module:rules,exports:rules.exports});
const {extractNative,loanAccountStatementHeader}=rules.exports;
const page=text=>({page:1,text,nativeCharacters:text.length,needsOcr:false});
const text='ВЫПИСКА\nпо кредитам за период с 01.09.25 по 31.08.26\nСЫНАҚ КЛИЕНТ\nКраткое содержание операций с 01.09.25 по 31.08.26\nВсего поступлений + 10,00 т\nКредит Наличными - 9,00 т\nНа счете на 31.08.26 1,00 т\nДата Сумма Операция Детали На счете\n01.01.26 +10,00 т Поступление С Kaspi Gold 10,00 т\n02.01.26 -9,00 т Кредит Наличными Оплата ежемесячного платежа 1,00 т';

test('explicit loan-account statement stays unknown evidence and cannot supply Gold turnover',()=>{
 const original=[page(text)],before=JSON.stringify(original),r=extractNative(original);
 assert.equal(r.kind,'unknown');assert.equal(r.bankStatement,undefined);assert.equal(r.facts.length,0);
 assert.ok(r.findings.includes('KASPI_LOAN_STATEMENT_NOT_GOLD'));assert.ok(r.findings.includes('DOCUMENT_TYPE_UNVERIFIED'));
 assert.equal(JSON.stringify(original),before);
 const tenge=extractNative([page(text.replaceAll(' т',' ₸'))]);
 assert.equal(tenge.kind,'unknown');assert.equal(tenge.bankStatement,undefined,'Changing currency glyph cannot turn a repayment account into Gold');
});

test('loan-account classification requires the printed heading on the first page',()=>{
 for(const t of [text.replace('ВЫПИСКА\nпо кредитам','ВЫПИСКА\nпо карте Kaspi Gold'),text.replace('по кредитам','по счету'),text.replace('ВЫПИСКА\n','Описание операции: ВЫПИСКА\n')])assert.equal(loanAccountStatementHeader(t),false);
 const gold=page('Kaspi ВЫПИСКА по карте Kaspi Gold за период с 01.09.25 по 31.08.26\n01.01.26 + 10,00 ₸ Пополнение');
 assert.equal(extractNative([gold]).kind,'kaspi');
 assert.equal(extractNative([gold,{...page(text),page:2}]).kind,'kaspi');
});
