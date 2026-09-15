import {RepositoryError,type CaseRow,type EvidenceRepository} from './repository';
import type {Actor} from '../worker-session';
import type {Analysis} from './analysis-service';
import {analysisVersion} from './analysis-service';
import {checkPowerRepresentative} from './power-validation';
import {statementPeriod,salaryStatementPeriod,enpfPeriod,type Representative} from './policy';
export const DOCUMENT_REVIEW_KEY='document.manual-check.v1';
export const MANUAL_DOCUMENT_TYPES:Record<string,string>={'Удостоверение личности':'identity','Ф6 об отсутствии имущества':'property','Справка ЕНПФ':'enpf','Справка по выплатам пенсии и пособий':'benefits','Выписка Kaspi Gold':'kaspi','Выписка зарплатного банка':'salary','Доверенность':'power_of_attorney'};
type ManualCheck={version:1;type:string;iin:string;pages:number;complete:true;contentMatches:true;periodChecked:true;reason:string;issuedAt:string;expiresAt:string;from:string;to:string;representative:Representative|null;authorityChecked:boolean};
function day(value:string){const d=new Date(value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
/** Human inspection is recorded separately from extraction and never proves authenticity. */
export function validateDocumentReview(raw:unknown,analysis:Analysis,record:CaseRow,today:string):ManualCheck{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new RepositoryError('INVALID_DOCUMENT_REVIEW',400);
 const v=raw as Record<string,unknown>;
 const str=(key:string,max=240)=>{if(typeof v[key]!=='string'||v[key].length>max)throw new RepositoryError('INVALID_DOCUMENT_REVIEW',400);return v[key].trim();};
 const type=str('type'),iin=str('iin'),reason=str('reason',2000),issuedAt=str('issuedAt'),expiresAt=str('expiresAt'),from=str('from'),to=str('to');
 if(!MANUAL_DOCUMENT_TYPES[type])throw new RepositoryError('MANUAL_TYPE_NOT_SUPPORTED',400);
 if(!record.client_iin||iin!==record.client_iin)throw new RepositoryError('DOCUMENT_CLIENT_UNVERIFIED');
 const parsed=analysis.extraction;
 if(parsed.identity.iin&&parsed.identity.iin!==iin)throw new RepositoryError('DOCUMENT_IDENTITY_CONFLICT');
 if(parsed.kind!=='unknown'&&parsed.kind!==MANUAL_DOCUMENT_TYPES[type])throw new RepositoryError('DOCUMENT_TYPE_CONFLICT');
 if(!Number.isInteger(v.pages)||v.pages!==analysis.read.totalPages||Number(v.pages)<1||v.complete!==true||v.contentMatches!==true||v.periodChecked!==true||reason.length<10)throw new RepositoryError('DOCUMENT_INSPECTION_INCOMPLETE',400);
 if(!day(today)||issuedAt&&(!day(issuedAt)||issuedAt>today)||expiresAt&&(!day(expiresAt)||expiresAt<today)||issuedAt&&expiresAt&&issuedAt>expiresAt)throw new RepositoryError('DOCUMENT_DATE_NOT_ACCEPTABLE');
 // Annual ENPF coverage is sufficient under the current intake rule.
 if(type==='Справка ЕНПФ'){
  if(enpfPeriod(from,to,issuedAt,today).length)throw new RepositoryError('ENPF_PERIOD_NOT_ACCEPTABLE');
  if(parsed.coverage?.from&&parsed.coverage?.to&&(parsed.coverage.from!==from||parsed.coverage.to!==to||parsed.issuedAt!==issuedAt))throw new RepositoryError('ENPF_PERIOD_NOT_ACCEPTABLE');
 }
 if(type==='Удостоверение личности'&&!expiresAt)throw new RepositoryError('DOCUMENT_EXPIRY_REQUIRED',400);
 if(type==='Выписка зарплатного банка'&&(salaryStatementPeriod(from,to,today).length||parsed.coverage&&(parsed.coverage.from!==from||parsed.coverage.to!==to)))throw new RepositoryError('STATEMENT_PERIOD_NOT_ACCEPTABLE');
 if(type==='Выписка Kaspi Gold'&&statementPeriod(from,to,today).length)throw new RepositoryError('STATEMENT_PERIOD_NOT_ACCEPTABLE');
 if(type==='Выписка Kaspi Gold'){
  const bank=parsed.bankStatement;
  if(parsed.kind!=='kaspi'||!bank?.reconciled||!bank.rowsReadable||analysis.read.pages.length!==analysis.read.totalPages||analysis.read.pages.some(p=>p.needsOcr))throw new RepositoryError('STATEMENT_RECONCILIATION_REQUIRED');
  if(bank.from!==from||bank.to!==to||statementPeriod(bank.from,bank.to,today).length)throw new RepositoryError('STATEMENT_PERIOD_NOT_ACCEPTABLE');
 }
 let representative:Representative|null=null;
 if(type==='Доверенность'){
  if(!issuedAt||!expiresAt||v.authorityChecked!==true)throw new RepositoryError('POWER_AUTHORITY_REVIEW_REQUIRED');
  const r=v.representative as Representative|undefined;
  if(!r||!['person','organization'].includes(r.kind)||typeof r.legalName!=='string'||r.legalName.length>240||typeof r.identifier!=='string')throw new RepositoryError('REPRESENTATIVE_NOT_APPROVED');
  representative={kind:r.kind,legalName:r.legalName.trim(),identifier:r.identifier.trim()};
  const power={principal:null,representative,representativeText:'',expiresText:null,findings:[]};
  if(!checkPowerRepresentative(power).representativeMatched||parsed.power?.representative&&!checkPowerRepresentative(parsed.power).representativeMatched)throw new RepositoryError('REPRESENTATIVE_NOT_APPROVED');
 }
 return {version:1,type,iin,pages:Number(v.pages),complete:true,contentMatches:true,periodChecked:true,reason,issuedAt,expiresAt,from,to,representative,authorityChecked:type==='Доверенность'};
}
export async function reviewDocument(repository:EvidenceRepository,record:CaseRow,documentId:string,requestId:string,identityRevision:number,raw:unknown,actor:Actor,today:string){
 if(identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))throw new RepositoryError('INVALID_REVIEW_REQUEST',400);
 const doc=await repository.document(record.id,documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE',404);
 const cached=await repository.cached(record.id,doc.original_sha256,analysisVersion);if(!cached)throw new RepositoryError('DOCUMENT_PROCESSING_REQUIRED');
 const value=validateDocumentReview(raw,cached.result as Analysis,record,today);
 return repository.appendReview({caseId:record.id,documentId:doc.id,extractionId:cached.extraction.id,identityRevision,requestId,factKey:DOCUMENT_REVIEW_KEY,value,disposition:'confirmed',reason:value.reason},actor);
}
export async function currentDocumentReview(repository:EvidenceRepository,record:CaseRow,documentId:string,extractionId:string,analysis:Analysis,type:string,today:string){
 const reviews=await repository.currentReviews(record.id,documentId,extractionId,record.identity_revision);
 const review=reviews.find(r=>r.fact_key===DOCUMENT_REVIEW_KEY);if(!review)return null;
 try{const value=validateDocumentReview(JSON.parse(review.value_json),analysis,record,today);return value.type===type?{id:review.id,actorId:review.actor_id,reviewedAt:review.created_at,value}:null;}catch(error){if(error instanceof RepositoryError||error instanceof SyntaxError)return null;throw error;}
}

/** Append a withdrawal; retain the original inspection and reject stale concurrent withdrawals. */
export async function withdrawDocumentReview(repository:EvidenceRepository,record:CaseRow,documentId:string,reviewId:string,requestId:string,identityRevision:number,reason:string,actor:Actor){
 if(identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)||reason.trim().length<10||reason.length>2000)throw new RepositoryError('INVALID_REVIEW_REQUEST',400);
 const previous=await repository.reviewRecord(record.id,reviewId);
 if(!previous||previous.document_id!==documentId||previous.fact_key!==DOCUMENT_REVIEW_KEY||previous.identity_revision!==identityRevision||previous.disposition!=='confirmed')throw new RepositoryError('REVIEW_NOT_IN_DOCUMENT',404);
 return repository.appendReview({caseId:record.id,documentId,extractionId:previous.extraction_id,identityRevision,requestId,factKey:DOCUMENT_REVIEW_KEY,value:null,disposition:'unresolved',reason:reason.trim(),expectedReviewId:previous.id},actor);
}
