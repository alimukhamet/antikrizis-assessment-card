import {test} from 'node:test';import assert from 'node:assert/strict';
import {compareGkb} from '../public/gkb-comparison.mjs';
const context={iin:'synthetic-client',day:'2026-09-14'};
const credit=(number,amount='100.25',days='0',bank='TEST BANK',page=2)=>({contractNumber:number,page,facts:[{key:'creditor',value:bank,page,source:'Кредитор'},{key:'debtOutstanding',value:amount,page,source:'Сумма долга'},{key:'overdueDays',value:days,page,source:'Дни просрочки'}]});
function reports(){return ['gkbShort','gkbFull'].map((kind,i)=>({fileId:i+1,hash:'hash-'+i,kind,date:context.day,identity:{iin:context.iin},creditEvidence:{readable:true,creditList:{complete:true,declared:2},findings:[],credits:[credit('A'),credit('B','200.50','3','SECOND BANK',i?7:3)]}}));}
const compare=r=>compareGkb(r,context);
test('independent report comparison matches reordered contracts, exact cents, and both source pages',()=>{
 const r=reports();r[1].creditEvidence.credits.reverse();r[1].creditEvidence.credits[1].facts[0].value='TESTBANK';const before=JSON.stringify(r),result=compare(r);
 assert.equal(result.status,'matched');assert.equal(result.shortTotal,'300.75');assert.equal(result.fullTotal,'300.75');assert.equal(result.rows[1].full.page,7);assert.equal(result.rows[1].short.fileId,1);assert.equal(JSON.stringify(r),before);
});
test('opposite per-loan differences cannot hide behind equal totals or edited form values',()=>{
 const r=reports();r[1].creditEvidence.credits[0].facts[1].value='100.26';r[1].creditEvidence.credits[1].facts[1].value='200.49';r[0].loans=r[1].loans=[{fields:{n8040:'0'}}];const result=compare(r);
 assert.equal(result.shortTotal,result.fullTotal);assert.equal(result.status,'mismatch');assert.equal(result.rows.filter(r=>r.status==='mismatch').length,2);
});
test('missing ambiguous debt stays unavailable while known differences remain visible',()=>{
 const r=reports();r[1].creditEvidence.credits[0].facts.splice(1,1);let result=compare(r);assert.equal(result.status,'unavailable');assert.equal(result.fullTotal,null);assert.equal(result.rows[1].status,'matched');
 r[1].creditEvidence.credits[1].facts[1].value='199.99';result=compare(r);assert.equal(result.status,'mismatch');assert.equal(result.rows[0].status,'unavailable');
});
test('different days overdue are a discrepancy even when debt matches',()=>{const r=reports();r[1].creditEvidence.credits[0].facts[2].value='1';assert.equal(compare(r).status,'mismatch');assert.match(compare(r).rows[0].reason,/дни просрочки/);});
test('an absent contract is a mismatch only when both independent lists are complete',()=>{
 const r=reports();r[1].creditEvidence.credits.pop();assert.equal(compare(r).status,'mismatch');r[1].creditEvidence.creditList.complete=false;assert.equal(compare(r).status,'unavailable');
});
test('shortened or duplicate identifiers cannot choose an arbitrary loan',()=>{
 const r=reports();r[0].creditEvidence.credits[0].contractNumber='A..';assert.equal(compare(r).status,'unavailable');
 const r2=reports();r2[1].creditEvidence.credits.push(structuredClone(r2[1].creditEvidence.credits[0]));assert.equal(compare(r2).status,'unavailable');
});
test('full contract number and code are exact aliases, different codes stay distinct',()=>{
 const r=reports();r[1].creditEvidence.credits[0].contractNumber='LONG A';r[1].creditEvidence.credits[0].contractCode='A';assert.equal(compare(r).status,'matched');r[1].creditEvidence.credits[0].contractCode='A2';assert.equal(compare(r).status,'mismatch');
});
test('wrong owner, dates, stale reports, partial pages, and multiple reports cannot claim a match',()=>{
 for(const mutate of [r=>r[1].identity.iin='other',r=>r[1].date='2026-09-13',r=>r.forEach(x=>x.date='2026-08-01'),r=>r.forEach(x=>x.date='2026-09-15'),r=>r[1].creditEvidence.readable=false,r=>r[1].creditEvidence.findings.push('PAGE_COMPLETENESS_UNVERIFIED'),r=>r[1].creditEvidence.creditList.complete=false,r=>r.push({...r[1],fileId:3,hash:'another'}),r=>r.pop()]){const r=reports();mutate(r);assert.equal(compare(r).status,'unavailable');}
 const r=reports();r.push({...r[1],fileId:3});assert.equal(compare(r).status,'matched','identical bytes should not count twice');
});
