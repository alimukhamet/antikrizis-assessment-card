import {PDF_READER_VERSION}from'./read-pdf';import {readDocument,originalDocumentFormat,type DocumentRead}from'./read-document';import {IMAGE_READER_VERSION}from'./read-image';import{extractNative,identityCardDates}from'./extract-native';import{gkbFreshness}from'./policy';import{operatingDay}from'./request-context';import type{EvidenceRepository,CaseRow,DocumentRow,ExtractionRow}from'./repository';import type{ClientContext}from'../crm/bitrix';import {RepositoryError}from'./repository';
import type{Actor}from'../worker-session';
import {requiresDocumentValidation,statementPeriod,salaryStatementPeriod,enpfPeriod,enpfAllHistory}from'./policy';
import {checkPowerTemplate}from'./power-validation';
import {analysisVersion} from './analysis-version';
import {DOCUMENT_REVIEW_KEY,validateDocumentReview} from './document-review';
export {analysisVersion};
export function analysisVersionForFormat(format?:string){return format?.startsWith('image/')?IMAGE_READER_VERSION+analysisVersion.slice(PDF_READER_VERSION.length):analysisVersion;}
export function analysisVersionForDocument(document:Pick<DocumentRow,'original_key'>){return analysisVersionForFormat(originalDocumentFormat(document));}
export type Analysis={read:DocumentRead;extraction:ReturnType<typeof extractNative>};
/** Saved-original inspection defaults, shared by analysis and package checking. */
export function documentReviewContext(analysis:Analysis,iin:string,today:string,reviewed?:{issuedAt:string;expiresAt:string;from:string;to:string;representative?:unknown}|null){
 const {read,extraction}=analysis;
 const power=extraction.kind==='power_of_attorney'?checkPowerTemplate(analysis,today):null;
 const identity=extraction.kind==='identity'?identityCardDates(read.pages):null;
 const allHistory=extraction.kind==='enpf'&&!extraction.coverage?.from&&!extraction.coverage?.to&&enpfAllHistory(read.pages?.[0]?.text||'');
 return {iin:extraction.identity.iin||iin||'',pages:read.totalPages,issuedAt:reviewed?.issuedAt??power?.issuedAt??identity?.issuedAt??extraction.issuedAt??'',expiresAt:reviewed?.expiresAt??power?.expiresAt??identity?.expiresAt??extraction.expiresAt??'',from:reviewed?.from??extraction.coverage?.from??extraction.bankStatement?.from??'',to:reviewed?.to??extraction.coverage?.to??extraction.bankStatement?.to??(allHistory?extraction.issuedAt:'')??'',allHistory,representative:reviewed?.representative??extraction.power?.representative??null};
}
export async function analysisResponse(client:ClientContext,record:CaseRow,repository:EvidenceRepository,stored:{document:DocumentRow;extraction:ExtractionRow;result:unknown},cacheHit:boolean){
 const{read,extraction}=stored.result as Analysis,today=operatingDay(),findings=[...extraction.findings];
 const powerValidation=extraction.kind==='power_of_attorney'?checkPowerTemplate(stored.result as Analysis,today):null;
 if(powerValidation){findings.splice(0,findings.length,...findings.filter(code=>code!=='POWER_AUTHORITY_REVIEW_REQUIRED'),...powerValidation.findings);}
 if(!client.iin)findings.push('DEAL_IDENTITY_UNVERIFIED');else if(!extraction.identity.iin)findings.push('DOCUMENT_IDENTITY_UNVERIFIED');else if(extraction.identity.iin!==client.iin)findings.push('WRONG_CLIENT');
 if(extraction.kind.startsWith('gkb_'))findings.push(...gkbFreshness(extraction.issuedAt||'',today).map(f=>f.code));
 if(extraction.kind==='kaspi')findings.push(...statementPeriod(extraction.bankStatement?.from||null,extraction.bankStatement?.to||null,today).map(f=>f.code));
 if(extraction.kind==='salary')findings.push(...salaryStatementPeriod(extraction.coverage?.from||null,extraction.coverage?.to||null,today).map(f=>f.code));
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
 const reviewContext=documentReviewContext(stored.result as Analysis,client.iin||'',today,reviewedDates);
 return{reviews,documentReview,reviewContext,client,document:{...read,extraction},powerValidation,assessmentDay:today,findings:[...new Set(findings)],eligibleForAutofill:eligible,eligibleForDraftAutofill:draftEligible,reviewRequired:true,authenticity:'not_verified',persisted:true,caseId:record.id,identityRevision:record.identity_revision,documentId:stored.document.id,extractionId:stored.extraction.id,cacheHit};
}
export async function storedAnalysis(client:ClientContext,record:CaseRow,repository:EvidenceRepository,document:DocumentRow,actor:Actor,cacheOnly=false){
 const cached=await repository.cached(record.id,document.original_sha256,analysisVersion);if(cached)return analysisResponse(client,record,repository,cached,true);
 if(cacheOnly)throw new RepositoryError('CACHE_REPROCESS_REQUIRED',409);
 const readerVersion=originalDocumentFormat(document)==='application/pdf'?PDF_READER_VERSION:IMAGE_READER_VERSION;
 const previous=await repository.previousAnalysis(document,readerVersion),saved=(previous?.result as Analysis|undefined)?.read;
 // Rule changes can reuse hash-verified native pages. Re-read the original only
 // if the PDF reader changed or the saved read is incomplete/inconsistent.
 const reusable=saved?.readerVersion===readerVersion&&saved.originalSha256===document.original_sha256&&saved.readAllPhysicalPages===true&&saved.pages.length===saved.totalPages;
 const read=reusable?saved:await readDocument(await repository.original(document)),extraction=extractNative(read.pages),stored=await repository.storeExtraction(document,analysisVersionForFormat(read.format),{read,extraction});
 return analysisResponse(client,record,repository,stored,false);
}
