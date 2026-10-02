// Add only native identity facts to an existing normalized draft. No inferred
// ownership, current employment, income, client answers or review approvals.
import {isDeepStrictEqual} from 'node:util';
import {digest, storedPayload} from './profile-source-fill.mjs';

const identityKinds = new Set(['identity', 'gkb_full', 'gkb_short', 'kaspi', 'benefits', 'enpf', 'property', 'encumbrance', 'salary', 'power_of_attorney']);
const targets = {'identity.iin': 'iin', 'identity.name': 'fio'};
const get = (answers, key) => answers.find(answer => answer.key === key);
const fail = code => { throw Object.assign(new Error(code), {code}); };

/** Call with the same history guard as planProfileSourceFill; revision 0 may be a new, empty draft. */
export function extendProfileDocumentFacts(draft, context, analyses, validateDraft, history = {protectedFields: []}) {
  if (!draft || draft.recovery || draft.identityRevision !== context.identityRevision || !/^\d{12}$/.test(context.client?.iin || '')) fail('CURRENT_IDENTITY_REQUIRED');
  const before = storedPayload(draft.payload), payload = validateDraft(before);
  // Normalize before calling. This helper must not introduce default answers or migrations.
  if (!isDeepStrictEqual(before, payload)) fail('DRAFT_NORMALIZATION_REQUIRED');
  const savedIin = get(payload.answers, 'iin')?.value.trim();
  if (savedIin && savedIin !== context.client.iin) fail('DRAFT_CLIENT_IDENTITY_CONFLICT');
  const selected = new Set(payload.documents.filter(document => document.person === 'Клиент' && !/Подписанный договор|ЭЦП|парол/iu.test(document.type)).map(document => document.documentId));
  const eligible = analyses.filter(analysis => {
    const document = analysis.document, extraction = document?.extraction;
    return selected.has(analysis.documentId) && analysis.caseId === context.caseId && analysis.identityRevision === context.identityRevision
      && analysis.persisted === true && analysis.eligibleForAutofill === true && typeof analysis.extractionId === 'string' && analysis.extractionId
      && identityKinds.has(extraction?.kind) && extraction.identity?.iin === context.client.iin
      && document.readAllPhysicalPages === true && Number.isInteger(document.totalPages) && document.totalPages > 0
      && Array.isArray(document.pages) && document.pages.length === document.totalPages && !document.pages.some(page => page.needsOcr)
      && typeof document.originalSha256 === 'string' && document.originalSha256 && (!document.format || document.format === 'application/pdf');
  });
  const sources = eligible.map(analysis => ({documentId: analysis.documentId, extractionId: analysis.extractionId, sha256: analysis.document.originalSha256, kind: analysis.document.extraction.kind, issuedAt: analysis.document.extraction.issuedAt ?? null}));
  const protectedFields = new Set((history.protectedFields || []).filter(field => !field.group).map(field => field.key));
  const candidates = new Map(), changes = [], skipped = [];
  // A newer document of the same kind supersedes its older identity spelling;
  // equally current sources and different document kinds must agree.
  for (const kind of identityKinds) {
    const documents = eligible.filter(analysis => analysis.document.extraction.kind === kind);
    const latest = documents.map(analysis => analysis.document.extraction.issuedAt || '').sort().at(-1);
    for (const analysis of documents.filter(analysis => (analysis.document.extraction.issuedAt || '') === latest)) {
      const extraction = analysis.document.extraction;
      for (const fact of extraction.facts || []) {
        const key = targets[fact.key];
        if (!key || typeof fact.value !== 'string' || !fact.value.trim() || !Number.isInteger(fact.page) || fact.page < 1 || fact.page > analysis.document.totalPages) continue;
        if (fact.key === 'identity.iin' && fact.value !== context.client.iin) continue;
        if (fact.key === 'identity.name' && fact.value !== extraction.identity.name) continue;
        const values = candidates.get(key) || [];
        values.push({value: fact.value, source: {documentId: analysis.documentId, extractionId: analysis.extractionId, sha256: analysis.document.originalSha256, factKey: fact.key, page: fact.page}});
        candidates.set(key, values);
      }
    }
  }
  for (const [key, values] of candidates) {
    const existing = get(payload.answers, key);
    if (existing && (existing.checked || existing.value.trim() || existing.sourceReplaced)) continue;
    if (get(payload.answers, 'unknown:' + key)?.checked) { skipped.push({key, code: 'EXPLICIT_UNKNOWN_PRESERVED'}); continue; }
    if (protectedFields.has(key)) { skipped.push({key, code: 'STAFF_CLEARED_VALUE_PRESERVED'}); continue; }
    if (new Set(values.map(candidate => candidate.value.trim())).size !== 1) { skipped.push({key, code: 'CONFLICTING_DOCUMENT_VALUES'}); continue; }
    const {value, source} = values[0];
    if (existing) existing.value = value; else payload.answers.push({key, value, checked: false});
    changes.push({key, value, source});
  }
  for (const answer of before.answers) if (!changes.some(change => change.key === answer.key) && !isDeepStrictEqual(answer, get(payload.answers, answer.key))) fail('EXISTING_ANSWER_CHANGED');
  for (const key of Object.keys(before).filter(key => key !== 'answers')) if (!isDeepStrictEqual(before[key], payload[key])) fail('PROTECTED_SECTION_CHANGED');
  if (!isDeepStrictEqual(validateDraft(payload), payload)) fail('FILLED_DRAFT_NORMALIZATION_REQUIRED');
  return {payload, changes, skipped, sources, beforeHash: digest(before), afterHash: digest(payload), planHash: digest({caseId: context.caseId, identityRevision: context.identityRevision, revision: draft.revision, before, payload, sources, history})};
}
