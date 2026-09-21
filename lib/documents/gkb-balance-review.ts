import {RepositoryError,sha256,type EvidenceRepository,type CaseRow,type DocumentRow,type ExtractionRow} from './repository';
import type {Analysis} from './analysis-service';
import {analysisVersion} from './analysis-version';
import {shortBalanceReviewPlan} from './credit-report-match';
import {creditorKey} from './loan-identity';
import type {DraftPayload} from '../questionnaire/draft';
import type {ApprovedAnswerEvidence} from '../questionnaire/review-bindings';
import type {Actor} from '../worker-session';

export const GKB_BALANCE_REVIEW_KEY='gkb.balance-source.v1';
type StoredReport={document:DocumentRow;extraction:ExtractionRow;result:unknown};
export async function inspectGkbBalanceReview(repository:EvidenceRepository,record:CaseRow,short:StoredReport,full:StoredReport,day:string){
 const plan=shortBalanceReviewPlan(short.result as Analysis,full.result as Analysis,record.client_iin,day);if(!plan)return null;
 const value={version:1,identityRevision:record.identity_revision,shortDocumentId:short.document.id,shortExtractionId:short.extraction.id,fullDocumentId:full.document.id,fullExtractionId:full.extraction.id,plan};
 const planKey=await sha256(JSON.stringify(value));
 const reviews=await repository.currentReviews(record.id,short.document.id,short.extraction.id,record.identity_revision);
 const review=reviews.find(r=>{if(r.fact_key!==GKB_BALANCE_REVIEW_KEY||r.disposition!=='confirmed')return false;try{return JSON.parse(r.value_json).planKey===planKey;}catch{return false;}})||null;
 return {...value,planKey,review:review?{reviewId:review.id,actorId:review.actor_id,reviewedAt:review.created_at}:null};
}
export type GkbBalanceInspection=NonNullable<Awaited<ReturnType<typeof inspectGkbBalanceReview>>>;
export function gkbBalanceRows(payload:DraftPayload,inspection:GkbBalanceInspection){
 const group=payload.groups?.find(g=>g.id==='creditors');
 return inspection.plan.balances.map(balance=>{
  const rows=(group?.rows||[]).flatMap((row,index)=>{const values=Object.fromEntries(row.map(a=>[a.key,a.value]));return creditorKey(values.n8038||'')===creditorKey(balance.creditor)&&balance.aliases.includes((values.loanContractId||'').trim())?[{row:index,amount:values.n8040}]:[];});
  const selected=rows.length===1?rows[0]:null;
  const amount=selected?.amount&&/^\d+(?:\.\d{1,2})?$/.test(selected.amount)?String(BigInt(selected.amount.split('.')[0]))+'.'+(selected.amount.split('.')[1]||'').padEnd(2,'0'):null;
  return {...balance,row:selected?.row??null,matches:!!selected&&amount===balance.amount};
 });
}
export function gkbBalanceEvidence(payload:DraftPayload,inspection:GkbBalanceInspection,short:StoredReport):ApprovedAnswerEvidence[]{
 if(!inspection.review)return [];
 return gkbBalanceRows(payload,inspection).filter(r=>r.matches).map(r=>({key:'n8040',group:'creditors',row:r.row!,documentId:short.document.id,extractionId:short.extraction.id,factKey:GKB_BALANCE_REVIEW_KEY,reviewId:inspection.review!.reviewId,value:r.amount,page:r.shortPage,source:`Сумма из краткого ГКБ, стр. ${r.shortPage}; договор ${r.contractNumber} сопоставлен с полным ГКБ, стр. ${r.fullPage}, где остаток не указан. Выбор источника подтверждён сотрудником.`,documentSha256:short.document.original_sha256,documentName:short.document.original_name,reviewedAt:inspection.review!.reviewedAt,reviewActorId:inspection.review!.actorId,disposition:'confirmed'}));
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
 const withdraw=input.action==='withdraw';
 if(withdraw){
  if(typeof input.reviewId!=='string'||inspection.review&&input.reviewId!==inspection.review.reviewId)throw new RepositoryError('REVIEW_CHANGED');
  const previous=await repository.reviewRecord(record.id,input.reviewId);
  if(!previous||previous.document_id!==short.document.id||previous.extraction_id!==short.extraction.id||previous.fact_key!==GKB_BALANCE_REVIEW_KEY)throw new RepositoryError('REVIEW_CHANGED');
 }
 if(!withdraw&&gkbBalanceRows(payload,inspection).some(r=>!r.matches))throw new RepositoryError('GKB_ANSWERS_NOT_SAVED');
 const review=await repository.appendReview({caseId:record.id,documentId:short.document.id,extractionId:short.extraction.id,identityRevision:record.identity_revision,requestId:input.requestId,factKey:GKB_BALANCE_REVIEW_KEY,value:withdraw?null:{...inspection,review:undefined},disposition:withdraw?'unresolved':'confirmed',reason:withdraw?'Сотрудник отменил выбор суммы из краткого ГКБ.':'Сотрудник сверил кредиторов и номера договоров и выбрал указанные суммы из краткого ГКБ; в полном ГКБ остатки не указаны.',...(withdraw?{expectedReviewId:input.reviewId as string}:{})},actor);
 return {reviewId:review.id,reviewedAt:review.created_at};
}
