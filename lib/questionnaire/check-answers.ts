import {normalizeIntake} from '../../public/intake-data.mjs';
import schema from './schema.json';
import {parseParticipants} from '../../public/loan-participants.mjs';
import type {Answer,DraftPayload} from './draft';
import {validIin} from '../documents/extract-native';
import {createPaymentSchedule} from '../../public/payment-schedule.mjs';
export type AnswerIssue={key:string;group?:string;row?:number;code:string;label:string};
export type DisplayAnswer={key:string;group?:string;row?:number;label:string;value:string};
type Definition={key:string;type:string;label:string;required?:boolean;legacy?:boolean;conditions?:string[];min?:string;max?:string;compactCount?:boolean};
/** Answer completeness only. Document eligibility and fact review are separate gates. */
/** Contract/payment answers belong to sales. The profile backfill never asks for or writes them. */
export const SALES_ONLY_KEYS=new Set(['dognum','summa','contractDate','months','payDay','grafType']);
/** Optional for sales, required when the documentologist completes the profile. */
const PROFILE_REQUIRED_KEYS=new Set(['n8001Employer','n8002Employer']);
export type CheckOptions={profile?:boolean};
export function checkAnswers(payload:DraftPayload,trustedIin:string|null,assessmentDay?:string,options:CheckOptions={}){
 const profile=options.profile===true;
 payload=normalizeIntake(payload);
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const assessmentMonth=assessmentDay?.slice(0,7)||`${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}`;
 const all=new Map(payload.answers.map(a=>[a.key,a])),groups=new Map(payload.groups.map(g=>[g.id,g]));
 const value=(key:string,row?:Map<string,Answer>)=>(row?.get(key)||all.get(key))?.value.trim()||'';
 const checked=(key:string)=>all.get(key)?.checked===true;
 const issues:AnswerIssue[]=[];
 /** Profile mode: answers marked «Неизвестно» are saved as open questions instead of blocking. */
 const unresolved:DisplayAnswer[]=[];
 const displayAnswers:DisplayAnswer[]=[];
 const issue=(key:string,code:string,label:string,group?:string,row?:number)=>issues.push({key,code,label,...(group?{group,row}:{})});
 const married=value('marital')==='В браке';
 function highKaspi(partner:boolean){
  const owner=partner?'partner':'client',annual=value(partner?'partnerKaspiAnnual':'kaspiAnnual');
  const incomes=(groups.get(owner+'jobs')?.rows||[]).map(r=>r.find(a=>a.key===(partner?'n8002':'n8001'))?.value||'');
  return /^\d+(\.\d{1,2})?$/.test(annual)&&incomes.every(v=>/^\d+(\.\d{1,2})?$/.test(v))&&Number(annual)>30*incomes.reduce((sum,v)=>sum+Number(v),0);
 }
 function active(conditions:string[]=[],row?:Map<string,Answer>):boolean{return conditions.every(c=>{
 if(c==='profileOnly')return profile;
 if(c==='factAddressField')return value('factAddressSame')==='other';
  if(['partnerIncome','partnerAssets','partnerBusiness','partnerKaspi'].includes(c))return married;
  if(c==='childrenUnder18Field')return !checked('unknown:childrenTotal')&&Number(value('childrenTotal'))>0;
  if(c==='socialOtherField')return checked('choice:socialStatus:Другое');
  if(c==='enforcementRecords')return value('enforcementStatus')==='yes';
  if(c==='lawyerNotesDetails')return value('lawyerNotesStatus')==='yes';
  if(c==='debtPurposeOtherField')return checked('choice:debtPurpose:Другое');
  if(c==='hardshipDetails')return !!value('hardshipReason')&&value('hardshipReason')!=='Платежи вношу, трудностей нет';
  if(c==='proof-details')return ['Есть на руках','Можно получить'].includes(value('n12009'));
  if(c==='kaspiWhyField'||c==='partnerKaspiWhyField')return highKaspi(c.startsWith('partner'));
  if(c==='panel-c8037')return value('c8037')==='1';
  const asset=/^(client|partner)-asset-(.+)$/.exec(c);if(asset)return checked(`holding:${asset[1]}:${asset[2]}`);
  if(c==='ownership-share')return ['n8004Kind','n8019Kind','clientLandOwnership','partnerLandOwnership'].some(key=>value(key,row)==='share');
  if(c==='transfer-other')return value('n8033',row)==='Другое';
  if(c==='purpose-other')return value('n8043',row)==='Другое';
  if(c==='benefit-other')return value('clientBenefitType',row)==='Другая государственная выплата'||value('partnerBenefitType',row)==='Другая государственная выплата';
  if(c==='loan-scheduled')return value('loanStatus',row)==='Платится по графику';
  throw Error('UNMAPPED_QUESTIONNAIRE_CONDITION:'+c);
 });}
 function field(f:Definition,row?:Map<string,Answer>,group?:string,index?:number){
  if(f.legacy||!active(f.conditions,row)||f.key.startsWith('exact:'))return;
  if(profile&&SALES_ONLY_KEYS.has(f.key))return;
  const required=f.required||profile&&PROFILE_REQUIRED_KEYS.has(f.key);
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
  if(unknown||['unknown','Не знаю'].includes(v)){if(profile)unresolved.push({key:f.key,label:f.label,value:'Неизвестно — уточнить',...(group?{group,row:index}:{})});else issue(f.key,'ANSWER_REQUIRED',f.label,group,index);return;}
  if(!v){if(required)issue(f.key,'ANSWER_REQUIRED',f.label,group,index);return;}
  if(f.key==='loanParticipants'&&!parseParticipants(v).valid)issue(f.key,'PARTICIPANTS_REQUIRED','Выберите «Нет» или укажите ФИО и роль каждого участника',group,index);
  if(f.compactCount&&v==='more')issue(f.key,'EXACT_COUNT_REQUIRED',f.label,group,index);
  if(f.key==='familyBirthDate'){const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v),d=m?new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`):null;if(!m||!d||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==`${m[3]}-${m[2]}-${m[1]}`||Number(m[3])<1900||`${m[3]}-${m[2]}`>assessmentMonth)issue(f.key,'INVALID_DATE','Дата рождения в формате ДД.ММ.ГГГГ',group,index);}
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
 if(value('enforcementStatus')==='legacy'){
  if(!value('enforcementDetails')||checked('unknown:enforcementDetails'))issue('enforcementStatus','ANSWER_REQUIRED','Уточните исполнительные производства и надписи');
  else displayAnswers.push({key:'enforcementDetails',label:'Прежние сведения о взысканиях',value:value('enforcementDetails')});
 }else if(value('enforcementStatus')==='yes'&&value('enforcementDetails')&&!/^нет[.!]?$/iu.test(value('enforcementDetails')))displayAnswers.push({key:'enforcementDetails',label:'Прежние сведения о взысканиях',value:value('enforcementDetails')});
 const rowRequiredLabels:Record<string,string>={
  clientreal:'Добавьте данные выбранной недвижимости клиента',clientland:'Добавьте земельный участок клиента',clientcars:'Добавьте выбранный автомобиль клиента',clientip:'Добавьте данные ИП клиента',clienttoo:'Добавьте данные доли в ТОО клиента',clientkh:'Добавьте данные КХ клиента',
  partnerreal:'Добавьте данные выбранной недвижимости супруга(и)',partnerland:'Добавьте земельный участок супруга(и)',partnercars:'Добавьте выбранный автомобиль супруга(и)',partnerip:'Добавьте данные ИП супруга(и)',partnertoo:'Добавьте данные доли в ТОО супруга(и)',partnerkh:'Добавьте данные КХ супруга(и)',
  enforcements:'Добавьте взыскателя и сумму взыскания',transfers:'Добавьте запись о переданном имуществе',creditors:'Добавьте хотя бы одного кредитора / обязательство',
 };
 for(const g of schema.groups){if(!active(g.conditions))continue;const rows=groups.get(g.id)?.rows||[];
  const counted=schema.scalar.find(f=>'groupTarget' in f&&f.groupTarget===g.id),rowLabel=rowRequiredLabels[g.id]||`Добавьте запись в раздел ${g.id}`;
  if(!counted&&!rows.length)issue(g.id,'ROW_REQUIRED',rowLabel,g.id);
  if(counted&&g.id.endsWith('cars')&&!rows.length)issue(g.id,'ROW_REQUIRED',rowLabel,g.id);
  rows.forEach((r,i)=>{const row=new Map(r.map(a=>[a.key,a]));for(const f of g.fields)field(f,row,g.id,i);
   if(g.id==='creditors'&&/^\d+$/.test(value('n8042',row))){const defaulted=Number(value('n8042',row))>0,status=value('loanStatus',row);if(status&&(defaulted!==(status==='В просрочке — требуют полную сумму')))issue('loanStatus','LOAN_STATUS_CONFLICT','Статус кредита не совпадает с количеством дней просрочки',g.id,i);}
  });
 }
 const choices=[{prefix:'choice:socialStatus:',kinds:null as string[]|null,none:'Нет',key:'choice:socialStatus:',label:'Социальный статус'}];
 for(const owner of ['client',...(married?['partner']:[])]){
  choices.push({prefix:`holding:${owner}:`,kinds:['real','land','car','other','none','unknown'],none:'none',key:`holding:${owner}:`,label:owner==='client'?'Имущество клиента':'Имущество супруга(и)'});
  choices.push({prefix:`holding:${owner}:`,kinds:['ip','too','kh','businessNone'],none:'businessNone',key:`holding:${owner}:business`,label:owner==='client'?'Бизнес и регистрация клиента':'Бизнес и регистрация супруга(и)'});
 }
 for(const choice of choices){
  const selected=payload.answers.filter(a=>a.key.startsWith(choice.prefix)&&a.checked).map(a=>a.key.slice(choice.prefix.length)).filter(k=>!choice.kinds||choice.kinds.includes(k));
  if(!selected.length||selected.includes('unknown'))issue(choice.key,'CHOICE_REQUIRED','Выберите ответ: '+choice.label);
  if(selected.length>1&&selected.some(v=>[choice.none,'unknown'].includes(v)))issue(choice.key,'CONFLICTING_CHOICES','Несовместимые ответы: '+choice.label);
 }
 if(!trustedIin)issue('iin','DEAL_IDENTITY_UNVERIFIED','Сначала подтвердите клиента сделки');
 else if(value('iin')!==trustedIin)issue('iin','WRONG_CLIENT','ИИН отличается от клиента сделки');
 if(value('iin')&&!validIin(value('iin')))issue('iin','INVALID_IIN','Некорректный ИИН');
 if(active(['childrenUnder18Field'])&&!checked('unknown:childrenUnder18')&&Number(value('childrenUnder18'))>Number(value('childrenTotal')))issue('childrenUnder18','CHILD_COUNT_CONFLICT','Число несовершеннолетних превышает общее число детей');
 const schedule=profile?null:createPaymentSchedule(Object.fromEntries(['summa','months','payDay','grafType','contractDate'].map(k=>[k,value(k)])));
 if(!profile&&!schedule)issue('summa','INVALID_PAYMENT_SCHEDULE','Проверьте сумму, дату и условия оплаты');
 return {answersComplete:issues.length===0,issues,schedule,displayAnswers,unresolved};
}
