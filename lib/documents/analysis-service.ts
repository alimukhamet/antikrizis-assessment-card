import {readPdf}from'./read-pdf';import{extractNative}from'./extract-native';import{gkbFreshness}from'./policy';import{operatingDay}from'./request-context';import type{EvidenceRepository,CaseRow,DocumentRow,ExtractionRow}from'./repository';import type{ClientContext}from'../crm/bitrix';import {RepositoryError}from'./repository';
import type{Actor}from'../worker-session';
import {requiresDocumentValidation,statementPeriod,salaryStatementPeriod,enpfPeriod,enpfAllHistory}from'./policy';
import {checkPowerTemplate}from'./power-validation';
import {analysisVersion} from './analysis-version';
import {DOCUMENT_REVIEW_KEY,validateDocumentReview} from './document-review';
export {analysisVersion};
export type Analysis={read:Awaited<ReturnType<typeof readPdf>>;extraction:ReturnType<typeof extractNative>};
export async function analysisResponse(client:ClientContext,record:CaseRow,repository:EvidenceRepository,stored:{document:DocumentRow;extraction:ExtractionRow;result:unknown},cacheHit:boolean){
 const{read,extraction}=stored.result as Analysis,today=operatingDay(),findings=[...extraction.findings];
 const powerValidation=extraction.kind==='power_of_attorney'?checkPowerTemplate(stored.result as Analysis,today):null;
 if(powerValidation){findings.splice(0,findings.length,...findings.filter(code=>code!=='POWER_AUTHORITY_REVIEW_REQUIRED'),...powerValidation.findings);}
 if(!client.iin)findings.push('DEAL_IDENTITY_UNVERIFIED');else if(!extraction.identity.iin)findings.push('DOCUMENT_IDENTITY_UNVERIFIED');else if(extraction.identity.iin!==client.iin)findings.push('WRONG_CLIENT');
 if(extraction.kind.startsWith('gkb_'))findings.push(...gkbFreshness(extraction.issuedAt||'',today).map(f=>f.code));
 if(extraction.kind==='kaspi')findings.push(...statementPeriod(extraction.bankStatement?.from||null,extraction.bankStatement?.to||null,today).map(f=>f.code));
 if(extraction.kind==='salary')findings.push(...salaryStatementPeriod(extraction.coverage?.from||null,extraction.coverage?.to||null,today).map(f=>f.code));
 const allHistory=extraction.kind==='enpf'&&!extraction.coverage?.from&&!extraction.coverage?.to&&enpfAllHistory(read.pages?.[0]?.text||'');
 if(extraction.kind==='enpf')findings.push(...enpfPeriod(extraction.coverage?.from||null,extraction.coverage?.to||null,extraction.issuedAt,today,read.pages?.[0]?.text||'').map(f=>f.code));
 const blockers=['DEAL_IDENTITY_UNVERIFIED','DOCUMENT_IDENTITY_UNVERIFIED','WRONG_CLIENT','GKB_TOO_OLD','FUTURE_DOCUMENT_DATE','DATE_UNVERIFIED','PAGE_COMPLETENESS_UNVERIFIED'];
 const eligible=(!powerValidation||powerValidation.accepted)&&!requiresDocumentValidation(findings)&&!findings.some(f=>blockers.includes(f)||f.startsWith('STATEMENT_PERIOD_'));
 // A missing CRM identity must not discard readable report proposals. They may
 // fill a draft only after the employee confirms its owner, never become reviews.
 const draftEligible=!client.iin&&!!extraction.identity.iin&&extraction.kind.startsWith('gkb_')&&extraction.creditList?.complete===true&&!requiresDocumentValidation(findings)&&!findings.some(f=>f!=='DEAL_IDENTITY_UNVERIFIED'&&blockers.includes(f));
 const reviews=eligible?await repository.currentReviews(record.id,stored.document.id,stored.extraction.id,record.identity_revision):[];
 let documentReview=null,reviewedDates=null;
 if(!extraction.kind.startsWith('gkb_')&&client.iin&&(!extraction.identity.iin||extraction.identity.iin===client.iin)){
  const current=eligible?reviews:await repository.currentReviews(record.id,stored.document.id,stored.extraction.id,record.identity_revision);
  const saved=current.find(review=>review.fact_key===DOCUMENT_REVIEW_KEY);
  if(saved)try{const value=validateDocumentReview(JSON.parse(saved.value_json),stored.result as Analysis,record,today);documentReview={reviewId:saved.id,type:value.type,actorId:saved.actor_id,reviewedAt:saved.created_at};reviewedDates={issuedAt:value.issuedAt,expiresAt:value.expiresAt,from:value.from,to:value.to};}catch(error){if(!(error instanceof RepositoryError||error instanceof SyntaxError))throw error;}
 }
 const reviewContext={iin:extraction.identity.iin||client.iin||'',pages:read.totalPages,issuedAt:powerValidation?.issuedAt||extraction.issuedAt||'',expiresAt:powerValidation?.expiresAt||'',from:extraction.coverage?.from||extraction.bankStatement?.from||'',to:extraction.coverage?.to||extraction.bankStatement?.to||(allHistory?extraction.issuedAt:'')||'',allHistory,representative:extraction.power?.representative||null,...reviewedDates};
 return{reviews,documentReview,reviewContext,client,document:{...read,extraction},powerValidation,assessmentDay:today,findings:[...new Set(findings)],eligibleForAutofill:eligible,eligibleForDraftAutofill:draftEligible,reviewRequired:true,authenticity:'not_verified',persisted:true,caseId:record.id,identityRevision:record.identity_revision,documentId:stored.document.id,extractionId:stored.extraction.id,cacheHit};
}
export async function storedAnalysis(client:ClientContext,record:CaseRow,repository:EvidenceRepository,document:DocumentRow,actor:Actor,cacheOnly=false){
 const cached=await repository.cached(record.id,document.original_sha256,analysisVersion);if(cached)return analysisResponse(client,record,repository,cached,true);
 if(cacheOnly)throw new RepositoryError('CACHE_REPROCESS_REQUIRED',409);
 const bytes=await repository.original(document),read=await readPdf(bytes),extraction=extractNative(read.pages),stored=await repository.store(record.id,bytes,document.original_name,actor,analysisVersion,{read,extraction});
 return analysisResponse(client,record,repository,stored,false);
}
