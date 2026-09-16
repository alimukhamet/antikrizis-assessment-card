import type {EvidenceRepository,CaseRow} from './repository';
import {analysisVersion,type Analysis} from './analysis-service';
import {gkbFreshness,requiresDocumentValidation,statementPeriod,salaryStatementPeriod,enpfPeriod} from './policy';
import type {DraftPayload} from '../questionnaire/draft';
import {currentDocumentReview,MANUAL_DOCUMENT_TYPES} from './document-review';
import {checkPowerTemplate} from './power-validation';
import {matchShortReport,shortReportMismatchReasons,type CreditMatch} from './credit-report-match';
import {creditorKey,loanRowKey} from './loan-identity';
// Contract preparation and lawyer handoff have independent document requirements.
export const REQUIRED_DOCUMENTS=['ГКБ — краткий отчёт','ГКБ — полный отчёт','Справка ЕНПФ','Ф6 об отсутствии имущества','Удостоверение личности','Выписка Kaspi Gold'];
const kinds:Record<string,string>={'ГКБ — краткий отчёт':'gkb_short','ГКБ — полный отчёт':'gkb_full','Справка ЕНПФ':'enpf','Ф6 об отсутствии имущества':'property','Удостоверение личности':'identity','Доверенность':'power_of_attorney','Выписка Kaspi Gold':'kaspi','Справка по выплатам пенсии и пособий':'benefits','Выписка зарплатного банка':'salary'};
export type PackageIssue={code:string;documentId?:string;type?:string;message:string};
/** No OCR/AI is started here; absent/current-version cache requires explicit processing. */
export async function checkDocumentPackage(repository:EvidenceRepository,record:CaseRow,payload:DraftPayload,day:string,scope:'contract'|'handoff'='contract'){
 const issues:PackageIssue[]=[],required=scope==='handoff'?['Доверенность']:[...REQUIRED_DOCUMENTS];
 const benefitCount=payload.answers?.find(a=>a.key==='clientBenefitsCount')?.value||'';
 if(scope==='contract'&&(payload.docContext.social==='1'||Number(benefitCount)>0||payload.groups?.some(g=>g.id==='clientbenefits'&&g.rows.length>0)))required.push('Справка по выплатам пенсии и пособий');
 if(scope==='contract'&&payload.docContext.salary==='1')required.push('Выписка зарплатного банка');
 if(scope==='contract'&&(!payload.docContext.social||!payload.docContext.salary))issues.push({code:'DOCUMENT_CONTEXT_REQUIRED',message:'Укажите, получает ли клиент пенсию или пособия и в какой банк поступает зарплата.'});
 if(scope==='contract'&&payload.pendingFiles.filter(name=>! /\.(p12|pfx|key|jks)$/i.test(name)).length)issues.push({code:'DOCUMENT_UPLOAD_PENDING',message:'Есть выбранные файлы, ещё не сохранённые для проверки.'});
 const manuallyReviewed:Array<{documentId:string;reviewId:string;type:string;actorId:string;reviewedAt:string}>=[];
 const pendingShort:Array<{documentId:string;type:string;analysis:Analysis;message:string}>=[],fullReports:Array<{documentId:string;analysis:Analysis}>=[];
 const matchedShortReports:Array<{documentId:string;fullDocumentId:string;matches:CreditMatch[]}>=[];
 const seen=new Set<string>(),available=new Set<string>();
 const credits=new Map<string,Array<{documentId:string;creditor:string;issuedAt:string|null;values:Record<string,string>;pages:Record<string,number>}>>();
 const selectedDocuments=payload.documents.filter(document=>scope==='handoff'?document.type==='Доверенность':!['Доверенность','Подписанный договор'].includes(document.type));
 // Bounded parallel reads of immutable saved results; no cross-request identity cache.
 const loaded=new Map<string,{document:Awaited<ReturnType<EvidenceRepository['document']>>;cached:Awaited<ReturnType<EvidenceRepository['cached']>>;review:Awaited<ReturnType<typeof currentDocumentReview>>}>();
 const ids=[...new Set(selectedDocuments.map(d=>d.documentId))];let nextDocument=0;
 await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(nextDocument<ids.length){
  const id=ids[nextDocument++],selected=selectedDocuments.find(d=>d.documentId===id)!,document=await repository.document(record.id,id);
  const cached=document?await repository.cached(record.id,document.original_sha256,analysisVersion):null;
  const review=cached&&selected.person==='Клиент'&&MANUAL_DOCUMENT_TYPES[selected.type]?await currentDocumentReview(repository,record,id,cached.extraction.id,cached.result as Analysis,selected.type,day):null;
  loaded.set(id,{document,cached,review});
 }}));
 for(const selected of selectedDocuments){
  const issue=(code:string,message:string)=>issues.push({code,message,documentId:selected.documentId,type:selected.type});
  if(seen.has(selected.documentId)){issue('DUPLICATE_DOCUMENT_SELECTION','Один файл выбран несколько раз.');continue;}seen.add(selected.documentId);
  const {document,cached,review}=loaded.get(selected.documentId)!;
  if(!document){issue('DOCUMENT_NOT_IN_CASE','Файл не принадлежит этой оценке.');continue;}
  if(!cached){issue('DOCUMENT_PROCESSING_REQUIRED','Запустите обработку сохранённого файла.');continue;}
  const {extraction:parsed,read}=cached.result as Analysis;
  if(selected.person!=='Клиент'){issue('FAMILY_IDENTITY_VALIDATION_REQUIRED','Для документа родственника ещё нужна проверка владельца и родства.');continue;}
  if(MANUAL_DOCUMENT_TYPES[selected.type]){
   if(review){available.add(selected.type);manuallyReviewed.push({documentId:document.id,reviewId:review.id,type:selected.type,actorId:review.actorId,reviewedAt:review.reviewedAt});continue;}
  }
  if(!record.client_iin||parsed.identity.iin!==record.client_iin){issue('DOCUMENT_CLIENT_UNVERIFIED','Владелец документа не подтверждён как клиент этой сделки.');continue;}
  if(!kinds[selected.type]||parsed.kind!==kinds[selected.type]){issue('DOCUMENT_TYPE_UNVERIFIED','Содержимое пока не подтверждает выбранный тип документа.');continue;}
  if(parsed.kind==='gkb_full')fullReports.push({documentId:document.id,analysis:cached.result as Analysis});
  if(parsed.kind==='power_of_attorney'){
   const power=checkPowerTemplate(cached.result as Analysis,day);
   if(power.accepted)available.add(selected.type);
   else for(const code of power.findings)issue(code,({REPRESENTATIVE_NOT_APPROVED:'Реквизиты поверенного не совпали с утверждёнными.',REPRESENTATIVE_IDENTITY_UNVERIFIED:'Не удалось прочитать реквизиты поверенного.',POWER_DATES_UNVERIFIED:'Не удалось прочитать дату выдачи или срок. Укажите даты по оригиналу.',POWER_DATE_NOT_ACCEPTABLE:'Срок доверенности истёк или указана будущая дата выдачи. Проверьте даты.',POWER_SCOPE_REVIEW_REQUIRED:'Текст полномочий отличается от рабочего шаблона. Подтвердите по оригиналу.',DOCUMENT_COMPLETENESS_UNVERIFIED:'Часть доверенности не прочитана. Проверьте все страницы.'} as Record<string,string>)[code]||'Проверьте владельца доверенности.');
   continue;
  }
  if(parsed.findings.includes('SHORT_CREDIT_LIST_UNVERIFIED')){
   const explanations:Record<string,string>={SHORT_CONTRACT_ID_TRUNCATED:'В кратком ГКБ сокращены номера договоров. Нужна сверка с полным отчётом.',SHORT_CREDIT_COUNT_MISMATCH:'Количество прочитанных обязательств не совпало с указанным в отчёте.',SHORT_TOTAL_MISMATCH:'Сумма прочитанных долгов не совпала с итогом отчёта.',SHORT_SUMMARY_MISSING:'Не удалось прочитать итоговую сумму или количество обязательств.'};
   pendingShort.push({documentId:document.id,type:selected.type,analysis:cached.result as Analysis,message:parsed.findings.filter(f=>explanations[f]).map(f=>explanations[f]).join(' ')||'Нужно сверить список обязательств краткого ГКБ с полным отчётом.'});continue;
  }
  if(requiresDocumentValidation(parsed.findings)||read.pages.some(p=>p.needsOcr)){issue('DOCUMENT_COMPLETENESS_UNVERIFIED','Есть нечитаемые страницы или полнота документа не подтверждена.');continue;}
  if(parsed.kind.startsWith('gkb_')){
   if(gkbFreshness(parsed.issuedAt||'',day).length){issue('GKB_DATE_NOT_ACCEPTABLE','ГКБ должен быть выдан не более 30 дней назад и не иметь будущую дату.');continue;}
   if(parsed.findings.includes('CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES'))issue('CREDIT_LIST_REVIEW_REQUIRED','Нужно сверить полноту обязательств и роль клиента.');
   for(const credit of parsed.credits){
    const creditor=credit.facts.find(f=>f.key==='creditor')?.value;
    if(!creditor||!credit.contractNumber){issue('CREDIT_IDENTITY_UNVERIFIED','Не удалось однозначно определить кредитора и номер обязательства.');continue;}
    const key=JSON.stringify([creditorKey(creditor),(credit.contractCode||credit.contractNumber).trim()]);
    const values=Object.fromEntries(credit.facts.filter(f=>['debtOutstanding','monthlyPayment','overdueDays','startedAtMonth'].includes(f.key)).map(f=>[f.key,f.value]));
    const pages=Object.fromEntries(credit.facts.map(f=>[f.key,f.page||credit.page]));
    const items=credits.get(key)||[];items.push({documentId:document.id,creditor,issuedAt:parsed.issuedAt,values,pages});credits.set(key,items);
   }
   available.add(selected.type);
  }else if(parsed.kind==='kaspi'){
   if(!parsed.bankStatement?.reconciled||!parsed.bankStatement.rowsReadable)issue('STATEMENT_RECONCILIATION_REQUIRED','Не удалось сверить операции и остатки по выписке.');
   else if(statementPeriod(parsed.bankStatement.from,parsed.bankStatement.to,day).length)issue('STATEMENT_PERIOD_NOT_ACCEPTABLE','Нужна выписка за последние 12 месяцев (полный год до даты выписки).');
   else available.add(selected.type);
  }else if(parsed.kind==='enpf'||parsed.kind==='salary'){
   const problems=parsed.kind==='enpf'?enpfPeriod(parsed.coverage?.from||null,parsed.coverage?.to||null,parsed.issuedAt,day):salaryStatementPeriod(parsed.coverage?.from||null,parsed.coverage?.to||null,day);
   if(problems.length)issue(problems[0].code,parsed.kind==='enpf'?'Нужна справка ЕНПФ за 12 месяцев до даты выдачи. Сверьте указанный период.':'Нужна зарплатная выписка, охватывающая последние 12 месяцев. Сверьте указанный период.');
   else available.add(selected.type);
  }else issue('DOCUMENT_RULES_PENDING','Сверьте владельца, даты и содержание документа по оригиналу.');
 }
 for(const short of pendingShort){
  const candidates=fullReports.flatMap(full=>{const matches=matchShortReport(short.analysis,full.analysis,record.client_iin,day);return matches?[{documentId:short.documentId,fullDocumentId:full.documentId,matches}]:[];});
  if(candidates.length===1){matchedShortReports.push(candidates[0]);available.add(short.type);}
  else {
   const reasons=candidates.length>1?['Подходят несколько полных отчётов. Оставьте один актуальный полный ГКБ для сверки.']:fullReports.length?fullReports.flatMap(full=>shortReportMismatchReasons(short.analysis,full.analysis,day)):['Выберите и обработайте полный ГКБ этого клиента.'];
   issues.push({code:'SHORT_CREDIT_REVIEW_REQUIRED',documentId:short.documentId,type:short.type,message:short.message+' '+[...new Set(reasons)].join(' ')});
  }
 }
 const conflicts:Array<{documentIds:string[];field:string;clientConfirmedAmount?:string;values:string[];issuedAt:Array<string|null>;creditor:string;contractNumber:string;sources:Array<{documentId:string;issuedAt:string|null;value:string;page:number|null}>}>=[];
 for(const [key,sources] of credits){
  const [,contractNumber]=JSON.parse(key) as [string,string],creditor=sources[0].creditor;
  const fields=new Set(sources.flatMap(s=>Object.keys(s.values)));
  for(const field of fields){const found=sources.filter(s=>s.values[field]!==undefined);const values=[...new Set(found.map(s=>s.values[field]))];if(values.length>1)conflicts.push({documentIds:found.map(s=>s.documentId),field,values,issuedAt:found.map(s=>s.issuedAt),creditor,contractNumber,sources:found.map(s=>({documentId:s.documentId,issuedAt:s.issuedAt,value:s.values[field],page:Number.isInteger(s.pages[field])&&s.pages[field]>0?s.pages[field]:null}))});}
 }
 const creditGroup=payload.groups?.find(g=>g.id==='creditors');
 for(const conflict of conflicts){
  if(conflict.field!=='debtOutstanding'||!creditGroup)continue;
  const expected=loanRowKey(`creditors|${record.client_iin}|${conflict.creditor}|${conflict.contractNumber}`);
  const matches=creditGroup.rowKeys.map((key,index)=>loanRowKey(key)===expected?index:-1).filter(index=>index>=0);
  const row=matches.length===1?matches[0]:-1;
  const answer=row<0?null:creditGroup.rows[row].find(a=>a.key==='n8040'&&a.clientConfirmed);
  if(answer)conflict.clientConfirmedAmount=answer.value;
 }
 if(conflicts.some(c=>c.clientConfirmedAmount===undefined))issues.push({code:'CREDIT_REPORT_CONFLICT',message:'В кредитных отчётах различаются сведения об одном обязательстве. Нужна сверка источников.'});
 const missing=required.filter(type=>type!=='ЭЦП файл'&&!payload.documents.some(d=>d.type===type&&d.person==='Клиент'));
 for(const type of missing)issues.push({code:'REQUIRED_DOCUMENT_MISSING',type,message:`Не выбран обязательный документ: ${type}.`});
 // Credentials remain in the existing separate upload flow, never in extraction/drafts.
 const credentials=await repository.credentialStatus?.(record);
 // The handoff service separately verifies the saved key and signed contract.
 return {required,missing,matchedShortReports,manuallyReviewed,credentials:credentials??null,structurallyChecked:[...available],issues,conflicts,packageReady:issues.length===0,authenticity:'not_verified'};
}
