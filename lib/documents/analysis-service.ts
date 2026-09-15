import {readPdf,PDF_READER_VERSION}from'./read-pdf';import{extractNative,EXTRACTION_VERSION}from'./extract-native';import{gkbFreshness}from'./policy';import{operatingDay}from'./request-context';import type{EvidenceRepository,CaseRow,DocumentRow,ExtractionRow}from'./repository';import type{ClientContext}from'../crm/bitrix';import {RepositoryError}from'./repository';
import type{Actor}from'../worker-session';
import {requiresDocumentValidation,statementPeriod,salaryStatementPeriod,enpfPeriod}from'./policy';
import {checkPowerRepresentative}from'./power-validation';
export const analysisVersion=PDF_READER_VERSION+':'+EXTRACTION_VERSION;
export type Analysis={read:Awaited<ReturnType<typeof readPdf>>;extraction:ReturnType<typeof extractNative>};
export async function analysisResponse(client:ClientContext,record:CaseRow,repository:EvidenceRepository,stored:{document:DocumentRow;extraction:ExtractionRow;result:unknown},cacheHit:boolean){
 const{read,extraction}=stored.result as Analysis,today=operatingDay(),findings=[...extraction.findings];
 const powerValidation=extraction.kind==='power_of_attorney'?checkPowerRepresentative(extraction.power):null;
 if(powerValidation)findings.push(...powerValidation.findings);
 if(!client.iin)findings.push('DEAL_IDENTITY_UNVERIFIED');else if(!extraction.identity.iin)findings.push('DOCUMENT_IDENTITY_UNVERIFIED');else if(extraction.identity.iin!==client.iin)findings.push('WRONG_CLIENT');
 if(extraction.kind.startsWith('gkb_'))findings.push(...gkbFreshness(extraction.issuedAt||'',today).map(f=>f.code));
 if(extraction.kind==='kaspi')findings.push(...statementPeriod(extraction.bankStatement?.from||null,extraction.bankStatement?.to||null,today).map(f=>f.code));
 if(extraction.kind==='salary')findings.push(...salaryStatementPeriod(extraction.coverage?.from||null,extraction.coverage?.to||null,today).map(f=>f.code));
 if(extraction.kind==='enpf')findings.push(...enpfPeriod(extraction.coverage?.from||null,extraction.coverage?.to||null,extraction.issuedAt,today).map(f=>f.code));
 const blockers=['DEAL_IDENTITY_UNVERIFIED','DOCUMENT_IDENTITY_UNVERIFIED','WRONG_CLIENT','GKB_TOO_OLD','FUTURE_DOCUMENT_DATE','DATE_UNVERIFIED','PAGE_COMPLETENESS_UNVERIFIED'];
 const eligible=!requiresDocumentValidation(findings)&&!findings.some(f=>blockers.includes(f)||f.startsWith('STATEMENT_PERIOD_'));
 const reviews=eligible?await repository.currentReviews(record.id,stored.document.id,stored.extraction.id,record.identity_revision):[];
 return{reviews,client,document:{...read,extraction},powerValidation,assessmentDay:today,findings:[...new Set(findings)],eligibleForAutofill:eligible,reviewRequired:true,authenticity:'not_verified',persisted:true,caseId:record.id,identityRevision:record.identity_revision,documentId:stored.document.id,extractionId:stored.extraction.id,cacheHit};
}
export async function storedAnalysis(client:ClientContext,record:CaseRow,repository:EvidenceRepository,document:DocumentRow,actor:Actor,cacheOnly=false){
 const cached=await repository.cached(record.id,document.original_sha256,analysisVersion);if(cached)return analysisResponse(client,record,repository,cached,true);
 if(cacheOnly)throw new RepositoryError('CACHE_REPROCESS_REQUIRED',409);
 const bytes=await repository.original(document),read=await readPdf(bytes),extraction=extractNative(read.pages),stored=await repository.store(record.id,bytes,document.original_name,actor,analysisVersion,{read,extraction});
 return analysisResponse(client,record,repository,stored,false);
}
