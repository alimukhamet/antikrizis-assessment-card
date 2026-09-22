import {analysisVersion,type Analysis}from'./analysis-service';
import {checkPowerTemplate}from'./power-validation';
import {RepositoryError,EvidenceRepository,type CaseRow,type ExtractionRow,type DocumentRow} from './repository';
import type {Actor} from '../worker-session';
import type {NativeExtraction} from './extract-native';
import {gkbFreshness,requiresDocumentValidation,statementPeriod} from './policy';
export type StoredResult={read:unknown;extraction:NativeExtraction};
export function extractFactMap(extraction:NativeExtraction){
 const facts=new Map(extraction.facts.map(f=>[f.key,f]));
 extraction.credits.forEach((credit,index)=>credit.facts.forEach(f=>facts.set(`credits.${index}.${f.key}`,f)));
 return facts;
}
export function assertReviewAllowed(record:CaseRow,document:DocumentRow,extraction:ExtractionRow,result:StoredResult,input:{factKey:string;value:unknown;disposition:string;reason:string;identityRevision:number},assessmentDay:string,compatibleExtractionId?:string){
 if(extraction.version!==analysisVersion&&compatibleExtractionId!==extraction.id)throw new RepositoryError('EXTRACTION_VERSION_CHANGED');
 if(document.case_id!==record.id||extraction.document_id!==document.id)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');
 if(record.identity_revision!==input.identityRevision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 const parsed=result.extraction;
 if(!record.client_iin||record.client_iin!==parsed.identity.iin)throw new RepositoryError('CLIENT_IDENTITY_UNVERIFIED');
 if(parsed.kind==='power_of_attorney'){
  if(!checkPowerTemplate(result as Analysis,assessmentDay).accepted)throw new RepositoryError('DOCUMENT_REQUIRES_VALIDATION');
 }else if(requiresDocumentValidation(parsed.findings))throw new RepositoryError('DOCUMENT_REQUIRES_VALIDATION');
 if(parsed.kind.startsWith('gkb_')&&gkbFreshness(parsed.issuedAt||'',assessmentDay).length)throw new RepositoryError('GKB_DATE_NOT_ACCEPTABLE');
 if(parsed.kind==='kaspi'&&statementPeriod(parsed.bankStatement?.from||null,parsed.bankStatement?.to||null,assessmentDay).length)throw new RepositoryError('STATEMENT_PERIOD_NOT_ACCEPTABLE');
 const fact=extractFactMap(parsed).get(input.factKey);if(!fact)throw new RepositoryError('FACT_NOT_IN_EXTRACTION',400);
 if(!['confirmed','corrected','unresolved'].includes(input.disposition))throw new RepositoryError('INVALID_REVIEW',400);
 if(input.disposition==='confirmed'&&input.value!==fact.value)throw new RepositoryError('CONFIRMATION_VALUE_MISMATCH',400);
 if(input.disposition==='corrected'){
  if(!input.reason.trim()||input.reason.length>2000||typeof input.value!=='string'||!input.value.trim()||input.value.length>1000)throw new RepositoryError('CORRECTION_REQUIRES_VALUE_AND_REASON',400);
  if((/(?:Payment|Outstanding)$/.test(fact.key)||fact.key==='statement.topUps')&&!/^\d+(\.\d{1,2})?$/.test(input.value))throw new RepositoryError('INVALID_MONEY',400);
  if(fact.key==='startedAtMonth'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.value))throw new RepositoryError('INVALID_MONTH',400);
  if(fact.key==='overdueDays'&&!/^\d{1,6}$/.test(input.value))throw new RepositoryError('INVALID_DAYS',400);
  // Identity cannot be corrected through a generic fact review; rebind the case explicitly instead.
  if(fact.key.startsWith('identity.'))throw new RepositoryError('IDENTITY_REBIND_REQUIRED');
 }
 if(input.disposition==='unresolved'&&(!input.reason.trim()||input.value!==null))throw new RepositoryError('UNRESOLVED_REQUIRES_REASON',400);
}
/** Use the same server-owned compatibility decision as document reopening. */
export async function compatibleReviewExtraction(repository:EvidenceRepository,record:CaseRow,document:DocumentRow,extraction:ExtractionRow){
 if(extraction.version===analysisVersion)return extraction.id;
 const cached=await repository.cached(record.id,document.original_sha256,analysisVersion);
 if(!cached||cached.extraction.id!==extraction.id)throw new RepositoryError('EXTRACTION_VERSION_CHANGED');
 return cached.extraction.id;
}
export async function reviewFact(repository:EvidenceRepository,record:CaseRow,document:DocumentRow,extraction:ExtractionRow,result:StoredResult,input:{requestId:string;factKey:string;value:unknown;disposition:'confirmed'|'corrected'|'unresolved';reason:string;identityRevision:number},actor:Actor,assessmentDay:string,compatibleExtractionId?:string){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.requestId))throw new RepositoryError('INVALID_REQUEST_ID',400);
 const accepted=compatibleExtractionId||await compatibleReviewExtraction(repository,record,document,extraction);
 assertReviewAllowed(record,document,extraction,result,input,assessmentDay,accepted);
 return repository.appendReview({...input,caseId:record.id,documentId:document.id,extractionId:extraction.id},actor);
}
