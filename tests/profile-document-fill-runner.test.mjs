import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPublicKey, publicEncrypt, randomBytes, createCipheriv, randomUUID, generateKeyPairSync, privateDecrypt, createDecipheriv} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {buildSync} from 'esbuild';
import {planProfileSourceFill, digest, storedPayload} from '../scripts/profile-source-fill.mjs';
import {deriveProfileFillHistory} from '../scripts/profile-fill-history.mjs';
import {extendProfileDocumentFacts} from '../scripts/profile-document-facts.mjs';

// The runner executes with in-memory filesystem/network adapters. Synthetic
// clients and documents are the only inputs; no production endpoint is called.
const built=buildSync({entryPoints:['lib/questionnaire/draft.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {validateDraft}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const publicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64');
const iin='991231300003',dealId='900001',caseId='synthetic-case';
const fact=(key,value)=>({key,value,page:1,source:'PRIVATE_SYNTHETIC_SOURCE'});
const clone=x=>structuredClone(x);
function analysis(documentId='doc-existing'){
 return {documentId,caseId,identityRevision:1,extractionId:'ext-'+documentId,persisted:true,eligibleForAutofill:true,findings:[],document:{readAllPhysicalPages:true,totalPages:1,pages:[{page:1,text:'PRIVATE_SYNTHETIC_DOCUMENT'}],originalSha256:'a'.repeat(64),extraction:{kind:'gkb_full',issuedAt:'2026-10-01',identity:{iin,name:'PRIVATE_SYNTHETIC_NAME'},facts:[fact('identity.iin',iin),fact('identity.name','PRIVATE_SYNTHETIC_NAME')],creditList:{complete:true},credits:[{contractNumber:'PRIVATE_SYNTHETIC_LOAN',facts:[fact('creditor','SYNTHETIC BANK'),fact('contractIdentifier','PRIVATE_SYNTHETIC_LOAN'),fact('debtOutstanding','4321987.65'),fact('overdueDays','0'),fact('loanStatus','Платится по графику')]}]}}};
}
function payload(){
 return validateDraft({schemaVersion:1,answers:[],groups:[],docContext:{social:'',salary:''},documents:[{documentId:'doc-existing',type:'ГКБ — полный отчёт',person:'Клиент'}],pendingFiles:[]});
}
function decrypt(text){
 const e=JSON.parse(text),key=privateDecrypt({key:pair.privateKey,oaepHash:'sha256'},Buffer.from(e.encryptedKey,'base64'));
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));decipher.setAuthTag(Buffer.from(e.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.ciphertext,'base64')),decipher.final()]).toString());
}
async function run(options={}){
 const {blankProfileDraft,crmImportCandidates,appendProfileDocument}=await import('../scripts/profile-document-import.mjs');
 const source=readFileSync('scripts/run-profile-document-fill.mjs','utf8').replace(/^import .*;\n/gm,'');
 const calls=[],outputs={},logs=[];
 const initial=clone(options.payload||payload());
 const model={context:{caseId,identityRevision:1,client:{iin,name:'PRIVATE_SYNTHETIC_NAME'},assessmentDay:'2026-10-02'},draft:options.noDraft?null:{revision:2,identityRevision:1,payload:initial},record:{id:caseId,identity_revision:1,client_iin:iin},drafts:[],profiles:[],operations:[],documents:[{id:'doc-existing',original_sha256:'a'.repeat(64),byte_size:123,created_at:'2026-10-01'}],reviews:[],bindings:[],activity:{active:[],completed:[]},refs:[],analyses:{'doc-existing':analysis()},draftWrites:0,imports:0,reads:0};
 if(model.draft)model.drafts.push({revision:2,identity_revision:1,payload_json:JSON.stringify(initial),request_id:'previous-save'});
 options.setup?.(model);
 const process={env:{PROFILE_DOCUMENT_APPLY:'true',PROFILE_DOCUMENT_PUBLIC_KEY:publicKey,ASSESSMENT_TEST_PASSWORD:'PRIVATE_SYNTHETIC_PASSWORD',CLOUDFLARE_API_TOKEN:'PRIVATE_SYNTHETIC_TOKEN',CLOUDFLARE_ACCOUNT_ID:'synthetic-account',...options.env}};
 function json(value,status=200){return Response.json(clone(value),{status});}
 async function fetch(url,init){
  const u=new URL(url),body=init.body?JSON.parse(init.body):null,path=u.pathname;
  const call={path,query:u.search,body,method:init.method};calls.push(call);options.beforeCall?.(call,model);
  if(u.hostname==='api.cloudflare.com'){
   assert.match(path,/\/d1\/database\/synthetic-db\/query$/);
   assert.match(body.sql,/^SELECT\s/i);assert.equal(body.sql.includes(';'),false);
   let rows;
   if(body.sql.includes('FROM assessment_cases'))rows=[model.record];
   else if(body.sql.includes('FROM assessment_draft_versions')){
    rows=body.sql.includes('AND request_id=?')?model.drafts.filter(d=>d.request_id===body.params[1]):model.drafts;
    if(options.receiptMismatch&&body.sql.includes('AND request_id=?'))rows=rows.map(r=>({...r,identity_revision:999}));
    if(options.missingReceipt&&body.sql.includes('AND request_id=?'))rows=[];
   }
   else if(body.sql.includes('FROM assessment_profile_saves'))rows=model.profiles;
   else if(body.sql.includes('FROM assessment_submissions'))rows=model.operations;
   else if(body.sql.includes('FROM assessment_documents'))rows=model.documents;
   else if(body.sql.includes('FROM assessment_reviews'))rows=model.reviews;
   else if(body.sql.includes('FROM assessment_identity_bindings'))rows=model.bindings;
   else if(/FROM assessment_(?:draft_recoveries|intake_repairs|submission_repairs)/.test(body.sql))rows=[];
   else assert.fail('Unexpected D1 read: '+body.sql);
   return json({success:true,result:[{success:true,results:rows}]});
  }
  assert.equal(u.origin,'https://assessment.anti-krizis.kz');assert.equal(init.redirect,'error');
  if(path==='/api/session')return Response.json({},{headers:{'set-cookie':'session=PRIVATE_SYNTHETIC_COOKIE'}});
  if(path==='/api/profile-queue')return json({items:options.queue||[{dealId,profileSavedAt:options.completed?'2026-10-01':null}]});
  if(path==='/api/profile-activity')return json(model.activity);
  if(path==='/api/assessment/'+dealId)return json(model.context);
  if(path.endsWith('/draft')){
   if(!body){model.reads++;return json({draft:model.draft});}
   model.draftWrites++;
   assert.equal(body.identityRevision,model.context.identityRevision);
   assert.equal(body.expectedRevision,model.draft?.revision||0);
   assert.ok(body.requestId);
   const revision=body.expectedRevision+1;
   model.drafts.push({revision,identity_revision:body.identityRevision,payload_json:JSON.stringify(body.payload),request_id:body.requestId});
   model.draft={revision,identityRevision:body.identityRevision,payload:clone(body.payload)};
   if(options.afterSave)options.afterSave(model);
   if(options.lostDraftResponse)throw Error('PRIVATE_SYNTHETIC_LOST_RESPONSE');
   return json({ok:true,revision,identityRevision:body.identityRevision});
  }
  if(path.endsWith('/documents/analyze'))return json({results:body.documentIds.map(id=>({documentId:id,analysis:model.analyses[id]}))});
  if(path.endsWith('/crm-documents')){
   if(!body&&!u.search)return json({files:model.refs});
   if(!body){const a=model.analyses['doc-'+u.searchParams.get('fileId')];return json(a||{pending:true},a?200:202);}
   model.imports++;
   const a=clone(options.importAnalysis||analysis('doc-'+body.fileId));model.analyses[a.documentId]=a;
   model.documents.push({id:a.documentId,original_sha256:a.document.originalSha256,byte_size:321,created_at:'2026-10-02'});
   model.reviews.push({id:'origin-'+body.fileId,document_id:a.documentId,extraction_id:a.extractionId,identity_revision:a.identityRevision,fact_key:'document.origin.bitrix.v1',value_json:JSON.stringify({fileId:body.fileId}),disposition:'confirmed',payload_hash:'origin-hash'});
   if(options.lostImportResponse)throw Error('PRIVATE_SYNTHETIC_LOST_RESPONSE');
   return json(a);
  }
  if(path.endsWith('/profile')){assert.equal(init.method,'POST');assert.equal(body.action,'check');return json({ready:false,issues:[{key:'phone',code:'ANSWER_REQUIRED',label:'Телефон'}]});}
  assert.fail('Unexpected application request '+path);
 }
 await vm.runInNewContext('(async()=>{'+source+'})()',{
  process,Buffer,JSON,URL,AbortSignal,structuredClone,createPublicKey,publicEncrypt,randomBytes,createCipheriv,randomUUID,isDeepStrictEqual,validateDraft,planProfileSourceFill,digest,storedPayload,deriveProfileFillHistory,blankProfileDraft,crmImportCandidates,appendProfileDocument,extendProfileDocumentFacts,
  fetch,readFileSync:name=>{assert.equal(name,'wrangler.anti-krizis.jsonc');return JSON.stringify({d1_databases:[{database_id:'synthetic-db'}]});},writeFileSync:(name,text)=>{outputs[name]=text;},console:{log:text=>logs.push(text)},
 });
 assert.ok(outputs['profile-document-fill-summary.json']);assert.ok(outputs['profile-document-fill.enc.json']);
 const report=JSON.parse(outputs['profile-document-fill-summary.json']),privateReport=decrypt(outputs['profile-document-fill.enc.json']);
 const publicText=logs.join('\n')+outputs['profile-document-fill-summary.json']+outputs['profile-document-fill.enc.json'];
 for(const secret of ['PRIVATE_SYNTHETIC',iin,'4321987.65'])assert.equal(publicText.includes(secret),false,'Sensitive value in public output: '+secret);
 assert.ok(calls.filter(c=>c.method==='POST'&&!c.path.startsWith('/client/v4/')).every(c=>c.path==='/api/session'||/\/(?:draft|crm-documents|documents\/analyze)$/.test(c.path)||c.path.endsWith('/profile')&&c.body.action==='check'));
 return {report,privateReport,model,calls,outputs,logs,process};
}

test('runner performs an additive source save with exact receipt and current-draft readback; raw facts remain encrypted',async()=>{
 const r=await run();assert.equal(r.report.cases[0].verified,true);assert.equal(r.model.draftWrites,1);assert.equal(r.report.cases[0].writes[0].verified,true);assert.ok(r.report.summary.filledFields>0);
 assert.ok(r.privateReport.cases[0].writes[0].payload.answers.some(a=>a.value==='PRIVATE_SYNTHETIC_NAME'));
 assert.ok(r.model.draft.payload.answers.every(a=>!a.checked));
 const post=r.calls.findIndex(c=>c.path.endsWith('/draft')&&c.body);
 assert.ok(r.calls.slice(post+1).some(c=>c.body?.sql?.includes('AND request_id=?')));
 assert.ok(r.calls.slice(post+1).some(c=>c.path.endsWith('/draft')&&!c.body));
});

test('runner verifies a saved draft after a lost response without submitting it a second time',async()=>{
 const r=await run({lostDraftResponse:true});assert.equal(r.model.draftWrites,1);assert.equal(r.report.cases[0].verified,true);
});

test('runner refuses missing or mismatched receipts and a changed draft after writing',async()=>{
 for(const [options,code] of [[{missingReceipt:true},'DRAFT_WRITE_NOT_CONFIRMED'],[{receiptMismatch:true},'DRAFT_RECEIPT_MISMATCH'],[{afterSave:m=>m.draft.revision++},'DRAFT_CHANGED_AFTER_WRITE']]){
  const r=await run(options);assert.equal(r.report.cases[0].error,code);assert.notEqual(r.report.cases[0].verified,true);assert.equal(r.model.draftWrites,1);
 }
});

test('runner skips completed profiles and refuses active sessions and unresolved external operations before mutations',async()=>{
 const scenarios=[
  [{completed:true},'COMPLETED_PROFILE_PRESERVED'],
  [{setup:m=>m.activity.active=[{dealId}]},'PROFILE_IN_USE'],
  [{setup:m=>m.activity.completed=[{dealId}]},'COMPLETED_PROFILE_PRESERVED'],
  [{setup:m=>m.operations=[{kind:'handoff',state:'uncertain'}]},'PENDING_EXTERNAL_OPERATION'],
  [{setup:m=>m.operations=[{kind:'draft-recovery',state:'prepared'}]},'PENDING_EXTERNAL_OPERATION'],
  [{setup:m=>m.operations=[{kind:'transport-repair',state:'writing'}]},'PENDING_EXTERNAL_OPERATION'],
  [{setup:m=>m.operations=[{kind:'title-repair',state:'uncertain'}]},'PENDING_EXTERNAL_OPERATION'],
  [{setup:m=>m.operations=[{kind:'submission',state:'verified',extra:'uncertain'}]},'PENDING_EXTERNAL_OPERATION'],
  [{setup:m=>m.profiles=[{state:'writing'}]},'PENDING_PROFILE_OPERATION'],
  [{setup:m=>m.profiles=[{state:'verified',history_comment_id:'saved'}]},'COMPLETED_PROFILE_PRESERVED'],
 ];
 for(const [options,code] of scenarios){const r=await run(options),c=r.report.cases[0];assert.equal(c.error||c.skipped,code);assert.equal(r.model.draftWrites,0);assert.equal(r.model.imports,0);}
});

test('runner refuses a mismatched case identity and preserves a saved answer for another client',async()=>{
 for(const setup of [m=>m.record.client_iin='991231300004',m=>{m.draft.payload.answers.push({key:'iin',value:'991231300004',checked:false});m.drafts[0].payload_json=JSON.stringify(m.draft.payload);},m=>m.draft.recovery={mode:'documents-only'}]){
  const r=await run({setup});assert.equal(r.model.draftWrites,0);assert.equal(r.model.imports,0);assert.match(r.report.cases[0].error,/(?:IDENTITY|RECOVERY)/);
 }
});

test('runner preserves a deliberately cleared scalar and removed loan from draft history',async()=>{
 const r=await run({setup:m=>{
  const old=clone(m.draft.payload);old.answers.push({key:'fio',value:'PRIVATE_SYNTHETIC_OLD_NAME',checked:false});
  old.groups.push({id:'creditors',rows:[[{key:'n8038',value:'SYNTHETIC BANK',checked:false},{key:'loanContractId',value:'PRIVATE_SYNTHETIC_LOAN',checked:false}]],rowKeys:[null]});
  m.drafts.unshift({revision:1,identity_revision:1,request_id:'old',payload_json:JSON.stringify(old)});
 }});
 assert.equal(r.report.cases[0].verified,true);assert.equal(r.model.draft.payload.answers.find(a=>a.key==='fio'),undefined);assert.equal(r.model.draft.payload.groups.find(g=>g.id==='creditors'),undefined);
 assert.ok(r.report.cases[0].planSkipped.some(s=>s.code==='STAFF_CLEARED_VALUE_PRESERVED'));
 assert.ok(r.report.cases[0].planSkipped.some(s=>s.code==='PREVIOUSLY_REMOVED_LOAN_PRESERVED'));
});

test('runner does not revive a CRM document that staff removed from an earlier draft',async()=>{
 const r=await run({setup:m=>{
  const old=clone(m.draft.payload);old.documents.push({documentId:'doc-101',type:'ГКБ — полный отчёт',person:'Клиент'});
  m.drafts.unshift({revision:1,identity_revision:1,payload_json:JSON.stringify(old)});
  m.reviews.push({id:'origin-101',document_id:'doc-101',fact_key:'document.origin.bitrix.v1',value_json:JSON.stringify({fileId:'101'})});
  m.refs=[{id:'101',name:'ГКБ полный.pdf',field:'UF_CRM_GKB'}];
 }});
 assert.equal(r.model.imports,0);assert.equal(r.model.draft.payload.documents.some(d=>d.documentId==='doc-101'),false);
 assert.ok(r.report.cases[0].imports.some(i=>i.skipped==='STAFF_REMOVED_DOCUMENT_PRESERVED'));
});

test('runner stops before saving when another writer changes the revision or a protected receipt',async()=>{
 for(const kind of ['draft','receipt']){
  let changed=false;
  const r=await run({beforeCall:(call,m)=>{if(!changed&&call.path.endsWith('/crm-documents')&&!call.body){changed=true;if(kind==='draft'){m.draft.revision++;m.drafts.push({revision:m.draft.revision,identity_revision:1,payload_json:JSON.stringify(m.draft.payload)});}else m.bindings.push({id:'new-binding'});}}});
  assert.equal(r.model.draftWrites,0);assert.equal(r.report.cases[0].error,kind==='draft'?'DRAFT_CHANGED':'PROTECTED_RECEIPTS_CHANGED');
 }
});

test('preview never imports or saves and an out-of-queue target never opens a case',async()=>{
 const preview=await run({env:{PROFILE_DOCUMENT_APPLY:'false'},setup:m=>m.refs=[{id:'101',name:'ГКБ полный.pdf',field:'UF_CRM_GKB'}]});
 assert.equal(preview.model.imports,0);assert.equal(preview.model.draftWrites,0);assert.equal(preview.report.summary.filledFields,0);
 const refused=await run({env:{PROFILE_DOCUMENT_IDS:'999999'}});assert.equal(refused.report.error,'CASE_NOT_IN_CURRENT_QUEUE');assert.equal(refused.process.exitCode,1);assert.equal(refused.calls.some(c=>c.path==='/api/assessment/'+dealId),false);
});

test('runner never fills from stale, unpersisted or wrong-client selected evidence',async()=>{
 for(const change of [a=>a.eligibleForAutofill=false,a=>a.persisted=false,a=>a.identityRevision=2,a=>a.caseId='other-client',a=>a.document.extraction.identity.iin='991231300004',a=>a.document.totalPages=2]){
  const r=await run({setup:m=>change(m.analyses['doc-existing'])});assert.equal(r.model.draftWrites,0);assert.equal(r.report.summary.filledFields,0);
 }
});

test('runner rechecks pending operations and current draft before every inbound import',async()=>{
 for(const change of ['operation','draft','active']){
  let changed=false;
  const r=await run({setup:m=>m.refs=[{id:'101',name:'ГКБ полный.pdf',field:'UF_CRM_GKB'}],beforeCall:(call,m)=>{
   if(!changed&&call.path.endsWith('/crm-documents')&&!call.body){changed=true;if(change==='operation')m.operations.push({kind:'submission',state:'prepared'});else if(change==='active')m.activity.active.push({dealId});else{m.draft.revision++;m.drafts.push({revision:m.draft.revision,identity_revision:1,payload_json:JSON.stringify(m.draft.payload)});}}
  }});
  assert.equal(r.model.imports,0);assert.equal(r.model.draftWrites,0);assert.equal(r.report.cases[0].error,change==='operation'?'PENDING_EXTERNAL_OPERATION':change==='active'?'PROFILE_IN_USE':'DRAFT_CHANGED');
 }
});

test('a missing draft is created only from an accessible matching original and every save has readback',async()=>{
 const r=await run({noDraft:true,setup:m=>m.refs=[{id:'101',name:'ГКБ полный.pdf',field:'UF_CRM_GKB'}]});
 assert.equal(r.model.imports,1);assert.equal(r.report.cases[0].verified,true);assert.equal(r.report.summary.createdDrafts,1);
 assert.equal(r.model.draft.payload.documents.length,1);assert.equal(r.model.draft.payload.documents[0].documentId,'doc-101');
 assert.ok(r.model.draftWrites>=1);assert.equal(r.report.cases[0].writes.length,r.model.draftWrites);assert.ok(r.report.cases[0].writes.every(w=>w.verified));
});

test('a lost inbound-copy response uses receipt reconciliation without a second import',async()=>{
 const r=await run({noDraft:true,lostImportResponse:true,setup:m=>m.refs=[{id:'101',name:'ГКБ полный.pdf',field:'UF_CRM_GKB'}]});
 assert.equal(r.model.imports,1);assert.equal(r.report.cases[0].verified,true);assert.ok(r.calls.some(c=>c.path.endsWith('/crm-documents')&&!c.body&&c.query.includes('fileId=101')));
});

test('a wrong-client imported original is not selected or used to create a draft',async()=>{
 const other=analysis('doc-101');other.document.extraction.identity.iin='991231300004';
 const r=await run({noDraft:true,importAnalysis:other,setup:m=>m.refs=[{id:'101',name:'ГКБ полный.pdf',field:'UF_CRM_GKB'}]});
 assert.equal(r.model.imports,1);assert.equal(r.model.draftWrites,0);assert.equal(r.model.draft,null);assert.equal(r.report.cases[0].skipped,'NO_ACCESSIBLE_MATCHED_DOCUMENT');
});

test('identity conflict in an additional source kind cannot be bypassed by the core source planner',async()=>{
 const r=await run({setup:m=>{
  const other=analysis('doc-enpf');other.document.extraction.kind='enpf';
  other.document.extraction.identity.name='PRIVATE_SYNTHETIC_DIFFERENT_NAME';
  other.document.extraction.facts.find(f=>f.key==='identity.name').value='PRIVATE_SYNTHETIC_DIFFERENT_NAME';
  m.analyses['doc-enpf']=other;
  m.draft.payload.documents.push({documentId:'doc-enpf',type:'Справка ЕНПФ',person:'Клиент'});
  m.drafts[0].payload_json=JSON.stringify(m.draft.payload);
 }});
 assert.equal(r.report.cases[0].verified,true);
 assert.equal(r.model.draft.payload.answers.find(a=>a.key==='fio'),undefined);
 assert.ok(r.report.cases[0].planSkipped.some(x=>x.key==='fio'&&x.code==='CONFLICTING_DOCUMENT_VALUES'));
});
