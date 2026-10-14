import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {loanDatePrecision,formatLoanDate,loanAutofillFacts} from '../public/loan-dates.mjs';
const bundled=buildSync({stdin:{contents:"export * from './lib/documents/loan-date-evidence';export {extractNative} from './lib/documents/extract-native';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const dates=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const text='Персональный кредитный отчет\nИИН: 991231300003\nДата выдачи: 10.09.2026\nОбязательство 1\nРоль субъекта: Заёмщик\nКредитор: TEST BANK\nФаза контракта: Действующий\nНомер договора: SYNTHETIC-1\nКод контракта: CODE-1\nДата начала срока действия контракта: 17.04.2023\nКоличество дней просрочки: 0\nСтраница 1 из 1';
function source(){const pages=[{page:1,text,nativeCharacters:text.length,needsOcr:false}],extraction=dates.extractNative(pages);extraction.version='rules-native-29';for(const c of extraction.credits)delete c.contractStartDate;return{extraction,read:{pages,originalSha256:'original-hash',readAllPhysicalPages:true,totalPages:1}};}
const document={id:'doc',case_id:'case',original_sha256:'original-hash'},row={id:'original-extraction',result_sha256:'original-result-hash'};
test('full dates have calendar precision; old months never acquire an invented day',()=>{
 assert.equal(loanDatePrecision('2024-02-29'),'day');assert.equal(loanDatePrecision('2023-02-29'),null);assert.equal(formatLoanDate('2023-04'),'04.2023 (день не указан)');assert.equal(formatLoanDate('2023-04-17'),'17.04.2023');
});
test('pre-v32 retained pages yield separately identified dates without altering old facts',()=>{
 const result=source(),before=structuredClone(result),evidence=dates.deriveLoanDateEvidence(document,row,result,'991231300003');
 assert.equal(evidence.version,'loan-dates-1');assert.equal(evidence.credits[0].contractStartDate.value,'2023-04-17');assert.equal(evidence.credits[0].contractStartDate.page,1);assert.match(evidence.credits[0].contractStartDate.source,/17.04.2023/);assert.deepEqual(result,before);assert.deepEqual(evidence.credits[0].facts.map(f=>f.key),['creditor']);
 const full=loanAutofillFacts(evidence.credits[0]);assert.equal(full.find(f=>f.key==='contractStartDate').value,'2023-04-17');assert.equal(full.some(f=>f.key==='startedAtMonth'),false);
});
test('supplements reject foreign identities, hash mismatches, unreadable pages and ambiguous loans',()=>{
 for(const [name,mutate]of [['owner',r=>r.extraction.identity.iin='000000000010'],['hash',r=>r.read.originalSha256='other'],['ocr',r=>r.read.pages[0].needsOcr=true],['contract',r=>{r.extraction.credits[0].contractNumber='OTHER';r.extraction.credits[0].contractCode='OTHER';}],['duplicate',r=>r.extraction.credits.push(structuredClone(r.extraction.credits[0]))]]){
  const result=source();mutate(result);assert.equal(dates.deriveLoanDateEvidence(document,{...row,result_sha256:name},result,'991231300003'),null,name);
 }
});
test('explicit analysis adds a distinct date extraction and never carries historical approval into it',async()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/documents/analysis-service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>({'./loan-date-evidence':dates,'./request-context':{operatingDay:()=> '2026-09-10'},'./policy':{gkbFreshness:()=>[],requiresDocumentValidation:()=>false}}[n]),Set});
 const result=source(),stored={document,extraction:row,result},before=structuredClone(stored),saved=[];
 const repository={cached:async()=>null,currentReviews:async(_case,_doc,id)=>id===row.id?[{id:'old-approval'}]:[],storeExtraction:async(doc,version,value)=>{saved.push({version,value});return{document:doc,extraction:{id:'new-date-evidence'},result:value};}};
 const response=await exports.analysisResponse({iin:'991231300003'},{id:'case',identity_revision:1},repository,stored,true);
 assert.equal(saved.length,1);assert.equal(saved[0].version,'loan-dates-1:original-extraction');assert.deepEqual(stored,before);assert.equal(response.reviews[0].id,'old-approval');assert.equal(response.dateSupplement.extractionId,'new-date-evidence');assert.equal(response.dateSupplement.reviews.length,0);
});
test('issuance-only facts never become commencement proposals',()=>{
 const credit={facts:[{key:'startedAtMonth',value:'2020-11',source:'Несиенің нақты берілген күні'}],disbursementDate:{key:'disbursementDate',value:'2020-11-16'}};
 assert.deepEqual(loanAutofillFacts(credit),[credit.disbursementDate]);
});
