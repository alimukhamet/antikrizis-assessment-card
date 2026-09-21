import {validateDraft,type DraftPayload} from './draft';
import {checkAnswers,type DisplayAnswer} from './check-answers';
import {RepositoryError} from '../documents/repository';
import {paymentScheduleText,PAYMENT_TYPES} from '../../public/payment-schedule.mjs';
import type {AssessmentValues} from '../crm/assessment-write';
import type {ApprovedAnswerEvidence} from './review-bindings';
const procedures:Record<string,string>={'199':'ВП — восстановление платёжеспособности','201':'СБ','203':'ВБ — внесудебное банкротство','205':'График'};
const holdings:Record<string,string>={real:'Недвижимость / доля',car:'Автомобиль',ip:'ИП',too:'Доля в ТОО',kh:'КХ',other:'Другое',businessNone:'ИП, доли в ТОО и КХ отсутствуют',none:'Имущества из перечисленного нет',unknown:'Неизвестно — уточнить'};
const groupNames:Record<string,string>={clientjobs:'Место работы клиента',clientunofficial:'Неофициальный доход клиента',clientbenefits:'Государственная выплата клиента',partnerjobs:'Место работы супруга(и)',partnerunofficial:'Неофициальный доход супруга(и)',partnerbenefits:'Государственная выплата супруга(и)',clientreal:'Недвижимость клиента',clientcars:'Автомобиль клиента',clientip:'ИП клиента',clienttoo:'Доля в ТОО клиента',clientkh:'КХ клиента',partnerreal:'Недвижимость супруга(и)',partnercars:'Автомобиль супруга(и)',partnerip:'ИП супруга(и)',partnertoo:'Доля в ТОО супруга(и)',partnerkh:'КХ супруга(и)',transfers:'Передача имущества',creditors:'Кредит / обязательство',enforcements:'Взыскание'};
const salesOnly=new Set(['dognum','summa','contractDate','months','payDay','grafType']);
export function displayAnswer(answer:DisplayAnswer){
 if(['gamblingTransfers','lawyerNotesStatus','enforcementStatus'].includes(answer.key))return answer.value==='yes'?'Да':answer.value==='no'?'Нет':answer.value==='legacy'?'Сведения из прежней анкеты':answer.value;
 if(['n8004Kind','n8019Kind'].includes(answer.key))return ({sole:'Единоличная собственность',joint:'Совместная собственность',share:'Долевая собственность'} as Record<string,string>)[answer.value]||answer.value;
 if(answer.key.startsWith('holding:'))return holdings[answer.value]||answer.value;
 if(answer.key==='procedure')return procedures[answer.value]||answer.value;
 if(answer.key==='grafType')return PAYMENT_TYPES[answer.value as keyof typeof PAYMENT_TYPES]||answer.value;
 if(answer.value==='unknown')return 'Неизвестно — уточнить';
 if(answer.key==='c8037')return answer.value==='1'?'Да':answer.value==='0'?'Нет':answer.value;
 return answer.value;
}
function sumDebt(payload:DraftPayload){
 let cents=BigInt(0);
 for(const row of payload.groups.find(g=>g.id==='creditors')?.rows||[]){
  const value=row.find(a=>a.key==='n8040')?.value.trim()||'';
  if(!/^\d+(\.\d{1,2})?$/.test(value))throw new RepositoryError('INVALID_DEBT',400);
  const [whole,fraction='']=value.split('.');cents+=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
 }
 return `${cents/BigInt(100)}.${String(cents%BigInt(100)).padStart(2,'0')}`;
}
/** Builds text and CRM-neutral values; does not approve evidence or perform a write. */
export function compileAssessment(payload:DraftPayload,trustedIin:string|null,evidence:ApprovedAnswerEvidence[]=[],assessmentDay?:string){
 payload=validateDraft(payload);
 const checked=checkAnswers(payload,trustedIin,assessmentDay);
 if(!checked.answersComplete||!checked.schedule)throw new RepositoryError('ANSWERS_INCOMPLETE',400);
 const value=(key:string)=>checked.displayAnswers.find(a=>!a.group&&a.key===key)?.value.trim()||'';
 const debt=sumDebt(payload),scheduleText=paymentScheduleText(checked.schedule);
 function card(includeContract:boolean){
  const lines=['КАРТОЧКА КЛИЕНТА','Ответы анкеты. Статус проверки документов и извлечённых сведений учитывается отдельно.'];
  const excluded=checked.displayAnswers.filter(a=>a.group==='creditors'&&a.key==='loanClaimIncluded'&&a.value==='Нет');
  if(excluded.length){
   lines.push('','НЕ ВКЛЮЧАТЬ В ИСК');
   for(const loan of excluded){const answers=checked.displayAnswers.filter(a=>a.group==='creditors'&&a.row===loan.row);lines.push(`• Кредит ${loan.row!+1}: ${answers.find(a=>a.key==='n8038')?.value} · ${answers.find(a=>a.key==='n8040')?.value} ₸`);}
   lines.push('Отмечено сотрудником для юриста. Эти обязательства сохранены в общем долге клиента.');
  }
  const append=(a:DisplayAnswer)=>{if(a.value)lines.push(`• ${a.label.replace(/\*/g,'').trim()}: ${displayAnswer(a)}`);};
  lines.push('','ОБЩИЕ СВЕДЕНИЯ');
  checked.displayAnswers.filter(a=>!a.group&&!salesOnly.has(a.key)).forEach(append);
  for(const group of payload.groups){
   for(let row=0;row<group.rows.length;row++){
    const answers=checked.displayAnswers.filter(a=>a.group===group.id&&a.row===row);
    if(!answers.length)continue;
    lines.push('',`${groupNames[group.id]||group.id} ${row+1}`);answers.forEach(append);
    const clientDebt=group.id==='creditors'?group.rows[row].find(a=>a.key==='n8040'&&a.clientConfirmed):null;
    if(clientDebt)lines.push(`Источник суммы долга: уточнено сотрудником у клиента — ${clientDebt.value} ₸; не подтверждение суммы по документу.`);
   }
  }
  lines.push('',`Общий долг по указанным обязательствам: ${debt} ₸`);
  if(evidence.length){
   lines.push('','ПОДТВЕРЖДЕНИЯ ОТВЕТОВ ПО ИСТОЧНИКАМ','Подтверждение ответа сотрудником не удостоверяет подлинность документа.');
   for(const item of evidence){
    const answer=checked.displayAnswers.find(a=>a.key===item.key&&a.group===item.group&&a.row===item.row);
    if(!answer||answer.value!==item.value)throw new RepositoryError('REVIEW_VALUE_CHANGED');
    if(!includeContract&&salesOnly.has(item.key))continue;
    const row=item.group?`${groupNames[item.group]||item.group} ${item.row!+1} · `:'';
    lines.push(`• ${row}${answer.label.replace(/\*/g,'')}: ${item.value} — ${item.documentName}, стр. ${item.page}; ${item.disposition==='corrected'?'исправлено сотрудником':'подтверждено сотрудником'}.`);
   }
  }
  if(includeContract){lines.push('','ДОГОВОР (только продажи)');checked.displayAnswers.filter(a=>salesOnly.has(a.key)).forEach(append);lines.push('','ГРАФИК ПЛАТЕЖЕЙ',scheduleText);}
  return lines.join('\n');
 }
 const lawyerCard=card(false),fullCard=card(true);
 const values:AssessmentValues={fio:value('fio'),iin:trustedIin!,dognum:value('dognum'),marital:value('marital'),procedure:value('procedure'),debt,comment:value('comment'),contractDate:value('contractDate'),months:value('months'),payDay:value('payDay'),grafType:value('grafType'),grafText:scheduleText,card:fullCard,summa:String(checked.schedule.total),currency:'KZT'};
 return {lawyerCard,fullCard,values,schedule:checked.schedule};
}
