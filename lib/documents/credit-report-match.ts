import type {Analysis} from './analysis-service';
import {gkbFreshness} from './policy';
import {creditorKey} from './loan-identity';

export type CreditMatch={shortIndex:number;fullIndex:number;shortNumber:string;fullNumber:string;shortPage:number;fullPage:number};
function amount(value:string|undefined){
 if(!value||!/^\d+(?:\.\d{1,2})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.');return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
}
function numberMatches(short:string,full:string){
 short=short.trim();full=full.trim();
 if(/\.\.|…/.test(full))return false;
 if(!/\.\.|…/.test(short))return short===full;
 const pieces=short.split(/\.{2,}|…/).map(piece=>piece.trim());
 // Accept one omission with at least six literal characters; no fuzzy matching.
 if(pieces.length!==2||pieces.join('').length<6)return false;
 return full.length>pieces[0].length+pieces[1].length&&full.startsWith(pieces[0])&&full.endsWith(pieces[1]);
}
/** Cross-check only. Never replaces extracted IDs or approves short-report facts. */
function matchReportLoans(short:Analysis,full:Analysis,clientIin:string|null,day:string,allowMissingBalance=false):CreditMatch[]|null{
 const s=short.extraction,f=full.extraction;
 if(!clientIin||s.identity.iin!==clientIin||f.identity.iin!==clientIin||s.kind!=='gkb_short'||f.kind!=='gkb_full')return null;
 if(!s.issuedAt||s.issuedAt!==f.issuedAt||gkbFreshness(s.issuedAt,day).length)return null;
 if(!short.read.pages.length||!full.read.pages.length)return null;
 if(short.read.pages.some(p=>p.needsOcr)||full.read.pages.some(p=>p.needsOcr))return null;
 if(f.findings.some(v=>!allowMissingBalance||v!=='TOTAL_DEBT_REQUIRES_RECONCILIATION')||!s.findings.includes('SHORT_CONTRACT_ID_TRUNCATED')||s.findings.some(v=>!['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'].includes(v)))return null;
 if(!s.credits.length||s.credits.length>f.credits.length)return null;
 const used=new Set<number>(),matches:CreditMatch[]=[];
 for(const [shortIndex,credit] of s.credits.entries()){
  const sf=Object.fromEntries(credit.facts.map(v=>[v.key,v.value])),debt=amount(sf.debtOutstanding);
  if(!sf.creditor||debt===null||!/^\d+$/.test(sf.overdueDays||''))return null;
  const candidates=f.credits.flatMap((other,fullIndex)=>{
   const ff=Object.fromEntries(other.facts.map(v=>[v.key,v.value]));
   return ff.creditor&&creditorKey(sf.creditor)===creditorKey(ff.creditor)&&[other.contractNumber,other.contractCode].some(number=>number&&numberMatches(credit.contractNumber,number))?[fullIndex]:[];
  });
  // Demand unique matches before consuming rows; never resolve ambiguity by order.
  if(candidates.length!==1||used.has(candidates[0]))return null;
  const fullIndex=candidates[0],other=f.credits[fullIndex],ff=Object.fromEntries(other.facts.map(v=>[v.key,v.value]));
  const missingBalance=allowMissingBalance&&ff.debtOutstanding===undefined&&!other.comparisonDebt&&other.components?.remaining===null&&amount(other.components.arrears??undefined)===BigInt(0)&&amount(other.components.penalty??undefined)===BigInt(0)&&['interest','fine'].every(key=>other.components[key]===null||other.components[key]===undefined||amount(other.components[key])===BigInt(0));
  if(!missingBalance&&debt!==amount(ff.debtOutstanding)||!/^\d+$/.test(ff.overdueDays||'')||BigInt(sf.overdueDays)!==BigInt(ff.overdueDays))return null;
  used.add(fullIndex);
  matches.push({shortIndex,fullIndex,shortNumber:credit.contractNumber,fullNumber:other.contractNumber,shortPage:credit.page,fullPage:other.page});
 }
 // The short report explicitly omits unused active limits. Keep them in the
 // full report and questionnaire; only an explicit zero debt AND zero arrears qualifies.
 if(f.credits.some((credit,index)=>{const values=Object.fromEntries(credit.facts.map(v=>[v.key,v.value]));return !used.has(index)&&(amount(values.debtOutstanding)!==BigInt(0)||!/^0+$/.test(values.overdueDays||''));}))return null;
 return matches;
}
export function matchShortReport(short:Analysis,full:Analysis,clientIin:string|null,day:string){return matchReportLoans(short,full,clientIin,day);}

/** A proposal for an employee, never an automatic match or a zero-balance inference. */
export function shortBalanceReviewPlan(short:Analysis,full:Analysis,clientIin:string|null,day:string){
 const s=short.extraction,f=full.extraction;
 if(!f.creditList?.complete||s.creditList?.declared!==s.credits.length||!f.findings.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'))return null;
 const matches=matchReportLoans(short,full,clientIin,day,true);if(!matches)return null;
 const balances=matches.filter(m=>!f.credits[m.fullIndex].facts.some(f=>f.key==='debtOutstanding')).map(m=>{
  const a=s.credits[m.shortIndex],b=f.credits[m.fullIndex],fact=a.facts.find(f=>f.key==='debtOutstanding')!,cents=amount(fact.value)!;
  return {...m,creditor:b.facts.find(f=>f.key==='creditor')!.value,contractNumber:b.contractCode||b.contractNumber,aliases:[...new Set([b.contractNumber,b.contractCode].filter((v):v is string=>!!v))],amount:`${cents/BigInt(100)}.${String(cents%BigInt(100)).padStart(2,'0')}`,shortPage:fact.page||a.page,fullPage:b.page};
 });
 return balances.length?{matches,balances,activeLoans:f.credits.length,issuedAt:s.issuedAt!}:null;
}

/** Explain why staff need another report or reconciliation; never grants approval. */
export function shortReportMismatchReasons(short:Analysis,full:Analysis,day:string):string[]{
 const s=short.extraction,f=full.extraction,reasons:string[]=[];
 if(!s.issuedAt||!f.issuedAt||s.issuedAt!==f.issuedAt)reasons.push('Отчёты выданы в разные даты или дата не прочитана. Нужны краткий и полный отчёты на одну дату.');
 if(gkbFreshness(s.issuedAt||'',day).length||gkbFreshness(f.issuedAt||'',day).length)reasons.push('Проверьте даты: оба ГКБ должны быть не старше 30 дней и без будущей даты.');
 if(s.credits.length!==f.credits.length)reasons.push(`Прочитано обязательств: краткий ГКБ — ${s.credits.length}, полный — ${f.credits.length}. Сверьте каждый договор: краткий отчёт может не включать кредитные карты и кредитные лимиты без задолженности и просрочки. Разница в количестве сама по себе не подтверждает ошибку. Не исключайте договор без проверки полного отчёта.`);
 if(f.findings.includes('TOTAL_DEBT_REQUIRES_RECONCILIATION'))reasons.push('В полном ГКБ итог долга не подтверждён: нужно сверить остаток, просрочку и дополнительные начисления.');
 if(short.read.pages.some(p=>p.needsOcr)||full.read.pages.some(p=>p.needsOcr)||[...s.findings,...f.findings].some(v=>['PAGE_COMPLETENESS_UNVERIFIED','SHORT_CREDIT_COUNT_MISMATCH','SHORT_TOTAL_MISMATCH','SHORT_SUMMARY_MISSING','SHORT_DUPLICATE_CREDIT','CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES'].includes(v)))reasons.push('Не подтверждена полнота или читаемость отчётов. Проверьте страницы и итоговые строки.');
 if(!reasons.length)for(const credit of s.credits){
  const sf=Object.fromEntries(credit.facts.map(v=>[v.key,v.value]));
  const candidates=f.credits.filter(other=>creditorKey(sf.creditor||'')===creditorKey(other.facts.find(v=>v.key==='creditor')?.value||'')&&[other.contractNumber,other.contractCode].some(number=>number&&numberMatches(credit.contractNumber,number)));
  const label=`${sf.creditor||'Кредитор не прочитан'} · № ${credit.contractNumber} · краткий ГКБ, стр. ${credit.page}`;
  if(candidates.length!==1){reasons.push(`${label}: ${candidates.length?'подходят несколько договоров':'не найден однозначный договор в полном ГКБ'}. Откройте «Сверить кредиты», сравните исходные страницы. Если договор отсутствует, запросите полный отчёт на ту же дату; не удаляйте кредит из анкеты.`);continue;}
  const ff=Object.fromEntries(candidates[0].facts.map(v=>[v.key,v.value]));
  const fields=[];if(amount(sf.debtOutstanding)!==amount(ff.debtOutstanding)||amount(sf.debtOutstanding)===null)fields.push('сумма долга');if(!/^\d+$/.test(sf.overdueDays||'')||!/^\d+$/.test(ff.overdueDays||'')||BigInt(sf.overdueDays)!==BigInt(ff.overdueDays))fields.push('дни просрочки');
  if(fields.length)reasons.push(`${label}: требуют сверки ${fields.join(' и ')}. Нажмите «Сверить кредиты»: рядом показаны оба значения и страницы источников. Уточните расхождение по актуальному отчёту.`);
 }
 if(!reasons.length)reasons.push('Проверьте владельца, читаемость и полноту обоих ГКБ. Нажмите «Сверить кредиты», чтобы увидеть каждый договор и обе исходные страницы.');
 return reasons;
}
