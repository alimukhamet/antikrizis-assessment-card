import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import{DatabaseSync}from'node:sqlite';import{webcrypto}from'node:crypto';
import {httpHeaders} from './bitrix-headers-helper.mjs'; function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./http-headers'?httpHeaders:imports[n],crypto:webcrypto,TextEncoder,Uint8Array,Date,Set,Map});return exports;}
const evidence=load('lib/documents/repository.ts'),{UploadManifestRepository}=load('lib/documents/upload-manifest.ts',{'./repository':evidence}),upload=load('lib/crm/document-upload.ts',{'../documents/repository':evidence});
const {uploadStoredDocuments}=load('lib/documents/upload-service.ts',{'./repository':evidence,'../crm/document-upload':upload});
const record={id:'case',identity_revision:1,client_iin:'000000000010',external_id:'11665'},actor={id:'worker:ramazan',authentication:'shared-password-worker-selection'},id='00000000-0000-0000-0000-000000000001';
const manifest={version:1,baseline:[{id:'11'}],files:[{documentId:'doc',sha256:'a'.repeat(64),name:'SYNTHETIC.pdf',byteSize:3}]};
const receipt={verified:true,preserved:[{id:'11'}],files:[{id:'22',sha256:'a'.repeat(64),name:'SYNTHETIC.pdf'}]};
function setup(){const sql=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));sql.exec("INSERT INTO assessment_cases (id,external_system,external_id,title,created_at,updated_at) VALUES ('case','bitrix','11665','TEST','now','now')");const db={prepare(q){return{bind(...args){const stmt=sql.prepare(q);return{async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return{meta:{changes:Number(stmt.run(...args).changes)}};}};}};}};return{db,sql,repo:new UploadManifestRepository(db)};}
test('manifest is immutable, retry-safe and claimable only once',async()=>{const s=setup();const a=await s.repo.prepare(record,id,manifest,actor);assert.equal((await new UploadManifestRepository(s.db).prepare(record,id,manifest,actor)).id,a.id);await assert.rejects(s.repo.prepare(record,id,{...manifest,baseline:[]},actor),/IDEMPOTENCY_KEY_REUSED/);assert.equal(await s.repo.claim(record,id),true);assert.equal(await s.repo.claim(record,id),false);});
test('unsent discovery is owner and case scoped, survives identity changes, and returns only the request ID',async()=>{
 const {repo,sql}=setup();await repo.prepare(record,id,manifest,actor);
 assert.deepEqual(JSON.parse(JSON.stringify(await repo.unsentForActor(record,actor,'documents'))),{requestId:id});
 assert.equal(await repo.unsentForActor(record,{...actor,id:'another-worker'},'documents'),null);
 assert.equal(await repo.unsentForActor({...record,id:'another-case'},actor,'documents'),null);
 assert.equal(await repo.unsentForActor(record,actor,'credentials'),null);
 sql.exec("UPDATE assessment_cases SET identity_revision=2 WHERE id='case'");
 assert.deepEqual(JSON.parse(JSON.stringify(await repo.unsentForActor({...record,identity_revision:2},actor,'documents'))),{requestId:id});
 await repo.cancelUnsent({...record,identity_revision:2},id,actor);assert.equal(await repo.unsentForActor(record,actor,'documents'),null);
});
test('receipt must cover intended hashes and preserved IDs; verified record is not downgraded',async()=>{const {repo}=setup();await repo.prepare(record,id,manifest,actor);await repo.claim(record,id);await assert.rejects(repo.finish(record.id,id,{...receipt,preserved:[]},'TEST'),/INVALID_UPLOAD_RECEIPT/);await repo.finish(record.id,id,receipt,'VERIFIED');await repo.finish(record.id,id,null,'LATE_TIMEOUT');const r=await repo.get(record.id,id);assert.equal(r.state,'verified');assert.equal(JSON.parse(r.receipt_json).files[0].id,'22');});
test('pending upload prevents competing batch and changed identity prevents claim',async()=>{const {repo,sql}=setup();await repo.prepare(record,id,manifest,actor);await assert.rejects(repo.prepare(record,'00000000-0000-0000-0000-000000000002',manifest,actor),/UPLOAD_PENDING/);sql.exec("UPDATE assessment_cases SET identity_revision=2 WHERE id='case'");assert.equal(await repo.claim(record,id),false);});
test('stored-document service recovers receipt without rereading bytes or resending',async()=>{const {repo}=setup();let reads=0,writes=0;const source={document:async()=>({id:'doc',original_sha256:'a'.repeat(64),byte_size:3}),original:async()=>{reads++;return new Uint8Array([1,2,3]);}},adapter={append:async()=>{writes++;return receipt;}};const selection=[{documentId:'doc',name:'SYNTHETIC.pdf'}];const a=await uploadStoredDocuments(source,repo,adapter,record,id,manifest.baseline,selection,actor),b=await uploadStoredDocuments(source,repo,adapter,record,id,manifest.baseline,selection,actor);assert.equal(a.state,'verified');assert.equal(a.id,b.id);assert.equal(reads,1);assert.equal(writes,1);});
test('withdrawal after package check prevents the upload claim',async()=>{
 const {repo,sql}=setup();sql.exec("INSERT INTO assessment_documents VALUES ('doc','case','hash','key','synthetic.pdf',3,'worker','now'); INSERT INTO assessment_extractions VALUES ('ext','doc','v','key','hash','now');");
 const insert=sql.prepare('INSERT INTO assessment_reviews (id,request_id,case_id,document_id,extraction_id,identity_revision,fact_key,value_json,disposition,reason,actor_id,authentication,payload_hash,created_at) VALUES (?,?,\'case\',\'doc\',\'ext\',1,\'document.manual-check.v1\',\'null\',?,\'synthetic\',\'worker\',\'test\',\'hash\',\'now\')');
 insert.run('review','review-request','confirmed');await repo.prepare(record,id,{...manifest,planHash:'b'.repeat(64),reviewIds:['review']},actor);insert.run('withdrawal','withdrawal-request','unresolved');assert.equal(await repo.claim(record,id),false);assert.equal((await repo.get(record.id,id)).state,'prepared');
});
test('a reopened session discovers its durable root and cannot duplicate a completed batch under a new request',async()=>{
 const {repo,db}=setup(),plan={...manifest,planHash:'b'.repeat(64),rootRequestId:id,batchIndex:0};
 await repo.prepare(record,id,plan,actor);await repo.claim(record,id);await repo.finish(record.id,id,receipt,'VERIFIED');
 const reopened=new UploadManifestRepository(db);
 assert.equal(await reopened.rootForPlan(record,plan.planHash,actor),id);
 await assert.rejects(reopened.prepare(record,'00000000-0000-0000-0000-000000000002',{...plan,rootRequestId:'00000000-0000-0000-0000-000000000003'},actor),/UPLOAD_PENDING_OR_IDENTITY_CHANGED/);
 await assert.rejects(reopened.rootForPlan(record,plan.planHash,{...actor,id:'different-worker'}),/UPLOAD_OWNED_BY_ANOTHER_WORKER/);
 assert.equal(await reopened.rootForPlan({...record,identity_revision:2},plan.planHash,actor),null);
 assert.equal((await reopened.prepare(record,'00000000-0000-0000-0000-000000000004',{...plan,batchIndex:1},actor)).state,'prepared');
});
test('legacy plan without root metadata blocks duplicate upload instead of guessing a new operation',async()=>{
 const {repo}=setup();await repo.prepare(record,id,{...manifest,planHash:'c'.repeat(64)},actor);
 await assert.rejects(repo.rootForPlan(record,'c'.repeat(64),actor),/UPLOAD_LEGACY_RECOVERY_REQUIRED/);
});
test('different plans cannot prepare while a same-case upload is prepared, writing or uncertain',async()=>{
 const {repo}=setup(),second='00000000-0000-0000-0000-000000000002';
 const next={...manifest,planHash:'c'.repeat(64),batchIndex:0};
 await repo.prepare(record,id,{...manifest,planHash:'b'.repeat(64),batchIndex:0},actor);
 await assert.rejects(repo.prepare(record,second,next,actor),/UPLOAD_PENDING_OR_IDENTITY_CHANGED/);
 assert.equal(await repo.claim(record,id),true);
 await assert.rejects(repo.prepare(record,second,next,actor),/UPLOAD_PENDING_OR_IDENTITY_CHANGED/);
 await repo.finish(record.id,id,null,'LOST_RESPONSE');
 await assert.rejects(repo.prepare(record,second,next,actor),/UPLOAD_PENDING_OR_IDENTITY_CHANGED/);
 assert.equal(await repo.get(record.id,second),null);
 await repo.finish(record.id,id,receipt,'VERIFIED');
 assert.equal((await repo.prepare(record,second,next,actor)).state,'prepared');
});
test('an uncertain upload from an older identity revision still prevents a new external write',async()=>{
 const {repo,sql}=setup(),second='00000000-0000-0000-0000-000000000002';
 await repo.prepare(record,id,manifest,actor);await repo.claim(record,id);await repo.finish(record.id,id,null,'LOST_RESPONSE');
 sql.exec("UPDATE assessment_cases SET identity_revision=2 WHERE id='case'");
 const changed={...record,identity_revision:2};
 await assert.rejects(repo.prepare(changed,second,{...manifest,planHash:'c'.repeat(64),batchIndex:0},actor),/UPLOAD_PENDING_OR_IDENTITY_CHANGED/);
 assert.equal(await repo.get(record.id,second),null);
 assert.equal((await repo.get(record.id,id)).state,'uncertain');
});

test('only verified same-identity history supplies reuse candidates and pins their IDs',async()=>{
 const {repo}=setup();await repo.prepare(record,id,manifest,actor);await repo.claim(record,id);
 assert.equal((await repo.reusableFiles(record,manifest.files)).length,0);
 await repo.finish(record.id,id,receipt,'VERIFIED');
 const reusable=await repo.reusableFiles(record,manifest.files);assert.equal(reusable.length,1);assert.equal(reusable[0].id,'22');
 assert.equal((await repo.reusableFiles({...record,identity_revision:2},manifest.files)).length,0);
 const second='00000000-0000-0000-0000-000000000002',next={...manifest,baseline:[{id:'11'},{id:'22'}],reused:reusable};
 await repo.prepare(record,second,next,actor);await repo.claim(record,second);
 await assert.rejects(repo.finish(record.id,second,{...receipt,preserved:next.baseline,files:[{...receipt.files[0],id:'33'}]},'TEST'),/INVALID_UPLOAD_RECEIPT/);
 await repo.finish(record.id,second,{...receipt,preserved:next.baseline},'VERIFIED');assert.equal((await repo.get(record.id,second)).state,'verified');
});

test('an imported CRM original is reused only for its recorded case, identity, hash and size',async()=>{
 const {repo,sql}=setup();
 sql.prepare("INSERT INTO assessment_documents VALUES ('doc','case',?,'key','synthetic.pdf',3,'worker','now')").run('a'.repeat(64));
 sql.exec("INSERT INTO assessment_extractions VALUES ('ext','doc','v','key','hash','now')");
 const insert=sql.prepare("INSERT INTO assessment_reviews (id,request_id,case_id,document_id,extraction_id,identity_revision,fact_key,value_json,disposition,reason,actor_id,authentication,payload_hash,created_at) VALUES ('origin','origin-request','case','doc','ext',1,'document.origin.bitrix.v1',?,'confirmed','inbound read','worker','test','hash','now')");
 const receipt={system:'bitrix',fileId:'44',sha256:'a'.repeat(64),byteSize:3};insert.run(JSON.stringify(receipt));
 assert.equal((await repo.reusableFiles(record,manifest.files))[0].id,'44');
 for(const other of [{...record,id:'another-case'},{...record,identity_revision:2}])assert.equal((await repo.reusableFiles(other,manifest.files)).length,0);
 for(const replacement of [{...receipt,sha256:'b'.repeat(64)},{...receipt,byteSize:4},{...receipt,fileId:'invalid'},{...receipt,system:'other'}]){
  sql.prepare("UPDATE assessment_reviews SET value_json=? WHERE id='origin'").run(JSON.stringify(replacement));
  assert.equal((await repo.reusableFiles(record,manifest.files)).length,0);
 }
 sql.prepare("UPDATE assessment_reviews SET value_json=? WHERE id='origin'").run(JSON.stringify(receipt));
 sql.prepare("INSERT INTO assessment_reviews SELECT 'new-origin','new-origin-request',case_id,document_id,extraction_id,identity_revision,fact_key,?,disposition,reason,actor_id,authentication,payload_hash,created_at FROM assessment_reviews WHERE id='origin'").run(JSON.stringify({...receipt,fileId:'55'}));
 assert.equal((await repo.reusableFiles(record,manifest.files))[0].id,'55');
 assert.equal((await repo.reusableFiles(record,manifest.files,[{id:'44'}]))[0].id,'44');
 assert.equal((await repo.reusableFiles(record,manifest.files,[])).length,0);
});

test('separate credential handoff retries by readback and keeps key bytes out of stored intent',async()=>{
 const {repo}=setup();
 const {credentialUploadPlan}=load('lib/documents/credential-plan.ts',{'./repository':evidence});
 const {uploadCredentials}=load('lib/documents/credential-upload.ts',{'./repository':evidence,'./credential-plan':{credentialUploadPlan},'../crm/document-upload':upload});
 const input={requestId:id,identityRevision:1,clientName:'SYNTHETIC CLIENT',password:'TEST PASSWORD',ownerConfirmed:true,files:[{name:'synthetic.p12',bytes:new Uint8Array([1,2,3])}]};
 let writes=0,reconciles=0;const hash=await evidence.sha256(input.files[0].bytes);
 const adapter={read:async()=>({refs:manifest.baseline}),append:async()=>{writes++;throw new upload.DocumentUploadError('UPLOAD_OUTCOME_UNCERTAIN');},reconcile:async()=>{reconciles++;return{verified:true,preserved:manifest.baseline,files:[{id:'22',sha256:hash,name:'synthetic'}]};}};
 await assert.rejects(uploadCredentials(repo,adapter,record,actor,{...input,ownerConfirmed:false}),/CREDENTIAL_OWNER_CONFIRMATION_REQUIRED/);
 const first=await uploadCredentials(repo,adapter,record,actor,input);assert.equal(first.state,'uncertain');
 const saved=JSON.parse(first.manifest_json);assert.equal(saved.scope,'credentials');assert.equal(saved.credentialOwnerConfirmed,true);assert.equal(saved.files[0].bytes,undefined);assert.match(saved.files[0].name,/пароль TEST PASSWORD/);
 const recovered=await uploadCredentials(repo,adapter,record,actor,{...input,requestId:'00000000-0000-0000-0000-000000000002'});assert.equal(recovered.state,'verified');assert.equal(recovered.request_id,id);assert.equal(writes,1);assert.equal(reconciles,1);
 await uploadCredentials(repo,adapter,record,actor,input);assert.equal(writes,1);assert.equal(reconciles,1);
});

test('credential readiness requires a verified current-identity handoff and never exposes its filename',async()=>{
 const {repo,db}=setup(),evidenceRepo=new evidence.EvidenceRepository(db,{});
 assert.equal(await evidenceRepo.credentialStatus(record),null);
 await repo.prepare(record,id,manifest,actor);await repo.claim(record,id);await repo.finish(record.id,id,receipt,'VERIFIED');
 assert.equal(await evidenceRepo.credentialStatus(record),null);
 const second='00000000-0000-0000-0000-000000000002';await repo.prepare(record,second,{...manifest,scope:'credentials',credentialOwnerConfirmed:true},actor);
 assert.equal((await evidenceRepo.credentialStatus(record)).verified,false);await repo.claim(record,second);await repo.finish(record.id,second,receipt,'VERIFIED');
 const status=await evidenceRepo.credentialStatus(record);assert.equal(status.verified,true);assert.equal(status.requestId,second);assert.equal(JSON.stringify(status).includes('SYNTHETIC.pdf'),false);
 assert.equal(await evidenceRepo.credentialStatus({...record,identity_revision:2}),null);
});

test('proven unsent attempt returns to prepared and can retry, but verified receipt cannot be reset',async()=>{
 const {repo}=setup();let attempts=0;
 const source={document:async()=>({id:'doc',original_sha256:'a'.repeat(64),byte_size:3}),original:async()=>new Uint8Array([1,2,3])};
 const adapter={append:async()=>{attempts++;if(attempts===1)throw new upload.DocumentUploadError('UPLOAD_PREFLIGHT_FAILED',true);return receipt;}};
 const args=[source,repo,adapter,record,id,manifest.baseline,[{documentId:'doc',name:'SYNTHETIC.pdf'}],actor];
 const first=await uploadStoredDocuments(...args);assert.equal(first.state,'prepared');assert.equal(first.outcome_code,'NOT_SENT:UPLOAD_PREFLIGHT_FAILED');
 assert.equal((await uploadStoredDocuments(...args)).state,'verified');assert.equal(attempts,2);
 await repo.releaseUnsent(record.id,id,'LATE_ERROR');assert.equal((await repo.get(record.id,id)).state,'verified');
});

test('only owner can cancel unsent intent; new root replans while old history stays',async()=>{
 const {repo}=setup(),plan={...manifest,planHash:'plan',rootRequestId:id,batchIndex:0};
 await repo.prepare(record,id,plan,actor);
 await assert.rejects(repo.cancelUnsent(record,id,{...actor,id:'other'}),/UPLOAD_NOT_OWNED/);
 assert.equal((await repo.cancelUnsent(record,id,actor)).state,'cancelled');assert.equal(await repo.rootForPlan(record,'plan',actor),null);
 const next='00000000-0000-0000-0000-000000000002';await repo.prepare(record,next,{...plan,rootRequestId:next,baseline:[]},actor);
 assert.equal((await repo.get(record.id,id)).state,'cancelled');assert.equal(await repo.claim(record,id),false);assert.equal(await repo.claim(record,next),true);
 await assert.rejects(repo.cancelUnsent(record,next,actor),/UPLOAD_ALREADY_STARTED/);
 await repo.finish(record.id,next,null,'UNKNOWN');await assert.rejects(repo.cancelUnsent(record,next,actor),/UPLOAD_ALREADY_STARTED/);
});
test('cancelled later batch permits a new root without erasing a verified earlier batch',async()=>{
 const {repo}=setup(),plan={...manifest,planHash:'plan',rootRequestId:id,batchIndex:0};await repo.prepare(record,id,plan,actor);await repo.claim(record,id);await repo.finish(record.id,id,receipt,'VERIFIED');
 const second='00000000-0000-0000-0000-000000000002';await repo.prepare(record,second,{...plan,batchIndex:1},actor);await repo.cancelUnsent(record,second,actor);assert.equal(await repo.rootForPlan(record,'plan',actor),null);
 const next='00000000-0000-0000-0000-000000000003';await repo.prepare(record,next,{...plan,rootRequestId:next},actor);assert.equal((await repo.get(record.id,id)).state,'verified');
});
