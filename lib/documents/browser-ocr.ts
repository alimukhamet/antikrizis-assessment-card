import { extractNative } from './extract-native';
import { analysisVersionForDocument, analysisVersionForFormat, type Analysis } from './analysis-service';
import { RepositoryError, sha256, type CaseRow, type DocumentRow, type EvidenceRepository } from './repository';
import type { Actor } from '../worker-session';

// Pinned to the exact browser runtime/models. Changing this keeps old OCR intact.
export const BROWSER_OCR_ENGINE_VERSION = 'paddleocr-js-0.4.2-cyrillic-v1';
export const BROWSER_OCR_LEASE_MS = 120_000;
export const BROWSER_OCR_MAX_REQUEST_BYTES = 1_000_000;
const MAX_RESULT_BYTES = 250_000, STATUS_RESULT_BYTES = 200_000, STATUS_RESULT_PAGES = 32, SUGGESTION_RESULT_BYTES = 750_000;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const forbiddenControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export type BrowserOcrLine = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type BrowserOcrPage = { page: number; text: string; lines: BrowserOcrLine[]; confidence: number; width: number; height: number };
export type BrowserOcrSource = { record: CaseRow; document: DocumentRow; analysis: Analysis; eligiblePages: number[] };
type LeaseRow = { document_id: string; case_id: string; original_sha256: string; engine_version: string; identity_revision: number; token_hash: string; actor_id: string; actor_name: string; expires_at: number; updated_at: number };
type PageSummary = { page_number: number; result_sha256: string; result_bytes: number; character_count: number; confidence: number; state: 'completed' | 'needs_manual'; actor_id: string; created_at: number };
type PageRow = PageSummary & { result_json: string; token_hash: string };
const scopeSql = 'case_id=? AND document_id=? AND original_sha256=? AND engine_version=? AND identity_revision=?';

function scope(source: BrowserOcrSource) {
  return [source.record.id, source.document.id, source.document.original_sha256, BROWSER_OCR_ENGINE_VERSION, source.record.identity_revision];
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryError('OCR_INVALID_INPUT', 400);
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new RepositoryError('OCR_INVALID_INPUT', 400);
  return value;
}
function finite(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RepositoryError('OCR_INVALID_INPUT', 400);
  return value;
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max || forbiddenControl.test(value)) throw new RepositoryError('OCR_INVALID_TEXT', 400);
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
}
function leaseToken(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new RepositoryError('OCR_INVALID_LEASE_TOKEN', 400);
  return value;
}

/** Only a hash-verified current native read can nominate scanned pages. */
export async function browserOcrSource(repository: EvidenceRepository, record: CaseRow, documentId: string): Promise<BrowserOcrSource> {
  const document = await repository.document(record.id, documentId);
  if (!document) throw new RepositoryError('DOCUMENT_NOT_IN_CASE', 404);
  const cached = await repository.cached(record.id, document.original_sha256, analysisVersionForDocument(document));
  if (!cached) throw new RepositoryError('CACHE_REPROCESS_REQUIRED');
  const analysis = cached.result as Analysis, read = analysis?.read;
  if (!read || read.originalSha256 !== document.original_sha256 || !hash.test(read.pdfSha256 || '') || read.readAllPhysicalPages !== true ||
      !Number.isSafeInteger(read.totalPages) || read.totalPages < 1 || read.totalPages > 1000 || !Array.isArray(read.pages) || read.pages.length !== read.totalPages ||
      read.pages.some((page, index) => page.page !== index + 1 || typeof page.text !== 'string' || typeof page.needsOcr !== 'boolean')) {
    throw new RepositoryError('OCR_NATIVE_READ_INCOMPLETE');
  }
  return { record, document, analysis, eligiblePages: read.pages.filter(page => page.needsOcr).map(page => page.page) };
}

export function validateBrowserOcrPin(body: Record<string, unknown>, source: BrowserOcrSource) {
  if (body.identityRevision !== source.record.identity_revision) throw new RepositoryError('CASE_IDENTITY_CHANGED');
  if (body.originalSha256 !== source.document.original_sha256) throw new RepositoryError('OCR_DOCUMENT_CHANGED');
  if (body.engineVersion !== BROWSER_OCR_ENGINE_VERSION) throw new RepositoryError('OCR_ENGINE_CHANGED');
}

/** Discard extra client keys; page text is backed by the submitted spatial lines. */
export function validateBrowserOcrPage(value: unknown, source: BrowserOcrSource): BrowserOcrPage {
  const input = object(value), page = integer(input.page, 1, source.analysis.read.totalPages);
  if (!source.eligiblePages.includes(page)) throw new RepositoryError('OCR_PAGE_NOT_ELIGIBLE', 400);
  const width = integer(input.width, 1, 20_000), height = integer(input.height, 1, 20_000);
  if (width * height > 60_000_000 || !Array.isArray(input.lines) || input.lines.length > 3000) throw new RepositoryError('OCR_INVALID_INPUT', 400);
  const lines = input.lines.map(value => {
    const line = object(value), box = object(line.bbox), lineText = text(line.text, 4000);
    if (!lineText || /\n/u.test(lineText)) throw new RepositoryError('OCR_INVALID_TEXT', 400);
    const bbox = { x0: finite(box.x0, 0, width), y0: finite(box.y0, 0, height), x1: finite(box.x1, 0, width), y1: finite(box.y1, 0, height) };
    if (bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0) throw new RepositoryError('OCR_INVALID_BOUNDS', 400);
    return { text: lineText, confidence: finite(line.confidence, 0, 1), bbox };
  });
  const suppliedText = text(input.text, 100_000), joined = lines.map(line => line.text).join('\n');
  if (joined.length > 100_000 || suppliedText.replace(/\s+/gu, ' ') !== joined.replace(/\s+/gu, ' ')) throw new RepositoryError('OCR_TEXT_LINES_MISMATCH', 400);
  finite(input.confidence, 0, 1);
  const confidence = lines.length ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length : 0;
  const result = { page, text: joined, lines, confidence, width, height };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_RESULT_BYTES) throw new RepositoryError('OCR_PAGE_TOO_LARGE', 413);
  return result;
}

export class BrowserOcrRepository {
  constructor(private db: D1Database, private now: () => number = Date.now) {}

  private async current(source: BrowserOcrSource) {
    const current = await this.db.prepare('SELECT d.id FROM assessment_documents d JOIN assessment_cases c ON c.id=d.case_id WHERE d.id=? AND d.case_id=? AND d.original_sha256=? AND c.identity_revision=?')
      .bind(source.document.id, source.record.id, source.document.original_sha256, source.record.identity_revision).first();
    if (!current) throw new RepositoryError('CASE_IDENTITY_CHANGED');
  }
  private lease(source: BrowserOcrSource) {
    return this.db.prepare(`SELECT * FROM assessment_browser_ocr_leases WHERE ${scopeSql}`).bind(...scope(source)).first<LeaseRow>();
  }
  private summary(source: BrowserOcrSource) {
    return this.db.prepare(`SELECT page_number,result_sha256,result_bytes,character_count,confidence,state,actor_id,created_at FROM assessment_browser_ocr_pages WHERE ${scopeSql} ORDER BY page_number`).bind(...scope(source)).all<PageSummary>();
  }
  private page(source: BrowserOcrSource, page: number) {
    return this.db.prepare(`SELECT * FROM assessment_browser_ocr_pages WHERE ${scopeSql} AND page_number=?`).bind(...scope(source), page).first<PageRow>();
  }
  private async pageResponse(row: PageRow) {
    if (await sha256(row.result_json) !== row.result_sha256) throw new RepositoryError('OCR_RESULT_INTEGRITY_FAILED', 503);
    return { ...JSON.parse(row.result_json) as BrowserOcrPage, resultSha256: row.result_sha256, state: row.state, characterCount: row.character_count, reviewNeeded: true as const, savedAt: new Date(row.created_at).toISOString() };
  }

  async status(source: BrowserOcrSource, actor: Actor, options: { page?: number; suggestions?: boolean } = {}) {
    await this.current(source);
    if (options.page !== undefined && (!Number.isSafeInteger(options.page) || !source.eligiblePages.includes(options.page))) throw new RepositoryError('OCR_PAGE_NOT_ELIGIBLE', 400);
    const [summary, lease] = await Promise.all([this.summary(source), this.lease(source)]), now = this.now();
    const rows = summary.results, completed = new Set(rows.map(row => row.page_number));
    const pendingPages = source.eligiblePages.filter(page => !completed.has(page));
    const selectedPages: number[] = []; let bytes = 0;
    for (const row of rows) {
      if (options.page !== undefined && row.page_number !== options.page) continue;
      if (options.page === undefined && (selectedPages.length >= STATUS_RESULT_PAGES || bytes + row.result_bytes > STATUS_RESULT_BYTES)) break;
      selectedPages.push(row.page_number); bytes += row.result_bytes;
    }
    // A long document with tiny/empty results must not make a query per page.
    // Explicit page reads retain the full individual result, including pages
    // too large for the default preview budget.
    const details = selectedPages.length ? (await this.db.prepare(`SELECT * FROM assessment_browser_ocr_pages WHERE ${scopeSql} AND page_number IN (${selectedPages.map(() => '?').join(',')}) ORDER BY page_number`)
      .bind(...scope(source), ...selectedPages).all<PageRow>()).results : [];
    const pages = await Promise.all(details.map(row => this.pageResponse(row)));
    // Large scans remain resumable page by page. A bounded suggestion preview
    // must never pretend that a prefix of the document is a complete report.
    const suggestionBytes = rows.reduce((sum, row) => sum + row.result_bytes, 0);
    let suggestions = null;
    let suggestionsUnavailable: string | null = null;
    if (options.suggestions !== false && rows.length) {
      if (suggestionBytes > SUGGESTION_RESULT_BYTES) suggestionsUnavailable = 'OCR_SUGGESTIONS_SIZE_LIMIT';
      else {
        const all = await this.db.prepare(`SELECT * FROM assessment_browser_ocr_pages WHERE ${scopeSql} ORDER BY page_number`).bind(...scope(source)).all<PageRow>();
        const savedPages = new Map<number, BrowserOcrPage>();
        for (const row of all.results) savedPages.set(row.page_number, await this.pageResponse(row));
        const merged = source.analysis.read.pages.map(page => {
          const saved = savedPages.get(page.page);
          return saved?.text ? { ...page, text: saved.text, layoutText: saved.text, nativeCharacters: 0, needsOcr: false } : page;
        });
        const extraction = extractNative(merged);
        const complete = !pendingPages.length && rows.every(row => row.state === 'completed');
        const candidate = { extraction: { ...extraction, findings: [...new Set([...extraction.findings, 'OCR_UNVERIFIED', ...(!complete ? ['OCR_INCOMPLETE'] : [])])] }, reviewNeeded: true, eligibleForAutofill: false, complete, source: 'native-and-browser-ocr', ocrPages: [...savedPages.keys()] };
        if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_RESULT_BYTES) suggestionsUnavailable = 'OCR_SUGGESTIONS_SIZE_LIMIT';
        else suggestions = candidate;
      }
    }
    await this.current(source);
    return {
      documentId: source.document.id, caseId: source.record.id, identityRevision: source.record.identity_revision,
      originalSha256: source.document.original_sha256, hash: source.document.original_sha256,
      pdfSha256: source.analysis.read.pdfSha256, pdfHash: source.analysis.read.pdfSha256,
      totalPages: source.analysis.read.totalPages, format: source.analysis.read.format || 'application/pdf',
      engineVersion: BROWSER_OCR_ENGINE_VERSION, nativeAnalysisVersion: analysisVersionForFormat(source.analysis.read.format),
      eligiblePages: source.eligiblePages, pendingPages,
      completedPages: rows.map(row => ({ page: row.page_number, confidence: row.confidence, characterCount: row.character_count, resultSha256: row.result_sha256, state: row.state })),
      pages, pagesTruncated: options.page === undefined && pages.length < rows.length,
      lease: lease && lease.expires_at > now ? { actorId: lease.actor_id, displayName: lease.actor_name, expiresAt: new Date(lease.expires_at).toISOString(), mine: lease.actor_id === actor.id } : null,
      suggestions, suggestionsUnavailable, reviewNeeded: true, authenticity: 'not_verified', complete: !pendingPages.length,
    };
  }

  async claim(source: BrowserOcrSource, actor: Actor, token: unknown) {
    const candidate = leaseToken(token), tokenHash = await sha256(candidate), now = this.now();
    await this.current(source);
    const completed = (await this.summary(source)).results;
    if (source.eligiblePages.every(page => completed.some(row => row.page_number === page))) return { claimed: false, complete: true, leaseToken: null };
    // One conditional statement decides the winner across all tabs/employees.
    // A new identity may replace an old lease, but never reuse its page results.
    await this.db.prepare(`INSERT INTO assessment_browser_ocr_leases (document_id,case_id,original_sha256,engine_version,identity_revision,token_hash,actor_id,actor_name,expires_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM assessment_documents d JOIN assessment_cases c ON c.id=d.case_id WHERE d.id=? AND d.case_id=? AND d.original_sha256=? AND c.identity_revision=?)
      ON CONFLICT(document_id) DO UPDATE SET case_id=excluded.case_id,original_sha256=excluded.original_sha256,engine_version=excluded.engine_version,identity_revision=excluded.identity_revision,token_hash=excluded.token_hash,actor_id=excluded.actor_id,actor_name=excluded.actor_name,expires_at=excluded.expires_at,updated_at=excluded.updated_at
      WHERE assessment_browser_ocr_leases.expires_at<=? OR assessment_browser_ocr_leases.identity_revision<>excluded.identity_revision
      OR (assessment_browser_ocr_leases.token_hash=excluded.token_hash AND assessment_browser_ocr_leases.actor_id=excluded.actor_id)`)
      .bind(source.document.id, source.record.id, source.document.original_sha256, BROWSER_OCR_ENGINE_VERSION, source.record.identity_revision, tokenHash, actor.id, actor.displayName.slice(0, 100), now + BROWSER_OCR_LEASE_MS, now,
        source.document.id, source.record.id, source.document.original_sha256, source.record.identity_revision, now).run();
    await this.current(source);
    const lease = await this.lease(source), claimed = !!lease && lease.token_hash === tokenHash && lease.actor_id === actor.id && lease.expires_at > now;
    return { claimed, complete: false, leaseToken: claimed ? candidate : null };
  }

  async renew(source: BrowserOcrSource, actor: Actor, token: unknown) {
    const tokenHash = await sha256(leaseToken(token)), now = this.now();
    await this.db.prepare(`UPDATE assessment_browser_ocr_leases SET expires_at=?,updated_at=? WHERE ${scopeSql} AND token_hash=? AND actor_id=? AND expires_at>? AND EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?)`)
      .bind(now + BROWSER_OCR_LEASE_MS, now, ...scope(source), tokenHash, actor.id, now, source.record.id, source.record.identity_revision).run();
    await this.current(source);
    const lease = await this.lease(source);
    if (!lease || lease.token_hash !== tokenHash || lease.actor_id !== actor.id || lease.expires_at <= now) throw new RepositoryError('OCR_LEASE_LOST');
    return { renewed: true };
  }

  async release(source: BrowserOcrSource, actor: Actor, token: unknown) {
    const tokenHash = await sha256(leaseToken(token)), now = this.now();
    await this.current(source);
    const lease = await this.lease(source);
    if (!lease || lease.token_hash !== tokenHash || lease.actor_id !== actor.id) throw new RepositoryError('OCR_LEASE_LOST');
    await this.db.prepare(`UPDATE assessment_browser_ocr_leases SET expires_at=0,updated_at=? WHERE ${scopeSql} AND token_hash=? AND actor_id=? AND EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?)`)
      .bind(now, ...scope(source), tokenHash, actor.id, source.record.id, source.record.identity_revision).run();
    await this.current(source);
    return { released: true };
  }

  async savePage(source: BrowserOcrSource, actor: Actor, token: unknown, input: unknown) {
    const candidate = validateBrowserOcrPage(input, source), tokenHash = await sha256(leaseToken(token)), now = this.now();
    const json = JSON.stringify(candidate), resultHash = await sha256(json), bytes = new TextEncoder().encode(json).byteLength;
    await this.current(source);
    const existing = await this.page(source, candidate.page);
    if (existing) {
      // Reconcile a lost successful response even if its lease expired later.
      // This never updates the row or permits a different tab to overwrite it.
      if (existing.actor_id !== actor.id || existing.token_hash !== tokenHash) throw new RepositoryError('OCR_PAGE_ALREADY_COMPLETED');
      if (existing.result_sha256 !== resultHash) throw new RepositoryError('OCR_PAGE_IMMUTABLE');
      return { saved: true, reused: true, page: await this.pageResponse(existing) };
    }
    const characterCount = candidate.text.replace(/\s/gu, '').length;
    const state = !characterCount || candidate.confidence < 0.65 ? 'needs_manual' : 'completed';
    await this.db.prepare(`INSERT INTO assessment_browser_ocr_pages (case_id,document_id,original_sha256,engine_version,identity_revision,page_number,result_json,result_sha256,result_bytes,character_count,confidence,state,actor_id,token_hash,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM assessment_browser_ocr_leases l JOIN assessment_cases c ON c.id=l.case_id JOIN assessment_documents d ON d.id=l.document_id AND d.case_id=c.id WHERE l.case_id=? AND l.document_id=? AND l.original_sha256=? AND l.engine_version=? AND l.identity_revision=? AND l.token_hash=? AND l.actor_id=? AND l.expires_at>? AND c.identity_revision=l.identity_revision AND d.original_sha256=l.original_sha256)
      ON CONFLICT(case_id,document_id,original_sha256,engine_version,identity_revision,page_number) DO NOTHING`)
      .bind(...scope(source), candidate.page, json, resultHash, bytes, characterCount, candidate.confidence, state, actor.id, tokenHash, now, ...scope(source), tokenHash, actor.id, now).run();
    await this.current(source);
    const saved = await this.page(source, candidate.page);
    if (!saved) throw new RepositoryError('OCR_LEASE_LOST');
    if (saved.result_sha256 !== resultHash) throw new RepositoryError('OCR_PAGE_IMMUTABLE');
    if (saved.actor_id !== actor.id || saved.token_hash !== tokenHash) throw new RepositoryError('OCR_PAGE_ALREADY_COMPLETED');
    return { saved: true, reused: false, page: await this.pageResponse(saved) };
  }
}
