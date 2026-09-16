import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {webcrypto} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {httpHeaders} from './bitrix-headers-helper.mjs'; function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./http-headers'?httpHeaders:imports[n],crypto:webcrypto,TextEncoder,Uint8Array,Date,JSON});return exports;}
const evidence=load('lib/documents/repository.ts');
const {SubmissionRepository}=load('lib/questionnaire/submission-repository.ts',{'../documents/repository':evidence});
const write=load('lib/crm/assessment-write.ts');
const {submitValidatedAssessment}=load('lib/questionnaire/submission-service.ts',{'../crm/assessment-write':write});
const actor={id:'worker:ramazan',authentication:'shared-password-worker-selection'},record={id:'case',identity_revision:1};
const payload={schemaVersion:1,draft:{test:'synthetic snapshot'},baseline:{test:'before'},values:{test:'after'},reviewIds:[],validationVersion:'test',assessmentDay:'2026-09-10'};
const first='00000000-0000-0000-0000-000000000001',second='00000000-0000-0000-0000-000000000002';
function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 sqlite.exec("INSERT INTO assessment_cases (id,external_system,external_id,title,created_at,updated_at) VALUES ('case','bitrix','11665','SYNTHETIC','now','now')");
 const db={prepare(sql){return {bind(...args){const q=sqlite.prepare(sql);return {async run(){return {meta:{changes:Number(q.run(...args).changes)}};},async first(){return q.get(...args)||null;}};}};}};
 return {sqlite,db,repo:new SubmissionRepository(db)};
}
test('immutable submission retries survive a repository restart',async()=>{
 const {repo,db}=setup();const saved=await repo.prepare(record,first,payload,actor);
 const restored=await new SubmissionRepository(db).prepare(record,first,payload,actor);
 assert.equal(saved.id,restored.id);assert.equal(restored.authentication,actor.authentication);
 await assert.rejects(repo.prepare(record,first,{...payload,values:{test:'changed'}},actor),/IDEMPOTENCY_KEY_REUSED/);
});
test('only one submission per case can be active and only one worker can claim it',async()=>{
 const {repo}=setup();await repo.prepare(record,first,payload,actor);
 await assert.rejects(repo.prepare(record,second,payload,actor),/SUBMISSION_PENDING/);
 assert.equal(await repo.claim(record,first),true);assert.equal(await repo.claim(record,first),false);
 await repo.finish(record.id,first,false,'READBACK_UNCERTAIN');
 assert.equal(await repo.claim(record,first),false);
 await assert.rejects(repo.prepare(record,second,payload,actor),/SUBMISSION_PENDING/);
});
test('verified outcome releases case and cannot be downgraded by a late failure',async()=>{
 const {repo}=setup();await repo.prepare(record,first,payload,actor);await repo.claim(record,first);
 await repo.finish(record.id,first,true,'READBACK_VERIFIED');await repo.finish(record.id,first,false,'LATE_TIMEOUT');
 assert.equal((await repo.get(record.id,first)).state,'verified');
 assert.equal((await repo.prepare(record,second,payload,actor)).state,'prepared');
});
test('identity revision change prevents both preparation and claiming old work',async()=>{
 const {repo,sqlite}=setup();await repo.prepare(record,first,payload,actor);
 sqlite.exec("UPDATE assessment_cases SET identity_revision=2 WHERE id='case'");
 assert.equal(await repo.claim(record,first),false);
 await assert.rejects(repo.prepare(record,second,payload,actor),/SUBMISSION_PENDING_OR_IDENTITY_CHANGED/);
});
test('service records verified result once and retry returns its durable receipt',async()=>{
 const {repo,db}=setup();let saves=0;
 const adapter={save:async()=>{saves++;return {verified:true};}};
 const client={...record,client_iin:'000000000001',external_id:'11665'};
 const a=await submitValidatedAssessment(repo,adapter,client,first,payload,actor);
 const b=await submitValidatedAssessment(new SubmissionRepository(db),adapter,client,first,payload,actor);
 assert.equal(a.state,'verified');assert.equal(a.id,b.id);assert.equal(saves,1);
});
test('service retains uncertain outcome without resending on browser retry',async()=>{
 const {repo}=setup();let saves=0;
 const adapter={save:async()=>{saves++;throw new write.AssessmentWriteError('ASSESSMENT_SAVE_UNCERTAIN');}};
 const client={...record,client_iin:'000000000001',external_id:'11665'};
 const a=await submitValidatedAssessment(repo,adapter,client,first,payload,actor);
 const b=await submitValidatedAssessment(repo,adapter,client,first,payload,actor);
 assert.equal(a.state,'uncertain');assert.equal(b.outcome_code,'ASSESSMENT_SAVE_UNCERTAIN');assert.equal(saves,1);
});
test('withdrawn review cannot be claimed between validation and the external write',async()=>{
 const {repo,sqlite}=setup();
 sqlite.exec("INSERT INTO assessment_documents VALUES ('doc','case','hash','key','synthetic.pdf',1,'worker','now'); INSERT INTO assessment_extractions VALUES ('ext','doc','v','key','hash','now');");
 const insert=sqlite.prepare('INSERT INTO assessment_reviews (id,request_id,case_id,document_id,extraction_id,identity_revision,fact_key,value_json,disposition,reason,actor_id,authentication,payload_hash,created_at) VALUES (?,?,\'case\',\'doc\',\'ext\',1,\'document.manual-check.v1\',\'null\',?,\'synthetic\',\'worker\',\'test\',\'hash\',\'now\')');
 insert.run('review','review-request','confirmed');await repo.prepare(record,first,{...payload,reviewIds:['review']},actor);insert.run('withdrawal','withdrawal-request','unresolved');assert.equal(await repo.claim(record,first),false);assert.equal((await repo.get(record.id,first)).state,'prepared');
});
test('cancelled preparation retains its snapshot and permits a new request; attempted writes cannot cancel',async()=>{
 const {repo,sqlite}=setup();const original=await repo.prepare(record,first,payload,actor);const cancelled=await repo.cancelPrepared(record.id,first,actor.id);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.payload_json,original.payload_json);assert.equal((await repo.cancelPrepared(record.id,first,actor.id)).state,'cancelled');assert.equal(await repo.claim(record,first),false);
 await repo.prepare(record,second,payload,actor);assert.equal(await repo.claim(record,second),true);assert.equal((await repo.cancelPrepared(record.id,second,actor.id)).state,'writing');await repo.finish(record.id,second,false,'TEST_UNCERTAIN');assert.equal((await repo.cancelPrepared(record.id,second,actor.id)).state,'uncertain');assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_submissions').get().n,2);
});
test('timeline receipt is independent, claimed once, and cannot downgrade after verification',async()=>{
 const {repo}=setup();await repo.prepare(record,first,payload,actor);assert.equal(await repo.claimHistory(record,first),false);await repo.claim(record,first);await repo.finish(record.id,first,true,'READBACK_VERIFIED');assert.equal(await repo.claimHistory(record,first),true);assert.equal(await repo.claimHistory(record,first),false);await repo.finishHistory(record.id,first,null,'LOST');let row=await repo.get(record.id,first);assert.equal(row.state,'verified');assert.equal(row.history_state,'uncertain');await repo.finishHistory(record.id,first,'123','HISTORY_READBACK_VERIFIED');await repo.finishHistory(record.id,first,null,'LATE_FAILURE');row=await repo.get(record.id,first);assert.equal(row.history_state,'verified');assert.equal(row.history_comment_id,'123');
});
test('resume lookup is actor-scoped and excludes cancelled preparations',async()=>{
 const {repo}=setup();await repo.prepare(record,first,payload,actor);assert.equal((await repo.latest(record.id,actor.id)).request_id,first);assert.equal(await repo.latest(record.id,'other-worker'),null);await repo.cancelPrepared(record.id,first,actor.id);assert.equal(await repo.latest(record.id,actor.id),null);await repo.prepare(record,second,payload,actor);assert.equal((await repo.latest(record.id,actor.id)).request_id,second);
});
