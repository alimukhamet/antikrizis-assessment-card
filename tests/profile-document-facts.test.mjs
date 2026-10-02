import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {extendProfileDocumentFacts} from '../scripts/profile-document-facts.mjs';

const built = buildSync({entryPoints: ['lib/questionnaire/draft.ts'], bundle: true, platform: 'node', format: 'esm', write: false});
const {validateDraft} = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const iin = '991231300003', context = {caseId: 'case', identityRevision: 1, client: {iin}};
function fixture(kind = 'enpf') {
  const draft = {revision: 0, identityRevision: 1, payload: validateDraft({schemaVersion: 1, answers: [], groups: [], docContext: {social: '', salary: ''}, documents: [{documentId: 'doc', type: 'Справка ЕНПФ', person: 'Клиент'}], pendingFiles: []})};
  const analysis = {documentId: 'doc', extractionId: 'extraction', caseId: 'case', identityRevision: 1, persisted: true, eligibleForAutofill: true, document: {format: 'application/pdf', readAllPhysicalPages: true, totalPages: 1, pages: [{page: 1, needsOcr: false}], originalSha256: 'synthetic-hash', extraction: {kind, issuedAt: '2026-10-01', identity: {iin, name: 'SYNTHETIC PERSON'}, facts: [{key: 'identity.iin', value: iin, page: 1}, {key: 'identity.name', value: 'SYNTHETIC PERSON', page: 1}], credits: []}}};
  return {draft, analysis, run(history) { return extendProfileDocumentFacts(draft, context, [analysis], validateDraft, history); }};
}
test('additional native document kinds supply only exact identity facts and retain source references', () => {
  for (const kind of ['enpf', 'property', 'encumbrance', 'salary', 'power_of_attorney']) {
    const f = fixture(kind), before = structuredClone(f.draft.payload);
    f.analysis.document.extraction.facts.push({key: 'employment.payersCount', value: '2', page: 1}, {key: 'property.absent', value: 'true', page: 1});
    const result = f.run();
    assert.deepEqual(result.changes.map(change => change.key), ['iin', 'fio']);
    assert.ok(result.changes.every(change => change.source.documentId === 'doc' && change.source.extractionId === 'extraction' && change.source.sha256 === 'synthetic-hash' && change.source.page === 1));
    assert.ok(result.payload.answers.every(answer => !answer.checked));
    assert.deepEqual(f.draft.payload, before, 'pure helper does not mutate the input');
    assert.deepEqual(result.payload.groups, before.groups); assert.deepEqual(result.payload.docContext, before.docContext);
    f.draft.payload = result.payload; assert.equal(f.run().changes.length, 0, 'repeat is idempotent');
  }
});
test('source scope, identity, persistence, complete pages and eligibility are mandatory', () => {
  for (const alter of [f => f.analysis.documentId = 'other', f => f.draft.payload.documents[0].person = 'Супруг(а)', f => f.draft.payload.documents[0].type = 'Подписанный договор', f => f.analysis.caseId = 'other', f => f.analysis.identityRevision = 2, f => f.analysis.persisted = false, f => f.analysis.eligibleForAutofill = false, f => f.analysis.document.extraction.identity.iin = 'other', f => f.analysis.document.readAllPhysicalPages = false, f => f.analysis.document.totalPages = 2, f => f.analysis.document.pages[0].needsOcr = true, f => f.analysis.document.format = 'image/png', f => f.analysis.document.originalSha256 = '', f => f.analysis.extractionId = '', f => f.analysis.document.extraction.kind = 'unknown']) {
    const f = fixture(); alter(f); assert.equal(f.run().changes.length, 0);
  }
});
test('existing values, checked answers, source replacement and explicit prior clears survive', () => {
  for (const answer of [{key: 'fio', value: 'STAFF NAME', checked: false}, {key: 'fio', value: '', checked: true}, {key: 'fio', value: '', checked: false, sourceReplaced: true}]) {
    const f = fixture(); f.draft.payload.answers.push(answer);
    assert.deepEqual(f.run().payload.answers.find(value => value.key === 'fio'), answer);
  }
  const f = fixture(), result = f.run({protectedFields: [{key: 'fio'}]});
  assert.equal(result.changes.some(change => change.key === 'fio'), false);
  assert.ok(result.skipped.some(change => change.code === 'STAFF_CLEARED_VALUE_PRESERVED'));
});
test('an explicit unknown control and all unrelated choices remain unchanged', () => {
  const f = fixture(); f.draft.payload.answers.push({key: 'unknown:fio', value: 'on', checked: true});
  const result = extendProfileDocumentFacts(f.draft, context, [f.analysis], value => structuredClone(value));
  assert.equal(result.changes.some(change => change.key === 'fio'), false);
  assert.ok(result.skipped.some(change => change.code === 'EXPLICIT_UNKNOWN_PRESERVED'));
  assert.deepEqual(result.payload.answers[0], f.draft.payload.answers[0]);
});
test('equally current or different-kind identity disagreement cannot fill a blank name', () => {
  for (const kind of ['enpf', 'property']) {
    const f = fixture(), other = structuredClone(f.analysis);
    other.documentId = 'other'; other.document.extraction.kind = kind; other.document.extraction.identity.name = 'OTHER PERSON'; other.document.extraction.facts[1].value = 'OTHER PERSON';
    f.draft.payload.documents.push({documentId: 'other', type: 'Другой документ', person: 'Клиент'});
    const result = extendProfileDocumentFacts(f.draft, context, [f.analysis, other], validateDraft);
    assert.equal(result.changes.some(change => change.key === 'fio'), false);
    assert.ok(result.skipped.some(change => change.code === 'CONFLICTING_DOCUMENT_VALUES'));
  }
});
test('only the latest same-kind source supplies identity and malformed fact references are ignored', () => {
  const f = fixture(), old = structuredClone(f.analysis);
  old.documentId = 'old'; old.document.extraction.issuedAt = '2026-09-01'; old.document.extraction.identity.name = 'OLD SPELLING'; old.document.extraction.facts[1].value = 'OLD SPELLING';
  f.draft.payload.documents.push({documentId: 'old', type: 'Справка ЕНПФ', person: 'Клиент'});
  assert.equal(extendProfileDocumentFacts(f.draft, context, [old, f.analysis], validateDraft).payload.answers.find(answer => answer.key === 'fio').value, 'SYNTHETIC PERSON');
  f.analysis.document.extraction.facts[1].page = 2; assert.equal(f.run().changes.some(change => change.key === 'fio'), false);
  f.analysis.document.extraction.facts[1].page = 1; f.analysis.document.extraction.facts[1].value = 'INCONSISTENT FACT'; assert.equal(f.run().changes.some(change => change.key === 'fio'), false);
});
test('identity conflicts and normalization that would create defaults stop before any change', () => {
  const f = fixture(); f.draft.identityRevision = 2; assert.throws(() => f.run(), /CURRENT_IDENTITY_REQUIRED/);
  f.draft.identityRevision = 1; f.draft.payload.answers.push({key: 'iin', value: '991231300004', checked: false}); assert.throws(() => f.run(), /DRAFT_CLIENT_IDENTITY_CONFLICT/);
  f.draft.payload.answers = []; f.draft.payload.unrecognized = 'preserve'; assert.throws(() => f.run(), /DRAFT_NORMALIZATION_REQUIRED/);
});
