/* Compare independent report facts, never the merged questionnaire answers. */
const fact=(credit,key)=>credit.facts?.find(f=>f.key===key);
const debt=credit=>fact(credit,'debtOutstanding')||credit.comparisonDebt;
export const creditorKey=value=>value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[\s«»“”„"]/g,'').replace(/^акционерноеобщество(?=.)/u,'ао').replace(/^товариществосограниченнойответственностью(?=.)/u,'тоо').replace(/^тоомикрофинансоваяорганизация(?=.)/u,'тоомфо').replace(/^народныйбанкказахстана$/u,'аонародныйбанкказахстана').replace(/^тоомфоакф$/u,'тоомфоазиатскийкредитныйфонд');
const bank=credit=>creditorKey(String(fact(credit,'creditor')?.value||''));
const ids=credit=>[credit.contractNumber,credit.contractCode].filter(Boolean).map(s=>s.trim());
const truncated=credit=>ids(credit).some(s=>/\.\.|…/.test(s));
function numberMatches(a,b){
 if(a===b&&!/\.\.|…/.test(a))return true;
 if(/\.\.|…/.test(b))return false;
 const parts=a.split(/\.{2,}|…/).map(s=>s.trim());
 return parts.length===2&&parts.join('').length>=6&&b.length>parts.join('').length&&b.startsWith(parts[0])&&b.endsWith(parts[1]);
}
const sameLoan=(a,b)=>bank(a)&&bank(a)===bank(b)&&ids(a).some(x=>ids(b).some(y=>numberMatches(x,y)));
const shortenedOnly=report=>report.kind==='gkbShort'&&report.creditEvidence?.findings?.includes('SHORT_CONTRACT_ID_TRUNCATED')&&report.creditEvidence.findings.every(f=>['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'].includes(f));
const listRead=report=>report.creditEvidence.creditList?.complete||shortenedOnly(report)&&report.creditEvidence.creditList?.declared===report.creditEvidence.credits.length;
function cents(value){if(!/^\d+(?:\.\d{1,2})?$/.test(value||''))return null;const [whole,part='']=value.split('.');return BigInt(whole)*100n+BigInt(part.padEnd(2,'0'));}
const money=value=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
function total(report){
 if(!listRead(report))return null;
 const amounts=report.creditEvidence.credits.map(c=>cents(debt(c)?.value));
 return amounts.some(v=>v===null)?null:money(amounts.reduce((sum,v)=>sum+v,0n));
}
function side(report,credit){
 const balance=debt(credit),days=fact(credit,'overdueDays');
 return {fileId:report.fileId,contractNumber:credit.contractNumber,contractCode:credit.contractCode||null,page:balance?.page||credit.page,quote:balance?.source||'Сверьте остаток, просрочку и санкции по этому договору.',value:balance?.value??null,calculated:balance?.key==='debtComponentsTotal',days:days?.value??null,daysPage:days?.page||credit.page};
}
function row(short,full,a,b,status,reason=''){
 const credit=a||b,aliases=[a,b].filter(Boolean).flatMap(c=>ids(c).map(id=>(fact(c,'creditor')?.value||'')+'|'+id));
 return {name:fact(credit,'creditor')?.value||'Кредитор не прочитан',number:credit.contractNumber,aliases,status,reason,short:a?side(short,a):null,full:b?side(full,b):null};
}
export function compareGkb(reports,{iin,day}={}){
 const unique=new Map();for(const r of reports.filter(r=>['gkbShort','gkbFull'].includes(r.kind)))unique.set(r.hash?r.kind+'|'+r.hash:r.fileId,r);
 const list=[...unique.values()],shorts=list.filter(r=>r.kind==='gkbShort'),fulls=list.filter(r=>r.kind==='gkbFull');
 const unavailable=reason=>({status:'unavailable',reason,rows:[],shortTotal:null,fullTotal:null,reports:list});
 if(shorts.length!==1||fulls.length!==1)return unavailable(shorts.length>1||fulls.length>1?'Выберите одну пару краткого и полного ГКБ для сверки.':'Добавьте краткий и полный ГКБ.');
 const [short]=shorts,[full]=fulls;
 if(!iin||list.some(r=>r.identity?.iin!==iin))return unavailable('Не подтверждено, что оба отчёта относятся к этому клиенту.');
 if(!short.date||short.date!==full.date)return unavailable('У отчётов разные даты или дата не прочитана. Нужна пара на одну дату.');
 const elapsed=(Date.parse(day+'T00:00:00Z')-Date.parse(short.date+'T00:00:00Z'))/86400000;
 if(!Number.isFinite(elapsed)||elapsed<0||elapsed>30)return unavailable('Для сверки нужны ГКБ не старше 30 дней.');
 if(list.some(r=>r.error||r.blocked&&!shortenedOnly(r)||!r.creditEvidence?.readable||r.creditEvidence.findings?.some(f=>['PAGE_COMPLETENESS_UNVERIFIED','OCR_OR_PAGE_REVIEW_REQUIRED'].includes(f))))return unavailable('Есть непрочитанные страницы или отчёт ещё не прошёл проверку.');
 const a=short.creditEvidence.credits,b=full.creditEvidence.credits,rows=[],used=new Set();
 const complete=listRead(short)&&full.creditEvidence.creditList?.complete===true;
 for(const credit of a){
  const matches=b.filter(c=>sameLoan(credit,c));
  if(matches.length!==1||a.filter(c=>sameLoan(c,matches[0])).length!==1){
   const uncertain=!complete||truncated(credit)||b.some(truncated)||matches.length>1;
   rows.push(row(short,full,credit,null,uncertain?'unavailable':'mismatch',uncertain?'Договор нельзя однозначно сопоставить.':'Договор не найден в полном ГКБ.'));continue;
  }
  const other=matches[0];used.add(other);
  const av=cents(debt(credit)?.value),bv=cents(debt(other)?.value);
  const ad=fact(credit,'overdueDays')?.value,bd=fact(other,'overdueDays')?.value,daysKnown=/^\d+$/.test(ad||'')&&/^\d+$/.test(bd||'');
  const differences=[];if(av!==null&&bv!==null&&av!==bv)differences.push('сумма долга');if(daysKnown&&BigInt(ad)!==BigInt(bd))differences.push('дни просрочки');
  const status=differences.length?'mismatch':av===null||bv===null||!daysKnown?'unavailable':'matched';
  rows.push(row(short,full,credit,other,status,differences.length?'Различаются: '+differences.join(', ')+'.':status==='unavailable'?'Нужно сверить остаток, просрочку и санкции.':''));
 }
 for(const credit of b.filter(c=>!used.has(c))){if(complete&&cents(debt(credit)?.value)===0n&&/^0+$/.test(fact(credit,'overdueDays')?.value||'')&&!a.some(c=>sameLoan(c,credit))){rows.push(row(short,full,null,credit,'matched','Активный договор без долга и просрочки: краткий ГКБ может его не показывать. Он остаётся в анкете по полному отчёту.'));continue;}const uncertain=!complete||truncated(credit)||a.some(truncated)||a.some(c=>sameLoan(c,credit));rows.push(row(short,full,null,credit,uncertain?'unavailable':'mismatch',uncertain?'Договор нельзя однозначно сопоставить.':'Договор не найден в кратком ГКБ.'));}
 const status=rows.some(r=>r.status==='mismatch')?'mismatch':!complete||rows.some(r=>r.status==='unavailable')?'unavailable':'matched';
 return {status,reason:!complete?'Полнота списка договоров ещё не подтверждена.':status==='unavailable'?'Часть сумм требует проверки по полному отчёту.':'',rows,shortTotal:total(short),fullTotal:total(full),reports:list};
}
