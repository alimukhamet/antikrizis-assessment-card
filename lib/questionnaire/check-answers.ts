import schema from './schema.json';
import {parseParticipants} from '../../public/loan-participants.mjs';
import type {Answer,DraftPayload} from './draft';
import {validIin} from '../documents/extract-native';
import {createPaymentSchedule} from '../../public/payment-schedule.mjs';
export type AnswerIssue={key:string;group?:string;row?:number;code:string;label:string};
export type DisplayAnswer={key:string;group?:string;row?:number;label:string;value:string};
type Definition={key:string;type:string;label:string;required?:boolean;legacy?:boolean;conditions?:string[];min?:string;max?:string;compactCount?:boolean};
/** Answer completeness only. Document eligibility and fact review are separate gates. */
export function checkAnswers(payload:DraftPayload,trustedIin:string|null,assessmentDay?:string){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const assessmentMonth=assessmentDay?.slice(0,7)||`${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}`;
 const all=new Map(payload.answers.map(a=>[a.key,a])),groups=new Map(payload.groups.map(g=>[g.id,g]));
 const value=(key:string,row?:Map<string,Answer>)=>(row?.get(key)||all.get(key))?.value.trim()||'';
 const checked=(key:string)=>all.get(key)?.checked===true;
 const issues:AnswerIssue[]=[];
 const displayAnswers:DisplayAnswer[]=[];
 const issue=(key:string,code:string,label:string,group?:string,row?:number)=>issues.push({key,code,label,...(group?{group,row}:{})});
 const married=value('marital')==='В браке';
 function highKaspi(partner:boolean){
  const owner=partner?'partner':'client',annual=value(partner?'partnerKaspiAnnual':'kaspiAnnual');
  const incomes=(groups.get(owner+'jobs')?.rows||[]).map(r=>r.find(a=>a.key===(partner?'n8002':'n8001'))?.value||'');
  return /^\d+(\.\d{1,2})?$/.test(annual)&&incomes.every(v=>/^\d+(\.\d{1,2})?$/.test(v))&&Number(annual)>30*incomes.reduce((sum,v)=>sum+Number(v),0);
 }
 function active(conditions:string[]=[],row?:Map<string,Answer>):boolean{return conditions.every(c=>{
  if(['partnerIncome','partnerAssets','partnerKaspi'].includes(c))return married;
  if(c==='childrenUnder18Field')return !checked('unknown:childrenTotal')&&Number(value('childrenTotal'))>0;
  if(c==='socialOtherField')return checked('choice:socialStatus:Другое');
  if(c==='lawyerNotesDetails')return value('lawyerNotesStatus')==='yes';
  if(c==='debtPurposeOtherField')return checked('choice:debtPurpose:Другое');
  if(c==='hardshipDetails')return !!value('hardshipReason')&&value('hardshipReason')!=='Платежи вношу, трудностей нет';
  if(c==='proof-details')return ['Есть на руках','Можно получить'].includes(value('n12009'));
  if(c==='kaspiWhyField'||c==='partnerKaspiWhyField')return highKaspi(c.startsWith('partner'));
  if(c==='panel-c8037')return value('c8037')==='1';
  const asset=/^(client|partner)-asset-(.+)$/.exec(c);if(asset)return checked(`holding:${asset[1]}:${asset[2]}`);
  if(c==='ownership-share')return value('n8004Kind',row)==='share'||value('n8019Kind',row)==='share';
  if(c==='transfer-other')return value('n8033',row)==='Другое';
  if(c==='purpose-other')return value('n8043',row)==='Другое';
  if(c==='benefit-other')return value('clientBenefitType',row)==='Другая государственная выплата'||value('partnerBenefitType',row)==='Другая государственная выплата';
  throw Error('UNMAPPED_QUESTIONNAIRE_CONDITION:'+c);
 });}
 function field(f:Definition,row?:Map<string,Answer>,group?:string,index?:number){
  if(f.legacy||!active(f.conditions,row)||f.key.startsWith('exact:'))return;
  if((row?.get(f.key)||all.get(f.key))?.sourceReplaced)issue(f.key,'ANSWER_SOURCE_REPLACED','Источник заменён: '+f.label,group,index);
  if(f.type==='checkbox'){
   if(group==='creditors'&&f.key==='loanClaimIncluded'){
    displayAnswers.push({key:f.key,label:'Включить в иск',value:row?.get(f.key)?.checked===false?'Нет':'Да',group,row:index});return;
   }
   if(!f.key.startsWith('unknown:')&&!f.key.startsWith('choice:debtPurpose:')&&checked(f.key))displayAnswers.push({key:f.key,label:f.label,value:f.key.split(':').at(-1)||''});
   return;
  }
  const v=value(f.key,row);
  const unknownKey='unknown:'+f.key;
  const unknown=f.key!=='loanParticipants'&&(row?row.get(unknownKey)?.checked===true:checked(unknownKey))&&(group?schema.groups.find(g=>g.id===group)?.fields:schema.scalar)?.some(x=>x.key===unknownKey);
  displayAnswers.push({key:f.key,label:f.label,value:unknown?'Неизвестно — уточнить':v,...(group?{group,row:index}:{})});
  if(unknown||['unknown','Не знаю'].includes(v)){issue(f.key,'ANSWER_REQUIRED',f.label,group,index);return;}
  if(!v){if(f.required)issue(f.key,'ANSWER_REQUIRED',f.label,group,index);return;}
  if(f.key==='loanParticipants'&&!parseParticipants(v).valid)issue(f.key,'PARTICIPANTS_REQUIRED','Выберите «Нет» или укажите ФИО и роль каждого участника',group,index);
  if(f.compactCount&&v==='more')issue(f.key,'EXACT_COUNT_REQUIRED',f.label,group,index);
  if(f.type==='number'){
   const integer=['months','payDay','n8042'].includes(f.key);
   if(!(integer?/^\d+$/:/^\d+(\.\d{1,2})?$/).test(v)||!Number.isFinite(Number(v))||Number(v)>Number.MAX_SAFE_INTEGER/100||f.min!==undefined&&Number(v)<Number(f.min)||f.max!==undefined&&Number(v)>Number(f.max))issue(f.key,'INVALID_NUMBER',f.label,group,index);
  }
  if(f.type==='month'){
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)||v.startsWith('0000'))issue(f.key,'INVALID_MONTH',f.label,group,index);
   else if(group==='creditors'&&f.key==='n8038Start'&&v>assessmentMonth)issue(f.key,'FUTURE_LOAN_MONTH','Дата получения кредита не может быть в будущем',group,index);
  }
 }
 for(const f of schema.scalar)field(f);
 const benefitCount=value('clientBenefitsCount');
 if(/^\d+$/.test(benefitCount)&&['0','1'].includes(payload.docContext.social)&&((Number(benefitCount)>0)!==(payload.docContext.social==='1')))issue('clientBenefitsCount','BENEFITS_CONTEXT_CONFLICT','Количество выплат не совпадает с ответом о пенсии и пособиях в документах');
 const purposes=payload.answers.filter(a=>a.key.startsWith('choice:debtPurpose:')&&a.checked).map(a=>a.key.slice('choice:debtPurpose:'.length));
 if(purposes.length)displayAnswers.push({key:'debtPurposes',label:'На что в целом брали кредиты / почему возникли долги?',value:purposes.join('; ')});
 else issue('debtPurposes','CHOICE_REQUIRED','Укажите цели кредитов');
 if(value('gamblingTransfers')==='no'&&value('n8044')&&Number(value('n8044'))!==0)issue('n8044','GAMBLING_AMOUNT_CONFLICT','При ответе «Нет» сумма переводов должна быть 0');
 if(value('gamblingTransfers')==='yes'&&value('n8044')&&Number(value('n8044'))===0)issue('n8044','GAMBLING_AMOUNT_CONFLICT','Уточните сумму переводов или выберите «Нет»');
 for(const g of schema.groups){if(!active(g.conditions))continue;const rows=groups.get(g.id)?.rows||[];
  const counted=schema.scalar.find(f=>'groupTarget' in f&&f.groupTarget===g.id);
  if(!counted&&!rows.length)issue(g.id,'ROW_REQUIRED','Добавьте запись',g.id);
  if(counted&&g.id.endsWith('cars')&&!rows.length)issue(g.id,'ROW_REQUIRED','Добавьте выбранный автомобиль',g.id);
  rows.forEach((r,i)=>{const row=new Map(r.map(a=>[a.key,a]));for(const f of g.fields)field(f,row,g.id,i);});
 }
 for(const prefix of ['choice:socialStatus:', 'holding:client:',...(married?['holding:partner:']:[])]){
  const selected=payload.answers.filter(a=>a.key.startsWith(prefix)&&a.checked).map(a=>a.key.slice(prefix.length));
  if(!selected.length||selected.includes('unknown'))issue(prefix,'CHOICE_REQUIRED','Выберите подходящий ответ');
  if(selected.length>1&&selected.some(v=>['Нет','none','unknown'].includes(v)))issue(prefix,'CONFLICTING_CHOICES','Несовместимые ответы');
 }
 if(!trustedIin)issue('iin','DEAL_IDENTITY_UNVERIFIED','Сначала подтвердите клиента сделки');
 else if(value('iin')!==trustedIin)issue('iin','WRONG_CLIENT','ИИН отличается от клиента сделки');
 if(value('iin')&&!validIin(value('iin')))issue('iin','INVALID_IIN','Некорректный ИИН');
 if(active(['childrenUnder18Field'])&&!checked('unknown:childrenUnder18')&&Number(value('childrenUnder18'))>Number(value('childrenTotal')))issue('childrenUnder18','CHILD_COUNT_CONFLICT','Число несовершеннолетних превышает общее число детей');
 const schedule=createPaymentSchedule(Object.fromEntries(['summa','months','payDay','grafType','contractDate'].map(k=>[k,value(k)])));
 if(!schedule)issue('summa','INVALID_PAYMENT_SCHEDULE','Проверьте сумму, дату и условия оплаты');
 return {answersComplete:issues.length===0,issues,schedule,displayAnswers};
}
