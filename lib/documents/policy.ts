/** CRM-neutral rules. Evidence must be extracted/verified by trusted adapters. */
export type Finding = { code: string; severity: 'block' | 'review' };
/** These findings prevent both using extracted answers and confirming them. */
export const DOCUMENT_VALIDATION_BLOCKERS = [
  'PAGE_COMPLETENESS_UNVERIFIED',
  'SHORT_CREDIT_LIST_UNVERIFIED',
  'DOCUMENT_TYPE_UNVERIFIED',
  'OCR_OR_PAGE_REVIEW_REQUIRED',
  'STATEMENT_RECONCILIATION_REQUIRED',
  'POWER_AUTHORITY_REVIEW_REQUIRED',
  'REPRESENTATIVE_IDENTITY_UNVERIFIED',
  'REPRESENTATIVE_NOT_APPROVED',
] as const;
export function requiresDocumentValidation(findings: readonly string[]): boolean {
  return DOCUMENT_VALIDATION_BLOCKERS.some(code => findings.includes(code));
}
/** Accept a full rolling year, or the preceding twelve complete calendar months.
 * The end must reach the most recent completed month; future and older periods remain blocked. */
export function statementPeriod(from:string|null,to:string|null,assessmentDay:string):Finding[]{
 const assessment=parseDay(assessmentDay),start=from?parseDay(from):null,end=to?parseDay(to):null;
 if(!assessment||!start||!end)return [{code:'STATEMENT_PERIOD_UNVERIFIED',severity:'block'}];
 const latestCompletedMonth=new Date(Date.UTC(assessment.getUTCFullYear(),assessment.getUTCMonth(),0));
 const anniversary=new Date(Date.UTC(end.getUTCFullYear()-1,end.getUTCMonth(),Math.min(end.getUTCDate(),new Date(Date.UTC(end.getUTCFullYear()-1,end.getUTCMonth()+1,0)).getUTCDate())));
 const annual=start>=anniversary&&start.getTime()<=anniversary.getTime()+86400000;
 return annual&&end>=latestCompletedMonth&&end<=assessment?[]:[{code:'STATEMENT_PERIOD_NOT_ACCEPTABLE',severity:'block'}];
}
function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(result.getTime()) && result.toISOString().slice(0, 10) === value ? result : null;
}
export function gkbFreshness(issuedAt: string, assessmentDay: string, boundary: 'calendar-month' | '30-days' = '30-days'): Finding[] {
  const issued = parseDay(issuedAt), assessment = parseDay(assessmentDay);
  if (!issued || !assessment) return [{ code: 'DATE_UNVERIFIED', severity: 'block' }];
  if (issued > assessment) return [{ code: 'FUTURE_DOCUMENT_DATE', severity: 'block' }];
  let minimum: Date;
  if (boundary === '30-days') minimum = new Date(assessment.getTime() - 30 * 86400000);
  else {
    const lastDay = new Date(Date.UTC(assessment.getUTCFullYear(), assessment.getUTCMonth(), 0)).getUTCDate();
    minimum = new Date(Date.UTC(assessment.getUTCFullYear(), assessment.getUTCMonth() - 1, Math.min(assessment.getUTCDate(), lastDay)));
  }
  return issued < minimum ? [{ code: 'GKB_TOO_OLD', severity: 'block' }] : [];
}
export type Representative = { kind: 'person' | 'organization'; legalName: string; identifier: string };
export function representativeAllowed(found: Representative | null, approved: Representative[]): Finding[] {
  if (!found || !/^\d{12}$/.test(found.identifier)) return [{ code: 'REPRESENTATIVE_IDENTITY_UNVERIFIED', severity: 'block' }];
  const sameName = (a: string, b: string) => a.normalize('NFKC').toLocaleUpperCase('ru').replace(/\s+/g, ' ').trim() === b.normalize('NFKC').toLocaleUpperCase('ru').replace(/\s+/g, ' ').trim();
  return approved.some(a => a.kind === found.kind && a.identifier === found.identifier && sameName(a.legalName, found.legalName)) ? [] : [{ code: 'REPRESENTATIVE_NOT_APPROVED', severity: 'block' }];
}
export type DocumentEvidence = {
  id: string; sha256: string; clientId: string; kind: string;
  source: { system: string; externalId?: string }; extractedAt: string; extractionVersion: string;
  facts: Array<{ key: string; value: unknown; page: number; sourceText: string }>;
  verification: { identity: 'pending' | 'matched' | 'mismatch'; authenticity: 'not_checked' | 'verified' | 'failed'; findings: Finding[] };
};
export type ReviewRecord = { documentId: string; documentSha256: string; factKey: string; value: unknown; actorId: string; reviewedAt: string; extractionVersion: string; disposition: 'confirmed' | 'corrected' | 'unresolved' };
