import {RepositoryError,type EvidenceRepository,type CaseRow} from '../documents/repository';
import {assertReviewAllowed,extractFactMap,type StoredResult} from '../documents/review-service';
import type {DraftPayload} from './draft';
import type {DisplayAnswer} from './check-answers';
import {loanRowKey} from '../documents/loan-identity';
export type ReviewBinding={key:string;group?:string;row?:number;documentId:string;extractionId:string;factKey:string;reviewId:string|null};
export type ApprovedAnswerEvidence=ReviewBinding&{reviewId:string;value:string;page:number;source:string;documentSha256:string;documentName:string;reviewedAt:string;reviewActorId:string;disposition:string};
const direct:Record<string,string>={'identity.iin':'iin','identity.name':'fio','statement.topUps':'kaspiAnnual','employment.payersCount':'count-clientjobs','benefits.count':'clientBenefitsCount','statement.gambling':'n8044'};
const loans:Record<string,string>={creditor:'n8038',startedAtMonth:'n8038Start',monthlyPayment:'n8041',overdueDays:'n8042',debtOutstanding:'n8040',creditType:'n8039',purpose:'n8043',relatedParties:'loanParticipants'};
export function parseReviewBindings(value:unknown):ReviewBinding[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>1500)throw new RepositoryError('INVALID_REVIEW_BINDINGS',400);
 return value.map(raw=>{
  if(!raw||typeof raw!=='object')throw new RepositoryError('INVALID_REVIEW_BINDINGS',400);
  const b=raw as Record<string,unknown>;
  for(const key of ['key','documentId','extractionId','factKey'])if(typeof b[key]!=='string'||!b[key]||String(b[key]).length>160)throw new RepositoryError('INVALID_REVIEW_BINDINGS',400);
  if(b.reviewId!==null&&(typeof b.reviewId!=='string'||b.reviewId.length>80))throw new RepositoryError('INVALID_REVIEW_BINDINGS',400);
  if(b.group!==undefined&&(typeof b.group!=='string'||!Number.isInteger(b.row)||Number(b.row)<0||Number(b.row)>199))throw new RepositoryError('INVALID_REVIEW_BINDINGS',400);
  if(b.group===undefined&&b.row!==undefined)throw new RepositoryError('INVALID_REVIEW_BINDINGS',400);
  return {key:b.key as string,documentId:b.documentId as string,extractionId:b.extractionId as string,factKey:b.factKey as string,reviewId:b.reviewId as string|null,...(b.group!==undefined?{group:b.group as string,row:b.row as number}:{})};
 });
}
/** Caller references are proposals, never evidence that a review passed. */
export async function checkReviewBindings(repository:EvidenceRepository,record:CaseRow,payload:DraftPayload,active:DisplayAnswer[],bindings:ReviewBinding[],assessmentDay:string){
 const approved:ApprovedAnswerEvidence[]=[];
 const issues:Array<{key:string;group?:string;row?:number;code:string}>=[];
 const seen=new Set<string>();
 async function load(documentId:string,extractionId:string){
  const doc=await repository.document(record.id,documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');
  const extraction=await repository.extraction(record.id,doc.id,extractionId);if(!extraction)throw new RepositoryError('EXTRACTION_NOT_IN_DOCUMENT');
  const result=await repository.readResult(extraction) as StoredResult;
  const reviews=await repository.currentReviews(record.id,doc.id,extraction.id,record.identity_revision);
  return {doc,extraction,result,reviews};
 }
 const loaded=new Map<string,ReturnType<typeof load>>();
 for(const binding of bindings){
  try{
   const target=JSON.stringify([binding.group||'',binding.row??null,binding.key]);
   if(seen.has(target))throw new RepositoryError('DUPLICATE_REVIEW_TARGET');seen.add(target);
   const answer=active.find(a=>a.key===binding.key&&a.group===binding.group&&a.row===binding.row);
   if(!answer)throw new RepositoryError('REVIEW_TARGET_NOT_ACTIVE');
   const clientAnswer=binding.group==='creditors'&&binding.key==='n8040'?payload.groups.find(g=>g.id==='creditors')?.rows?.[binding.row!]?.find(a=>a.key==='n8040'):null;
   if(clientAnswer?.clientConfirmed&&clientAnswer.value===answer.value)continue; // Kept as a client answer, never promoted to document evidence.
   if(!binding.reviewId)throw new RepositoryError('ANSWER_REVIEW_REQUIRED');
   const sourceKey=JSON.stringify([binding.documentId,binding.extractionId]);
   if(!loaded.has(sourceKey))loaded.set(sourceKey,load(binding.documentId,binding.extractionId));
   const {doc,extraction,result,reviews}=await loaded.get(sourceKey)!;
   const parsed=result.extraction,loan=/^credits\.(\d+)\.([A-Za-z]+)$/.exec(binding.factKey);
   if(loan){
    const credit=parsed.credits[Number(loan[1])];
    if(!credit||binding.group!=='creditors'||loans[loan[2]]!==binding.key)throw new RepositoryError('REVIEW_TARGET_MISMATCH');
    const expected=[credit.contractNumber,credit.contractCode].filter(Boolean).map(number=>loanRowKey(`creditors|${record.client_iin}|${credit.facts.find(f=>f.key==='creditor')?.value||''}|${number}`));
    const rowKeys=payload.groups.find(g=>g.id==='creditors')?.rowKeys.map(loanRowKey)||[];
    if(rowKeys.filter(key=>key&&expected.includes(key)).length>1)throw new RepositoryError('REVIEW_LOAN_DUPLICATE');
    if(!expected.includes(rowKeys[binding.row!]||''))throw new RepositoryError('REVIEW_LOAN_MISMATCH');
   }else if(binding.group!==undefined||direct[binding.factKey]!==binding.key)throw new RepositoryError('REVIEW_TARGET_MISMATCH');
   const review=reviews.find(r=>r.id===binding.reviewId&&r.fact_key===binding.factKey);
   if(!review)throw new RepositoryError('REVIEW_SUPERSEDED_OR_MISSING');
   const value=JSON.parse(review.value_json);
   if(typeof value!=='string'||answer.value!==value)throw new RepositoryError('REVIEW_VALUE_CHANGED');
   assertReviewAllowed(record,doc,extraction,result,{factKey:binding.factKey,value,disposition:review.disposition,reason:review.reason,identityRevision:record.identity_revision},assessmentDay);
   const fact=extractFactMap(parsed).get(binding.factKey)!;
   approved.push({...binding,reviewId:review.id,value,page:fact.page,source:fact.source,documentSha256:doc.original_sha256,documentName:doc.original_name,reviewedAt:review.created_at,reviewActorId:review.actor_id,disposition:review.disposition});
  }catch(error){if(!(error instanceof RepositoryError))throw error;issues.push({key:binding.key,...(binding.group?{group:binding.group,row:binding.row}:{}),code:error.code});}
 }
 return {approved,issues};
}
