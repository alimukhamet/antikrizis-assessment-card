import type {Analysis} from './analysis-service';
import {gkbFreshness} from './policy';

export type CreditMatch={shortIndex:number;fullIndex:number;shortNumber:string;fullNumber:string;shortPage:number;fullPage:number};
const normalized=(value:string)=>value.normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleUpperCase('ru');
function amount(value:string|undefined){
 if(!value||!/^\d+(?:\.\d{1,2})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
}
function numberMatches(short:string,full:string){
 if(/\.\.|…/.test(full))return false;
 if(!/\.\.|…/.test(short))return short===full;
 const pieces=short.split(/\.{2,}|…/);
 // Accept one omission with at least six literal characters; no fuzzy matching.
 if(pieces.length!==2||pieces.join('').length<6)return false;
 return full.length>pieces[0].length+pieces[1].length&&full.startsWith(pieces[0])&&full.endsWith(pieces[1]);
}
/** Cross-check only. Never replaces extracted IDs or approves short-report facts. */
export function matchShortReport(short:Analysis,full:Analysis,clientIin:string|null,day:string):CreditMatch[]|null{
 const s=short.extraction,f=full.extraction;
 if(!clientIin||s.identity.iin!==clientIin||f.identity.iin!==clientIin||s.kind!=='gkb_short'||f.kind!=='gkb_full')return null;
 if(!s.issuedAt||s.issuedAt!==f.issuedAt||gkbFreshness(s.issuedAt,day).length)return null;
 if(!short.read.pages.length||!full.read.pages.length)return null;
 if(short.read.pages.some(p=>p.needsOcr)||full.read.pages.some(p=>p.needsOcr))return null;
 if(f.findings.length||!s.findings.includes('SHORT_CONTRACT_ID_TRUNCATED')||s.findings.some(v=>!['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'].includes(v)))return null;
 if(!s.credits.length||s.credits.length!==f.credits.length)return null;
 const used=new Set<number>(),matches:CreditMatch[]=[];
 for(const [shortIndex,credit] of s.credits.entries()){
  const sf=Object.fromEntries(credit.facts.map(v=>[v.key,v.value])),debt=amount(sf.debtOutstanding);
  if(!sf.creditor||debt===null||!/^\d+$/.test(sf.overdueDays||''))return null;
  const candidates=f.credits.flatMap((other,fullIndex)=>{
   const ff=Object.fromEntries(other.facts.map(v=>[v.key,v.value]));
   return ff.creditor&&normalized(sf.creditor)===normalized(ff.creditor)&&[other.contractNumber,other.contractCode].some(number=>number&&numberMatches(credit.contractNumber,number))&&debt===amount(ff.debtOutstanding)&&/^\d+$/.test(ff.overdueDays||'')&&BigInt(sf.overdueDays)===BigInt(ff.overdueDays)?[fullIndex]:[];
  });
  // Demand unique matches before consuming rows; never resolve ambiguity by order.
  if(candidates.length!==1||used.has(candidates[0]))return null;
  const fullIndex=candidates[0],other=f.credits[fullIndex];used.add(fullIndex);
  matches.push({shortIndex,fullIndex,shortNumber:credit.contractNumber,fullNumber:other.contractNumber,shortPage:credit.page,fullPage:other.page});
 }
 return matches;
}

/** Explain why staff need another report or reconciliation; never grants approval. */
export function shortReportMismatchReasons(short:Analysis,full:Analysis,day:string):string[]{
 const s=short.extraction,f=full.extraction,reasons:string[]=[];
 if(!s.issuedAt||!f.issuedAt||s.issuedAt!==f.issuedAt)reasons.push('Отчёты выданы в разные даты или дата не прочитана. Нужны краткий и полный отчёты на одну дату.');
 if(gkbFreshness(s.issuedAt||'',day).length||gkbFreshness(f.issuedAt||'',day).length)reasons.push('Проверьте даты: оба ГКБ должны быть не старше 30 дней и без будущей даты.');
 if(s.credits.length!==f.credits.length)reasons.push(`Прочитано обязательств: краткий ГКБ — ${s.credits.length}, полный — ${f.credits.length}. Сверьте каждый договор: краткий отчёт может не включать кредитные карты и кредитные лимиты без задолженности и просрочки. Разница в количестве сама по себе не подтверждает ошибку. Не исключайте договор без проверки полного отчёта.`);
 if(f.findings.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'))reasons.push('В полном ГКБ итог долга не подтверждён: нужно сверить остаток, просрочку и дополнительные начисления.');
 if(short.read.pages.some(p=>p.needsOcr)||full.read.pages.some(p=>p.needsOcr)||[...s.findings,...f.findings].some(v=>['PAGE_COMPLETENESS_UNVERIFIED','SHORT_CREDIT_COUNT_MISMATCH','SHORT_TOTAL_MISMATCH','SHORT_SUMMARY_MISSING','SHORT_DUPLICATE_CREDIT','CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES'].includes(v)))reasons.push('Не подтверждена полнота или читаемость отчётов. Проверьте страницы и итоговые строки.');
 if(!reasons.length)reasons.push('Не удалось однозначно сопоставить кредитора, номер договора, сумму и дни просрочки. Сверьте оба источника; не подставляйте номер по предположению.');
 return reasons;
}
