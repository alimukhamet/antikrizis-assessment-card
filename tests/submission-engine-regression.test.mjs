/** Real repository + real CRM adapters + real save services. Only document approval and network are synthetic. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {httpHeaders} from './bitrix-headers-helper.mjs';

function load(file, imports = {}, clock = Date) {
 const exports = {};
 const compiled=ts.transpileModule(fs.readFileSync(new URL('../'+file, import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}, reportDiagnostics:true,
 });
 const errors=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,file+': '+errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; '));
 vm.runInNewContext(compiled.outputText, {exports, require: name => name === './http-headers' ? httpHeaders : imports[name],
  crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Date: clock, JSON, Set, Map, AbortSignal});
 return exports;
}
const evidence = load('lib/documents/repository.ts');
const {SubmissionRepository} = load('lib/questionnaire/submission-repository.ts', {'../documents/repository': evidence});
const write = load('lib/crm/assessment-write.ts');
const history = load('lib/crm/assessment-history.ts');
const {submitValidatedAssessment} = load('lib/questionnaire/submission-service.ts', {'../crm/assessment-write': write});
const {saveSubmissionHistory} = load('lib/questionnaire/submission-history.ts', {
 '../documents/repository': evidence, '../crm/assessment-history': history,
});
const request1 = '00000000-0000-0000-0000-000000000001';
const request2 = '00000000-0000-0000-0000-000000000002';
const request3 = '00000000-0000-0000-0000-000000000003';
const iin = '000000000001';
const values = {fio:'SYNTHETIC CLIENT',iin,dognum:'TEST',marital:'Холост / не замужем',procedure:'199',debt:'123.45',comment:'TEST ONLY',contractDate:'2026-09-17',months:'5',payDay:'7',grafType:'423',grafText:'TEST SCHEDULE',card:'TEST CARD',summa:'500000',currency:'KZT'};
function fixture(t) {
 const sqlite = new DatabaseSync(':memory:');
 t.after(() => sqlite.close());
 sqlite.exec('PRAGMA foreign_keys=ON');
 for (const file of fs.readdirSync(new URL('../drizzle/', import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file, import.meta.url), 'utf8'));
 }
 sqlite.exec("INSERT INTO assessment_cases (id,external_system,external_id,client_iin,title,created_at,updated_at) VALUES ('case','bitrix','11665','000000000001','SYNTHETIC','now','now')");
 const db = {prepare(sql) {return {bind(...args) {const q = sqlite.prepare(sql); return {
  async first() {return q.get(...args) || null;}, async run() {return {meta:{changes:Number(q.run(...args).changes)}};},
 };}};}};
 const repo = new SubmissionRepository(db);
 const record = sqlite.prepare('SELECT * FROM assessment_cases').get();
 const actor = {id:'worker:synthetic',displayName:'SYNTHETIC',authentication:'test'};
 const draft = {schemaVersion:1,answers:[{key:'fio',value:'SYNTHETIC CLIENT',checked:false}],groups:[],documents:[],pendingFiles:[],docContext:{salary:'0',social:'0'}};
 const baseline = {...values,card:'BEFORE',debt:'100.00'};
 const state = {...baseline}, calls = [], comments = [];
 const options = {readFails:false,readbackFails:false,rejectWrite:false,loseResponse:false,historyReadFails:false};
 let cardWrites = 0, historyWrites = 0, validations = 0;
 const send = async (url, init) => {
  const method = url.split('/').at(-1).replace('.json',''); calls.push(method);
  const body = JSON.parse(init.body);
  if (method === 'crm.deal.get') {
   if (options.readFails || (options.readbackFails && cardWrites > 0)) throw Error('SYNTHETIC READ FAILURE');
   return Response.json({result:{ID:'11665',...Object.fromEntries(Object.entries(write.ASSESSMENT_FIELDS).map(([key,field])=>[field,state[key]]))}});
  }
  if (method === 'crm.deal.update') {
   cardWrites++;
   if (!options.rejectWrite) for (const [key,field] of Object.entries(write.ASSESSMENT_FIELDS)) state[key] = body.fields[field];
   if (options.loseResponse) throw Error('SYNTHETIC LOST RESPONSE');
   return Response.json(options.rejectWrite ? {error:'SYNTHETIC_REJECTED'} : {result:true});
  }
  if (method === 'crm.timeline.comment.list') {
   if (options.historyReadFails) throw Error('SYNTHETIC HISTORY READ FAILURE');
   return Response.json({result:comments});
  }
  assert.equal(method,'crm.timeline.comment.add');
  historyWrites++;
  comments.push({ID:String(comments.length+1),ENTITY_ID:'11665',ENTITY_TYPE:'deal',COMMENT:body.fields.COMMENT});
  return Response.json({result:comments.length});
 };
 const adapter = write.createAssessmentAdapter('https://synthetic.invalid/',send);
 const historyAdapter = history.createAssessmentHistoryAdapter('https://synthetic.invalid/',send);
 let time = Date.parse('2026-09-17T08:00:00Z');
 class Clock extends Date {constructor(...args) {super(...(args.length ? args : [time++]));}}
 const service = load('lib/questionnaire/final-submission.ts', {
  '../documents/repository':evidence, './submission-service':{submitValidatedAssessment},
  './draft':{validateDraft: v=>structuredClone(v)},
  './review-bindings':{parseReviewBindings: v=>structuredClone(v||[])},
  '../../public/contract-words.mjs':{CONTRACT_RENDERER_VERSION:'a'.repeat(64)},
  './history-snapshot':load('lib/questionnaire/history-snapshot.ts'),
  './final-check':{FINAL_VALIDATION_VERSION:'test-version',finalCheck: async (r,c,d) => {
   validations++;
   return {payload:d,compiled:{values,lawyerCard:'LAWYER'},reviewIds:[],publicResult:{readyToSubmit:true,preview:{contractData:{contract_number:'TEST'}},evidence:{approved:[]}}};
  }},
 }, Clock);
 const prepare = (id=request1,input=draft,as=actor) => service.prepareFinalSubmission({},repo,adapter,record,as,id,1,input,[],'2026-09-17');
 const commit = (id=request1) => service.commitFinalSubmission({},repo,adapter,record,actor,id,'2026-09-17');
 const reconcile = (id=request1) => service.reconcileFinalSubmission(repo,adapter,record,actor,id);
 const saveHistory = (id=request1) => saveSubmissionHistory(repo,historyAdapter,record,actor,id);
 return {sqlite,repo,db,record,actor,draft,state,options,calls,prepare,commit,reconcile,saveHistory,
  counts:()=>({cardWrites,historyWrites,validations}),service};
}

test('page reload reuses the same preparation despite a new request ID and clock tick',async t=>{
 const f=fixture(t),first=await f.prepare();
 const retried=await f.prepare(request2);
 assert.equal(retried.request_id,first.request_id);
 assert.equal(retried.payload_json,first.payload_json);
 assert.equal(f.counts().validations,1);
 assert.equal(f.calls.length,1);
});
test('uncertain save survives reload without rebuilding against its changed CRM baseline',async t=>{
 const f=fixture(t);await f.prepare();f.options.readbackFails=true;
 assert.equal((await f.commit()).state,'uncertain');
 const retried=await f.prepare(request2);
 assert.equal(retried.request_id,request1);
 f.options.readbackFails=false;
 assert.equal((await f.reconcile(retried.request_id)).state,'verified');
 await f.saveHistory(retried.request_id);
 assert.equal((await f.service.savedContract(f.repo,f.record,f.actor,retried.request_id)).data.contract_number,'TEST');
 assert.equal(f.counts().cardWrites,1);
});
test('completed contract download after reload does not create another submission or timeline entry',async t=>{
 const f=fixture(t);await f.prepare();await f.commit();await f.saveHistory();
 assert.equal((await f.prepare(request2)).request_id,request1);
 await f.saveHistory();
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM assessment_submissions').get().n,1);
 assert.deepEqual([f.counts().cardWrites,f.counts().historyWrites],[1,1]);
});
test('a failed pre-write read is retryable, not an uncertain external write',async t=>{
 const f=fixture(t);await f.prepare();f.options.readFails=true;
 const failed=await f.commit();
 assert.equal(failed.state,'prepared');assert.match(failed.outcome_code,/^NOT_SENT:/);
 assert.equal(f.counts().cardWrites,0);
 f.options.readFails=false;
 assert.equal((await f.commit()).state,'verified');assert.equal(f.counts().cardWrites,1);
});
test('a CRM conflict before sending does not poison the case or overwrite the external edit',async t=>{
 const f=fixture(t);await f.prepare();f.state.card='EXTERNAL EDIT';
 const result=await f.commit();
 assert.equal(result.state,'prepared');assert.equal(result.outcome_code,'NOT_SENT:ASSESSMENT_CHANGED_IN_CRM');
 assert.equal(f.counts().cardWrites,0);
 assert.equal((await f.prepare(request2)).request_id,request1);
 assert.equal((await f.commit()).state,'prepared');assert.equal(f.state.card,'EXTERNAL EDIT');
});
test('history read failure before append remains pending and can be retried safely',async t=>{
 const f=fixture(t);await f.prepare();await f.commit();f.options.historyReadFails=true;
 assert.equal((await f.saveHistory()).history_state,'pending');assert.equal(f.counts().historyWrites,0);
 f.options.historyReadFails=false;
 assert.equal((await f.saveHistory()).history_state,'verified');assert.equal(f.counts().historyWrites,1);
});
test('once a write was attempted, rejection or lost readback must never release it for another send',async t=>{
 const f=fixture(t);await f.prepare();f.options.rejectWrite=true;
 assert.equal((await f.commit()).state,'uncertain');
 assert.equal((await f.commit()).state,'uncertain');
 assert.equal(f.counts().cardWrites,1);
 const changed={...f.draft,answers:[{key:'fio',value:'CHANGED',checked:false}]};
 await assert.rejects(f.prepare(request2,changed),/SUBMISSION_PENDING/);
 assert.equal(f.counts().cardWrites,1);
});
test('cross-worker and changed client identity cannot adopt another unfinished save',async t=>{
 const f=fixture(t);await f.prepare();
 await assert.rejects(f.prepare(request2,f.draft,{...f.actor,id:'other'}),/SUBMISSION_PENDING|SUBMISSION_OWNED/);
 f.sqlite.exec("UPDATE assessment_cases SET identity_revision=2 WHERE id='case'");f.record.identity_revision=2;
 await assert.rejects(f.service.prepareFinalSubmission({},f.repo,{},f.record,f.actor,request2,2,f.draft,[],'2026-09-17'),/SUBMISSION_PENDING|CASE_IDENTITY|SUBMISSION_ACTOR/);
 assert.equal(f.counts().cardWrites,0);
});
test('service uses the durable request ID and snapshot returned by repository recovery',async t=>{
 const f=fixture(t),first=await f.prepare(),payload=JSON.parse(first.payload_json);
 const result=await submitValidatedAssessment(f.repo,write.createAssessmentAdapter('https://synthetic.invalid/',async(url,init)=>{
  assert.equal(JSON.parse(init.body).id,'11665');
  if(url.endsWith('crm.deal.get.json'))return Response.json({result:{ID:'11665',...Object.fromEntries(Object.entries(write.ASSESSMENT_FIELDS).map(([k,v])=>[v,payload.values[k]]))}});
  assert.fail('Already applied values should not be written');
 }),f.record,request2,payload,f.actor);
 assert.equal(result?.request_id,request1);assert.equal(result?.state,'verified');
});
test('concurrent identical preparations choose one durable snapshot',async t=>{
 const f=fixture(t);
 const results=await Promise.all([f.prepare(request1),f.prepare(request2),f.prepare(request3)]);
 assert.equal(new Set(results.map(r=>r.request_id)).size,1);
 const id=results[0].request_id;
 await Promise.all([f.commit(id),f.commit(id)]);
 assert.equal((await f.repo.get(f.record.id,id)).state,'verified');
 assert.equal(f.counts().cardWrites,1);
});

test('original input bindings survive approval filtering and remain recognizable on reload',async t=>{
 const f=fixture(t),bindings=[{key:'n8040',group:'creditors',row:0,documentId:'test-doc',extractionId:'test-ext',factKey:'credits.0.debtOutstanding',reviewId:'test-review'}];
 const args=[{},f.repo,write.createAssessmentAdapter('https://synthetic.invalid/',async()=>Response.json({result:{ID:'11665',UF_CRM_AI_IIN:iin}})),f.record,f.actor];
 const first=await f.service.prepareFinalSubmission(...args,request1,1,f.draft,bindings,'2026-09-17');
 const second=await f.service.prepareFinalSubmission(...args,request2,1,f.draft,bindings,'2026-09-17');
 assert.equal(second.request_id,first.request_id);assert.equal(f.counts().validations,1);
 assert.deepEqual(JSON.parse(first.payload_json).inputBindings,bindings);
});
test('late unsent reports cannot downgrade a verified card or a verified history receipt',async t=>{
 const f=fixture(t);await f.prepare();await f.commit();await f.saveHistory();
 const before=await f.repo.get(f.record.id,request1);
 await f.repo.releaseUnsent(f.record.id,request1,'LATE_READ_FAILURE');
 await f.repo.releaseHistoryUnsent(f.record.id,request1,'LATE_READ_FAILURE');
 const after=await f.repo.get(f.record.id,request1);
 assert.equal(after.state,'verified');assert.equal(after.history_state,'verified');
 assert.equal(after.history_comment_id,before.history_comment_id);
});
test('old uncertain rows are not automatically unlocked using an ambiguous historic error code',async t=>{
 const f=fixture(t);await f.prepare();await f.repo.claim(f.record,request1);
 await f.repo.finish(f.record.id,request1,false,'BITRIX_REQUEST_FAILED');
 assert.equal((await f.prepare(request2)).state,'uncertain');
 assert.equal((await f.commit()).state,'uncertain');assert.equal(f.counts().cardWrites,0);
});
test('a prepared snapshot claimed by a competing tab cannot be superseded',async t=>{
 const f=fixture(t),first=await f.prepare(),payload=JSON.parse(first.payload_json);
 const original=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{
  if(sql.includes("outcome_code='SUPERSEDED_BEFORE_WRITE'")){
   f.sqlite.prepare("UPDATE assessment_submissions SET state='writing' WHERE request_id=?").run(request1);
  }
  return original(sql);
 };
 await assert.rejects(f.repo.prepare(f.record,request2,{...payload,values:{...payload.values,card:'DIFFERENT'}},f.actor),/SUBMISSION_PENDING/);
 assert.equal((await f.repo.get(f.record.id,request1)).state,'writing');
 assert.equal(await f.repo.get(f.record.id,request2),null);
});
