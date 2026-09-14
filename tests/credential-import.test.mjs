import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {webcrypto} from 'node:crypto';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name],crypto:webcrypto,TextEncoder,Uint8Array,Set});return exports;}
const repo=load('lib/documents/repository.ts'),{importCredentials}=load('lib/documents/credential-import.ts',{'./repository':repo,'./credential-plan':{MAX_CREDENTIAL_BYTES:2*1024*1024}});
function fixture(){
 const record={id:'case-A',external_id:'11665',client_iin:'991231300003',identity_revision:1},actor={id:'staff-A',authentication:'test'},input={requestId:'00000000-0000-0000-0000-000000000001',identityRevision:1,fileIds:['22'],ownerConfirmed:true};
 const state={rows:new Map(),prepares:0,reads:0,downloads:0,outboundWrites:0};
 const reader={read:async()=>{state.reads++;return {iin:record.client_iin,refs:[{id:'11'},{id:'22'}]};},file:async ref=>{state.downloads++;assert.equal(ref.id,'22');return {bytes:new Uint8Array([1,2,3]),name:'26 ЭЦП - TEST - пароль PRIVATE.p12'};},append:()=>{state.outboundWrites++;throw Error('External writes forbidden');}};
 const manifests={rootForPlan:async()=>null,get:async(caseId,id)=>{assert.equal(caseId,record.id);return state.rows.get(id);},prepare:async(r,id,manifest,a)=>{state.prepares++;const row={request_id:id,identity_revision:r.identity_revision,actor_id:a.id,state:'prepared',manifest_json:JSON.stringify(manifest)};state.rows.set(id,row);return row;},claim:async(r,id)=>{state.rows.get(id).state='writing';return true;},finish:async(caseId,id,receipt,code)=>{const row=state.rows.get(id);row.state='verified';row.receipt_json=JSON.stringify(receipt);row.outcome_code=code;return row;}};
 return {record,actor,input,reader,manifests,state,run:()=>importCredentials(manifests,record,actor,input,reader)};
}
test('existing EDS is registered from its current deal without uploading or exposing its password',async()=>{
 const f=fixture(),row=await f.run(),manifest=JSON.parse(row.manifest_json),receipt=JSON.parse(row.receipt_json);
 assert.equal(row.state,'verified');assert.equal(row.outcome_code,'CREDENTIAL_EXISTING_READBACK_VERIFIED');assert.equal(manifest.origin,'bitrix-existing');assert.equal(manifest.credentialOwnerConfirmed,true);assert.equal(manifest.reused[0].id,'22');assert.equal(receipt.files[0].id,'22');assert.deepEqual(receipt.preserved,[{id:'11'},{id:'22'}]);assert.equal(f.state.outboundWrites,0);
 const repository=new repo.EvidenceRepository({prepare:()=>({bind:()=>({first:async()=>({...row,id:'receipt-id'})})})},null);
 const publicStatus=await repository.credentialStatus(f.record);assert.equal(publicStatus.verified,true);assert.equal(publicStatus.files[0].name,'ЭЦП.p12');assert.equal(publicStatus.passwordStored,true);assert.doesNotMatch(JSON.stringify(publicStatus),/PRIVATE|TEST/);
 await f.run();assert.equal(f.state.prepares,1);assert.equal(f.state.downloads,2);assert.equal(f.state.outboundWrites,0);
});
test('ownership, identity and selected-deal membership are required before accepting a key',async()=>{
 const noOwner=fixture();noOwner.input.ownerConfirmed=false;await assert.rejects(noOwner.run(),/CREDENTIAL_OWNER_CONFIRMATION_REQUIRED/);assert.equal(noOwner.state.reads,0);
 const stale=fixture();stale.input.identityRevision=2;await assert.rejects(stale.run(),/CASE_IDENTITY_CHANGED/);
 const other=fixture();other.reader.read=async()=>({iin:'000000000010',refs:[{id:'22'}]});await assert.rejects(other.run(),/CASE_IDENTITY_CHANGED/);assert.equal(other.state.downloads,0);
 const absent=fixture();absent.input.fileIds=['33'];await assert.rejects(absent.run(),/FILE_NOT_IN_DEAL/);assert.equal(absent.state.downloads,0);
 const changed=fixture();changed.reader.read=async()=>({iin:changed.record.client_iin,refs:++changed.state.reads===1?[{id:'11'},{id:'22'}]:[{id:'11'}]});await assert.rejects(changed.run(),/DOCUMENTS_CHANGED_IN_CRM/);assert.equal(changed.state.prepares,0);
});
test('ordinary documents, missing passwords, empty keys and oversized keys cannot become credential receipts',async()=>{
 for(const file of [{name:'report.pdf',bytes:new Uint8Array([1])},{name:'key.p12',bytes:new Uint8Array([1])},{name:'пароль SECRET.p12',bytes:new Uint8Array([])},{name:'пароль SECRET.p12',bytes:new Uint8Array(2*1024*1024+1)}]){const f=fixture();f.reader.file=async()=>file;await assert.rejects(f.run(),error=>!/SECRET/.test(String(error)));assert.equal(f.state.prepares,0);}
});
test('a verified request cannot be reused for different key contents or another actor',async()=>{
 const f=fixture();await f.run();f.reader.file=async()=>({name:'26 пароль DIFFERENT.p12',bytes:new Uint8Array([9])});await assert.rejects(f.run(),/IDEMPOTENCY_KEY_REUSED/);
 const other=fixture();await other.run();other.actor.id='staff-B';await assert.rejects(other.run(),/IDEMPOTENCY_KEY_REUSED/);
});
