import {RepositoryError,sha256,type CaseRow} from './repository';
import type {Actor} from '../worker-session';
import type {CrmFileRef,ReusedUpload} from '../crm/document-upload';
export type UploadManifest={version:1;supersedesRequestId?:string;repairReason?:'BITRIX_CHUNKED_TRANSPORT_TIMEOUT';scope?:'credentials';origin?:'bitrix-existing';credentialOwnerConfirmed?:true;reused?:ReusedUpload[];planHash?:string;rootRequestId?:string;batchIndex?:number;reviewIds?:string[];baseline:CrmFileRef[];files:Array<{documentId:string;sha256:string;name:string;byteSize:number}>};
export type UploadReceipt={files:Array<{id:string;sha256:string;name:string}>;preserved:CrmFileRef[];verified:true};
export type UploadRow={id:string;case_id:string;request_id:string;identity_revision:number;manifest_json:string;payload_hash:string;actor_id:string;authentication:string;state:string;receipt_json:string|null;outcome_code:string|null;created_at:string;updated_at:string};
export class UploadManifestRepository{
 constructor(private db:D1Database){}
 get(caseId:string,requestId:string){return this.db.prepare('SELECT * FROM assessment_upload_manifests WHERE case_id=? AND request_id=?').bind(caseId,requestId).first<UploadRow>();}
 async unsentForActor(record:CaseRow,actor:Actor,scope:'documents'|'credentials'){
  // Older identity revisions may also be cancelled: these bytes were never sent.
  const row=await this.db.prepare("SELECT request_id FROM assessment_upload_manifests WHERE case_id=? AND actor_id=? AND state='prepared' AND receipt_json IS NULL AND COALESCE(json_extract(manifest_json,'$.scope'),'documents')=? ORDER BY rowid DESC LIMIT 1").bind(record.id,actor.id,scope).first<{request_id:string}>();
  return row?{requestId:row.request_id}:null;
 }
 async rootForPlan(record:CaseRow,planHash:string,actor:Actor){
  const row=await this.db.prepare("SELECT * FROM assessment_upload_manifests candidate WHERE case_id=? AND identity_revision=? AND json_extract(manifest_json,'$.planHash')=? AND state<>'cancelled' AND NOT EXISTS (SELECT 1 FROM assessment_upload_manifests cancelled WHERE cancelled.case_id=candidate.case_id AND cancelled.state='cancelled' AND json_extract(cancelled.manifest_json,'$.rootRequestId')=json_extract(candidate.manifest_json,'$.rootRequestId')) ORDER BY rowid ASC LIMIT 1").bind(record.id,record.identity_revision,planHash).first<UploadRow>();
  if(!row)return null;
  if(row.actor_id!==actor.id)throw new RepositoryError('UPLOAD_OWNED_BY_ANOTHER_WORKER');
  const manifest=JSON.parse(row.manifest_json) as UploadManifest;
  if(!manifest.rootRequestId)throw new RepositoryError('UPLOAD_LEGACY_RECOVERY_REQUIRED');
  return manifest.rootRequestId;
 }
 async reusableFiles(record:CaseRow,files:UploadManifest['files'],baseline?:CrmFileRef[]):Promise<ReusedUpload[]>{
  const present=(id:string)=>!baseline||baseline.some(ref=>ref.id===id);
  const rows=(await this.db.prepare("SELECT manifest_json,receipt_json FROM assessment_upload_manifests WHERE case_id=? AND identity_revision=? AND state='verified' AND COALESCE(json_extract(manifest_json,'$.scope'),'documents')='documents' ORDER BY rowid DESC").bind(record.id,record.identity_revision).all<{manifest_json:string;receipt_json:string}>()).results;
  const found=new Map<string,ReusedUpload>();
  for(const row of rows){const manifest=JSON.parse(row.manifest_json) as UploadManifest,receipt=JSON.parse(row.receipt_json) as UploadReceipt;
   for(const file of files){if(found.has(file.sha256))continue;const source=manifest.files.find(f=>f.sha256===file.sha256&&f.byteSize===file.byteSize),ref=receipt.files.find(f=>f.sha256===file.sha256&&present(f.id));if(source&&ref&&/^[1-9]\d*$/.test(ref.id))found.set(file.sha256,{id:ref.id,sha256:file.sha256,byteSize:file.byteSize});}
  }
  const imported=(await this.db.prepare("SELECT r.value_json,d.original_sha256,d.byte_size FROM assessment_reviews r JOIN assessment_documents d ON d.id=r.document_id AND d.case_id=r.case_id WHERE r.case_id=? AND r.identity_revision=? AND r.fact_key='document.origin.bitrix.v1' AND r.disposition='confirmed' ORDER BY r.rowid DESC").bind(record.id,record.identity_revision).all<{value_json:string;original_sha256:string;byte_size:number}>()).results;
  for(const row of imported){
   let receipt;try{receipt=JSON.parse(row.value_json);}catch{continue;}
   if(!receipt||receipt.system!=='bitrix'||!/^[1-9]\d*$/.test(receipt.fileId||'')||!present(receipt.fileId)||receipt.sha256!==row.original_sha256||receipt.byteSize!==row.byte_size||found.has(receipt.sha256))continue;
   if(files.some(file=>file.sha256===receipt.sha256&&file.byteSize===receipt.byteSize))found.set(receipt.sha256,{id:receipt.fileId,sha256:receipt.sha256,byteSize:receipt.byteSize});
  }
  return [...found.values()];
 }
 async prepare(record:CaseRow,requestId:string,manifest:UploadManifest,actor:Actor){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)||manifest.version!==1||!manifest.files.length||manifest.files.length>200)throw new RepositoryError('INVALID_UPLOAD_MANIFEST',400);
  if(new Set(manifest.files.map(f=>f.sha256)).size!==manifest.files.length||manifest.files.some(f=>!/^[a-f0-9]{64}$/.test(f.sha256)||!f.documentId||!f.name||!Number.isSafeInteger(f.byteSize)||f.byteSize<=0))throw new RepositoryError('INVALID_UPLOAD_MANIFEST',400);
  if(manifest.reused&&(new Set(manifest.reused.map(f=>f.id)).size!==manifest.reused.length||new Set(manifest.reused.map(f=>f.sha256)).size!==manifest.reused.length||manifest.reused.some(f=>!manifest.baseline.some(b=>b.id===f.id)||!manifest.files.some(v=>v.sha256===f.sha256&&v.byteSize===f.byteSize))))throw new RepositoryError('INVALID_UPLOAD_REUSE');
  const serialized=JSON.stringify(manifest);if(new TextEncoder().encode(serialized).length>100000)throw new RepositoryError('UPLOAD_MANIFEST_TOO_LARGE',413);
  const hash=await sha256(JSON.stringify({manifest,identityRevision:record.identity_revision,actorId:actor.id}));
  const old=await this.get(record.id,requestId);if(old){if(old.payload_hash!==hash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');return old;}
  const now=new Date().toISOString();
  await this.db.prepare("INSERT INTO assessment_upload_manifests (id,case_id,request_id,identity_revision,manifest_json,payload_hash,actor_id,authentication,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'prepared',?,? WHERE EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) AND NOT EXISTS (SELECT 1 FROM assessment_upload_manifests other WHERE other.case_id=? AND other.identity_revision=? AND json_extract(other.manifest_json,'$.planHash')=? AND json_extract(other.manifest_json,'$.batchIndex')=? AND other.state<>'cancelled' AND NOT EXISTS (SELECT 1 FROM assessment_upload_manifests cancelled WHERE cancelled.case_id=other.case_id AND cancelled.state='cancelled' AND json_extract(cancelled.manifest_json,'$.rootRequestId')=json_extract(other.manifest_json,'$.rootRequestId'))) ON CONFLICT DO NOTHING")
   .bind(crypto.randomUUID(),record.id,requestId,record.identity_revision,serialized,hash,actor.id,actor.authentication,now,now,record.id,record.identity_revision,record.id,record.identity_revision,manifest.planHash??null,manifest.batchIndex??null).run();
  const saved=await this.get(record.id,requestId);if(!saved)throw new RepositoryError('UPLOAD_PENDING_OR_IDENTITY_CHANGED');if(saved.payload_hash!==hash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');return saved;
 }
 async claim(record:CaseRow,requestId:string){const result=await this.db.prepare("UPDATE assessment_upload_manifests SET state='writing',updated_at=? WHERE case_id=? AND request_id=? AND state='prepared' AND identity_revision=? AND EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) AND NOT EXISTS (SELECT 1 FROM json_each(assessment_upload_manifests.manifest_json, '$.reviewIds') required WHERE NOT EXISTS (SELECT 1 FROM assessment_reviews r WHERE r.id=required.value AND r.case_id=assessment_upload_manifests.case_id AND r.identity_revision=assessment_upload_manifests.identity_revision AND r.disposition IN ('confirmed','corrected') AND NOT EXISTS (SELECT 1 FROM assessment_reviews newer WHERE newer.case_id=r.case_id AND newer.document_id=r.document_id AND newer.extraction_id=r.extraction_id AND newer.identity_revision=r.identity_revision AND newer.fact_key=r.fact_key AND newer.rowid>r.rowid)))").bind(new Date().toISOString(),record.id,requestId,record.identity_revision,record.id,record.identity_revision).run();return result.meta.changes===1;}
 /** Prepared means no write began, or the claimant proved it never began. */
 async cancelUnsent(record:CaseRow,requestId:string,actor:Actor){
  const row=await this.get(record.id,requestId);
  if(!row||row.actor_id!==actor.id)throw new RepositoryError('UPLOAD_NOT_OWNED',404);
  if(row.state==='cancelled')return row;
  await this.db.prepare("UPDATE assessment_upload_manifests SET state='cancelled',outcome_code='CANCELLED_BEFORE_SEND',updated_at=? WHERE case_id=? AND request_id=? AND actor_id=? AND state='prepared' AND receipt_json IS NULL").bind(new Date().toISOString(),record.id,requestId,actor.id).run();
  const after=await this.get(record.id,requestId);if(after?.state!=='cancelled')throw new RepositoryError('UPLOAD_ALREADY_STARTED');return after;
 }
 /** Called only by the claimant with explicit adapter proof that no write started. */
 async releaseUnsent(caseId:string,requestId:string,code:string){
  await this.db.prepare("UPDATE assessment_upload_manifests SET state='prepared',outcome_code=?,updated_at=? WHERE case_id=? AND request_id=? AND state IN ('writing','uncertain') AND receipt_json IS NULL").bind('NOT_SENT:'+code,new Date().toISOString(),caseId,requestId).run();
  return this.get(caseId,requestId);
 }
 async finish(caseId:string,requestId:string,receipt:UploadReceipt|null,code:string){
  const row=await this.get(caseId,requestId);if(!row)throw new RepositoryError('UPLOAD_MANIFEST_NOT_FOUND',404);
  if(receipt){
   const manifest=JSON.parse(row.manifest_json) as UploadManifest;
   const hashes=new Set(receipt.files.map(f=>f.sha256)),ids=new Set(receipt.files.map(f=>f.id));
   if(manifest.reused?.some(r=>!receipt.files.some(f=>f.id===r.id&&f.sha256===r.sha256))||receipt.verified!==true||receipt.files.length!==manifest.files.length||hashes.size!==manifest.files.length||ids.size!==receipt.files.length||manifest.files.some(f=>!hashes.has(f.sha256))||receipt.preserved.length!==manifest.baseline.length||manifest.baseline.some(r=>!receipt.preserved.some(p=>p.id===r.id))||receipt.files.some(f=>! /^[1-9]\d*$/.test(f.id)||(manifest.baseline.some(r=>r.id===f.id)&&!manifest.reused?.some(r=>r.id===f.id&&r.sha256===f.sha256))))throw new RepositoryError('INVALID_UPLOAD_RECEIPT');
  }
  await this.db.prepare("UPDATE assessment_upload_manifests SET state=?,receipt_json=?,outcome_code=?,updated_at=? WHERE case_id=? AND request_id=? AND state IN ('writing','uncertain')").bind(receipt?'verified':'uncertain',receipt?JSON.stringify(receipt):null,code,new Date().toISOString(),caseId,requestId).run();return this.get(caseId,requestId);
 }
}
