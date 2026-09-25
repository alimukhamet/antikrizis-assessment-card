import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {httpHeaders} from './bitrix-headers-helper.mjs';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./http-headers'?httpHeaders:imports[n],crypto:webcrypto,TextEncoder,Uint8Array,Date,JSON,AbortSignal});return exports;}
const evidence=load('lib/documents/repository.ts');
const submissionModule=load('lib/questionnaire/submission-repository.ts',{'../documents/repository':evidence});
const repositoryModule=load('lib/questionnaire/title-repair-repository.ts',{'../documents/repository':evidence});
const crmModule=load('lib/crm/title-repair.ts',{'../documents/repository':evidence});
const service=load('lib/questionnaire/title-repair-service.ts',{'../documents/repository':evidence,'../crm/title-repair':crmModule,'./title-repair-repository':repositoryModule});
const owner={id:'worker:ali',worker:'ali',displayName:'Ali',authentication:'shared-password-worker-selection'},employee={...owner,id:'worker:darkhan',worker:'darkhan',displayName:'Darkhan'};
const record={id:'case',external_system:'bitrix',external_id:'900001',client_iin:'000000000010',identity_revision:1};
const payload={schemaVersion:1,draft:{answers:[{key:'fio',value:'ТЕСТОВЫЙ  КЛИЕНТ',checked:false}]},values:{iin:record.client_iin,fio:'ТЕСТОВЫЙ  КЛИЕНТ',procedure:'199',card:'immutable assessment'},reviewIds:[],baseline:{},contractData:{test:true},validationVersion:'test',assessmentDay:'2026-09-23'};
const plain=value=>JSON.parse(JSON.stringify(value));
function transport(){
 const s={deal:{ID:record.external_id,UF_CRM_AI_IIN:record.client_iin,UF_CRM_1773669702495:payload.values.fio,UF_CRM_1773655613972:'199',CATEGORY_ID:'1',STAGE_ID:'C1:NEW',TITLE:'Тестовый клиент - [whatcrm] line #21'},writes:[],reads:0,loseWriteResponse:false,loseReadback:false,skipWrite:false,onRead:null,afterWrite:null};
 s.send=async(url,options)=>{
  const method=url.split('/').at(-1),body=JSON.parse(options.body);
  if(method==='crm.deal.get.json'){s.reads++;await s.onRead?.(s);if(s.loseReadback&&s.writes.length)throw Error('readback unavailable');return{ok:true,json:async()=>({result:{...s.deal}})};}
  assert.equal(method,'crm.deal.update.json');assert.deepEqual(Object.keys(body.fields),['TITLE']);assert.equal(body.id,record.external_id);s.writes.push(body);
  if(!s.skipWrite)s.deal.TITLE=body.fields.TITLE;await s.afterWrite?.(s);if(s.loseWriteResponse)throw Error('response lost');return{ok:true,json:async()=>({result:true})};
 };
 return s;
}
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 sqlite.prepare("INSERT INTO assessment_cases (id,external_system,external_id,client_iin,title,created_at,updated_at) VALUES (?,'bitrix',?,?,'Synthetic','now','now')").run(record.id,record.external_id,record.client_iin);
 const hooks={beforeRun:null};
 const db={prepare(sql){return{bind(...args){return{async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){await hooks.beforeRun?.(sql,args);return{meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}};}};
 const submissions=new submissionModule.SubmissionRepository(db),id=webcrypto.randomUUID();await submissions.prepare(record,id,payload,employee);await submissions.claim(record,id);await submissions.finish(record.id,id,true,'READBACK_VERIFIED');await submissions.claimHistory(record,id);await submissions.finishHistory(record.id,id,'401','HISTORY_READBACK_VERIFIED');
 const submission=await submissions.get(record.id,id),state=transport(),repository=new repositoryModule.TitleRepairRepository(db),checks={delivery:0};
 const deps={repository,crm:crmModule.createTitleRepairAdapter('https://synthetic.invalid/rest/',state.send),verifyDelivery:async()=>{checks.delivery++;return{requestId:submission.request_id,payloadHash:submission.payload_hash};}};
 const inspect=()=>service.inspectTitleRepair(deps,record,submission);
 const input=async()=>({action:'repair',requestId:webcrypto.randomUUID(),expectedProposalHash:(await inspect()).proposalHash});
 return{sqlite,db,hooks,submissions,submission,state,repository,deps,checks,inspect,input,run:(input,actor=owner)=>service.runTitleRepair(deps,record,submission,actor,input)};
}
function originalColumns(row){return Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('title_repair_')));}
test('inspection is read-only; repair changes TITLE once and preserves the original assessment snapshot and receipts',async t=>{
 const f=await fixture(t),before=plain(f.submission),proposal=await f.inspect();assert.equal(proposal.status,'PROPOSED');assert.equal(proposal.desiredTitle,'ВП ТЕСТОВЫЙ КЛИЕНТ');assert.equal(f.state.writes.length,0);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_json,null);
 const input={action:'repair',requestId:webcrypto.randomUUID(),expectedProposalHash:proposal.proposalHash},result=await f.run(input);
 assert.equal(result.status,'VERIFIED');assert.deepEqual(f.state.writes,[{id:record.external_id,fields:{TITLE:'ВП ТЕСТОВЫЙ КЛИЕНТ'}}]);assert.equal(f.checks.delivery>=3,true);
 const after=await f.repository.get(record.id,f.submission.id),intent=JSON.parse(after.title_repair_json);assert.deepEqual(originalColumns(plain(after)),originalColumns(before));assert.equal(intent.actorId,owner.id);assert.equal(intent.submissionHash,before.payload_hash);assert.equal(intent.requestId,input.requestId);assert.equal(intent.policy,'VP_FIO_1');assert.equal(intent.before.categoryId,'1');assert.equal(intent.before.stageId,'C1:NEW');assert.equal(intent.before.procedure,'199');assert.equal(intent.before.title,proposal.beforeTitle);
 assert.equal((await f.run(input)).status,'VERIFIED');assert.equal(f.state.writes.length,1);
 assert.equal((await f.submissions.prepare(record,webcrypto.randomUUID(),payload,employee)).state,'prepared','A completed independent repair releases normal submissions');
});
test('already-correct titles are a NOOP without creating repair state',async t=>{
 const f=await fixture(t);f.state.deal.TITLE='ВП ТЕСТОВЫЙ КЛИЕНТ';const proposal=await f.inspect();assert.equal(proposal.status,'NOOP');assert.equal((await f.run({action:'repair',requestId:webcrypto.randomUUID(),expectedProposalHash:proposal.proposalHash})).status,'NOOP');assert.equal(f.state.writes.length,0);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_state,null);
});
test('scope, saved procedure, identity, exact FIO and custom titles fail closed without writes',async t=>{
 for(const change of [
  f=>f.state.deal.CATEGORY_ID='13',f=>f.state.deal.STAGE_ID='C1:OTHER',f=>f.state.deal.UF_CRM_AI_IIN='000000000029',f=>f.state.deal.UF_CRM_1773669702495='Другой клиент',f=>f.state.deal.UF_CRM_1773655613972='200',f=>f.state.deal.TITLE='Custom lawyer title',f=>f.state.deal.TITLE='Custom [whatcrm] title',f=>f.submission.payload_json=JSON.stringify({...payload,values:{...payload.values,procedure:'200'}}),
 ]){const f=await fixture(t);change(f);await assert.rejects(f.inspect());assert.equal(f.state.writes.length,0);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_state,null);}
});
test('a changed proposal and a non-owner cannot create an intent',async t=>{
 const f=await fixture(t),input=await f.input();await assert.rejects(f.run(input,employee),/OWNER_REQUIRED/);f.state.deal.TITLE='Changed client - [whatcrm] line #21';await assert.rejects(f.run(input),/TITLE_REPAIR_PROPOSAL_CHANGED/);assert.equal(f.state.writes.length,0);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_json,null);
});
test('lost update response is verified only by complete protected readback',async t=>{
 const f=await fixture(t),input=await f.input();f.state.loseWriteResponse=true;assert.equal((await f.run(input)).status,'VERIFIED');assert.equal(f.state.writes.length,1);
});
test('lost response and readback remain uncertain across restart and reconcile without a second update',async t=>{
 const f=await fixture(t),input=await f.input();f.state.loseWriteResponse=true;f.state.loseReadback=true;assert.equal((await f.run(input)).status,'UNCERTAIN');const intent=(await f.repository.get(record.id,f.submission.id)).title_repair_json;
 f.deps.repository=new repositoryModule.TitleRepairRepository(f.db);assert.equal((await f.run({...input,action:'reconcile'})).status,'UNCERTAIN');assert.equal(f.state.writes.length,1);f.state.loseReadback=false;assert.equal((await f.run({...input,action:'reconcile'})).status,'VERIFIED');assert.equal(f.state.writes.length,1);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_json,intent);
});
test('an unchanged old title after a claimed write does not authorize a resend',async t=>{
 const f=await fixture(t),input=await f.input();f.state.skipWrite=true;assert.equal((await f.run(input)).status,'UNCERTAIN');f.state.skipWrite=false;assert.equal((await f.run(input)).status,'UNCERTAIN');assert.equal(f.state.writes.length,1);assert.equal(f.state.deal.TITLE,'Тестовый клиент - [whatcrm] line #21');
});
test('changed protected CRM fields or changed assessment proof after a title update remain uncertain',async t=>{
 for(const change of [f=>f.state.afterWrite=s=>s.deal.CATEGORY_ID='2',f=>f.state.afterWrite=s=>s.deal.STAGE_ID='C1:OTHER',f=>f.state.afterWrite=s=>s.deal.UF_CRM_AI_IIN='000000000029',f=>f.state.afterWrite=s=>s.deal.UF_CRM_1773669702495='Changed name',f=>f.state.afterWrite=s=>s.deal.UF_CRM_1773655613972='200',f=>f.deps.verifyDelivery=async()=>{if(f.state.writes.length)throw Error('assessment changed');return{requestId:f.submission.request_id,payloadHash:f.submission.payload_hash};}]){
  const f=await fixture(t),input=await f.input();change(f);assert.equal((await f.run(input)).status,'UNCERTAIN');assert.equal(f.state.writes.length,1);assert.equal((await f.run({...input,action:'reconcile'})).status,'UNCERTAIN');assert.equal(f.state.writes.length,1);
 }
});
test('claimed writing state is reconciled read-only after worker interruption',async t=>{
 const f=await fixture(t),input=await f.input();let reached=false;
 f.deps.crm.repair=async()=>{reached=true;throw Error('worker interrupted before transport');};assert.equal((await f.run(input)).status,'UNCERTAIN');assert.equal(reached,true);
 f.sqlite.prepare("UPDATE assessment_submissions SET title_repair_state='writing' WHERE id=?").run(f.submission.id);f.deps.crm=crmModule.createTitleRepairAdapter('https://synthetic.invalid/rest/',f.state.send);assert.equal((await f.run({...input,action:'reconcile'})).status,'UNCERTAIN');assert.equal(f.state.writes.length,0);
});
test('normal submissions cannot prepare during a pending repair, including an insert race after preflight',async t=>{
 const f=await fixture(t),input=await f.input();f.state.skipWrite=true;await f.run(input);
 await assert.rejects(f.submissions.prepare(record,webcrypto.randomUUID(),payload,employee),/TITLE_REPAIR_PENDING/);
 f.sqlite.prepare("UPDATE assessment_submissions SET title_repair_state=NULL WHERE id=?").run(f.submission.id);
 f.hooks.beforeRun=async sql=>{if(sql.startsWith('INSERT INTO assessment_submissions')){f.hooks.beforeRun=null;f.sqlite.prepare("UPDATE assessment_submissions SET title_repair_state='uncertain' WHERE id=?").run(f.submission.id);}};
 await assert.rejects(f.submissions.prepare(record,webcrypto.randomUUID(),payload,employee),/SUBMISSION_PENDING_OR_IDENTITY_CHANGED/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM assessment_submissions').get().n,1);
});
test('normal submission claim and title claim each reject the competing unfinished operation',async t=>{
 const f=await fixture(t),input=await f.input();f.state.skipWrite=true;await f.run(input);
 f.sqlite.prepare("UPDATE assessment_submissions SET title_repair_state=NULL WHERE id=?").run(f.submission.id);const next=await f.submissions.prepare(record,webcrypto.randomUUID(),payload,employee);
 f.sqlite.prepare("UPDATE assessment_submissions SET title_repair_state='prepared' WHERE id=?").run(f.submission.id);assert.equal(await f.submissions.claim(record,next.request_id),false);assert.equal(await f.repository.claim(record,await f.repository.get(record.id,f.submission.id)),false);assert.equal((await f.submissions.get(record.id,next.request_id)).state,'prepared');assert.equal(f.state.writes.length,1);
});
test('newer or unfinished submissions and a changed delivery receipt cannot prepare title repair',async t=>{
 for(const change of [async f=>f.submissions.prepare(record,webcrypto.randomUUID(),payload,employee),async f=>f.sqlite.prepare("UPDATE assessment_submissions SET history_state='uncertain' WHERE id=?").run(f.submission.id),async f=>f.deps.verifyDelivery=async()=>({requestId:'different',payloadHash:f.submission.payload_hash})]){
  const f=await fixture(t),input=await f.input();await change(f);await assert.rejects(f.run(input),/TITLE_REPAIR_SUBMISSION_CHANGED/);assert.equal(f.state.writes.length,0);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_json,null);
 }
});
test('concurrent repair requests cannot claim a second title write or replace the immutable intent',async t=>{
 const f=await fixture(t),input=await f.input(),results=await Promise.allSettled([f.run(input),f.run(input)]);assert.equal(results.some(r=>r.status==='fulfilled'),true);assert.equal(f.state.writes.length,1);const row=await f.repository.get(record.id,f.submission.id),intent=row.title_repair_json;
 await assert.rejects(f.run({...input,requestId:webcrypto.randomUUID()}),/TITLE_REPAIR_PROPOSAL_CHANGED/);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_json,intent);assert.equal(f.state.writes.length,1);
});
test('a late uncertain result cannot downgrade verified independent title receipt',async t=>{
 const f=await fixture(t),input=await f.input();await f.run(input);const row=await f.repository.get(record.id,f.submission.id);assert.equal((await f.repository.finish(record,row,false)).title_repair_state,'verified');assert.equal(f.state.writes.length,1);
});
test('a terminal preflight title conflict cancels only the unsent repair and unblocks normal submissions',async t=>{
 const f=await fixture(t),input=await f.input();f.state.onRead=async s=>{if((await f.repository.get(record.id,f.submission.id)).title_repair_state==='writing')s.deal.TITLE='Custom lawyer title';};
 await assert.rejects(f.run(input),/TITLE_REPAIR_TITLE_CONFLICT/);const row=await f.repository.get(record.id,f.submission.id);assert.equal(row.title_repair_state,'cancelled');assert.ok(row.title_repair_json);assert.equal(f.state.writes.length,0);assert.deepEqual(originalColumns(plain(row)),originalColumns(plain(f.submission)));
 await assert.rejects(f.run(input),/TITLE_REPAIR_CANCELLED/);assert.equal((await f.submissions.prepare(record,webcrypto.randomUUID(),payload,employee)).state,'prepared');
});
test('temporary read failure before any title write stays prepared and safely retries the same immutable intent',async t=>{
 const f=await fixture(t),input=await f.input();f.state.onRead=async()=>{if((await f.repository.get(record.id,f.submission.id)).title_repair_state==='writing'){f.state.onRead=null;throw Error('temporary preflight read failure');}};
 await assert.rejects(f.run(input),/TITLE_REPAIR_CRM_UNAVAILABLE/);const row=await f.repository.get(record.id,f.submission.id);assert.equal(row.title_repair_state,'prepared');assert.equal(f.state.writes.length,0);
 assert.equal((await f.run(input)).status,'VERIFIED');assert.equal(f.state.writes.length,1);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_json,row.title_repair_json);
});
test('an exact owner retry may cancel a prepared intent invalidated by case identity, but cannot cancel uncertainty',async t=>{
 const f=await fixture(t),input=await f.input();f.deps.crm.repair=async()=>{throw new crmModule.TitleRepairError('TITLE_REPAIR_CRM_UNAVAILABLE',true);};await assert.rejects(f.run(input));
 f.sqlite.prepare('UPDATE assessment_cases SET identity_revision=2 WHERE id=?').run(record.id);await assert.rejects(service.runTitleRepair(f.deps,{...record,identity_revision:2},f.submission,owner,input),/TITLE_REPAIR_SUBMISSION_CHANGED/);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_state,'cancelled');assert.equal(f.state.writes.length,0);
 f.sqlite.prepare("UPDATE assessment_submissions SET title_repair_state='uncertain' WHERE id=?").run(f.submission.id);const row=await f.repository.get(record.id,f.submission.id);await f.repository.cancelUnsent(record,row);await f.repository.cancelUnsent(record,row,true);assert.equal((await f.repository.get(record.id,f.submission.id)).title_repair_state,'uncertain');
});
