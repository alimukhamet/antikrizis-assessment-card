import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planGkbDraftBalanceSupplements as plan} from '../public/gkb-draft-supplements.mjs';

const context={iin:'991231300003',day:'2026-10-14'};
const fact=(key,value)=>({key,value,page:2,source:'SYNTHETIC ONLY'});
function credit(id,missing=false){return {contractNumber:id,page:4,facts:[fact('creditor','TEST BANK'),fact('overdueDays','0'),fact('loanStatus','Платится по графику'),...missing?[]:[fact('debtOutstanding','100.25')]],components:{remaining:null,arrears:'0.00',penalty:'0.00',interest:null,fine:null}};}
function fixture(){
 const report=(kind,index,credits)=>({fileId:index,kind,date:'2026-08-25',identity:{iin:context.iin},server:{dealId:'11665',documentId:'doc-'+index,extractionId:'ext-'+index,identityRevision:1},creditEvidence:{readable:true,credits,creditList:{complete:index===2,declared:credits.length},findings:index===2?['TOTAL_DEBT_REQUIRES_RECONCILIATION']:['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED']}});
 return [report('gkbShort',1,[credit('MATCH-A'),credit('OTHER..')]),report('gkbFull',2,[credit('MATCH-A',true),credit('OTHER-ABC'),credit('FULL-ONLY')])];
}
test('one truncated contract does not suppress another exact missing-balance proposal or resolve the list',()=>{
 const reports=fixture(),before=structuredClone(reports),p=plan(reports,context);
 assert.equal(p.length,1);assert.deepEqual(p[0],{shortFileId:1,fullFileId:2,shortIndex:0,fullIndex:0,amount:'100.25',shortPage:2,fullPage:4,contractNumber:'MATCH-A',creditor:'TEST BANK',shortFactKey:'credits.0.debtOutstanding',fullAliases:['MATCH-A']});
 assert.deepEqual(reports,before);assert.equal(reports[0].creditEvidence.creditList.complete,false);
});
test('a 46-loan full report retains its unmatched loan while 35 exact missing amounts are proposed',()=>{
 const r=fixture();r[0].creditEvidence.credits=Array.from({length:45},(_,i)=>credit(i===44?'OTHER..':'LOAN-'+i));r[1].creditEvidence.credits=Array.from({length:46},(_,i)=>credit('LOAN-'+i,i<35));
 for(const report of r)report.creditEvidence.creditList.declared=report.creditEvidence.credits.length;
 for(let i=0;i<4;i++){const c=r[1].creditEvidence.credits[i];c.facts=c.facts.filter(f=>!['overdueDays','loanStatus'].includes(f.key));c.components={remaining:null,arrears:null,penalty:null,interest:null,fine:null};}
 r[1].creditEvidence.credits[34].components.arrears='25.00';
 const before=structuredClone(r),p=plan(r,context);assert.equal(p.length,35);assert.ok(p.every(x=>x.fullIndex<35&&x.shortFactKey.endsWith('.debtOutstanding')));assert.deepEqual(r,before);
 assert.ok(p.every(x=>!('monthlyPayment'in x)&&!('loanStatus'in x)&&!('overdueDays'in x)));
});
test('wrong identity, date, source binding, missing pages, unverified arithmetic or competing reports refuse supplements',()=>{
 const mutations=[r=>r[0].identity.iin='other',r=>r[0].date='2026-08-24',r=>r.forEach(x=>x.date='2026-02-30'),r=>r.forEach(x=>x.date='2099-01-01'),r=>r[0].server.identityRevision=2,r=>r[0].server.dealId='other',r=>delete r[0].server.extractionId,r=>r[0].server.draftOnly=true,r=>r[1].creditEvidence.readable=false,r=>r[1].blocked=true,r=>r[0].error='FAILED',r=>r[0].excluded=true,r=>r[1].creditEvidence.creditList.complete=false,r=>r[0].creditEvidence.creditList.declared=99,r=>r[1].creditEvidence.creditList.declared=99,r=>r.push(structuredClone(r[1])),r=>r.pop()];
 for(const code of ['SHORT_TOTAL_MISMATCH','SHORT_CREDIT_COUNT_MISMATCH','SHORT_SUMMARY_MISSING','SHORT_DUPLICATE_CREDIT','OTHER_BORROWER_ROLE_REQUIRES_REVIEW','PAGE_COMPLETENESS_UNVERIFIED','OCR_OR_PAGE_REVIEW_REQUIRED','NEW_UNKNOWN_FINDING'])mutations.push(r=>r[0].creditEvidence.findings.push(code));
 for(const mutate of mutations){const r=fixture();mutate(r);assert.deepEqual(plan(r,context),[]);}
});
test('exact lender and number/code matches are unique in both directions and never use prefix matching',()=>{
 const r=fixture();r[1].creditEvidence.credits[0].contractCode='MATCH-A';r[1].creditEvidence.credits[0].contractNumber='FULL-NUMBER';assert.equal(plan(r,context).length,1);
 for(const change of [r=>r[0].creditEvidence.credits[0].contractNumber='MATCH..',r=>r[1].creditEvidence.credits[0].facts[0].value='OTHER BANK',r=>r[1].creditEvidence.credits.push(credit('MATCH-A',true)),r=>r[0].creditEvidence.credits.push(credit('MATCH-A'))]){const r=fixture();change(r);for(const report of r)report.creditEvidence.creditList.declared=report.creditEvidence.credits.length;assert.deepEqual(plan(r,context),[]);}
});
test('known contradictory amounts, partial totals, overdue days or statuses stay unresolved',()=>{
 for(const change of [c=>c.facts.push(fact('debtOutstanding','0.00')),c=>c.comparisonDebt=fact('debtComponentsTotal','100.25'),c=>c.components.remaining='0.00',c=>c.components.arrears='100.26',c=>c.components.penalty='not known',c=>c.facts.find(f=>f.key==='overdueDays').value='1',c=>c.facts.find(f=>f.key==='loanStatus').value='В просрочке — требуют полную сумму']){const r=fixture();change(r[1].creditEvidence.credits[0]);assert.deepEqual(plan(r,context),[]);}
});

test('actual short parser permits truncation-only assistance only after count and amount reconcile',async()=>{
 const {buildSync}=await import('esbuild');
 const built=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const {extractNative}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const text=(total='200.50',count='2')=>`Персональный кредитный отчет (краткая форма)\nИИН 991231300003\nДата выдачи: 25.08.2026\nДействующие обязательства: ${count}\nОбщая сумма задолженности/валюта:\nКоличество дней просрочки:\n${total} KZT   0\nКредитор   Номер договора   Сумма задолженности/валюта\nАО "TEST BANK"   MATCH-A   100.25 KZT   0   Нет данных   Нет данных\nАО "TEST BANK"   OTHER..   100.25 KZT   0   Нет данных   Нет данных\nСтраница 1 из 1`;
 for(const [total,count,expected] of [['200.50','2',1],['200.51','2',0],['200.50','3',0]]){
  const r=fixture(),source=text(total,count),parsed=extractNative([{page:1,text:source,nativeCharacters:source.length,needsOcr:false}]);
  r[0].creditEvidence={...r[0].creditEvidence,credits:parsed.credits,creditList:parsed.creditList,findings:parsed.findings};r[1].creditEvidence.credits[0].facts[0].value='АО "TEST BANK"';
  assert.equal(plan(r,context).length,expected,`${total}/${count}: ${parsed.findings.join(',')}`);
 }
});
