import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateAssessmentExport,validateAssessmentBundle} from '../scripts/validate-assessment-export.mjs';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const fixture=()=>[
 {type:'manifest',schemaVersion:2,format:'assessment-ndjson',historyOrder:'sequence-ascending-within-record-type',case:{id:'case'},questionnaireDefinition:{version:1}},
 {type:'document',id:'doc',case_id:'case',original_sha256:'a'.repeat(64),byte_size:3,downloadPath:'/api/assessment/11665/documents/doc'},
 {type:'extraction',id:'ext',document_id:'doc',result:{}},
 {type:'review',id:'r1',case_id:'case',document_id:'doc',extraction_id:'ext',sequence:2,disposition:'confirmed'},
 {type:'review',id:'r2',case_id:'case',document_id:'doc',extraction_id:'ext',sequence:4,disposition:'unresolved'},
 {type:'document-upload',id:'upload',case_id:'case',sequence:1,state:'uncertain',manifest:{files:[{documentId:'doc'}]},receipt:null},
 {type:'complete',documents:1,extractions:1,reviews:2,drafts:0,submissions:0,uploads:1}
];
const validate=rows=>validateAssessmentExport(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
test('export validation preserves withdrawal order and uncertainty without claiming byte or CRM verification',()=>{
 const rows=fixture(),before=JSON.stringify(rows),result=validate(rows);
 assert.equal(result.counts.reviews,2);assert.equal(result.originalBytesVerified,false);assert.equal(result.externalWritesReplayed,false);assert.equal(JSON.stringify(rows),before);
});
test('truncated, duplicate, wrong-case, miscounted and reordered exports fail closed',()=>{
 for(const mutate of [r=>r.pop(),r=>r.splice(2,0,{...r[1]}),r=>r[1].case_id='other',r=>r.at(-1).documents=2,r=>r[4].sequence=1,r=>r[4].extraction_id='missing',r=>r[2].document_id='other',r=>r[5].state='verified',r=>r[0].schemaVersion=1]){
  const rows=fixture();mutate(rows);assert.throws(()=>validate(rows),/EXPORT_/);
 }
 assert.throws(()=>validateAssessmentExport('{'),/EXPORT_INVALID_JSON/);
});
test('offline bundle validates bytes and rejects missing, truncated, corrupted and linked originals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'assessment-export-'));
 try{
  const rows=fixture(),bytes=Buffer.from('PDF');rows[1].original_sha256=createHash('sha256').update(bytes).digest('hex');
  const text=rows.map(row=>JSON.stringify(row)).join('\n'),file=join(dir,rows[1].original_sha256);
  await assert.rejects(validateAssessmentBundle(text,dir),/EXPORT_ORIGINAL_UNAVAILABLE/);
  await writeFile(file,bytes);assert.equal((await validateAssessmentBundle(text,dir)).originalBytesVerified,true);
  await writeFile(file,'PD');await assert.rejects(validateAssessmentBundle(text,dir),/EXPORT_ORIGINAL_SIZE_MISMATCH/);
  await writeFile(file,'BAD');await assert.rejects(validateAssessmentBundle(text,dir),/EXPORT_ORIGINAL_HASH_MISMATCH/);
  await rm(file);await writeFile(join(dir,'target'),bytes);await symlink(join(dir,'target'),file);
  await assert.rejects(validateAssessmentBundle(text,dir),/EXPORT_ORIGINAL_UNAVAILABLE/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('title repair exports retain independent uncertain intent and reject changed targets or receipts',()=>{
 const rows=fixture();rows[0].case.external_id='900001';
 const payload={values:{iin:'000000000001',fio:'Синтетический Клиент',procedure:'199'}};
 const intent={version:1,requestId:'12345678-1234-1234-1234-123456789abc',actorId:'worker:ali',authentication:'test',caseId:'case',identityRevision:1,submissionId:'s',submissionRequestId:'saved',submissionHash:'a'.repeat(64),createdAt:'2026-09-23T12:00:00.000Z',policy:'VP_FIO_1',before:{dealId:'900001',iin:payload.values.iin,fio:payload.values.fio,procedure:'199',categoryId:'1',stageId:'C1:NEW',title:'Client - [whatcrm] line #21'},desiredTitle:'ВП '+payload.values.fio};
 intent.proposalHash=createHash('sha256').update(JSON.stringify({version:1,caseId:intent.caseId,identityRevision:intent.identityRevision,submissionId:intent.submissionId,submissionHash:intent.submissionHash,policy:intent.policy,before:intent.before,desiredTitle:intent.desiredTitle})).digest('hex');
 const submission={type:'assessment-submission',id:'s',case_id:'case',sequence:1,request_id:'saved',payload_hash:intent.submissionHash,identity_revision:1,payload,title_repair_json:JSON.stringify(intent),title_repair_state:'uncertain',title_repair_updated_at:intent.createdAt};
 rows.splice(-1,0,submission);rows.at(-1).submissions=1;
 const before=JSON.stringify(rows);assert.equal(validate(rows).externalWritesReplayed,false);assert.equal(JSON.stringify(rows),before);
 for(const modify of [s=>s.title_repair_json=null,s=>s.title_repair_state='unknown',s=>s.title_repair_updated_at=null,s=>s.payload_hash='b'.repeat(64),s=>s.title_repair_json=s.title_repair_json.replace('ВП ','СБ '),s=>s.title_repair_json=s.title_repair_json.replace('C1:NEW','C1:NEXT'),s=>s.title_repair_json=s.title_repair_json.replace('worker:ali','worker:other')]){
  const invalid=structuredClone(rows);modify(invalid.at(-2));assert.throws(()=>validate(invalid),/EXPORT_TITLE_REPAIR_RECEIPT/);
 }
 for(const state of ['prepared','writing','verified','cancelled']){const copy=structuredClone(rows);copy.at(-2).title_repair_state=state;assert.equal(validate(copy).counts.submissions,1);}
});
