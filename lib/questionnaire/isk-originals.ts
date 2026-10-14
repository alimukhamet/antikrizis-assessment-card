import { EvidenceRepository, RepositoryError, type DocumentRow, type ExtractionRow } from '../documents/repository';
import { MAX_DOCUMENT_BYTES } from '../documents/read-document-limits';
import { validIin, type NativeExtraction } from '../documents/extract-native';
import type { PageText } from '../documents/read-pdf';

type LoanDate = { documentId: string; sha256: string; subjectIin: string; contractCode: string | null; contractNumber: string; startDate: string; disbursementDate: null; page: number; quote: string };

/** Only native, exact-day evidence for the same applicant; no saved answer changes. */
export function retainedLoanDates(document: DocumentRow, result: { extraction?: NativeExtraction; read?: { pages?: PageText[] } }, subjectIin: unknown): LoanDate[] {
  const extracted = result.extraction, pages = result.read?.pages;
  if (typeof subjectIin !== 'string' || !validIin(subjectIin) || extracted?.version !== 'rules-native-32' || extracted.kind !== 'gkb_full' || extracted.identity.iin !== subjectIin || !pages?.length || pages[0].needsOcr) return [];
  return extracted.credits.flatMap(credit => {
    const fact = credit.contractStartDate, page = pages.find(p => p.page === fact?.page);
    if (!fact || !/^\d{4}-\d{2}-\d{2}$/.test(fact.value) || !page || page.needsOcr || !fact.source || fact.source.length > 4000 || !page.text.includes(fact.source) || !credit.contractNumber || credit.contractNumber.length > 512 || (credit.contractCode?.length ?? 0) > 512) return [];
    const parsed = new Date(fact.value + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fact.value) return [];
    const printed = fact.value.slice(8) + '.' + fact.value.slice(5, 7) + '.' + fact.value.slice(0, 4);
    if (!fact.source.includes(printed)) return [];
    return [{ documentId: document.id, sha256: document.original_sha256, subjectIin, contractCode: credit.contractCode ?? null, contractNumber: credit.contractNumber, startDate: fact.value, disbursementDate: null, page: fact.page, quote: fact.source }];
  });
}

/** Original names are labels, never instructions or a source of ownership. */
export function iskOriginalType(document: DocumentRow): string | null {
  if (document.byte_size < 1 || document.byte_size > MAX_DOCUMENT_BYTES || !/^[a-f0-9]{64}$/.test(document.original_sha256)) return null;
  const name = document.original_name.toLowerCase();
  if (/\.(?:p12|pfx|jks|key|zip)(?:\.|$)/i.test(name)) return null;
  if (/\.pdf$/.test(name)) return 'application/pdf';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.jpe?g$/.test(name)) return 'image/jpeg';
  if (/\.sig$/.test(name)) return 'application/octet-stream';
  return null;
}

export async function iskOriginals(db: D1Database, files: R2Bucket, dealId: string, subjectIin: unknown) {
  const repository = new EvidenceRepository(db, files);
  const record = await repository.findCaseByExternal('bitrix', dealId);
  if (!record) throw new RepositoryError('PROFILE_NOT_FOUND', 404);
  const rows = await db.prepare('SELECT * FROM assessment_documents WHERE case_id=? ORDER BY created_at,id LIMIT 501').bind(record.id).all<DocumentRow>();
  if (rows.results.length > 500) throw new RepositoryError('ISK_ORIGINAL_LIMIT_EXCEEDED', 413);
  const loanDates: LoanDate[] = [];
  if (typeof subjectIin === 'string' && validIin(subjectIin)) {
    // No legacy reparsing and no remote OCR. Only newly retained full-date data.
    const extractions = await db.prepare(`SELECT e.* FROM assessment_extractions e JOIN assessment_documents d ON d.id=e.document_id
      WHERE d.case_id=? AND e.version LIKE 'native-pdf-%:rules-native-32'
      AND e.id=(SELECT x.id FROM assessment_extractions x WHERE x.document_id=e.document_id ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1)
      ORDER BY e.created_at,e.id LIMIT 501`).bind(record.id).all<ExtractionRow>();
    if (extractions.results.length > 500) throw new RepositoryError('ISK_ORIGINAL_LIMIT_EXCEEDED', 413);
    for (const extraction of extractions.results) {
      const document = rows.results.find(d => d.id === extraction.document_id);
      if (!document || !iskOriginalType(document)) continue;
      const result = await repository.readResult(extraction) as Parameters<typeof retainedLoanDates>[1];
      loanDates.push(...retainedLoanDates(document, result, subjectIin));
      if (loanDates.length > 1000) throw new RepositoryError('ISK_LOAN_DATE_LIMIT_EXCEEDED', 413);
    }
  }
  return {
    schema: 'antikrizis.isk-originals.v1',
    documents: rows.results.flatMap(document => {
      const content_type = iskOriginalType(document);
      return content_type ? [{ id: document.id, original_name: document.original_name, content_type, size_bytes: document.byte_size, sha256: document.original_sha256 }] : [];
    }),
    loanDates,
  };
}
