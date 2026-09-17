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
  crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Date: clock, JSON, Set, Map, AbortSignal, setTimeout, clearTimeout});
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
  counts:()=>({cardWrites,historyWrites,validations}),service,adapter,historyAdapter};
}


function coordinator(f){
 const {completeSubmission,submissionProgress}=load('lib/questionnaire/complete-submission.ts',{
  '../documents/repository':evidence,'./final-submission':f.service,'./submission-history':{saveSubmissionHistory},
 });
 const deps={repository:new evidence.EvidenceRepository(f.db,{}),submissions:f.repo,assessment:f.adapter,history:f.historyAdapter};
 const run=(id=request1,input=f.draft,actor=f.actor,deadline)=>completeSubmission(deps,f.record,actor,id,'2026-09-17',input===null?undefined:{identityRevision:f.record.identity_revision,payload:input,bindings:[]},deadline);
 return {run,submissionProgress};
}
test('one coordinator call persists card and history, then returns the immutable contract',async t=>{
 const f=fixture(t),c=coordinator(f),result=await c.run();
 assert.equal(result.workflow.status,'ready');assert.equal(result.contract.data.contract_number,'TEST');
 assert.equal(result.row.state,'verified');assert.equal(result.row.history_state,'verified');
 assert.deepEqual([f.counts().cardWrites,f.counts().historyWrites],[1,1]);
});
test('repeated click and page reload return the same contract without another CRM write or history entry',async t=>{
 const f=fixture(t),c=coordinator(f),first=await c.run();
 const again=await c.run(request2);assert.equal(again.row.id,first.row.id);assert.equal(again.row.request_id,request1);
 const resumed=await c.run(request1,null);assert.equal(resumed.workflow.status,'ready');
 assert.deepEqual([f.counts().cardWrites,f.counts().historyWrites],[1,1]);
});
test('known pending row resumes by durable ID without committing twice',async t=>{
 const f=fixture(t),c=coordinator(f);await f.prepare();f.options.readbackFails=true;await f.commit();
 f.options.readbackFails=false;const result=await c.run(request1,null);
 assert.equal(result.workflow.status,'ready');assert.equal(f.counts().cardWrites,1);assert.equal(f.counts().historyWrites,1);
});
test('coordinator resolves delayed readback within the original command',async t=>{
 const f=fixture(t),c=coordinator(f);f.options.readbackFails=true;
 const reconcile=f.adapter.reconcile;f.adapter.reconcile=async(...args)=>{f.options.readbackFails=false;return reconcile(...args);};
 const result=await c.run();assert.equal(result.workflow.status,'ready');assert.equal(f.counts().cardWrites,1);
});
test('persistently mismatched readback is bounded and never converted into another send',async t=>{
 const f=fixture(t),c=coordinator(f);f.options.rejectWrite=true;
 let readbacks=0;const reconcile=f.adapter.reconcile;f.adapter.reconcile=async(...args)=>{readbacks++;return reconcile(...args);};
 const result=await c.run();assert.equal(result.contract,null);assert.equal(result.row.state,'uncertain');assert.equal(readbacks,3);
 await c.run(request2);assert.equal(readbacks,6);assert.equal(f.counts().cardWrites,1);assert.equal(f.counts().historyWrites,0);
});
test('proven-unsent card is retried only on the next explicit command',async t=>{
 const f=fixture(t),c=coordinator(f);await f.prepare();f.options.readFails=true;
 const result=await c.run(request1,null);assert.equal(result.workflow.status,'retry');assert.equal(result.row.state,'prepared');assert.equal(f.counts().cardWrites,0);
 f.options.readFails=false;assert.equal((await c.run(request2)).workflow.status,'ready');assert.equal(f.counts().cardWrites,1);
});
test('a history preflight failure does not poison or resend the verified card',async t=>{
 const f=fixture(t),c=coordinator(f);f.options.historyReadFails=true;
 const result=await c.run();assert.equal(result.row.state,'verified');assert.equal(result.row.history_state,'pending');assert.equal(result.contract,null);
 f.options.historyReadFails=false;assert.equal((await c.run(request2)).workflow.status,'ready');
 assert.deepEqual([f.counts().cardWrites,f.counts().historyWrites],[1,1]);
});
test('a history write with lost confirmation is read-only on subsequent coordinator calls',async t=>{
 const f=fixture(t),c=coordinator(f),append=f.historyAdapter.append;let reconciles=0;
 f.historyAdapter.append=async(...args)=>{const receipt=await append(...args);f.options.historyReadFails=true;throw Error('lost receipt '+receipt.commentId);};
 const reconcile=f.historyAdapter.reconcile;f.historyAdapter.reconcile=async(...args)=>{reconciles++;return reconcile(...args);};
 const stopped=await c.run();assert.equal(stopped.contract,null);assert.equal(stopped.row.history_state,'uncertain');
 f.options.historyReadFails=false;assert.equal((await c.run(request2)).workflow.status,'ready');
 assert.ok(reconciles>0);assert.deepEqual([f.counts().cardWrites,f.counts().historyWrites],[1,1]);
});
test('simultaneous identical commands serialize external writes in the real repository',async t=>{
 const f=fixture(t),c=coordinator(f);const results=await Promise.all([c.run(request1),c.run(request2)]);
 assert.equal(results[0].row.id,results[1].row.id);assert.deepEqual([f.counts().cardWrites,f.counts().historyWrites],[1,1]);
});
test('wrong employee cannot resume or download another employee snapshot',async t=>{
 const f=fixture(t),c=coordinator(f);await f.prepare();
 await assert.rejects(c.run(request1,null,{...f.actor,id:'other-worker'}),/SUBMISSION_ACTOR_OR_IDENTITY_CHANGED/);
 assert.equal(f.counts().cardWrites,0);
});
test('changed identity during a long command blocks history and contract output',async t=>{
 const f=fixture(t),c=coordinator(f),save=f.adapter.save;
 f.adapter.save=async(...args)=>{const result=await save(...args);f.sqlite.exec("UPDATE assessment_cases SET identity_revision=2 WHERE id='case'");return result;};
 await assert.rejects(c.run(),/CASE_IDENTITY_CHANGED/);assert.equal(f.counts().historyWrites,0);
});
test('expired budget leaves prepared state intact instead of starting an external write',async t=>{
 const f=fixture(t),c=coordinator(f);await f.prepare();
 const result=await c.run(request1,null,f.actor,Date.now()-1);
 assert.equal(result.row.state,'prepared');assert.equal(result.contract,null);assert.equal(f.counts().cardWrites,0);
});
test('known CRM conflict stays a review, not an invitation to blindly overwrite',async t=>{
 const f=fixture(t),c=coordinator(f);await f.prepare();f.state.card='EXTERNAL CHANGE';
 const result=await c.run(request1,null);assert.equal(result.workflow.status,'review');assert.match(result.workflow.message,/Карточка изменилась/);assert.equal(f.counts().cardWrites,0);
});
test('cancelled snapshot cannot be resurrected through resume',async t=>{
 const f=fixture(t),c=coordinator(f);await f.prepare();await f.repo.cancelPrepared(f.record.id,request1,f.actor.id);
 const result=await c.run(request1,null);assert.equal(result.workflow.status,'cancelled');assert.equal(result.contract,null);assert.equal(f.counts().cardWrites,0);
});
