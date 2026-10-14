import {creditorKey} from './gkb-comparison.mjs';

const fact=(credit,key)=>credit.facts?.find(f=>f.key===key);
const findings=report=>[...new Set([...(report.findings||[]),...(report.creditEvidence?.findings||[])])];
const aliases=credit=>[...new Set([credit.contractNumber,credit.contractCode].filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))];
const exactIds=credit=>aliases(credit).length>0&&aliases(credit).every(v=>!/[\r\n]|\.{2,}|…/u.test(v));
const lender=credit=>creditorKey(fact(credit,'creditor')?.value||'');
const sameLoan=(a,b)=>exactIds(a)&&exactIds(b)&&lender(a)&&lender(a)===lender(b)&&aliases(a).some(id=>aliases(b).includes(id));
function cents(value){
 if(typeof value!=='string'||!/^\d{1,14}(?:\.\d{1,2})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
function validDay(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
 const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function sourceBound(report){
 const s=report.server;
 return s&&typeof s.dealId==='string'&&s.dealId&&typeof s.documentId==='string'&&s.documentId&&typeof s.extractionId==='string'&&s.extractionId&&Number.isInteger(s.identityRevision)&&s.identityRevision>=0&&!s.draftOnly;
}
function noKnownConflict(short,full,amount){
 // Missing components/days remain unknown. This proposes the independently
 // printed short amount; it never computes a full-report total from nulls.
 if(fact(full,'debtOutstanding')||full.comparisonDebt||full.components?.remaining!==null)return false;
 let known=0n;
 for(const key of ['arrears','penalty','interest','fine']){
  const value=full.components[key];if(value===null||value===undefined)continue;
  const part=cents(value);if(part===null)return false;known+=part;
 }
 if(known>amount)return false;
 const a=fact(short,'overdueDays')?.value,b=fact(full,'overdueDays')?.value;
 if(!/^\d+$/.test(a||'')||b!==undefined&&(!/^\d+$/.test(b)||BigInt(a)!==BigInt(b)))return false;
 const sa=fact(short,'loanStatus')?.value,sb=fact(full,'loanStatus')?.value;
 return !(sa&&sb&&sa!==sb);
}

/** Unconfirmed blank-field assistance only. Never establishes report eligibility,
 * list reconciliation, a fact review, closure, payment, or status. Inputs must be
 * the selected server-adapted reports, retaining all original findings. */
export function planGkbDraftBalanceSupplements(reports,{iin,day}={}){
 const list=reports.filter(r=>['gkbShort','gkbFull'].includes(r.kind));
 const shorts=list.filter(r=>r.kind==='gkbShort'),fulls=list.filter(r=>r.kind==='gkbFull');
 if(shorts.length!==1||fulls.length!==1||!iin||!validDay(day))return [];
 const [short]=shorts,[full]=fulls;
 if(list.some(r=>r.error||r.excluded||r.duplicate||!sourceBound(r)||r.identity?.iin!==iin||!r.creditEvidence?.readable||r.fileId===undefined))return [];
 if(short.server.dealId!==full.server.dealId||short.server.identityRevision!==full.server.identityRevision||short.server.documentId===full.server.documentId)return [];
 if(!validDay(short.date)||short.date!==full.date||short.date>day||full.blocked)return [];
 const sf=findings(short),ff=findings(full),a=short.creditEvidence.credits,b=full.creditEvidence.credits;
 // Both current parsers emit separate summary/count/total/duplicate findings.
 // Thus this exact allowlist plus the declared count permits ONLY the known
 // identifier truncation failure, not a table whose arithmetic is unverified.
 if(!sf.includes('SHORT_CONTRACT_ID_TRUNCATED')||!sf.includes('SHORT_CREDIT_LIST_UNVERIFIED')||sf.some(f=>!['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'].includes(f)))return [];
 if(ff.some(f=>f!=='TOTAL_DEBT_REQUIRES_RECONCILIATION')||!ff.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'))return [];
 if(!Array.isArray(a)||!a.length||!Array.isArray(b)||!b.length||short.creditEvidence.creditList?.declared!==a.length||full.creditEvidence.creditList?.complete!==true||full.creditEvidence.creditList?.declared!==b.length)return [];
 const proposals=[];
 for(const [shortIndex,credit] of a.entries()){
  const matches=b.flatMap((other,index)=>sameLoan(credit,other)?[index]:[]);
  if(matches.length!==1)continue;
  const fullIndex=matches[0],other=b[fullIndex];
  if(a.filter(candidate=>sameLoan(candidate,other)).length!==1)continue;
  const debt=fact(credit,'debtOutstanding'),amount=cents(debt?.value);
  if(amount===null||!noKnownConflict(credit,other,amount))continue;
  if(!Number.isInteger(debt.page)||debt.page<1||!Number.isInteger(other.page)||other.page<1)continue;
  proposals.push({shortFileId:short.fileId,fullFileId:full.fileId,shortIndex,fullIndex,amount:`${amount/100n}.${String(amount%100n).padStart(2,'0')}`,shortPage:debt.page,fullPage:other.page,contractNumber:other.contractCode||other.contractNumber,creditor:fact(other,'creditor').value,shortFactKey:`credits.${shortIndex}.debtOutstanding`,fullAliases:aliases(other)});
 }
 return proposals;
}
