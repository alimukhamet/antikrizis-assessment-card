import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {creditorKey as comparisonKey,compareGkb} from '../public/gkb-comparison.mjs';

const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/documents/loan-identity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const {creditorKey,loanRowKey}=exports,script=fs.readFileSync('public/assessment-review.js','utf8');
const form=script.slice(script.indexOf('const afCreditorKey='),script.indexOf('\nfunction afRow('));
const pairs=[
 ['ТОО \"Микрофинансовая организация \"Азиатский Кредитный Фонд\"','ТОО \"МФО \"АКФ\"'],
 ['ТОО Микрофинансовая организация «SurfKaz Finance»','ТОО «МФО «SurfKaz Finance»'],
 ['Товарищество с ограниченной ответственностью «Микрофинансовая организация «Вивус»','ТОО «МФО «Вивус»'],
 ['АО "Народный банк Казахстана"','"Народный банк Казахстана"'],
 ['Дочерний Банк Акционерное Общество "Сбербанк России"','АО «Bereke Bank» (ДБ Lesha Bank LLC (Public))'],
 ['TOO "Микрофинансовая организация Тест Финанс"','ТОО "МФО "Тест Финанс"'],
];
test('printed creditor aliases and previously saved compact keys have one identity everywhere',()=>{
 for(const pair of pairs){
  const expected=creditorKey(pair[0]);
  for(const name of pair.flatMap(name=>[name,name.toLocaleLowerCase('ru-RU').replace(/[«»“”„]/g,'"').replace(/\s+/g,'')])){
   assert.equal(creditorKey(name),expected,name);
   assert.equal(comparisonKey(name),expected,name);
   assert.equal(vm.runInNewContext(form+`;afCreditorKey(${JSON.stringify(name)})`),expected,name);
   assert.equal(creditorKey(expected),expected,'normalization must be idempotent');
  }
 }
});
test('aliases never erase company identity, client identity or a different contract',()=>{
 for(const [a,b] of [['ТОО МФО АКФ','ТОО МФО АКФ Плюс'],['ТОО МФО АКФ','АО МФО АКФ'],['ТОО МФО АКФ','ТОО АКФ'],['ТОО «МФО «Example»','ТОО «МФО «Example Plus»'],['АО «Example»','ТОО «Example»'],['ТОО «Example»','ТОО «МФО «Example»'],['АО «Example»','Example'],['АО «Народный банк Казахстана»','ТОО «Народный банк Казахстана»'],['АО «Народный банк Казахстана»','АО «Народный банк Казахстана» (ДБ Parent)']])assert.notEqual(creditorKey(a),creditorKey(b));
 const key=(name,id='TEST-1',client='synthetic')=>loanRowKey(`creditors|${client}|${name}|${id}`);
 assert.equal(key(pairs[0][0]),key(pairs[0][1]));
 assert.notEqual(key(pairs[0][0]),key(pairs[0][1],'TEST-2'));
 assert.notEqual(key(pairs[0][0]),key(pairs[0][1],'TEST-1','other'));
});
test('short and full reports match spelling aliases only with the same exact contract and facts',()=>{
 for(const [a,b] of pairs){
  const credit=creditor=>({contractNumber:'TEST-1',page:2,facts:[{key:'creditor',value:creditor},{key:'debtOutstanding',value:'100.25'},{key:'overdueDays',value:'0'}]});
  const reports=[a,b].map((name,i)=>({fileId:i,kind:i?'gkbFull':'gkbShort',date:'2026-09-22',identity:{iin:'synthetic'},creditEvidence:{readable:true,findings:[],creditList:{complete:true},credits:[credit(name)]}}));
  const context={iin:'synthetic',day:'2026-09-22'},before=JSON.stringify(reports);
  assert.equal(compareGkb(reports,context).status,'matched');assert.equal(JSON.stringify(reports),before);
  reports[1].creditEvidence.credits[0].contractNumber='TEST-2';assert.equal(compareGkb(reports,context).status,'mismatch');
 }
});
