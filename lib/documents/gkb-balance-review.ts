import {RepositoryError,sha256,type EvidenceRepository,type CaseRow,type DocumentRow,type ExtractionRow,type ReviewRow} from './repository';
import type {Analysis} from './analysis-service';
import {analysisVersion} from './analysis-version';
import {shortBalanceReviewPlan} from './credit-report-match';
import {creditorKey} from './loan-identity';
import type {DraftPayload} from '../questionnaire/draft';
import type {ApprovedAnswerEvidence} from '../questionnaire/review-bindings';
import type {Actor} from '../worker-session';

export const GKB_BALANCE_REVIEW_KEY='gkb.balance-source.v1';
const rowKey=(index:number)=>'gkb.balance-source.v2.'+index;
type StoredReport={document:DocumentRow;extraction:ExtractionRow;result:unknown};
type Decision='confirm'|'correct'|'reject'|'unresolved';
type SavedDecision={fullIndex:number;decision:Decision;amount:string|null;reason:string;reviewId:string;factKey:string;actorId:string;reviewedAt:string;rowReviewId:string|null};
const receipt=(r:ReviewRow)=>({reviewId:r.id,factKey:r.fact_key,actorId:r.actor_id,reviewedAt:r.created_at});
function money(value:unknown){
 if(typeof value!=='string'||!/^\d{1,14}(?:\.\d{1,2})?$/.test(value)||Number(value)>Number.MAX_SAFE_INTEGER/100)return null;
 const [whole,fraction='']=value.split('.');return String(BigInt(whole))+'.'+fraction.padEnd(2,'0');
}
function storedValue(row:ReviewRow|undefined){try{return row?JSON.parse(row.value_json):null;}catch{return null;}}
export async function inspectGkbBalanceReview(repository:EvidenceRepository,record:CaseRow,short:StoredReport,full:StoredReport,day:string){
 const plan=shortBalanceReviewPlan(short.result as Analysis,full.result as Analysis,record.client_iin,day);if(!plan)return null;
 // Keep this identity unchanged so earlier whole-report confirmations remain valid.
 const value={version:1,identityRevision:record.identity_revision,shortDocumentId:short.document.id,shortExtractionId:short.extraction.id,fullDocumentId:full.document.id,fullExtractionId:full.extraction.id,plan};
 const planKey=await sha256(JSON.stringify(value));
 const reviews=await repository.currentReviews(record.id,short.document.id,short.extraction.id,record.identity_revision,true);
 const legacy=reviews.find(r=>r.fact_key===GKB_BALANCE_REVIEW_KEY&&r.disposition==='confirmed'&&storedValue(r)?.planKey===planKey);
 const decisions:SavedDecision[]=[],rowHeads=plan.balances.map(b=>({fullIndex:b.fullIndex,reviewId:reviews.find(r=>r.fact_key===rowKey(b.fullIndex))?.id||null}));
 for(const b of plan.balances){
  const row=reviews.find(r=>r.fact_key===rowKey(b.fullIndex)),saved=storedValue(row);
  if(row&&saved?.planKey===planKey){
   const decision:Decision=['confirm','correct','reject'].includes(saved.decision)?saved.decision:'unresolved',amount=money(saved.amount);
   const accepted=(decision==='confirm'&&row.disposition==='confirmed'&&amount===b.amount)||(decision==='correct'&&row.disposition==='corrected'&&amount!==null&&typeof saved.reason==='string'&&saved.reason.trim().length>=4);
   decisions.push({...receipt(row),rowReviewId:row.id,fullIndex:b.fullIndex,decision:accepted?decision:decision==='reject'?'reject':'unresolved',amount:accepted?amount:null,reason:typeof saved.reason==='string'?saved.reason:''});
  }else if(legacy)decisions.push({...receipt(legacy),rowReviewId:null,fullIndex:b.fullIndex,decision:'confirm',amount:b.amount,reason:'Сумма из краткого ГКБ подтверждена сотрудником.'});
 }
 const approved=decisions.filter(d=>['confirm','correct'].includes(d.decision)),complete=approved.length===plan.balances.length;
 const last=complete?[...approved].sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt))[0]:null;
 return {...value,planKey,decisions,rowHeads,review:last?{reviewId:last.reviewId,actorId:last.actorId,reviewedAt:last.reviewedAt}:null};
}
export type GkbBalanceInspection=NonNullable<Awaited<ReturnType<typeof inspectGkbBalanceReview>>>;
export function gkbBalanceRows(payload:DraftPayload,inspection:GkbBalanceInspection){
 const group=payload.groups?.find(g=>g.id==='creditors');
 return inspection.plan.balances.map(balance=>{
  const rows=(group?.rows||[]).flatMap((row,index)=>{const values=Object.fromEntries(row.map(a=>[a.key,a.value]));return creditorKey(values.n8038||'')===creditorKey(balance.creditor)&&balance.aliases.includes((values.loanContractId||'').trim())?[{row:index,amount:values.n8040}]:[];});
  const selected=rows.length===1?rows[0]:null,decision=inspection.decisions.find(d=>d.fullIndex===balance.fullIndex),approved=!!decision&&['confirm','correct'].includes(decision.decision),chosenAmount=approved?decision.amount!:balance.amount;
  return {...balance,chosenAmount,decision,approved,row:selected?.row??null,matches:!!selected&&money(selected.amount)===chosenAmount};
 });
}
export function gkbBalanceEvidence(payload:DraftPayload,inspection:GkbBalanceInspection,short:StoredReport):ApprovedAnswerEvidence[]{
 return gkbBalanceRows(payload,inspection).filter(r=>r.approved&&r.matches).map(r=>({key:'n8040',group:'creditors',row:r.row!,documentId:short.document.id,extractionId:short.extraction.id,factKey:r.decision!.factKey,reviewId:r.decision!.reviewId,value:r.chosenAmount,page:r.shortPage,source:r.decision!.decision==='correct'?`Сотрудник исправил сумму: ${r.decision!.reason}. Извлечённая сумма краткого ГКБ: ${r.amount}, стр. ${r.shortPage}. Договор ${r.contractNumber}, полный ГКБ, стр. ${r.fullPage}.`:`Сумма из краткого ГКБ, стр. ${r.shortPage}; договор ${r.contractNumber} сопоставлен с полным ГКБ, стр. ${r.fullPage}, где остаток не указан. Выбор источника подтверждён сотрудником.`,documentSha256:short.document.original_sha256,documentName:short.document.original_name,reviewedAt:r.decision!.reviewedAt,reviewActorId:r.decision!.actorId,disposition:r.decision!.decision==='correct'?'corrected':'confirmed'}));
}
export async function loadGkbBalanceReview(repository:EvidenceRepository,record:CaseRow,input:Record<string,unknown>,day:string){
 if(input.identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 const load=async(key:string)=>{
  if(typeof input[key]!=='string'||!(input[key] as string))throw new RepositoryError('INVALID_GKB_REVIEW',400);
  const document=await repository.document(record.id,input[key] as string);if(!document)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');
  const cached=await repository.cached(record.id,document.original_sha256,analysisVersion);if(!cached)throw new RepositoryError('DOCUMENT_PROCESSING_REQUIRED');
  return {...cached,document};
 };
 const [short,full]=await Promise.all([load('shortDocumentId'),load('fullDocumentId')]);
 const inspection=await inspectGkbBalanceReview(repository,record,short,full,day);
 return {short,full,inspection};
}
export async function confirmGkbBalanceReview(repository:EvidenceRepository,record:CaseRow,input:Record<string,unknown>,payload:DraftPayload,actor:Actor,day:string){
 if(typeof input.requestId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.requestId))throw new RepositoryError('INVALID_REQUEST_ID',400);
 const {short,full,inspection}=await loadGkbBalanceReview(repository,record,input,day);
 if(!inspection||input.planKey!==inspection.planKey)throw new RepositoryError('GKB_REVIEW_CHANGED');
 for(const [type,documentId]of [['ГКБ — краткий отчёт',short.document.id],['ГКБ — полный отчёт',full.document.id]]){
  const selected=payload.documents.filter(d=>d.type===type&&d.person==='Клиент');
  if(selected.length!==1||selected[0].documentId!==documentId)throw new RepositoryError('GKB_REVIEW_CHANGED');
 }
 if(input.fullIndex!==undefined){
  const balance=inspection.plan.balances.find(b=>b.fullIndex===input.fullIndex);
  if(!balance||!(input.expectedReviewId===null||typeof input.expectedReviewId==='string'))throw new RepositoryError('INVALID_GKB_REVIEW',400);
  const decision=input.action==='withdraw'?'unresolved':input.decision;
  if(!['confirm','correct','reject','unresolved'].includes(String(decision)))throw new RepositoryError('INVALID_GKB_REVIEW',400);
  const amount=decision==='confirm'?balance.amount:decision==='correct'?money(input.amount):null;
  const reason=decision==='correct'?String(input.reason||'').trim():decision==='reject'?'Сотрудник не подтвердил соответствие кредитора или номера договора.':decision==='unresolved'?'Сотрудник отменил подтверждение кредита.':'Сотрудник сверил договор и подтвердил сумму краткого ГКБ.';
  if(decision==='correct'&&(!amount||reason.length<4||reason.length>600))throw new RepositoryError('GKB_CORRECTION_REQUIRED',400);
  if(decision==='confirm'||decision==='correct'){
   const expected={...inspection,decisions:[{fullIndex:balance.fullIndex,decision,amount,reason,reviewId:'pending',factKey:rowKey(balance.fullIndex),actorId:actor.id,reviewedAt:'',rowReviewId:null}] as SavedDecision[]};
   if(!gkbBalanceRows(payload,expected).find(r=>r.fullIndex===balance.fullIndex)?.matches)throw new RepositoryError('GKB_ANSWERS_NOT_SAVED');
  }
  const review=await repository.appendReview({caseId:record.id,documentId:short.document.id,extractionId:short.extraction.id,identityRevision:record.identity_revision,requestId:input.requestId,factKey:rowKey(balance.fullIndex),value:{planKey:inspection.planKey,fullIndex:balance.fullIndex,decision,amount,reason},disposition:decision==='confirm'?'confirmed':decision==='correct'?'corrected':'unresolved',reason,...(input.expectedReviewId?{expectedReviewId:input.expectedReviewId as string}:{requireNewReview:true})},actor);
  return {reviewId:review.id,reviewedAt:review.created_at};
 }
 // Old open tabs retain their batch action until the first per-loan review.
 if(inspection.rowHeads.some(r=>r.reviewId))throw new RepositoryError('GKB_REVIEW_CHANGED');
 const withdraw=input.action==='withdraw';
 if(withdraw){
  if(typeof input.reviewId!=='string'||inspection.review&&input.reviewId!==inspection.review.reviewId)throw new RepositoryError('REVIEW_CHANGED');
  const previous=await repository.reviewRecord(record.id,input.reviewId);
  if(!previous||previous.document_id!==short.document.id||previous.extraction_id!==short.extraction.id||previous.fact_key!==GKB_BALANCE_REVIEW_KEY)throw new RepositoryError('REVIEW_CHANGED');
 }
 if(!withdraw&&gkbBalanceRows(payload,inspection).some(r=>!r.matches))throw new RepositoryError('GKB_ANSWERS_NOT_SAVED');
 const {decisions:_decisions,rowHeads:_rowHeads,review:_review,...legacyValue}=inspection;
 void _decisions;void _rowHeads;void _review;
 const review=await repository.appendReview({caseId:record.id,documentId:short.document.id,extractionId:short.extraction.id,identityRevision:record.identity_revision,requestId:input.requestId,factKey:GKB_BALANCE_REVIEW_KEY,value:withdraw?null:legacyValue,disposition:withdraw?'unresolved':'confirmed',reason:withdraw?'Сотрудник отменил выбор суммы из краткого ГКБ.':'Сотрудник сверил кредиторов и номера договоров и выбрал указанные суммы из краткого ГКБ; в полном ГКБ остатки не указаны.',...(withdraw?{expectedReviewId:input.reviewId as string}:{})},actor);
 return {reviewId:review.id,reviewedAt:review.created_at};
}
