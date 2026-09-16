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
function transport(){const state={deal:{ID:'900001',CATEGORY_ID:'13',STAGE_ID:'C13:FINAL_INVOICE',STAGE_SEMANTIC_ID:'P',UF_CRM_AI_IIN:'000000000010'},writes:[],history:[],timeout:false,robot:false,name:'Сделка завершена'};
 state.send=async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);let result;
  if(method==='crm.deal.get.json')result=state.deal;
  else if(method==='crm.status.list.json'){assert.equal(body.filter.ENTITY_ID,'DEAL_STAGE_13');result=[{STATUS_ID:'C13:FINAL_INVOICE',NAME:'Договор'},{STATUS_ID:'C13:WON',NAME:state.name}];}
  else if(method==='crm.deal.update.json'){state.writes.push(body);if(state.timeout)throw Error('network lost');state.deal={...state.deal,CATEGORY_ID:state.robot?'1':'13',STAGE_ID:state.robot?'C1:NEW':'C13:WON'};result=true;}
  else if(method==='crm.stagehistory.list.json')result={items:state.history};else throw Error(method);
  return{ok:true,json:async()=>({result})};};return state;
}
test('handoff resolves the named final sales stage and writes no fields except STAGE_ID',async()=>{
 const s=transport(),adapter=crm.createHandoffAdapter('https://synthetic.invalid/rest/',s.send),stage=await adapter.discover(record.external_id,record.client_iin);
 assert.deepEqual(JSON.parse(JSON.stringify(stage)),destination);assert.equal(await adapter.move(record.external_id,record.client_iin,stage,'2026-09-16T08:00:00Z'),true);
 assert.deepEqual(s.writes,[{id:'900001',fields:{STAGE_ID:'C13:WON'}}]);
});
test('wrong identity, another pipeline, changed source stage and wrong destination name cannot trigger the robot',async()=>{
 for(const change of [s=>s.deal.UF_CRM_AI_IIN='000000000029',s=>s.deal.CATEGORY_ID='1',s=>s.deal.STAGE_ID='C13:NEW',s=>s.name='Different final stage']){
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
test('three stored files are read back before the stage changes; repeat calls never send again',async()=>{
 const s=database(),keyId=webcrypto.randomUUID(),id=webcrypto.randomUUID(),contents={power:new Uint8Array([1,2]),signed:new Uint8Array([3,4]),key:new Uint8Array([5,6])};
 const docs={};for(const [name,bytes]of Object.entries(contents))docs[name]={id:name,original_sha256:await evidence.sha256(bytes),byte_size:bytes.length};
 const keyManifest={version:1,scope:'credentials',credentialOwnerConfirmed:true,baseline:[],files:[{documentId:'key',name:'synthetic.key',sha256:docs.key.original_sha256,byteSize:2}]};
 const crmFiles=new Map([['11',contents.key]]);let uploads=0,moves=0,reads=0;
 const adapter={read:async()=>({iin:record.client_iin,refs:[...crmFiles.keys()].map(id=>({id}))}),append:async(deal,iin,baseline,files)=>{uploads++;const refs=[];for(const file of files){const id=String(11+crmFiles.size);crmFiles.set(id,file.bytes);refs.push({id,name:file.name,sha256:await evidence.sha256(file.bytes)});}return{verified:true,preserved:baseline,files:refs};}};
 try{
  await s.manifests.prepare(record,keyId,keyManifest,actor);await s.manifests.claim(record,keyId);await s.manifests.finish(record.id,keyId,{verified:true,preserved:[],files:[{id:'11',name:'synthetic.key',sha256:docs.key.original_sha256}]},'VERIFIED');
  const repository={document:async(caseId,id)=>caseId===record.id?docs[id]:null,original:async doc=>contents[doc.id],cached:async()=>({result:{read:{totalPages:1},extraction:{identity:{iin:record.client_iin}}}}),credentialStatus:async()=>({verified:true,passwordStored:true,requestId:keyId})};
  const row=await s.handoffs.prepare(record,id,{destination,powerId:'power',signedId:'signed',credentialRequestId:keyId,reviewIds:[],signedConfirmed:true,confirmedAt:new Date().toISOString()},actor);
  const deps={...s,repository,upload:adapter,readFile:async file=>{reads++;return crmFiles.get(file.id);},stages:{move:async()=>{moves++;assert.equal(reads,3);return true;},reconcile:async()=>true}};
  const done=await service.runHandoff(deps,record,actor,row,'2026-09-16');assert.equal(done.state,'verified');assert.equal(uploads,2);assert.equal(moves,1);
  await service.runHandoff(deps,record,actor,done,'2026-09-16');assert.equal(uploads,2);assert.equal(moves,1);
 }finally{s.sql.close();}
});
test('uncertain operations are read-only and never upload or repeat a stage update',async()=>{
 let reconciles=0;const row={state:'uncertain',actor_id:actor.id,identity_revision:1,payload_json:JSON.stringify({destination}),created_at:'2026-09-16T08:00:00Z'};
 const result=await service.runHandoff({handoffs:{finish:async(record,row,state)=>({state})},stages:{reconcile:async()=>{reconciles++;return false;}}},record,actor,row,'2026-09-16');assert.equal(result.state,'uncertain');assert.equal(reconciles,1);
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
