import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>imports[n],Date,Map,Set,BigInt});return exports;}
const {extractNative}=load('lib/documents/extract-native.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./kz-labels.json':JSON.parse(fs.readFileSync('lib/documents/kz-labels.json','utf8'))});
const base='Kaspi ВЫПИСКА за период с 01.09.25 по 31.08.26\nИИН: 000000000010\nДоступно на 01.09.25 + 10,00 ₸\nДоступно на 31.08.26 + 90,03 ₸\n15.01.26 + 100,03 ₸ Пополнение\n16.01.26 - 20,00 ₸ Покупка';
const pages=text=>[{page:3,text,needsOcr:false,nativeCharacters:text.length}];
test('only top-ups fill the questionnaire; own transfers, loan disbursements and refunds remain in reconciliation',()=>{
 const text=base.replace('90,03','350,03')+'\n17.01.26 + 200,00 ₸ Поступление со своего счета\n18.01.26 + 50,00 ₸ Зачисление кредита\n19.01.26 + 10,00 ₸ Покупка Возврат';
 const r=extractNative(pages(text)),fact=r.facts.find(f=>f.key==='statement.topUps');
 assert.equal(r.bankStatement.credits,'360.03');assert.equal(r.bankStatement.topUps,'100.03');assert.equal(r.bankStatement.reconciled,true);assert.equal(fact.value,'100.03');assert.equal(fact.page,3);assert.ok(!r.facts.some(f=>f.key==='statement.credits'));
});
test('the top-up subtotal must independently match its rows, even when all balances reconcile',()=>{
 const text=base+'\nКраткое содержание операций по карте:\nПополнения + 100,03 ₸\n';
 assert.equal(extractNative(pages(text)).facts.find(f=>f.key==='statement.topUps').value,'100.03');
 for(const broken of [text.replace('Пополнения + 100,03','Пополнения + 99,03'),text+'\nПополнения + 100,03 ₸',base.replace('₸ Пополнение','₸ Неизвестная операция')]){
  const r=extractNative(pages(broken));assert.equal(r.bankStatement.reconciled,true);assert.ok(!r.facts.some(f=>f.key==='statement.topUps'));assert.ok(r.findings.includes('STATEMENT_RECONCILIATION_REQUIRED'));
 }
});

test('category reconciliation nets returned top-ups and purchase refunds without treating refunds as top-ups',()=>{
 const text=base.replace('90,03','-900,00').replace('+ -','- ')+'\n17.01.26 - 1,00 ₸ Пополнение Возврат\n18.01.26 + 2,00 ₸ Покупка Возврат\nКраткое содержание операций по карте:\nПополнения + 99,03 ₸\nПоступления со своих счетов + 0,00 ₸\nЗачисления кредитов + 0,00 ₸\nПереводы - 0,00 ₸\nПереводы на свои счета - 0,00 ₸\nПокупки - 18,00 ₸\nСнятия - 0,00 ₸\nРазное - 0,00 ₸';
 const result=extractNative(pages(text));
 assert.equal(result.bankStatement.reconciliation,'summary');
 assert.equal(result.bankStatement.credits,'102.03');
 assert.equal(result.bankStatement.topUps,'99.03');
 assert.equal(result.facts.find(f=>f.key==='statement.topUps').value,'99.03');
 for(const broken of [text.replace('17.01.26 - 1,00 ₸ Пополнение Возврат\n',''),text.replace('18.01.26 + 2,00 ₸ Покупка Возврат\n',''),text.replace('₸ Покупка Возврат','₸ Неизвестно')]){
  const parsed=extractNative(pages(broken));assert.ok(parsed.findings.includes('STATEMENT_RECONCILIATION_REQUIRED'));assert.ok(!parsed.facts.some(f=>f.key==='statement.topUps'));
 }
});
