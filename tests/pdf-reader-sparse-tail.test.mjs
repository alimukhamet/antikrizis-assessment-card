import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';

const OPS={beginText:1,dependency:2,setFont:3,moveText:4,showText:5,endText:6,paintImageXObject:7,paintInlineImageXObject:8,paintImageMaskXObject:9,paintFormXObjectBegin:10,shadingFill:11,constructPath:12};
const textOps={fnArray:[1,2,3,4,5,6,1,2,3,4,5,6],argsArray:[]};
const footer='АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz';
const prefix='Раздел «Краткое содержание операций по карте», в строках «Поступления со своих счетов», «Зачисления кредитов», «Переводы на свои';
const closing=footer+'\nсчета» содержит информацию об операциях клиента между счетами в Kaspi.\n';
const heading=footer+'\nВЫПИСКА\nпо Kaspi Gold за период с 10.08.25 по 10.08.26\nКраткое содержание операций по карте:\nДата Сумма Операция Детали\n09.08.26 + 40000,00 ₸ Пополнение TEST CLIENT';
const previous='11.08.25 - 6886,00 ₸ Покупка TEST SHOP\n'+prefix+'\n';

function load(file,imports={},context={}){
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{if(name in imports)return imports[name];throw Error(name);},TextEncoder,crypto:webcrypto,...context});
 return exports;
}
function setup(texts,operators=textOps){
 const accessed=[],cleaned=[];let destroyed=false;
 const pdf={numPages:texts.length,getPage:async n=>{accessed.push(n);return {view:[0,0,595,842],getTextContent:async()=>({items:texts[n-1].split('\n').map(str=>({str,hasEOL:true}))}),getOperatorList:async()=>operators,cleanup:()=>cleaned.push(n)};},loadingTask:{destroy:async()=>{destroyed=true;}}};
 const reader=load('lib/documents/read-pdf.ts',{'unpdf':{getDocumentProxy:async()=>pdf,getResolvedPDFJS:async()=>({OPS})},'./read-document-limits':load('lib/documents/read-document-limits.ts'),'./pdf-text-heuristics':load('lib/documents/pdf-text-heuristics.ts')});
 return {reader,accessed,cleaned,wasDestroyed:()=>destroyed};
}
const bytes=new TextEncoder().encode('%PDF synthetic test');

test('native Kaspi closing continuation remains a physical readable page',async()=>{
 const s=setup([heading,previous,closing]),result=await s.reader.readPdf(bytes);
 assert.equal(result.totalPages,3);assert.equal(result.readAllPhysicalPages,true);
 assert.deepEqual([...result.pages].map(p=>p.page),[1,2,3]);
 assert.deepEqual(s.accessed,[1,2,3]);assert.deepEqual(s.cleaned,[1,2,3]);assert.equal(s.wasDestroyed(),true);
 assert.equal(result.pages[2].nativeCharacters,99);assert.equal(result.pages[2].needsOcr,false);
 assert.equal(result.pages[2].text,closing+'\n');
 assert.equal(result.originalSha256,result.pdfSha256);
});

test('sparse Kaspi text requires exact disclaimer, previous continuation and statement context',async()=>{
 for(const texts of [
  [heading,previous,closing+'10.08.25 + 1,00 ₸ Пополнение OMITTED ROW'],
  [heading,previous,closing+'\nНечитаемая операция'],
  [heading,previous,closing.replace('операциях','непрочитанных операциях')],
  [heading,previous.replace('Переводы на свои','Переводы'),closing],
  [heading.replace('ВЫПИСКА','Справка'),previous,closing],
  [heading.replace('Kaspi Gold','Другой счет'),previous,closing],
  [heading.replace('Краткое содержание операций по карте:','Сводка'),previous,closing],
  [heading,previous,footer],
  [closing],
 ]){
  const s=setup(texts);
  assert.equal(s.reader.sparseKaspiClosingText(texts.at(-1),texts.at(-2)||'',texts.slice(0,-1).join('\n')),false);
  const result=await s.reader.readPdf(bytes);
  // The exception only participates in the existing <120-character OCR gate.
  if(result.pages.at(-1).nativeCharacters<120)assert.equal(result.pages.at(-1).needsOcr,true);
 }
 const middle=await setup([heading,previous,closing,heading]).reader.readPdf(bytes);
 assert.equal(middle.pages[2].needsOcr,true);
});

test('native disclaimer over images or unknown drawing operators still requires OCR',async()=>{
 for(const name of ['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintFormXObjectBegin','shadingFill','constructPath']){
  const s=setup([heading,previous,closing],{fnArray:[...textOps.fnArray,OPS[name]],argsArray:[]});
  assert.equal((await s.reader.readPdf(bytes)).pages[2].needsOcr,true,name);
 }
 for(const fnArray of [[],[OPS.beginText,OPS.endText],[...textOps.fnArray,999]]){
  const s=setup([heading,previous,closing],{fnArray,argsArray:[]});
  assert.equal((await s.reader.readPdf(bytes)).pages[2].needsOcr,true);
 }
 const imageOnly=await setup([heading,previous,''],{fnArray:[OPS.paintImageXObject],argsArray:[]}).reader.readPdf(bytes);
 assert.equal(imageOnly.pages[2].needsOcr,true);
});

test('sparse non-Kaspi financial pages retain the OCR gate',async()=>{
 const result=await setup(['OTHER BANK\nStatement','10.08.25 + 1,00 ₸ Transfer']).reader.readPdf(bytes);
 assert.equal(result.pages.every(p=>p.needsOcr),true);
});
