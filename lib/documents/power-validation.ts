import approved from './approved-representatives.server.json';
import {representativeAllowed,requiresDocumentValidation,type Representative} from './policy';
import {powerTemplateDetails} from './power-of-attorney';
import type {PowerParties} from './power-of-attorney';
import type {Analysis} from './analysis-service';
/** Matching authorized reference records does not verify execution, revocation or legal scope. */
export function checkPowerRepresentative(power:PowerParties|undefined){
 const findings=representativeAllowed(power?.representative||null,approved as Representative[]);
 return {representativeMatched:findings.length===0,authorityVerified:false,findings:findings.map(f=>f.code)};
}
/** Re-evaluate saved page text, so existing uploads benefit without reprocessing or losing reviews. */
export function checkPowerTemplate(analysis:Analysis,day:string){
 const matched=checkPowerRepresentative(analysis.extraction.power);
 const details=powerTemplateDetails(analysis.read.pages.map(page=>page.text).join('\n'));
 const findings=[...matched.findings];
 const pages=analysis.read.pages;
 if(!pages.length||pages.length!==analysis.read.totalPages||pages.some(page=>page.needsOcr)||requiresDocumentValidation(analysis.extraction.findings.filter(code=>code!=='POWER_AUTHORITY_REVIEW_REQUIRED')))findings.push('DOCUMENT_COMPLETENESS_UNVERIFIED');
 if(!analysis.extraction.power?.principal)findings.push('POWER_PRINCIPAL_UNVERIFIED');
 if(!details.issuedAt||!details.expiresAt)findings.push('POWER_DATES_UNVERIFIED');
 else if(details.issuedAt>day||details.expiresAt<day||details.expiresAt<details.issuedAt)findings.push('POWER_DATE_NOT_ACCEPTABLE');
 if(!details.standardScopeMatched)findings.push('POWER_SCOPE_REVIEW_REQUIRED');
 return {...matched,...details,accepted:findings.length===0,findings:[...new Set(findings)]};
}
