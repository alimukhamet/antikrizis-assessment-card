import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {httpHeaders} from './bitrix-headers-helper.mjs'; function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='./http-headers'?httpHeaders:imports[name],crypto:webcrypto,TextEncoder,Uint8Array,Date,Set,Map,AbortSignal,JSON});return exports;}
const evidence=load('lib/documents/repository.ts');
const crm=load('lib/crm/lawyer-handoff.ts',{'../documents/repository':evidence});
const {HandoffRepository}=load('lib/questionnaire/handoff-repository.ts',{'../documents/repository':evidence});
const upload=load('lib/crm/document-upload.ts',{'../documents/repository':evidence});
const {UploadManifestRepository}=load('lib/documents/upload-manifest.ts',{'./repository':evidence});
const service=load('lib/questionnaire/handoff-service.ts',{'../documents/repository':evidence,'../documents/analysis-service':{analysisVersion:'test'},'../documents/package-check':{checkDocumentPackage:async()=>({packageReady:true,manuallyReviewed:[]})},'../documents/upload-service':load('lib/documents/upload-service.ts',{'./repository':evidence,'../crm/document-upload':upload}),'../documents/upload-plan':load('lib/documents/upload-plan.ts',{'./repository':evidence}),'../crm/lawyer-handoff':crm});
const record={id:'case',identity_revision:1,client_iin:'000000000010',external_id:'900001'},actor={id:'staff',authentication:'test'};
const destination={categoryId:'13',fromStageId:'C13:FINAL_INVOICE',fromStageName:'Договор',stageId:'C13:WON',stageName:'Сделка завершена'};
function transport(){const state={deal:{ID:'900001',CATEGORY_ID:'13',STAGE_ID:'C13:FINAL_INVOICE',STAGE_SEMANTIC_ID:'P',UF_CRM_AI_IIN:'000000000010',TITLE:'SYNTHETIC ONLY',UF_CRM_1773669702495:'SYNTHETIC ONLY',UF_CRM_1773655613972:'199'},writes:[],history:[],timeout:false,robot:false,name:'Сделка завершена',semantic:'S'};
 state.send=async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);let result;
  if(method==='crm.deal.get.json')result=state.deal;
  else if(method==='crm.status.list.json'){assert.equal(body.filter.ENTITY_ID,'DEAL_STAGE_13');result=[{STATUS_ID:'C13:FINAL_INVOICE',NAME:'Договор'},{STATUS_ID:'C13:WON',NAME:state.name,SEMANTICS:state.semantic,ENTITY_ID:'DEAL_STAGE_13'}];}
  else if(method==='crm.deal.update.json'){state.writes.push(body);if(state.timeout)throw Error('network lost');state.deal={...state.deal,...body.fields,...(state.dropTitle?{TITLE:state.deal.TITLE}:{}),CATEGORY_ID:state.robot?'1':'13',STAGE_ID:state.robot?'C1:NEW':'C13:WON'};result=true;}
  else if(method==='crm.stagehistory.list.json')result={items:state.history};else throw Error(method);
  return{ok:true,json:async()=>({result})};};return state;
}
test('handoff resolves the named final sales stage and writes no fields except STAGE_ID',async()=>{
 const s=transport(),adapter=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send),stage=await adapter.discover(record.external_id,record.client_iin);
 assert.deepEqual(JSON.parse(JSON.stringify(stage)),destination);assert.equal(await adapter.move(record.external_id,record.client_iin,stage,'2026-09-16T08:00:00Z'),true);
 assert.deepEqual(s.writes,[{id:'900001',fields:{STAGE_ID:'C13:WON'}}]);
});
test('wrong identity, another pipeline, changed source stage and invalid destination semantics cannot trigger the robot',async()=>{
 for(const change of [s=>s.deal.UF_CRM_AI_IIN='000000000029',s=>s.deal.CATEGORY_ID='1',s=>s.deal.STAGE_ID='C13:NEW',s=>s.semantic='F']){
  const s=transport();change(s);const a=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send);
  await assert.rejects(a.move(record.external_id,record.client_iin,destination,'2026-09-16T08:00:00Z'));assert.equal(s.writes.length,0);
 }
});
test('robot movement after completion is reconciled from stage history, not overwritten',async()=>{
 const s=transport();s.robot=true;s.history=[{OWNER_ID:'900001',CATEGORY_ID:13,STAGE_ID:'C13:WON',CREATED_TIME:'2026-09-16T08:01:00Z'}];
 const a=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send);
 assert.equal(await a.move(record.external_id,record.client_iin,destination,'2026-09-16T08:00:00Z'),true);assert.equal(s.writes.length,1);assert.equal(s.deal.CATEGORY_ID,'1');
 s.history[0].CREATED_TIME='2026-09-15T08:00:00Z';assert.equal(await a.reconcile(record.external_id,record.client_iin,destination,'2026-09-16T08:00:00Z'),false);assert.equal(s.writes.length,1);
});
function database(){const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 sql.exec("INSERT INTO assessment_cases (id,external_system,external_id,client_iin,title,created_at,updated_at) VALUES ('case','bitrix','900001','000000000010','Synthetic','now','now')");
 const db={prepare(query){return{bind(...args){const stmt=sql.prepare(query);return{async first(){return stmt.get(...args)||null;},async all(){return{results:stmt.all(...args)};},async run(){return{meta:{changes:Number(stmt.run(...args).changes)}};}};}};}};
 return{sql,db,handoffs:new HandoffRepository(db),manifests:new UploadManifestRepository(db)};
}
test('durable handoff claim is unique across retries and employees, including after success',async()=>{
 const s=database(),id=webcrypto.randomUUID(),payload={destination,powerId:'power',signedId:'signed',credentialRequestId:'key',reviewIds:[],signedConfirmed:true,confirmedAt:new Date().toISOString()};
 try{const row=await s.handoffs.prepare(record,id,payload,actor);assert.equal((await s.handoffs.prepare(record,id,payload,actor)).id,row.id);
  await assert.rejects(s.handoffs.prepare(record,webcrypto.randomUUID(),payload,{...actor,id:'other'}),/HANDOFF_ALREADY_PENDING/);
  assert.equal(await s.handoffs.claim(record,row),true);assert.equal(await s.handoffs.claim(record,row),false);
  await s.handoffs.finish(record,row,'verified','VERIFIED');await s.handoffs.finish(record,row,'uncertain','late timeout');assert.equal((await s.handoffs.active(record.id)).state,'verified');
  await assert.rejects(s.handoffs.prepare(record,webcrypto.randomUUID(),payload,actor),/HANDOFF_ALREADY_PENDING/);
 }finally{s.sql.close();}
});
async function deliveredHandoff(options={}){
 const s=database(),keyId=webcrypto.randomUUID(),id=webcrypto.randomUUID(),contents={power:new Uint8Array([1,2]),signed:new Uint8Array([3,4]),key:new Uint8Array([5,6]),original:new Uint8Array([7,8])};
 const docs={};for(const [name,bytes]of Object.entries(contents))docs[name]={id:name,case_id:record.id,original_name:name+'.pdf',original_sha256:await evidence.sha256(bytes),byte_size:bytes.length};
 const crmFiles=new Map([['11',contents.key],['12',contents.original]]),counts={uploads:0,moves:0,reads:0,assessments:0};
 const adapter={read:async()=>({iin:record.client_iin,refs:[...crmFiles.keys()].map(id=>({id}))}),append:async(deal,iin,baseline,files)=>{counts.uploads++;const refs=[];for(const file of files){const id=String(11+crmFiles.size);crmFiles.set(id,file.bytes);refs.push({id,name:file.name,sha256:await evidence.sha256(file.bytes)});}return{verified:true,preserved:baseline,files:refs};}};
 const keyManifest={version:1,scope:'credentials',credentialOwnerConfirmed:true,baseline:[],files:[{documentId:'key',name:'synthetic.key',sha256:docs.key.original_sha256,byteSize:2}]};
 await s.manifests.prepare(record,keyId,keyManifest,actor);await s.manifests.claim(record,keyId);await s.manifests.finish(record.id,keyId,{verified:true,preserved:[],files:[{id:'11',name:'synthetic.key',sha256:docs.key.original_sha256}]},'VERIFIED');
 const originalId=webcrypto.randomUUID(),originalManifest={version:1,baseline:[],files:[{documentId:'original',name:'original.pdf',sha256:docs.original.original_sha256,byteSize:2}]};
 await s.manifests.prepare(record,originalId,originalManifest,actor);await s.manifests.claim(record,originalId);await s.manifests.finish(record.id,originalId,{verified:true,preserved:[],files:[{id:'12',name:'original.pdf',sha256:docs.original.original_sha256}]},'VERIFIED');
 const repository={document:async(caseId,id)=>caseId===record.id?docs[id]:null,original:async doc=>contents[doc.id],cached:async()=>({result:{read:{totalPages:1},extraction:{identity:{iin:record.client_iin}}}}),credentialStatus:async()=>({verified:true,passwordStored:true,requestId:keyId})};
 const handoffPayload={destination,powerId:'power',signedId:'signed',credentialRequestId:keyId,reviewIds:[],signedConfirmed:true,confirmedAt:new Date().toISOString()};
 const row=options.prepare===false?null:await s.handoffs.prepare(record,id,handoffPayload,actor);
 const payload={values:{iin:record.client_iin,fio:'SYNTHETIC ONLY',procedure:'199'},draft:{documents:[{documentId:'original',type:'Удостоверение личности'},{documentId:'original',type:'Удостоверение личности'},{documentId:'power',type:'Доверенность'},{documentId:'signed',type:'Подписанный договор'}]}},submission={case_id:record.id,identity_revision:record.identity_revision,state:'verified',history_state:'verified',history_comment_id:'41',request_id:webcrypto.randomUUID(),payload_hash:'a'.repeat(64),payload_json:JSON.stringify(payload)};
 const deps={...s,repository,submissions:{latestForCase:async()=>submission},assessment:{reconcile:async(deal,iin,values)=>{counts.assessments++;assert.equal(deal,record.external_id);assert.equal(iin,record.client_iin);assert.deepEqual(JSON.parse(JSON.stringify(values)),payload.values);return{verified:true};}},upload:adapter,readFile:async file=>{counts.reads++;return crmFiles.get(file.id);},stages:{validateTitle:async()=>{},move:async()=>{counts.moves++;return true;},reconcile:async()=>true}};
 return {...s,deps,row,submission,contents,docs,crmFiles,counts,originalId,handoffPayload};
}
test('saved intake originals are verified first; unsent handoff docs in the snapshot are uploaded and verified before the stage move',async()=>{
 const s=await deliveredHandoff();
 try{
  assert.deepEqual([...s.crmFiles.keys()],['11','12']);
  s.deps.stages.move=async()=>{s.counts.moves++;assert.equal(s.counts.reads,5);assert.equal(s.counts.assessments,2);assert.equal(s.counts.uploads,2);assert.deepEqual(s.crmFiles.get('13'),s.contents.power);assert.deepEqual(s.crmFiles.get('14'),s.contents.signed);return true;};
  const done=await service.runHandoff(s.deps,record,actor,s.row,'2026-09-16');assert.equal(done.state,'verified');assert.equal(s.counts.uploads,2);assert.equal(s.counts.moves,1);
  s.deps.submissions.latestForCase=async()=>{throw Error('historical stage receipt must remain readable');};
  await service.runHandoff(s.deps,record,actor,done,'2026-09-16');assert.equal(s.counts.uploads,2);assert.equal(s.counts.moves,1);
 }finally{s.sql.close();}
});
test('missing, pending, foreign or changed assessment blocks before any upload or stage write',async()=>{
 for(const [change,code]of [
  [s=>s.deps.submissions.latestForCase=async()=>null,'HANDOFF_ASSESSMENT_REQUIRED'],
  [s=>s.submission.state='prepared','HANDOFF_ASSESSMENT_PENDING'],
  [s=>s.submission.history_state='uncertain','HANDOFF_ASSESSMENT_PENDING'],
  [s=>s.submission.history_comment_id=null,'HANDOFF_ASSESSMENT_PENDING'],
  [s=>s.submission.case_id='other-case','HANDOFF_ASSESSMENT_CHANGED'],
  [s=>s.submission.identity_revision=2,'HANDOFF_ASSESSMENT_CHANGED'],
  [s=>s.deps.assessment.reconcile=async()=>({verified:false}),'HANDOFF_ASSESSMENT_CHANGED'],
  [s=>s.deps.assessment.reconcile=async()=>{throw Error('read failed');},'HANDOFF_ASSESSMENT_UNVERIFIED'],
 ]){
  const s=await deliveredHandoff();try{change(s);await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),new RegExp(code));assert.equal(s.counts.uploads,0);assert.equal(s.counts.moves,0);assert.equal((await s.handoffs.get(record.id,s.row.request_id)).state,'prepared');}finally{s.sql.close();}
 }
});
test('missing upload receipts, removed originals and changed original bytes cannot pass handoff',async()=>{
 for(const [change,code]of [
  [s=>s.sql.prepare("UPDATE assessment_upload_manifests SET state='uncertain' WHERE request_id=?").run(s.originalId),'HANDOFF_ORIGINALS_REQUIRED'],
  [s=>s.crmFiles.delete('12'),'HANDOFF_ORIGINAL_REMOVED'],
  [s=>s.crmFiles.set('12',new Uint8Array([8,7])),'HANDOFF_ORIGINAL_CHANGED'],
  [s=>delete s.docs.original,'HANDOFF_ORIGINALS_REQUIRED'],
 ]){
  const s=await deliveredHandoff();try{change(s);await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),new RegExp(code));assert.equal(s.counts.uploads,0);assert.equal(s.counts.moves,0);}finally{s.sql.close();}
 }
});
test('an empty intake package cannot be replaced by only signed contract and power of attorney',async()=>{
 for(const keepHandoffDocuments of [true,false]){
  const s=await deliveredHandoff();try{
   const payload=JSON.parse(s.submission.payload_json);payload.draft.documents=keepHandoffDocuments?payload.draft.documents.filter(doc=>['Доверенность','Подписанный договор'].includes(doc.type)):[];s.submission.payload_json=JSON.stringify(payload);
   await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),/HANDOFF_ORIGINALS_REQUIRED/);
   assert.equal(s.counts.uploads,0);assert.equal(s.counts.moves,0);
  }finally{s.sql.close();}
 }
});
test('snapshot handoff documents are still blocked if their uploaded bytes differ from the selected originals',async()=>{
 const s=await deliveredHandoff();try{
  const append=s.deps.upload.append;s.deps.upload.append=async(...args)=>{const receipt=await append(...args);if(s.counts.uploads===2)s.crmFiles.set(receipt.files[0].id,new Uint8Array([8,7]));return receipt;};
  await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),/HANDOFF_FILE_CHANGED/);
  assert.equal(s.counts.uploads,2);assert.equal(s.counts.moves,0);assert.equal((await s.handoffs.get(record.id,s.row.request_id)).state,'prepared');
 }finally{s.sql.close();}
});
test('assessment changes during uploads are caught again before claiming the stage transition',async()=>{
 const s=await deliveredHandoff();try{
  s.deps.assessment.reconcile=async()=>({verified:++s.counts.assessments===1});
  await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),/HANDOFF_ASSESSMENT_CHANGED/);
  assert.equal(s.counts.uploads,2);assert.equal(s.counts.moves,0);assert.equal((await s.handoffs.get(record.id,s.row.request_id)).state,'prepared');
 }finally{s.sql.close();}
});
test('original changes during uploads are caught again before claiming the stage transition',async()=>{
 const s=await deliveredHandoff();try{
  const append=s.deps.upload.append;s.deps.upload.append=async(...args)=>{const receipt=await append(...args);s.crmFiles.set('12',new Uint8Array([8,7]));return receipt;};
  await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),/HANDOFF_ORIGINAL_CHANGED/);
  assert.equal(s.counts.uploads,2);assert.equal(s.counts.moves,0);assert.equal((await s.handoffs.get(record.id,s.row.request_id)).state,'prepared');
 }finally{s.sql.close();}
});
test('a different saved submission appearing during upload cannot inherit the prepared delivery proof',async()=>{
 const s=await deliveredHandoff();try{
  let checks=0;s.deps.submissions.latestForCase=async()=>++checks===1?s.submission:{...s.submission,request_id:webcrypto.randomUUID()};
  await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),/HANDOFF_ASSESSMENT_CHANGED/);
  assert.equal(s.counts.uploads,2);assert.equal(s.counts.moves,0);assert.equal((await s.handoffs.get(record.id,s.row.request_id)).state,'prepared');
 }finally{s.sql.close();}
});
test('status inspection verifies assessment and current original refs without downloading original bytes',async()=>{
 const s=await deliveredHandoff();try{
  const result=await service.verifyHandoffDelivery(s.deps,record,{verifyBytes:false});
  assert.equal(result.requestId,s.submission.request_id);assert.equal(result.originals,1);assert.equal(s.counts.assessments,1);assert.equal(s.counts.reads,0);assert.equal(s.counts.uploads,0);assert.equal(s.counts.moves,0);
  s.crmFiles.delete('12');await assert.rejects(service.verifyHandoffDelivery(s.deps,record,{verifyBytes:false}),/HANDOFF_ORIGINAL_REMOVED/);assert.equal(s.counts.reads,0);
 }finally{s.sql.close();}
});
test('writing and uncertain operations reconcile read-only even if current delivery is missing',async()=>{
 for(const state of ['writing','uncertain']){
  let reconciles=0;const row={state,actor_id:actor.id,identity_revision:1,payload_json:JSON.stringify({destination}),created_at:'2026-09-16T08:00:00Z'};
  const result=await service.runHandoff({submissions:{latestForCase:async()=>{throw Error('delivery guard must not replay claimed operations');}},handoffs:{finish:async(record,row,state)=>({state})},stages:{reconcile:async()=>{reconciles++;return false;}}},record,actor,row,'2026-09-16');assert.equal(result.state,'uncertain');assert.equal(reconciles,1);
 }
});
test('signed PDF ownership and saved credentials are required independently of contract intake',async()=>{
 const repo={document:async()=>({id:'signed',original_sha256:'hash'}),cached:async()=>({result:{read:{totalPages:1},extraction:{identity:{iin:'other'}}}}),credentialStatus:async()=>null};
 await assert.rejects(service.validateHandoffDocuments(repo,record,'power','signed','2026-09-16'),/WRONG_CLIENT/);
 repo.cached=async()=>({result:{read:{totalPages:1},extraction:{identity:{iin:null}}}});
 await assert.rejects(service.validateHandoffDocuments(repo,record,'power','signed','2026-09-16'),/HANDOFF_CREDENTIALS_REQUIRED/);
});
test('malformed CRM bodies and stage rows fail closed without any stage write',async()=>{
 for(const bad of [null,[],42,{ID:'900001'}]){
  let writes=0;const send=async(url)=>{if(url.includes('crm.deal.update'))writes++;return{ok:true,json:async()=>({result:bad})};};
  const adapter=crm.createHandoffAdapter('https://synthetic.invalid/rest/',send);
  await assert.rejects(adapter.move(record.external_id,record.client_iin,destination,'2026-09-16T08:00:00Z'),e=>e.notStarted===true);assert.equal(writes,0);
 }
 const s=transport(),original=s.send;
 s.send=async(url,options)=>url.includes('crm.status.list')?{ok:true,json:async()=>({result:[null,{STATUS_ID:'C13:WON',NAME:'Сделка завершена'}]})}:original(url,options);
 const a=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send);
 await assert.rejects(a.discover(record.external_id,record.client_iin),/HANDOFF_STAGE_UNVERIFIED/);assert.equal(s.writes.length,0);
});

test('production final-stage label and harmless renames keep the exact approved transition',async()=>{
 for(const name of ['Сделка успешна','Сделка завершена','Переименованная успешная стадия']){
  const s=transport();s.name=name;const a=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send);
  const target=await a.discover(record.external_id,record.client_iin);
  assert.equal(target.stageId,'C13:WON');assert.equal(target.stageName,name);
  // A prepared snapshot may retain the former label; only IDs authorize the move.
  assert.equal(await a.move(record.external_id,record.client_iin,destination,'2026-09-16T08:00:00Z'),true);
  assert.deepEqual(s.writes,[{id:'900001',fields:{STAGE_ID:'C13:WON'}}]);
 }
});
test('destination comparison accepts labels only, never a different pipeline or stage',()=>{
 assert.equal(crm.sameHandoffDestination({...destination,stageName:'Сделка успешна'},destination),true);
 for(const field of ['categoryId','fromStageId','stageId'])assert.equal(crm.sameHandoffDestination({...destination,[field]:'other'},destination),false);
 for(const bad of [null,[],{},'C13:WON'])assert.equal(crm.sameHandoffDestination(bad,destination),false);
});
test('duplicate, foreign-directory or explicitly unsuccessful destinations remain blocked',async()=>{
 for(const alter of [rows=>rows.push({...rows[1]}),rows=>rows[1].ENTITY_ID='DEAL_STAGE_1',rows=>rows[1].EXTRA={SEMANTICS:'failure'},rows=>rows[1].NAME='']){
  const s=transport(),original=s.send;
  s.send=async(url,options)=>{const response=await original(url,options);if(url.includes('crm.status.list')){const value=await response.json();alter(value.result);return{ok:true,json:async()=>value};}return response;};
  const a=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send);
  await assert.rejects(a.move(record.external_id,record.client_iin,destination,'2026-09-16T08:00:00Z'),e=>e.notStarted===true);
  assert.equal(s.writes.length,0);
 }
});

async function plannedHandoff(){
 const s=await deliveredHandoff({prepare:false}),remote=transport();remote.deal.TITLE='SYNTHETIC ONLY - [whatcrm] line #21';
 s.deps.stages=crm.createHandoffAdapter('https://synthetic.invalid/rest/',remote.send);
 const naming=await service.prepareHandoffTitle(s.deps,record);
 const row=await s.handoffs.prepare(record,webcrypto.randomUUID(),{...s.handoffPayload,...naming},actor);
 return {...s,row,remote,plan:naming.titlePlan};
}
test('preparation freezes verified submission title intent and one claimed update sends both stage and VP title',async()=>{
 const s=await plannedHandoff();try{
  const frozen=JSON.parse(s.row.payload_json);
  assert.equal(frozen.titlePlan.policy,'VP_FIO_1');assert.equal(frozen.titlePlan.source.requestId,s.submission.request_id);assert.equal(frozen.titlePlan.source.payloadHash,s.submission.payload_hash);
  assert.equal(frozen.titlePlan.beforeTitle,s.remote.deal.TITLE);assert.equal(frozen.titlePlan.desiredTitle,'ВП SYNTHETIC ONLY');
  const originalPayload=s.submission.payload_json;
  const done=await service.runHandoff(s.deps,record,actor,s.row,'2026-09-16');
  assert.equal(done.state,'verified');assert.equal(done.outcome_code,'STAGE_AND_TITLE_READBACK_VERIFIED');
  assert.deepEqual(s.remote.writes,[{id:record.external_id,fields:{STAGE_ID:'C13:WON',TITLE:'ВП SYNTHETIC ONLY'}}]);
  assert.equal(s.submission.payload_json,originalPayload);assert.equal(done.payload_json,s.row.payload_json);
  await service.runHandoff(s.deps,record,actor,done,'2026-09-16');assert.equal(s.remote.writes.length,1);
 }finally{s.sql.close();}
});
test('only exact VP intake titles receive a policy; custom titles and unsupported procedures remain untouched',async()=>{
 for(const [title,procedure]of [['Manager custom title','199'],['SYNTHETIC ONLY [whatcrm] note','199'],['SYNTHETIC ONLY - [whatcrm] line #21','201'],['SYNTHETIC ONLY - [whatcrm] line #21','203'],['SYNTHETIC ONLY - [whatcrm] line #21','205']]){
  const s=transport();s.deal.TITLE=title;s.deal.UF_CRM_1773655613972=procedure;
  const a=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send),plan=await a.planTitle(record.external_id,record.client_iin,{requestId:webcrypto.randomUUID(),payloadHash:'a'.repeat(64),fio:s.deal.UF_CRM_1773669702495,procedure});
  assert.equal(plan,null);assert.equal(await a.move(record.external_id,record.client_iin,destination,'2026-09-16T08:00:00Z'),true);
  assert.deepEqual(s.writes,[{id:record.external_id,fields:{STAGE_ID:'C13:WON'}}]);assert.equal(s.deal.TITLE,title);
 }
 const s=transport();s.deal.TITLE='SYNTHETIC ONLY - [whatcrm] line #21';s.deal.UF_CRM_1773669702495='  SYNTHETIC   ONLY  ';
 const a=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send),plan=await a.planTitle(record.external_id,record.client_iin,{requestId:webcrypto.randomUUID(),payloadHash:'a'.repeat(64),fio:s.deal.UF_CRM_1773669702495,procedure:'199'});
 assert.equal(plan.desiredTitle,'ВП SYNTHETIC ONLY');assert.equal(plan.source.fio,'  SYNTHETIC   ONLY  ');
});
test('frozen submission and title guards reject new source, custom title, FIO, procedure or stage before handoff uploads',async()=>{
 for(const [change,code]of [
  [s=>s.submission.request_id=webcrypto.randomUUID(),'HANDOFF_ASSESSMENT_CHANGED'],
  [s=>s.submission.payload_hash='b'.repeat(64),'HANDOFF_ASSESSMENT_CHANGED'],
  [s=>s.remote.deal.TITLE='Manager corrected title','HANDOFF_TITLE_CHANGED'],
  [s=>s.remote.deal.UF_CRM_1773669702495='OTHER SYNTHETIC','HANDOFF_ASSESSMENT_CHANGED'],
  [s=>s.remote.deal.UF_CRM_1773655613972='201','HANDOFF_ASSESSMENT_CHANGED'],
  [s=>s.remote.deal.CATEGORY_ID='1','HANDOFF_STAGE_CHANGED'],
  [s=>s.remote.deal.STAGE_ID='C13:NEW','HANDOFF_STAGE_CHANGED'],
 ]){
  const s=await plannedHandoff();try{change(s);await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),new RegExp(code));assert.equal(s.counts.uploads,0);assert.equal(s.remote.writes.length,0);assert.equal((await s.handoffs.get(record.id,s.row.request_id)).state,'prepared');}finally{s.sql.close();}
 }
});
test('a title changed during uploads is checked again before the claimed CRM update',async()=>{
 const s=await plannedHandoff();try{
  const append=s.deps.upload.append;s.deps.upload.append=async(...args)=>{const receipt=await append(...args);s.remote.deal.TITLE='Manager edited during upload';return receipt;};
  const done=await service.runHandoff(s.deps,record,actor,s.row,'2026-09-16');
  assert.equal(done.state,'prepared');assert.equal(done.outcome_code,'HANDOFF_TITLE_CHANGED');assert.equal(s.remote.writes.length,0);assert.equal(s.counts.uploads,2);
 }finally{s.sql.close();}
});
test('legacy prepared VP intake handoff stops before uploads; cancel and reprepare preserve all saved file receipts',async()=>{
 const s=await deliveredHandoff(),remote=transport();remote.deal.TITLE='SYNTHETIC ONLY - [whatcrm] line #21';s.deps.stages=crm.createHandoffAdapter('https://synthetic.invalid/rest/',remote.send);
 try{
  const before=s.sql.prepare('SELECT * FROM assessment_upload_manifests ORDER BY rowid').all(),files=[...s.crmFiles];
  await assert.rejects(service.runHandoff(s.deps,record,actor,s.row,'2026-09-16'),/HANDOFF_TITLE_PLAN_REQUIRED/);
  assert.equal(s.counts.uploads,0);assert.equal(remote.writes.length,0);assert.deepEqual([...s.crmFiles],files);assert.deepEqual(s.sql.prepare('SELECT * FROM assessment_upload_manifests ORDER BY rowid').all(),before);
  await s.handoffs.cancel(record,s.row,actor);assert.deepEqual([...s.crmFiles],files);assert.deepEqual(s.sql.prepare('SELECT * FROM assessment_upload_manifests ORDER BY rowid').all(),before);
  const naming=await service.prepareHandoffTitle(s.deps,record),row=await s.handoffs.prepare(record,webcrypto.randomUUID(),{...s.handoffPayload,...naming},actor);
  const done=await service.runHandoff(s.deps,record,actor,row,'2026-09-16');assert.equal(done.state,'verified');assert.equal(remote.writes.length,1);assert.deepEqual(s.crmFiles.get('11'),s.contents.key);assert.deepEqual(s.crmFiles.get('12'),s.contents.original);
 }finally{s.sql.close();}
});
test('stage proof with an unchanged intake title stays uncertain and all resume attempts are read-only',async()=>{
 const s=await plannedHandoff();try{
  s.remote.robot=true;s.remote.dropTitle=true;s.remote.history=[{OWNER_ID:record.external_id,CATEGORY_ID:13,STAGE_ID:'C13:WON',CREATED_TIME:new Date().toISOString()}];
  const done=await service.runHandoff(s.deps,record,actor,s.row,'2026-09-16');assert.equal(done.state,'uncertain');assert.equal(done.outcome_code,'HANDOFF_TITLE_UNVERIFIED');
  s.deps.submissions.latestForCase=async()=>{throw Error('No new submission read after attempted stage write');};
  const resumed=await service.runHandoff(s.deps,record,actor,done,'2026-09-16');assert.equal(resumed.state,'uncertain');assert.equal(resumed.outcome_code,'HANDOFF_TITLE_UNVERIFIED');assert.equal(s.remote.writes.length,1);
  s.remote.deal.TITLE=s.plan.desiredTitle;
  assert.equal((await service.runHandoff(s.deps,record,actor,resumed,'2026-09-16')).state,'verified');assert.equal(s.remote.writes.length,1);
 }finally{s.sql.close();}
});
test('legacy claimed handoffs retain stage-only recovery even when their current title is intake-style',async()=>{
 const s=await deliveredHandoff(),remote=transport();remote.deal.TITLE='SYNTHETIC ONLY - [whatcrm] line #21';remote.deal.STAGE_ID='C13:WON';s.deps.stages=crm.createHandoffAdapter('https://synthetic.invalid/rest/',remote.send);
 try{
  await s.handoffs.claim(record,s.row);const row=await s.handoffs.get(record.id,s.row.request_id);
  s.deps.submissions.latestForCase=async()=>{throw Error('Legacy claimed operation must reconcile without new delivery obligations');};
  const done=await service.runHandoff(s.deps,record,actor,row,'2026-09-16');assert.equal(done.state,'verified');assert.equal(done.outcome_code,'STAGE_READBACK_VERIFIED');assert.equal(remote.writes.length,0);assert.equal(s.counts.uploads,0);
 }finally{s.sql.close();}
});
