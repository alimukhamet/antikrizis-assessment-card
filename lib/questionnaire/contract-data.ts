import {enforcementSummary} from '../../public/intake-data.mjs';
import type {DraftPayload} from './draft';
import type {ApprovedAnswerEvidence} from './review-bindings';
import {compileAssessment,displayAnswer} from './compile-assessment';
import {checkAnswers} from './check-answers';
import {COMPANY,numberToWordsRu} from '../../public/contract-words.mjs';
import {RepositoryError} from '../documents/repository';
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function amount(value:string){const [whole,fraction]=value.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(fraction&&fraction!=='00'?','+fraction:'');}
/** Template slots only; the legal clauses, layout and payment rules remain canonical. */
export function contractData(payload:DraftPayload,trustedIin:string|null,evidence:ApprovedAnswerEvidence[]=[],assessmentDay?:string){
 const compiled=compileAssessment(payload,trustedIin,evidence,assessmentDay),active=checkAnswers(payload,trustedIin,assessmentDay).displayAnswers;
 const v=compiled.values,price=compiled.schedule.total;
 if(price>=1_000_000_000_000)throw new RepositoryError('CONTRACT_AMOUNT_UNSUPPORTED',400);
 const [year,month,day]=v.contractDate.split('-'),monthName=months[Number(month)-1];
 const parts=v.fio.trim().split(/\s+/),short=parts.length>1?parts[0]+' '+parts.slice(1).map(p=>p[0]+'.').join(' '):v.fio;
 const describe=(groups:string[])=>active.filter(a=>a.group&&groups.includes(a.group)&&a.value).map(a=>`${a.group!.startsWith('partner')?'Супруг(а)':'Клиент'}, запись ${a.row!+1}: ${a.label.replace(/\*/g,'')} — ${displayAnswer(a)}`).join('; ');
 const holdings=(owner:string)=>active.filter(a=>a.key.startsWith(`holding:${owner}:`)).map(a=>a.value);
 const property=(owner:string)=>{const chosen=holdings(owner);if(chosen.includes('unknown'))return 'Неизвестно — уточнить';if(chosen.includes('none'))return 'Нет';return [describe([owner+'real',owner+'land',owner+'cars']),active.find(a=>a.key===(owner==='client'?'n8017':'n8032'))?.value].filter(Boolean).join('; ')||'Не указано среди выбранного имущества';};
 const business=(groups:string[])=>describe(groups)||(holdings('client').includes('unknown')?'Неизвестно — уточнить':'Нет');
 const loans=payload.groups.find(g=>g.id==='creditors')?.rows||[];
 const creditors=[...new Set(loans.map(r=>r.find(a=>a.key==='n8038')!.value))].join('; ');
 const participantAnswers=active.filter(a=>a.group==='creditors'&&a.key==='loanParticipants');
 const guarantors=participantAnswers.length&&participantAnswers.every(a=>a.value==='Нет')?'Нет':participantAnswers.map(a=>`Кредит ${a.row!+1} (${loans[a.row!].find(f=>f.key==='n8038')!.value}): ${a.value}`).join('; ');
 const overdue=loans.map((r,i)=>`Кредит ${i+1}: ${r.find(a=>a.key==='n8042')!.value} дн.`).join('; ');
 const income=describe(['clientjobs','clientunofficial','clientbenefits',...(v.marital==='В браке'?['partnerjobs','partnerunofficial','partnerbenefits']:[])]);
 const transfer=active.find(a=>a.key==='c8037')?.value;
 const procedure=({'199':'восстановление платёжеспособности','201':'СБ','203':'внесудебное банкротство','205':'График'} as Record<string,string>)[v.procedure];
 return {contract_number:v.dognum,contract_date_long:`«${day}» ${monthName} ${year} года`,contract_date_full:`${day}.${month}.${year}`,client_name:v.fio,client_short_name:short,client_iin:v.iin,company_name:COMPANY.name,company_bin:COMPANY.bin,company_signer:COMPANY.signer,company_signer_intro:COMPANY.signerIntro,service_price_amount:amount(String(price)),service_price_words:numberToWordsRu(price),payment_total_amount:amount(String(price)),payment_total_words:numberToWordsRu(price),total_debt:amount(v.debt),creditors,overdue,enforcement:enforcementSummary(payload),property:property('client'),marital_status:v.marital,spouse_property:v.marital==='В браке'?property('partner'):'не применимо',official_income:income||'Официальный доход: 0 ₸/мес; неофициальный доход: 0 ₸/мес',ip_status:business(['clientip']),legal_entities:business(['clienttoo','clientkh']),guarantors,deals:transfer==='0'?'Передачи имущества за 3 года не было':transfer==='unknown'?'Неизвестно — уточнить':describe(['transfers']),procedure_name:procedure,procedure_filing:procedure,payments:compiled.schedule.rows.map(r=>{const [y,m,d]=r.date.split('-');return {index:String(r.index),amount:amount(String(r.amount)),date:`${d} ${months[Number(m)-1]} ${y} г.`};})};
}
