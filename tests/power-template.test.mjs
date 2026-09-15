import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>imports[n],Date,Map,Set});return exports;}
const parser=load('lib/documents/power-of-attorney.ts'),policy=load('lib/documents/policy.ts');
const validation=load('lib/documents/power-validation.ts',{'./power-of-attorney':parser,'./policy':policy,'./approved-representatives.server.json':[{kind:'person',legalName:'TEST APPROVED PERSON',identifier:'000000000002'}]});
const text=`ДОВЕРЕННОСТЬ
Пятнадцатое сентября две тысячи двадцать шестого года
Я, гр. TEST PRINCIPAL, ИИН 000000000001, настоящей доверенностью уполномочиваю гр. TEST APPROVED PERSON, ИИН 000000000002, на следующее:
право подписания и подачи заявления о признании банкротом;
представления интересов в суде в рамках дела о банкротстве;
с правом на подписание искового заявления.
Доверенность выдана сроком до пятнадцатого сентября две тысячи двадцать девятого года.`;
function analysis(content=text){return {read:{totalPages:1,pages:[{page:1,text:content,needsOcr:false}]},extraction:{kind:'power_of_attorney',identity:{iin:'000000000001'},issuedAt:null,facts:[{key:'identity.iin',value:'000000000001'}],credits:[],findings:['POWER_AUTHORITY_REVIEW_REQUIRED'],power:parser.extractPowerParties(content)}};}
test('written Russian dates are parsed without guessing impossible dates or years',()=>{
 for(const [input,date]of [['пятнадцатого сентября две тысячи двадцать девятого года','2029-09-15'],['Тридцать первое декабря две тысячи тридцатого года','2030-12-31'],['«15» сентября 2026 года','2026-09-15'],['31.12.2029','2029-12-31'],['31 февраля 2026 года',null],['первого января неизвестного года',null]])assert.equal(parser.powerDate(input),date,input);
});
test('the company template passes existing cached uploads with dates and approved representative',()=>{
 const result=validation.checkPowerTemplate(analysis(),'2026-09-15');assert.equal(result.accepted,true);assert.equal(result.issuedAt,'2026-09-15');assert.equal(result.expiresAt,'2029-09-15');assert.equal(result.authorityVerified,false);
 assert.equal(analysis().extraction.findings[0],'POWER_AUTHORITY_REVIEW_REQUIRED');
});
test('unknown, altered, expired, future and incomplete powers still request specific checks',()=>{
 for(const [change,day,code]of [
  [a=>a.extraction.power.representative.identifier='000000000099','2026-09-15','REPRESENTATIVE_NOT_APPROVED'],
  [a=>a.read.pages[0].text=a.read.pages[0].text.replace('с правом на подписание искового заявления','без права подписания искового заявления'),'2026-09-15','POWER_SCOPE_REVIEW_REQUIRED'],
  [a=>a.read.pages[0].text=a.read.pages[0].text.replace('право подписания и подачи','не предоставляется право подписания и подачи'),'2026-09-15','POWER_SCOPE_REVIEW_REQUIRED'],
  [()=>{},'2030-01-01','POWER_DATE_NOT_ACCEPTABLE'],[()=>{},'2026-09-14','POWER_DATE_NOT_ACCEPTABLE'],
  [a=>a.read.pages[0].needsOcr=true,'2026-09-15','DOCUMENT_COMPLETENESS_UNVERIFIED'],
  [a=>a.read.totalPages=2,'2026-09-15','DOCUMENT_COMPLETENESS_UNVERIFIED'],
  [a=>a.read.pages[0].text=a.read.pages[0].text.replace('до пятнадцатого сентября две тысячи двадцать девятого года','до неопределённой даты'),'2026-09-15','POWER_DATES_UNVERIFIED']
 ]){const a=analysis();change(a);const result=validation.checkPowerTemplate(a,day);assert.equal(result.accepted,false,code);assert.ok(result.findings.includes(code),code);}
});
test('analysis response and package check agree on accepted cached template while wrong owners stay blocked',async()=>{
 const record={id:'case',client_iin:'000000000001',identity_revision:1},result=analysis(),stored={document:{id:'doc'},extraction:{id:'extraction'},result};
 const repository={currentReviews:async()=>[],document:async()=>({id:'doc',original_sha256:'sha'}),cached:async()=>stored,credentialStatus:async()=>({verified:true})};
 const imports={'./policy':policy,'./power-validation':validation,'./analysis-version':{analysisVersion:'test'},'./request-context':{operatingDay:()=> '2026-09-15'},'./document-review':{MANUAL_DOCUMENT_TYPES:{},DOCUMENT_REVIEW_KEY:'document'}};
 const {analysisResponse}=load('lib/documents/analysis-service.ts',imports);
 const {checkDocumentPackage}=load('lib/documents/package-check.ts',{...imports,'./analysis-service':{analysisVersion:'test'}});
 const payload={answers:[],groups:[],documents:[{documentId:'doc',type:'Доверенность',person:'Клиент'}],pendingFiles:[],docContext:{social:'0',salary:'none'}};
 const response=await analysisResponse({iin:record.client_iin},record,repository,stored,true),pack=await checkDocumentPackage(repository,record,payload,'2026-09-15');
 assert.equal(response.eligibleForAutofill,true);assert.equal(response.powerValidation.accepted,true);assert.equal(response.findings.includes('POWER_AUTHORITY_REVIEW_REQUIRED'),false);assert.equal(response.reviewContext.expiresAt,'2029-09-15');assert.ok(pack.structurallyChecked.includes('Доверенность'));assert.equal(pack.issues.some(issue=>issue.documentId==='doc'),false);assert.equal(pack.authenticity,'not_verified');
 result.extraction.identity.iin='other';
 assert.equal((await analysisResponse({iin:record.client_iin},record,repository,stored,true)).eligibleForAutofill,false);
 const wrong=await checkDocumentPackage(repository,record,payload,'2026-09-15');assert.equal(wrong.structurallyChecked.includes('Доверенность'),false);assert.ok(wrong.issues.some(issue=>issue.code==='DOCUMENT_CLIENT_UNVERIFIED'));
});


test('fact confirmation uses the same template decision as document and package checks',()=>{
 const repo=load('lib/documents/repository.ts');
 const {assertReviewAllowed}=load('lib/documents/review-service.ts',{'./analysis-service':{analysisVersion:'test'},'./policy':policy,'./repository':repo,'./power-validation':validation});
 const record={id:'case',client_iin:'000000000001',identity_revision:1},document={id:'doc',case_id:'case'},extraction={id:'extraction',document_id:'doc',version:'test'};
 const input={factKey:'identity.iin',value:'000000000001',disposition:'confirmed',reason:'',identityRevision:1};
 assert.doesNotThrow(()=>assertReviewAllowed(record,document,extraction,analysis(),input,'2026-09-15'));
 assert.throws(()=>assertReviewAllowed(record,document,extraction,analysis(),input,'2030-01-01'),/DOCUMENT_REQUIRES_VALIDATION/);
});
