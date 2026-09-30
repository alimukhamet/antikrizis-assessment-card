// Owner-requested draft repair only. This module cannot write or approve anything.
import {isDeepStrictEqual} from 'node:util';
import { createHash } from 'node:crypto';
import { creditorKey } from '../public/gkb-comparison.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function storedPayload(payload) {
  const copy = structuredClone(payload);
  for (const doc of copy.documents) delete doc.originalName;
  return copy;
}
const field = (row, key) => row.find(answer => answer.key === key);
const parts = key => typeof key === 'string' ? key.split('|') : [];
const completeNumber = value => typeof value === 'string' && value.trim() && !/\.{2,}|…|[\r\n]/u.test(value);
const requireCondition = (condition, code) => { if (!condition) throw Object.assign(new Error(code), {code}); };

export function planContractRepair(draft, context, analyses, validateDraft) {
  requireCondition(/^\d{12}$/.test(context.client.iin || ''), 'CLIENT_IDENTITY_UNVERIFIED');
  requireCondition(draft.identityRevision === context.identityRevision, 'CASE_IDENTITY_CHANGED');
  const before = storedPayload(draft.payload), normalized = validateDraft(before);
  // Old drafts may predate these controls. Only unanswered additions are safe;
  // checked/nonempty derived answers and any change to an old answer are rejected.
  const emptyControls = new Map([['holding:client:businessNone','businessNone'],['holding:partner:businessNone','businessNone'],['enforcementStatus','']]);
  const oldKeys = new Set(before.answers.map(a => a.key));
  const additions = normalized.answers.filter(a => !oldKeys.has(a.key));
  requireCondition(additions.every(a => emptyControls.has(a.key) && isDeepStrictEqual(a,{key:a.key,value:emptyControls.get(a.key),checked:false})), 'DRAFT_SCHEMA_CHANGE_REQUIRED');
  const withoutAdditions = structuredClone(normalized);
  withoutAdditions.answers = withoutAdditions.answers.filter(a => oldKeys.has(a.key));
  requireCondition(isDeepStrictEqual(withoutAdditions, before), 'DRAFT_SCHEMA_CHANGE_REQUIRED');
  const payload = structuredClone(normalized), group = payload.groups.find(g => g.id === 'creditors');
  const selected = new Set(before.documents.filter(d => d.person === 'Клиент').map(d => d.documentId));
  const candidates = [];
  for (const analysis of analyses) {
    if (!selected.has(analysis.documentId) || analysis.caseId !== context.caseId || analysis.identityRevision !== context.identityRevision ||
        analysis.eligibleForAutofill !== true || !analysis.extractionId || analysis.persisted !== true) continue;
    const document = analysis.document, extraction = document?.extraction;
    if (!extraction?.kind.startsWith('gkb_') || extraction.identity.iin !== context.client.iin ||
        document.readAllPhysicalPages !== true || !document.originalSha256 ||
        document.pages?.length !== document.totalPages) continue;
    for (const [index, credit] of extraction.credits.entries()) {
      const lender = credit.facts.find(f => f.key === 'creditor')?.value;
      const number = credit.facts.find(f => f.key === 'contractIdentifier')?.value;
      if (!lender || !completeNumber(number)) continue;
      // The extracted identifier must also belong to this exact parsed contract.
      const aliases = [credit.contractNumber, credit.contractCode].filter(completeNumber).map(n => n.trim());
      if (!aliases.includes(number.trim())) continue;
      candidates.push({lender: creditorKey(lender), number: number.trim(), aliases,
        documentId: analysis.documentId, extractionId: analysis.extractionId,
        factKey: `credits.${index}.contractIdentifier`, originalSha256: document.originalSha256});
    }
  }
  const changes = [], skipped = [];
  for (const [rowIndex, row] of (group?.rows || []).entries()) {
    const answer = field(row, 'loanContractId'), lender = field(row, 'n8038')?.value.trim();
    if (answer?.value.trim() || !lender) continue;
    if (row.some(answer => answer.sourceReplaced)) { skipped.push({row: rowIndex, code: 'STAFF_SOURCE_REPLACEMENT_PRESERVED'}); continue; }
    const key = parts(group.rowKeys?.[rowIndex]);
    if (key.length !== 4 || key[0] !== 'creditors' || key[1] !== context.client.iin ||
        creditorKey(key[2]) !== creditorKey(lender) || !completeNumber(key[3])) {
      skipped.push({row: rowIndex, code: 'SOURCE_ROW_IDENTITY_UNVERIFIED'}); continue;
    }
    const matches = candidates.filter(c => c.lender === creditorKey(lender) && c.aliases.includes(key[3].trim()));
    const numbers = new Set(matches.map(c => c.number));
    if (numbers.size !== 1) { skipped.push({row: rowIndex, code: numbers.size ? 'CONFLICTING_SOURCE_NUMBERS' : 'NO_CURRENT_EXACT_SOURCE'}); continue; }
    const chosen = matches[0];
    const duplicate = group.rows.some((other, index) => {
      if (index === rowIndex || creditorKey(field(other, 'n8038')?.value || '') !== chosen.lender) return false;
      const otherKey = parts(group.rowKeys?.[index]);
      return field(other, 'loanContractId')?.value.trim() === chosen.number ||
        (otherKey.length === 4 && otherKey[1] === context.client.iin && chosen.aliases.includes(otherKey[3].trim()));
    });
    if (duplicate) { skipped.push({row: rowIndex, code: 'DUPLICATE_LOAN_NEEDS_REVIEW'}); continue; }
    if (answer) answer.value = chosen.number;
    else row.push({key: 'loanContractId', value: chosen.number, checked: false});
    changes.push({row: rowIndex, previous: field(before.groups.find(g => g.id === 'creditors').rows[rowIndex], 'loanContractId')?.value, added: !answer, ...chosen});
  }
  const undo = structuredClone(payload);
  undo.answers = undo.answers.filter(a => oldKeys.has(a.key));
  for (const change of changes) {
    const row = undo.groups.find(g => g.id === 'creditors').rows[change.row];
    if (change.added) row.splice(row.findIndex(answer => answer.key === 'loanContractId'), 1);
    else field(row, 'loanContractId').value = change.previous;
  }
  requireCondition(isDeepStrictEqual(undo, before), 'UNRELATED_FIELD_CHANGED');
  requireCondition(isDeepStrictEqual(validateDraft(payload), payload), 'REPAIR_SCHEMA_CHANGE_REQUIRED');
  const planHash = digest({caseId: context.caseId, identityRevision: context.identityRevision,
    revision: draft.revision, before, payload, changes});
  return {payload, changes, skipped, migratedControls:additions.map(a=>a.key), planHash, beforeHash: digest(before), afterHash: digest(payload)};
}
