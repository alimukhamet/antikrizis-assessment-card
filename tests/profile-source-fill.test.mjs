import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {planProfileSourceFill} from '../scripts/profile-source-fill.mjs';
const built=buildSync({entryPoints:['lib/questionnaire/draft.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {validateDraft}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const iin='991231300003',context={caseId:'case',identityRevision:1,client:{iin}};
const fact=(key,value)=>({key,value,page:1,source:'SYNTHETIC ONLY'});
const credit=(id='LOAN1',extra=[])=>({contractNumber:id,facts:[fact('creditor','TEST BANK'),fact('contractIdentifier',id),fact('overdueDays','0'),fact('loanStatus','Платится по графику'),...extra]});
function fixture(){
 const payload=validateDraft({schemaVersion:1,answers:[],groups:[],docContext:{social:'',salary:''},documents:[{documentId:'doc',type:'ГКБ — полный отчёт',person:'Клиент'}],pendingFiles:[]});
 const draft={revision:5,identityRevision:1,payload};
 const analysis={documentId:'doc',extractionId:'ext',caseId:'case',identityRevision:1,persisted:true,eligibleForAutofill:true,document:{readAllPhysicalPages:true,totalPages:1,pages:[{page:1}],originalSha256:'hash',extraction:{kind:'gkb_full',issuedAt:'2026-09-30',identity:{iin},facts:[],creditList:{complete:true},credits:[credit()]}}};
 return {draft,analysis,run(history){return planProfileSourceFill(draft,context,[analysis],validateDraft,history);}};
}
const value=(p,key)=>p.payload.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key===key)?.value;
test('fills complete source facts into a draft without confirmations; rerunning is idempotent',()=>{
 const f=fixture(),p=f.run();assert.equal(p.newLoans,1);assert.equal(value(p,'n8042'),'0');assert.equal(value(p,'loanStatus'),'Платится по графику');assert.ok(p.changes.every(c=>c.source.documentId==='doc'&&c.source.page===1));
 assert.equal(p.payload.groups[0].rows[0].find(a=>a.key==='n8042').checked,false);f.draft.payload=p.payload;assert.equal(f.run().changes.length,0);
});
test('preserves typed values, explicit zeros, checked fields, review drafts and pending files',()=>{
 const f=fixture();f.draft.payload=f.run().payload;const row=f.draft.payload.groups[0].rows[0];row.push({key:'n8040',value:'0',checked:false},{key:'loanParticipants',value:'STAFF ANSWER',checked:true});f.draft.payload.pendingFiles=['PENDING ORIGINAL'];f.draft.payload.documentReviewDrafts=[{documentId:'doc',type:'ГКБ — полный отчёт',values:{reason:'STAFF REVIEW'}}];
 f.analysis.document.extraction.credits[0].facts.push(fact('debtOutstanding','123'),fact('relatedParties','Нет'));assert.deepEqual(f.run().payload,f.draft.payload);
});
test('prior manual deletions and removed loans are not resurrected',()=>{
 const f=fixture();f.draft.payload=f.run().payload;f.draft.payload.groups[0].rows[0].find(a=>a.key==='n8042').value='';f.analysis.document.extraction.credits.push(credit('LOAN2'));
 const p=f.run({protectedFields:[{group:'creditors',row:0,key:'n8042'}],allowNewLoans:false});assert.equal(value(p,'n8042'),'');assert.equal(p.newLoans,0);assert.ok(p.skipped.some(x=>x.code==='STAFF_CLEARED_VALUE_PRESERVED'));
});
test('unselected, wrong-person, stale, incomplete and unpersisted evidence cannot fill a draft',()=>{
 for(const change of [a=>a.documentId='other',a=>a.caseId='other',a=>a.identityRevision=2,a=>a.persisted=false,a=>a.eligibleForAutofill=false,a=>a.document.extraction.identity.iin='other',a=>a.document.readAllPhysicalPages=false,a=>a.document.totalPages=2,a=>a.document.extraction.creditList.complete=false]){const f=fixture();change(f.analysis);assert.equal(f.run().changes.length,0);}
});
test('ambiguous existing rows and manual rows without identifiers never create duplicates',()=>{
 for(const duplicate of [false,true]){const f=fixture();f.draft.payload=f.run().payload;const g=f.draft.payload.groups[0];if(duplicate){g.rows.push(structuredClone(g.rows[0]));g.rowKeys=[null,null];}else{g.rows[0]=[{key:'n8038',value:'TEST BANK',checked:false}];g.rowKeys=[null];}assert.equal(f.run().newLoans,0);assert.equal(f.run().changes.length,0);}
});
test('only latest dated complete reports supply balances and same-date disagreement stays empty',()=>{
 for(const later of [true,false]){const f=fixture(),b=structuredClone(f.analysis);b.documentId='short';b.extractionId='ext-short';b.document.extraction.kind='gkb_short';b.document.extraction.issuedAt=later?'2026-10-01':'2026-09-30';f.analysis.document.extraction.credits[0].facts.push(fact('debtOutstanding','100'));b.document.extraction.credits[0].facts.push(fact('debtOutstanding','200'));f.draft.payload.documents.push({documentId:'short',type:'ГКБ — краткий отчёт',person:'Клиент'});
 const p=planProfileSourceFill(f.draft,context,[f.analysis,b],validateDraft);assert.equal(value(p,'n8040'),later?'200':undefined);if(!later)assert.ok(p.skipped.some(x=>x.code==='CONFLICTING_DOCUMENT_VALUES'));}
});
test('truncated IDs including a single ellipsis cannot create loans',()=>{for(const id of ['LOAN..','LOAN…']){const f=fixture();f.analysis.document.extraction.credits=[credit(id)];assert.equal(f.run().newLoans,0);}});
test('source replacements and excluded loans remain intact',()=>{
 const f=fixture();f.draft.payload=f.run().payload;const row=f.draft.payload.groups[0].rows[0];row.find(a=>a.key==='loanClaimIncluded').checked=false;row.find(a=>a.key==='n8042').value='';row[0].sourceReplaced=true;const p=f.run();assert.deepEqual(p.payload,f.draft.payload);
});
test('reusing an empty form row counts as a new loan and preserves unrelated groups',()=>{
 const f=fixture();f.draft.payload.groups=[{id:'creditors',rows:[[{key:'loanClaimIncluded',value:'on',checked:true}]],rowKeys:[null]},{id:'clientjobs',rows:[],rowKeys:[]}];const p=f.run();assert.equal(p.newLoans,1);assert.equal(p.payload.groups[0].rows.length,1);assert.deepEqual(p.payload.groups[1],f.draft.payload.groups[1]);
});
test('monthly payment is not inserted before a contradictory source status is considered',()=>{
 const f=fixture();f.analysis.document.extraction.credits[0].facts=[fact('creditor','TEST BANK'),fact('contractIdentifier','LOAN1'),fact('monthlyPayment','123'),fact('loanStatus','В просрочке — требуют полную сумму')];const p=f.run();assert.equal(value(p,'n8041'),undefined);
});
test('identity changes and normalization that would remove or alter old answers stop the plan',()=>{
 const f=fixture();f.draft.identityRevision=2;assert.throws(()=>f.run(),/CURRENT_IDENTITY_REQUIRED/);f.draft.identityRevision=1;f.draft.payload.unrecognized='preserve me';assert.throws(()=>f.run(),/DRAFT_NORMALIZATION_REQUIRED/);
});

const {deriveProfileFillHistory}=await import('../scripts/profile-fill-history.mjs');
test('history protects removed scalar and loan values and unmatchable old obligations',()=>{
 const f=fixture(),old=f.run().payload,current=structuredClone(old);old.answers.push({key:'fio',value:'STAFF NAME',checked:false});current.groups[0].rows[0].find(a=>a.key==='n8042').value='';
 let h=deriveProfileFillHistory(current,[old]);assert.ok(h.protectedFields.some(x=>x.key==='fio'));assert.ok(h.protectedFields.some(x=>x.key==='n8042'&&x.row===0));assert.equal(h.allowNewLoans,true);
 current.groups[0].rows=[];current.groups[0].rowKeys=[];h=deriveProfileFillHistory(current,[old]);assert.equal(h.allowNewLoans,false);
});

test('unchecked legacy unknown controls are empty controls, not deleted client facts',()=>{
 const f=fixture();f.draft.payload.groups=[{id:'creditors',rows:[[{key:'loanClaimIncluded',value:'on',checked:true},{key:'unknown:loanParticipants',value:'on',checked:false}]],rowKeys:[null]}];const h=deriveProfileFillHistory(f.draft.payload,[f.draft.payload]);assert.equal(h.allowNewLoans,true);const p=f.run(h);assert.equal(p.newLoans,1);assert.equal(p.payload.groups[0].rows.length,1);assert.equal(p.payload.groups[0].rows[0].find(a=>a.key==='unknown:loanParticipants').checked,false);
});

test('benefit counts do not manufacture or erase benefit rows',()=>{
 for(const rows of [null,[]]){const f=fixture();f.analysis.document.extraction.kind='benefits';f.analysis.document.extraction.facts=[fact('benefits.count','0')];if(rows)f.draft.payload.groups.push({id:'clientbenefits',rows,rowKeys:[]});const p=f.run();assert.equal(p.changes.some(x=>x.key==='clientBenefitsCount'),rows!==null);}
});

test('canonical legacy split controls retain their existing business meaning and original answers',()=>{
 const f=fixture();f.draft.payload.answers=[{key:'holding:client:none',value:'none',checked:true},{key:'enforcementDetails',value:'Нет',checked:false}];const before=structuredClone(f.draft.payload.answers),p=f.run();assert.equal(p.payload.answers.find(a=>a.key==='holding:client:businessNone').checked,true);assert.equal(p.payload.answers.find(a=>a.key==='enforcementStatus').value,'no');for(const a of before)assert.deepEqual(p.payload.answers.find(b=>b.key===a.key),a);
});

test('a manually truncated contract identifier cannot cause a duplicate source loan',()=>{
 const f=fixture();f.draft.payload.groups=[{id:'creditors',rows:[[{key:'n8038',value:'TEST BANK',checked:false},{key:'loanContractId',value:'LOA…',checked:false}]],rowKeys:[null]}];const p=f.run();assert.equal(p.newLoans,0);assert.equal(p.changes.length,0);assert.equal(p.skipped[0].code,'MANUAL_LOAN_ID_REQUIRED');
});

test('a saved answer for another IIN blocks filling even when case revision and source match',()=>{
 const f=fixture();f.draft.payload.answers.push({key:'iin',value:'991231300004',checked:false});assert.throws(()=>f.run(),/DRAFT_CLIENT_IDENTITY_CONFLICT/);
});
