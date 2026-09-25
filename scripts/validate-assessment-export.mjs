import {readFile,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const countsByType={'document':'documents','extraction':'extractions','review':'reviews','questionnaire-draft':'drafts','assessment-submission':'submissions','document-upload':'uploads'};
const ordered=new Set(['review','assessment-submission','document-upload']);
const fail=code=>{throw new Error(code);};
/** Offline structural validation only. Never imports rows or replays CRM operations. */
export function validateAssessmentExport(text){
 const lines=text.trim().split(/\r?\n/);let rows;
 try{rows=lines.map(line=>JSON.parse(line));}catch{fail('EXPORT_INVALID_JSON');}
 if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))fail('EXPORT_INVALID_RECORD');
 const first=rows[0],last=rows.at(-1);
 if(first.type!=='manifest'||last.type!=='complete'||rows.length<2)fail('EXPORT_INCOMPLETE');
 if(first.schemaVersion!==2||first.format!=='assessment-ndjson'||first.historyOrder!=='sequence-ascending-within-record-type')fail('EXPORT_UNSUPPORTED_FORMAT');
 if(typeof first.case?.id!=='string'||!first.case.id||!first.questionnaireDefinition)fail('EXPORT_MISSING_CONTEXT');
 const groups=Object.fromEntries(Object.keys(countsByType).map(type=>[type,[]]));
 const seen=new Map(),previous=new Map();
 for(const row of rows.slice(1,-1)){
  if(!Object.hasOwn(groups,row.type))fail('EXPORT_UNEXPECTED_RECORD');
  if(typeof row.id!=='string'||!row.id)fail('EXPORT_MISSING_ID');
  const key=row.type+':'+row.id;if(seen.has(key))fail('EXPORT_DUPLICATE_ID');seen.set(key,row);
  if(row.type!=='extraction'&&row.case_id!==first.case.id)fail('EXPORT_WRONG_CASE');
  if(ordered.has(row.type)){
   if(!Number.isSafeInteger(row.sequence)||row.sequence<=0||row.sequence<=(previous.get(row.type)||0))fail('EXPORT_HISTORY_ORDER');
   previous.set(row.type,row.sequence);
  }
  groups[row.type].push(row);
 }
 for(const [type,count]of Object.entries(countsByType))if(!Number.isSafeInteger(last[count])||last[count]!==groups[type].length)fail('EXPORT_COUNT_MISMATCH');
 for(const row of groups.extraction)if(!seen.has('document:'+row.document_id)||!Object.hasOwn(row,'result'))fail('EXPORT_EXTRACTION_REFERENCE');
 for(const row of groups.review){const extraction=seen.get('extraction:'+row.extraction_id);if(!seen.has('document:'+row.document_id)||!extraction||extraction.document_id!==row.document_id)fail('EXPORT_REVIEW_REFERENCE');}
 for(const row of groups.document)if(!/^[a-f0-9]{64}$/.test(row.original_sha256)||!Number.isSafeInteger(row.byte_size)||row.byte_size<=0||typeof row.downloadPath!=='string')fail('EXPORT_DOCUMENT_METADATA');
 for(const type of ['questionnaire-draft','assessment-submission'])for(const row of groups[type])if(!Object.hasOwn(row,'payload'))fail('EXPORT_MISSING_PAYLOAD');
 for(const row of groups['assessment-submission']){
  const fields=[row.title_repair_json,row.title_repair_state,row.title_repair_updated_at];
  if(fields.every(value=>value==null))continue;
  if(!['prepared','writing','uncertain','verified','cancelled'].includes(row.title_repair_state)||
     typeof row.title_repair_updated_at!=='string'||!Number.isFinite(Date.parse(row.title_repair_updated_at)))fail('EXPORT_TITLE_REPAIR_RECEIPT');
  let intent;try{intent=JSON.parse(row.title_repair_json);}catch{fail('EXPORT_TITLE_REPAIR_RECEIPT');}
  if(!intent||intent.version!==1||intent.policy!=='VP_FIO_1'||intent.caseId!==row.case_id||
     intent.submissionId!==row.id||intent.submissionRequestId!==row.request_id||intent.submissionHash!==row.payload_hash||
     intent.identityRevision!==row.identity_revision||intent.actorId!=='worker:ali'||
     typeof intent.authentication!=='string'||!intent.authentication||!Number.isFinite(Date.parse(intent.createdAt))||
     !/^[a-f0-9]{64}$/.test(intent.proposalHash)||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(intent.requestId)||
     intent.before?.dealId!==first.case.external_id||intent.before.iin!==row.payload.values?.iin||
     intent.before.fio!==row.payload.values?.fio||intent.before.procedure!=='199'||row.payload.values?.procedure!=='199'||
     intent.before.categoryId!=='1'||intent.before.stageId!=='C1:NEW'||typeof intent.before.title!=='string'||
     typeof intent.before.fio!=='string'||!intent.before.fio.trim()||
     intent.desiredTitle!=='ВП '+intent.before.fio.replace(/\s+/gu,' ').trim())fail('EXPORT_TITLE_REPAIR_RECEIPT');
  const proposal={version:1,caseId:intent.caseId,identityRevision:intent.identityRevision,submissionId:intent.submissionId,
   submissionHash:intent.submissionHash,policy:intent.policy,before:intent.before,desiredTitle:intent.desiredTitle};
  if(createHash('sha256').update(JSON.stringify(proposal)).digest('hex')!==intent.proposalHash)fail('EXPORT_TITLE_REPAIR_RECEIPT');
 }
 for(const row of groups['document-upload']){
  if(!Array.isArray(row.manifest?.files)||!row.manifest.files.length)fail('EXPORT_UPLOAD_MANIFEST');
  for(const file of row.manifest.files){if(row.manifest.scope==='credentials'){if(file.documentId!=='eds:'+file.sha256||!/^[a-f0-9]{64}$/.test(file.sha256))fail('EXPORT_UPLOAD_REFERENCE');}else if(!seen.has('document:'+file.documentId))fail('EXPORT_UPLOAD_REFERENCE');}
  if(row.state==='verified'&&row.receipt?.verified!==true)fail('EXPORT_UPLOAD_RECEIPT');
 }
 return {schemaVersion:2,counts:Object.fromEntries(Object.entries(countsByType).map(([type,count])=>[count,groups[type].length])),originalBytesVerified:false,externalWritesReplayed:false};
}
/** Files are named by validated content hash, never by a source path or client name. */
export async function validateAssessmentBundle(text,originalsDirectory){
 const result=validateAssessmentExport(text);
 const documents=text.trim().split(/\r?\n/).map(line=>JSON.parse(line)).filter(row=>row.type==='document');
 for(const doc of documents){
  let handle;
  try{handle=await open(join(originalsDirectory,doc.original_sha256),constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch{fail('EXPORT_ORIGINAL_UNAVAILABLE');}
  try{
   const stat=await handle.stat();
   if(!stat.isFile()||stat.size!==doc.byte_size)fail('EXPORT_ORIGINAL_SIZE_MISMATCH');
   const hash=createHash('sha256');let bytes=0;
   for await(const chunk of handle.createReadStream({autoClose:false})){bytes+=chunk.length;if(bytes>doc.byte_size)fail('EXPORT_ORIGINAL_SIZE_MISMATCH');hash.update(chunk);}
   if(bytes!==doc.byte_size)fail('EXPORT_ORIGINAL_SIZE_MISMATCH');
   if(hash.digest('hex')!==doc.original_sha256)fail('EXPORT_ORIGINAL_HASH_MISMATCH');
  }finally{await handle.close();}
 }
 return {...result,originalBytesVerified:true,originalFilesChecked:documents.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==3&&!(process.argv.length===5&&process.argv[3]==='--originals'))fail('USAGE: node scripts/validate-assessment-export.mjs export.ndjson [--originals directory]');const text=await readFile(process.argv[2],'utf8');console.log(JSON.stringify(process.argv[4]?await validateAssessmentBundle(text,process.argv[4]):validateAssessmentExport(text),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
