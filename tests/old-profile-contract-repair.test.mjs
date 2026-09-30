import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {planContractRepair, storedPayload} from '../scripts/old-profile-contract-repair.mjs';
const temp = await mkdtemp(tmpdir() + '/profile-contract-repair-');
await build({entryPoints:['scripts/old-profile-validation-entry.mjs'],bundle:true,platform:'node',format:'esm',external:['cloudflare:workers'],outfile:temp+'/validation.mjs'});
const {validateDraft} = await import(pathToFileURL(temp+'/validation.mjs'));
const iin='900101300000',context={caseId:'case-a',identityRevision:1,client:{iin}};
const answer=(key,value)=>({key,value,checked:false});
function fixture(){
 const row=[answer('n8038','АО Банк'),answer('loanContractId',''),answer('n8040','123.45')];
 const draft={revision:7,identityRevision:1,payload:{schemaVersion:1,answers:[answer('iin',iin)],groups:[{id:'creditors',rows:[row],rowKeys:[`creditors|${iin}|АО Банк|FULL-42`]}],docContext:{social:'',salary:''},documents:[{documentId:'doc-a',type:'ГКБ — краткий отчёт',person:'Клиент',originalName:'source.pdf'}],pendingFiles:[]}};
 const analysis={caseId:'case-a',documentId:'doc-a',extractionId:'extract-a',identityRevision:1,eligibleForAutofill:true,persisted:true,document:{readAllPhysicalPages:true,originalSha256:'a'.repeat(64),totalPages:1,pages:[{}],extraction:{kind:'gkb_short',identity:{iin},credits:[{contractNumber:'FULL-42',facts:[{key:'creditor',value:'АО Банк'},{key:'contractIdentifier',value:'FULL-42'}]}]}}};
 draft.payload=validateDraft(storedPayload(draft.payload));
 draft.payload.documents[0].originalName='source.pdf';
 return{draft,analyses:[analysis]};
}
const plan=f=>planContractRepair(f.draft,context,f.analyses,validateDraft);
test('exact source fills only the blank ID and preserves the original',()=>{
 const f=fixture(),before=structuredClone(f.draft);const p=plan(f);
 assert.equal(p.changes.length,1);assert.equal(p.payload.groups[0].rows[0][1].value,'FULL-42');
 assert.equal(p.payload.groups[0].rows[0][2].value,'123.45');assert.deepEqual(f.draft,before);
 const again=plan({...f,draft:{...f.draft,payload:p.payload}});assert.equal(again.changes.length,0);
});
test('missing historical field can be added without rebuilding a row',()=>{
 const f=fixture();f.draft.payload.groups[0].rows[0].splice(1,1);const p=plan(f);
 assert.equal(p.changes.length,1);assert.equal(p.changes[0].added,true);assert.equal(p.payload.groups[0].rows[0].at(-1).value,'FULL-42');
});
for(const [name,change] of [
 ['nonblank staff answer',f=>f.draft.payload.groups[0].rows[0][1].value='STAFF-ANSWER'],
 ['staff replaced source',f=>f.draft.payload.groups[0].rows[0][1].sourceReplaced=true],
 ['wrong case',f=>f.analyses[0].caseId='other'],
 ['wrong document IIN',f=>f.analyses[0].document.extraction.identity.iin='800101300000'],
 ['wrong row IIN',f=>f.draft.payload.groups[0].rowKeys[0]=`creditors|800101300000|АО Банк|FULL-42`],
 ['changed lender',f=>f.draft.payload.groups[0].rows[0][0].value='Другой банк'],
 ['unverified report',f=>f.analyses[0].eligibleForAutofill=false],
 ['unread pages',f=>f.analyses[0].document.readAllPhysicalPages=false],
 ['family document',f=>f.draft.payload.documents[0].person='Супруг(а)'],
 ['truncated number',f=>{f.analyses[0].document.extraction.credits[0].facts[1].value='FULL…42';}],
 ['unproven fact',f=>{f.analyses[0].document.extraction.credits[0].facts[1].value='OTHER-42';}],
 ['missing source key',f=>f.draft.payload.groups[0].rowKeys[0]=null],
 ['empty starter',f=>f.draft.payload.groups[0].rows[0][0].value=''],
 ]) test(name+' is preserved',()=>{const f=fixture();change(f);const p=plan(f);assert.equal(p.changes.length,0);assert.deepEqual(p.payload,storedPayload(f.draft.payload));});
test('conflicting complete sources are left for review',()=>{
 const f=fixture(),other=structuredClone(f.analyses[0]);other.documentId='doc-b';other.extractionId='extract-b';
 other.document.extraction.credits[0].contractCode='FULL-42';other.document.extraction.credits[0].contractNumber='OTHER-42';other.document.extraction.credits[0].facts[1].value='OTHER-42';
 f.analyses.push(other);f.draft.payload.documents.push({documentId:'doc-b',type:'ГКБ — полный отчёт',person:'Клиент'});
 assert.equal(plan(f).skipped[0].code,'CONFLICTING_SOURCE_NUMBERS');
});
test('an existing duplicate contract prevents a repair',()=>{
 const f=fixture();f.draft.payload.groups[0].rows.push([answer('n8038','АО Банк'),answer('loanContractId','FULL-42')]);f.draft.payload.groups[0].rowKeys.push(null);
 assert.equal(plan(f).skipped[0].code,'DUPLICATE_LOAN_NEEDS_REVIEW');
});
test('any unrelated schema normalization rejects the whole repair',()=>{
 const f=fixture();f.draft.payload.unrelated='keep';assert.throws(()=>plan(f),/DRAFT_SCHEMA_CHANGE_REQUIRED/);
});
test('plan pin changes if another answer or extraction changes',()=>{
 const f=fixture(),before=plan(f).planHash;f.draft.payload.groups[0].rows[0][2].value='999.99';assert.notEqual(plan(f).planHash,before);
 const next=plan(f).planHash;f.analyses[0].extractionId='new';assert.notEqual(plan(f).planHash,next);
});
test.after(()=>rm(temp,{recursive:true,force:true}));
