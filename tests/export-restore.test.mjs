import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {restoreAssessmentExport} from '../scripts/restore-assessment-export.mjs';
function fixture(){return [{type:'manifest',schemaVersion:2,format:'assessment-ndjson',historyOrder:'sequence-ascending-within-record-type',questionnaireDefinition:{version:1},case:{id:'case',external_system:'bitrix',external_id:'11665',client_iin:null,identity_revision:1,title:'SYNTHETIC',created_at:'now',updated_at:'now'}},{type:'complete',documents:0,extractions:0,reviews:0,drafts:0,submissions:0,uploads:0}];}
test('offline restore creates isolated database and refuses an existing destination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'assessment-import-'));try{
 const input=join(root,'input.ndjson'),out=join(root,'restored');await writeFile(input,fixture().map(JSON.stringify).join('\n'));
 const result=await restoreAssessmentExport(input,root,root,out);assert.equal(result.externalWritesReplayed,false);
 const db=new DatabaseSync(join(out,'assessment.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT title FROM assessment_cases').get().title,'SYNTHETIC');db.close();
 const before=await readFile(join(out,'complete.json'));await assert.rejects(restoreAssessmentExport(input,root,root,out),/EEXIST/);assert.deepEqual(await readFile(join(out,'complete.json')),before);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('failed database import removes only its newly created incomplete destination',async()=>{
 const root=await mkdtemp(join(tmpdir(),'assessment-import-'));try{
 const rows=fixture();delete rows[0].case.external_system;const input=join(root,'input.ndjson'),out=join(root,'restored');await writeFile(input,rows.map(JSON.stringify).join('\n'));
 await assert.rejects(restoreAssessmentExport(input,root,root,out),/NOT NULL/);await assert.rejects(stat(out),/ENOENT/);assert.ok(await readFile(input));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('separate credential originals must match verified manifest bytes before destination creation',async()=>{
 const {createHash}=await import('node:crypto'),root=await mkdtemp(join(tmpdir(),'credential-import-'));
 try{
  const bytes=Buffer.from('SYNTHETIC KEY'),sha=createHash('sha256').update(bytes).digest('hex'),rows=fixture();
  rows.splice(1,0,{type:'document-upload',id:'upload',case_id:'case',sequence:1,request_id:'request',identity_revision:1,payload_hash:'hash',actor_id:'worker',authentication:'test',state:'verified',created_at:'now',updated_at:'now',manifest:{scope:'credentials',files:[{documentId:'eds:'+sha,sha256:sha,byteSize:bytes.length,name:'TEST.key'}]},receipt:{verified:true,files:[{id:'22',sha256:sha}]}});rows.at(-1).uploads=1;
  const input=join(root,'input.ndjson');await writeFile(input,rows.map(JSON.stringify).join('\n'));await writeFile(join(root,sha),Buffer.from('WRONG'));
  await assert.rejects(restoreAssessmentExport(input,root,root,join(root,'bad'),root),/RESTORE_CREDENTIAL_HASH_MISMATCH/);await assert.rejects(stat(join(root,'bad')),/ENOENT/);
  await writeFile(join(root,sha),bytes);const result=await restoreAssessmentExport(input,root,root,join(root,'good'),root);assert.equal(result.credentialFilesChecked,1);assert.deepEqual(await readFile(join(root,'good','credentials',sha)),bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('offline restore preserves uncertain title maintenance without altering original submission history',async()=>{
 const {createHash}=await import('node:crypto'),root=await mkdtemp(join(tmpdir(),'title-repair-restore-'));
 try{
  const rows=fixture(),stamp='2026-09-23T12:00:00.000Z',sha='a'.repeat(64),renderer='b'.repeat(64);
  const payload={values:{iin:'000000000001',fio:'Синтетический Клиент',procedure:'199'},contractRendererVersion:renderer};
  const intent={version:1,requestId:'12345678-1234-1234-1234-123456789abc',actorId:'worker:ali',authentication:'test',caseId:'case',identityRevision:1,submissionId:'saved',submissionRequestId:'request',submissionHash:sha,createdAt:stamp,policy:'VP_FIO_1',before:{dealId:'11665',iin:payload.values.iin,fio:payload.values.fio,procedure:'199',categoryId:'1',stageId:'C1:NEW',title:'Client - [whatcrm] line #21'},desiredTitle:'ВП '+payload.values.fio};
  intent.proposalHash=createHash('sha256').update(JSON.stringify({version:1,caseId:intent.caseId,identityRevision:intent.identityRevision,submissionId:intent.submissionId,submissionHash:intent.submissionHash,policy:intent.policy,before:intent.before,desiredTitle:intent.desiredTitle})).digest('hex');
  const saved={type:'assessment-submission',id:'saved',case_id:'case',sequence:1,request_id:'request',identity_revision:1,payload_hash:sha,actor_id:'worker:darkhan',authentication:'staff',state:'verified',history_state:'verified',history_comment_id:'123',created_at:stamp,updated_at:stamp,payload,title_repair_json:JSON.stringify(intent),title_repair_state:'uncertain',title_repair_updated_at:stamp};
  rows.splice(1,0,saved);rows.at(-1).submissions=1;
  const input=join(root,'input.ndjson'),out=join(root,'restored');await writeFile(input,rows.map(JSON.stringify).join('\n'));await writeFile(join(root,renderer+'.js'),'// synthetic renderer');
  const result=await restoreAssessmentExport(input,root,root,out);assert.equal(result.externalWritesReplayed,false);
  const db=new DatabaseSync(join(out,'assessment.sqlite'),{readOnly:true}),restored=db.prepare('SELECT * FROM assessment_submissions').get();db.close();
  for(const key of ['actor_id','authentication','payload_hash','state','history_state','history_comment_id','created_at','updated_at','title_repair_json','title_repair_state','title_repair_updated_at'])assert.equal(restored[key],saved[key],key);
  assert.deepEqual(JSON.parse(restored.payload_json),payload);
 }finally{await rm(root,{recursive:true,force:true});}
});
