import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/documents/policy.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date});
const p=exports;
test('GKB age has no cutoff; invalid and future dates remain blocked',()=>{
 for(const issued of ['2026-06-17','2020-01-01','2024-02-29','2025-12-31'])assert.equal(p.gkbFreshness(issued,'2026-10-12').length,0);
 for(const issued of ['','bad','2026-02-30','2025-02-29'])assert.equal(p.gkbFreshness(issued,'2026-10-12')[0].code,'DATE_UNVERIFIED');
 assert.equal(p.gkbFreshness('2026-10-13','2026-10-12')[0].code,'FUTURE_DOCUMENT_DATE');
 assert.equal(p.gkbFreshness('2026-10-12','2026-10-12').length,0);
 assert.equal(p.gkbFreshness('2026-10-12','invalid')[0].code,'DATE_UNVERIFIED');
});
test('statements may end up to three months before the assessment day',()=>{assert.equal(p.statementPeriod('2025-06-01','2026-05-31','2026-08-31').length,0);assert.equal(p.statementPeriod('2025-05-01','2026-04-30','2026-08-31')[0].code,'STATEMENT_PERIOD_NOT_ACCEPTABLE');assert.equal(p.statementPeriod('2025-09-01','2026-09-30','2026-08-31')[0].code,'STATEMENT_PERIOD_NOT_ACCEPTABLE');assert.equal(p.salaryStatementPeriod('2025-06-01','2026-06-15','2026-09-10').length,0)});
test('representative name alone, wrong entity kind and lookalike ID never suffice',()=>{const ref={kind:'organization',legalName:'TEST ORGANIZATION',identifier:'123456789012'};assert.equal(p.representativeAllowed(ref,[ref]).length,0);for(const value of [{...ref,identifier:'123456789013'},{...ref,kind:'person'},{...ref,legalName:'TEST ORGANIZATION OTHER'}])assert.equal(p.representativeAllowed(value,[ref])[0].code,'REPRESENTATIVE_NOT_APPROVED');assert.equal(p.representativeAllowed(ref,[])[0].code,'REPRESENTATIVE_NOT_APPROVED')});
test('an unverified short credit list blocks document use and fact confirmation',()=>assert.equal(p.requiresDocumentValidation(['SHORT_CREDIT_LIST_UNVERIFIED']),true));
