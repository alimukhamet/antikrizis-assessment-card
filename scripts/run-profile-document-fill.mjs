// Owner-triggered document import and additive draft entry. No publication,
// approvals, outbound files, contracts, stages, or CRM field writes.
import {readFileSync, writeFileSync} from 'node:fs';
import {createPublicKey, publicEncrypt, randomBytes, createCipheriv, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validateDraft} from '../.profile-fill-validation.mjs';
import {planProfileSourceFill, digest, storedPayload} from './profile-source-fill.mjs';
import {deriveProfileFillHistory} from './profile-fill-history.mjs';
import {blankProfileDraft, crmImportCandidates, appendProfileDocument} from './profile-document-import.mjs';
import {extendProfileDocumentFacts} from './profile-document-facts.mjs';

const origin='https://assessment.anti-krizis.kz';
const apply=process.env.PROFILE_DOCUMENT_APPLY==='true';
const sessionOnly=process.env.PROFILE_DOCUMENT_SESSION_ONLY==='true';
const requested=(process.env.PROFILE_DOCUMENT_IDS||'').split(',').filter(Boolean);
if(requested.some(id=>!/^\d{1,12}$/.test(id))||requested.length>200)throw Error('INVALID_COHORT');
const publicKey=createPublicKey({key:Buffer.from(process.env.PROFILE_DOCUMENT_PUBLIC_KEY||'','base64'),format:'der',type:'spki'});
const config=JSON.parse(readFileSync('wrangler.anti-krizis.jsonc','utf8'));
const database=config.d1_databases[0].database_id;
const privateReport={startedAt:new Date().toISOString(),apply,queue:[],cases:[]};
const publicReport={startedAt:privateReport.startedAt,apply,noCrmWrites:true,noApprovals:true,noPublication:true,cases:[]};
let cookie='';
const fail=code=>{throw Object.assign(Error(code),{code});};
const safeCode=e=>/^[A-Z][A-Z0-9_]{1,90}$/.test(e?.code||'')?e.code:'REQUEST_FAILED';
function checkpoint(){
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(privateReport)),cipher.final()]);
 writeFileSync('profile-document-fill.enc.json',JSON.stringify({encryptedKey:publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));
 writeFileSync('profile-document-fill-summary.json',JSON.stringify(publicReport,null,2));
}
async function request(path,body){
 // Deliberately exclude /profile GET: it may retry a timeline publication.
 const read=/^\/api\/(?:profile-queue|profile-activity|assessment\/\d+(?:\/draft|\/crm-documents(?:\?.*)?)?)$/.test(path);
 const write=path==='/api/session'||/^\/api\/assessment\/\d+\/(?:draft|crm-documents|documents\/analyze|documents\/[^/]+\/analyze)$/.test(path)||/^\/api\/assessment\/\d+\/profile$/.test(path)&&body?.action==='check';
 if(body?!write:!read)fail('ENDPOINT_NOT_ALLOWED');
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});
 if(path==='/api/session')cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 let data;try{data=await response.json();}catch{fail('INVALID_RESPONSE');}
 if(!response.ok)throw Object.assign(Error('HTTP_ERROR'),{code:data.error||'HTTP_ERROR',status:response.status});
 return data;
}
async function dbRead(sql,params=[]){
 if(!/^SELECT\s/i.test(sql)||/;/.test(sql))fail('READ_ONLY_DATABASE_REQUIRED');
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${database}/query`,{method:'POST',headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(60000)});
 const data=await response.json();if(!response.ok||!data.success||!data.result?.[0]?.success){
  (privateReport.databaseErrors??=[]).push({at:new Date().toISOString(),status:response.status,sql,response:data});
  fail('DATABASE_READ_FAILED');
 }
 return data.result[0].results;
}
async function state(caseId){
 const [cases,drafts,profiles,operations,documents,reviews,bindings]=await Promise.all([
  dbRead('SELECT * FROM assessment_cases WHERE id=?',[caseId]),
  dbRead('SELECT * FROM assessment_draft_versions WHERE case_id=? ORDER BY revision',[caseId]),
  dbRead('SELECT id,state,history_comment_id,created_at,updated_at,payload_hash FROM assessment_profile_saves WHERE case_id=? ORDER BY rowid',[caseId]),
  dbRead("SELECT 'submission' kind,id,state,payload_hash,history_state extra FROM assessment_submissions WHERE case_id=? UNION ALL SELECT 'upload',id,state,payload_hash,NULL FROM assessment_upload_manifests WHERE case_id=? UNION ALL SELECT 'handoff',id,state,payload_hash,NULL FROM assessment_handoffs WHERE case_id=? UNION ALL SELECT 'draft-recovery',request_id,state,plan_hash,NULL FROM assessment_draft_recoveries WHERE case_id=? UNION ALL SELECT 'transport-repair',request_id,state,original_payload_hash,NULL FROM assessment_transport_repairs WHERE case_id=? UNION ALL SELECT 'title-repair',id,title_repair_state,payload_hash,NULL FROM assessment_submissions WHERE case_id=? AND title_repair_state IS NOT NULL",[caseId,caseId,caseId,caseId,caseId,caseId]),
  dbRead('SELECT id,original_sha256,byte_size,created_at FROM assessment_documents WHERE case_id=? ORDER BY id',[caseId]),
  dbRead('SELECT id,document_id,extraction_id,identity_revision,fact_key,value_json,disposition,payload_hash FROM assessment_reviews WHERE case_id=? ORDER BY rowid',[caseId]),
  dbRead('SELECT * FROM assessment_identity_bindings WHERE case_id=? ORDER BY rowid',[caseId]),
 ]);
 return {record:cases[0],drafts,profiles,operations,documents,reviews,bindings};
}
function guard(saved,context,draft){
 if(!saved.record||saved.record.identity_revision!==context.identityRevision||saved.record.client_iin!==context.client.iin)fail('CASE_IDENTITY_CHANGED');
 if(draft?.recovery||draft&&draft.identityRevision!==context.identityRevision)fail('IDENTITY_RECOVERY_REQUIRED');
 const latest=saved.drafts.at(-1);
 if((latest?.revision||0)!==(draft?.revision||0)||latest&&digest(JSON.parse(latest.payload_json))!==digest(storedPayload(draft.payload)))fail('DRAFT_CHANGED');
 const iin=draft?.payload.answers.find(x=>x.key==='iin')?.value?.trim();if(iin&&iin!==context.client.iin)fail('DRAFT_CLIENT_IDENTITY_CONFLICT');
 if(saved.profiles.some(x=>['writing','uncertain'].includes(x.state)||x.state==='verified'&&!x.history_comment_id))fail('PENDING_PROFILE_OPERATION');
 if(saved.profiles.filter(x=>['verified','reopened'].includes(x.state)).at(-1)?.state==='verified')fail('COMPLETED_PROFILE_PRESERVED');
 if(saved.operations.some(x=>!['verified','cancelled'].includes(x.state)||x.kind==='submission'&&x.state==='verified'&&x.extra!=='verified'))fail('PENDING_EXTERNAL_OPERATION');
}
async function available(dealId){
 const activity=await request('/api/profile-activity');
 if(activity.active.some(x=>x.dealId===dealId))fail('PROFILE_IN_USE');
 if(activity.completed.some(x=>x.dealId===dealId))fail('COMPLETED_PROFILE_PRESERVED');
}
function preserved(a,b){
 if(!isDeepStrictEqual(a.bindings,b.bindings)||!isDeepStrictEqual(a.profiles,b.profiles)||!isDeepStrictEqual(a.operations,b.operations))fail('PROTECTED_RECEIPTS_CHANGED');
 for(const d of a.documents)if(!isDeepStrictEqual(d,b.documents.find(x=>x.id===d.id)))fail('ORIGINAL_CHANGED');
 for(const r of a.reviews)if(!isDeepStrictEqual(r,b.reviews.find(x=>x.id===r.id)))fail('REVIEW_CHANGED');
 if(b.reviews.some(x=>!a.reviews.some(r=>r.id===x.id)&&x.fact_key!=='document.origin.bitrix.v1'))fail('UNEXPECTED_NEW_REVIEW');
}
async function runCase(item){
 const out={dealId:item.dealId,completed:!!item.profileSavedAt,imports:[],writes:[],changes:[]};
 const detail={dealId:item.dealId,analyses:[],writes:[],plans:[]};publicReport.cases.push(out);privateReport.cases.push(detail);
 const root='/api/assessment/'+item.dealId;
 try{
  if(item.profileSavedAt){out.skipped='COMPLETED_PROFILE_PRESERVED';return;}
  const context=await request(root);detail.context=context;
  if(!/^\d{12}$/.test(context.client?.iin||'')){out.skipped='DEAL_IDENTITY_UNVERIFIED';return;}
  let draft=(await request(root+'/draft')).draft;
  const before=await state(context.caseId);detail.before=before;guard(before,context,draft);await available(item.dealId);
  const historical=before.drafts.map(x=>JSON.parse(x.payload_json));
  const previousDocIds=new Set(historical.flatMap(x=>x.documents.map(d=>d.documentId)));
  const initiallySelected=new Set(draft?.payload.documents.map(d=>d.documentId)||[]);
  out.beforeRevision=draft?.revision||0;
  const selected=()=>new Set(draft?.payload.documents.map(d=>d.documentId)||[]);
  const analyses=[];
  async function freshGuard(){
   const freshContext=await request(root),freshDraft=(await request(root+'/draft')).draft;
   if(freshContext.identityRevision!==context.identityRevision||freshContext.client.iin!==context.client.iin||(freshDraft?.revision||0)!==(draft?.revision||0)||digest(freshDraft?storedPayload(freshDraft.payload):null)!==digest(draft?storedPayload(draft.payload):null))fail('DRAFT_CHANGED');
   const freshState=await state(context.caseId);guard(freshState,freshContext,freshDraft);preserved(before,freshState);await available(item.dealId);
  }
  async function save(payload,reason,changes=[]){
   const clean=validateDraft(payload);if(!isDeepStrictEqual(clean,payload))fail('PAYLOAD_NORMALIZATION_REQUIRED');
   await freshGuard();
   const intent={requestId:randomUUID(),reason,expectedRevision:draft?.revision||0,beforeHash:digest(draft?storedPayload(draft.payload):null),afterHash:digest(payload),payload,changes};
   detail.writes.push(intent);checkpoint();
   let response,error;
   try{response=await request(root+'/draft',{payload,expectedRevision:intent.expectedRevision,identityRevision:context.identityRevision,requestId:intent.requestId});}catch(e){error=e;}
   const receipt=(await dbRead('SELECT revision,request_id,payload_json,identity_revision FROM assessment_draft_versions WHERE case_id=? AND request_id=?',[context.caseId,intent.requestId]))[0];
   if(!receipt){intent.error=safeCode(error);fail('DRAFT_WRITE_NOT_CONFIRMED');}
   if(receipt.revision!==intent.expectedRevision+1||receipt.identity_revision!==context.identityRevision||digest(JSON.parse(receipt.payload_json))!==intent.afterHash||response&&response.revision!==receipt.revision)fail('DRAFT_RECEIPT_MISMATCH');
   const after=(await request(root+'/draft')).draft;
   if(after?.revision!==receipt.revision||digest(storedPayload(after.payload))!==intent.afterHash)fail('DRAFT_CHANGED_AFTER_WRITE');
   intent.verified=true;intent.revision=receipt.revision;draft=after;
   out.writes.push({requestId:intent.requestId,reason,revision:receipt.revision,verified:true});
  }
  // Reuse persisted selections first. This never revives removed selections.
  if(draft)for(const documentId of [...selected()]){
   const doc=draft.payload.documents.find(d=>d.documentId===documentId);
   if(doc.person!=='Клиент'||/ЭЦП|парол|Подписанный договор/iu.test(doc.type))continue;
   try{
    const result=(await request(root+'/documents/analyze',{identityRevision:context.identityRevision,documentIds:[documentId]})).results[0];
    const a=result.error==='CACHE_REPROCESS_REQUIRED'?await request(root+'/documents/'+encodeURIComponent(documentId)+'/analyze',{cacheOnly:false}):result.analysis;
    if(!a)throw Object.assign(Error(),{code:result.error});analyses.push(a);
   }catch(e){out.imports.push({documentId,error:safeCode(e)});}
  }
  const references=(await request(root+'/crm-documents')).files;detail.references=references;
  const candidates=crmImportCandidates(references);
  out.availableDocuments=references.length;out.candidateDocuments=candidates.length;
  const selectedFileIds=new Set(before.reviews.filter(r=>r.fact_key==='document.origin.bitrix.v1'&&selected().has(r.document_id)).map(r=>{try{return JSON.parse(r.value_json).fileId;}catch{return null;}}));
  const removedFileIds=new Set(before.reviews.filter(r=>r.fact_key==='document.origin.bitrix.v1'&&previousDocIds.has(r.document_id)&&!initiallySelected.has(r.document_id)).map(r=>{try{return JSON.parse(r.value_json).fileId;}catch{return null;}}));
  for(const ref of candidates){
   const result={fileId:ref.id};
   if(selectedFileIds.has(ref.id)){result.skipped='ALREADY_SELECTED';out.imports.push(result);continue;}
   if(removedFileIds.has(ref.id)){result.skipped='STAFF_REMOVED_DOCUMENT_PRESERVED';out.imports.push(result);continue;}
   if(!apply){result.skipped='IMPORT_PREVIEW_ONLY';out.imports.push(result);continue;}
   await freshGuard();
   try{
    let a;
    try{a=await request(root+'/crm-documents',{fileId:ref.id,identityRevision:context.identityRevision});}
    catch(e){
     // An uncertain import is reconciled by its original receipt, never retried.
     if(e.status)throw e;
     const recovered=await request(root+'/crm-documents?fileId='+ref.id+'&identityRevision='+context.identityRevision);
     if(recovered.pending)throw e;a=recovered;
    }
    Object.assign(result,{documentId:a.documentId,kind:a.document?.extraction?.kind,eligible:a.eligibleForAutofill,findings:a.findings,pages:a.document?.totalPages});
    detail.analyses.push(a);
    if(previousDocIds.has(a.documentId)&&!initiallySelected.has(a.documentId)){result.skipped='STAFF_REMOVED_DOCUMENT_PRESERVED';continue;}
    if(!analyses.some(x=>x.documentId===a.documentId))analyses.push(a);
    const current=draft?storedPayload(draft.payload):blankProfileDraft();
    const appended=appendProfileDocument(current,a,context);
    if(appended.skipped){result.skipped=appended.skipped;continue;}
    if(digest(appended.payload)!==digest(current))await save(appended.payload,'import-document');
    result.selected=true;
   }catch(e){result.error=safeCode(e);if(['DRAFT_CHANGED','DRAFT_WRITE_NOT_CONFIRMED','DRAFT_CHANGED_AFTER_WRITE','DRAFT_RECEIPT_MISMATCH','PROTECTED_RECEIPTS_CHANGED','PROFILE_IN_USE','COMPLETED_PROFILE_PRESERVED','CASE_IDENTITY_CHANGED','PENDING_EXTERNAL_OPERATION','PENDING_PROFILE_OPERATION'].includes(result.error))throw e;}
   finally{out.imports.push(result);}
  }
  detail.analyses=analyses;
  if(!draft){out.skipped='NO_ACCESSIBLE_MATCHED_DOCUMENT';return;}
  const history=deriveProfileFillHistory(storedPayload(draft.payload),historical);
  // A separate checked “unknown” control is an explicit staff answer too.
  for(const a of draft.payload.answers)if(a.key.startsWith('unknown:')&&a.checked)history.protectedFields.push({key:a.key.slice(8)});
  for(const g of draft.payload.groups)for(const [row,answers]of g.rows.entries())for(const a of answers)if(a.key.startsWith('unknown:')&&a.checked)history.protectedFields.push({group:g.id,row,key:a.key.slice(8)});
  const canonicalPlan=planProfileSourceFill(draft,context,[],validateDraft,history);
  const identityPlan=extendProfileDocumentFacts({...draft,payload:canonicalPlan.payload},context,analyses,validateDraft,history);
  for(const item of identityPlan.skipped)if(item.code==='CONFLICTING_DOCUMENT_VALUES')history.protectedFields.push({key:item.key});
  const basePlan=planProfileSourceFill({...draft,payload:identityPlan.payload},context,analyses,validateDraft,history);
  const plan={...basePlan,changes:[...identityPlan.changes,...basePlan.changes],skipped:[...identityPlan.skipped,...basePlan.skipped],sources:[...identityPlan.sources,...basePlan.sources],migrated:canonicalPlan.migrated,beforeHash:digest(storedPayload(draft.payload)),planHash:digest({canonical:canonicalPlan.planHash,identity:identityPlan.planHash,base:basePlan.planHash})};
  detail.plans.push(plan);out.proposedFields=plan.changes.length;out.newLoans=plan.newLoans;out.planSkipped=plan.skipped;
  if(plan.changes.length&&apply)await save(plan.payload,'source-fill',plan.changes);
  out.changes=plan.changes.map(({value,...x})=>({...x,valueHash:digest(value)}));
  const check=await request(root+'/profile',{action:'check',requestId:randomUUID(),draft:storedPayload(draft.payload)});
  out.ready=check.ready;out.remainingIssues=(check.issues||[]).map(({code,key,group,row,label})=>({code,key,group,row,label}));
  out.afterRevision=draft.revision;out.documents=draft.payload.documents.length;
  const after=await state(context.caseId);detail.after=after;preserved(before,after);guard(after,context,draft);
  out.protectedRecordsPreserved=true;out.filledFields=apply?plan.changes.length:0;out.verified=true;
 }catch(e){out.error=safeCode(e);detail.error=out.error;}
 finally{checkpoint();console.log(JSON.stringify({dealId:out.dealId,finished:publicReport.cases.filter(c=>c.verified||c.error||c.skipped).length,filled:out.filledFields||0,imports:out.imports.filter(x=>x.selected).length,skipped:out.skipped,error:out.error}));}
}
try{
 if(process.env.PROFILE_DOCUMENT_SESSION_FILE){
  const session=JSON.parse(readFileSync(process.env.PROFILE_DOCUMENT_SESSION_FILE,'utf8'));
  if(typeof session.cookie!=='string'||!session.cookie||Date.now()-Date.parse(session.issuedAt)>3600000)fail('SESSION_EXPIRED');
  cookie=session.cookie;
 }else{
  if(!process.env.ASSESSMENT_TEST_PASSWORD)fail('AUTHENTICATION_NOT_CONFIGURED');
  await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 }
 if(sessionOnly){
  if(apply)fail('SESSION_BOOTSTRAP_MUST_BE_READ_ONLY');
  const activity=await request('/api/profile-activity');if(activity.currentWorker!=='ali')fail('OWNER_SESSION_REQUIRED');
  privateReport.session={cookie,issuedAt:new Date().toISOString()};publicReport.sessionReady=true;
 }else{
 if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)fail('AUTHENTICATION_NOT_CONFIGURED');
 const queue=(await request('/api/profile-queue')).items;privateReport.queue=queue;publicReport.queueCount=queue.length;
 if(requested.some(id=>!queue.some(x=>x.dealId===id)))fail('CASE_NOT_IN_CURRENT_QUEUE');
 const targets=requested.length?queue.filter(x=>requested.includes(x.dealId)):queue;let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<targets.length)await runCase(targets[next++]);}));
 }
}catch(e){publicReport.error=safeCode(e);process.exitCode=1;}
publicReport.finishedAt=new Date().toISOString();
publicReport.summary={queue:publicReport.queueCount,checked:publicReport.cases.length,changed:publicReport.cases.filter(x=>x.writes.length).length,createdDrafts:publicReport.cases.filter(x=>x.beforeRevision===0&&x.writes.length).length,filledFields:publicReport.cases.reduce((n,x)=>n+(x.filledFields||0),0),selectedDocuments:publicReport.cases.reduce((n,x)=>n+x.imports.filter(i=>i.selected).length,0),errors:publicReport.cases.filter(x=>x.error).length};
checkpoint();console.log(JSON.stringify(publicReport.summary));
