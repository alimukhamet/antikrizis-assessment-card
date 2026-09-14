import type {DraftRow}from'../questionnaire/repository';
import type {SubmissionRow}from'../questionnaire/submission-repository';
import type {UploadRow}from'./upload-manifest';
import type { ClientContext } from '../crm/bitrix';
import type { Actor } from '../worker-session';
export class RepositoryError extends Error {constructor(public code:string, public status=409){super(code);}}
export type CaseRow={id:string;external_system:string;external_id:string;client_iin:string|null;identity_revision:number;title:string;created_at:string;updated_at:string};
export type DocumentRow={id:string;case_id:string;original_sha256:string;original_key:string;original_name:string;byte_size:number;uploaded_by:string;created_at:string};
export type ExtractionRow={id:string;document_id:string;version:string;result_key:string;result_sha256:string;created_at:string};
export type ReviewRow={id:string;request_id:string;case_id:string;document_id:string;extraction_id:string;identity_revision:number;fact_key:string;value_json:string;disposition:string;reason:string;actor_id:string;authentication:string;payload_hash:string;created_at:string};
export async function sha256(data:Uint8Array|string){const input=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',input))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export class EvidenceRepository {
 constructor(private db:D1Database,private files:R2Bucket){}
 async syncCase(client:ClientContext):Promise<CaseRow>{
  const now=new Date().toISOString();
  await this.db.prepare('INSERT INTO assessment_cases (id,external_system,external_id,client_iin,identity_revision,title,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?) ON CONFLICT(external_system,external_id) DO UPDATE SET identity_revision=CASE WHEN assessment_cases.client_iin IS excluded.client_iin THEN assessment_cases.identity_revision ELSE assessment_cases.identity_revision+1 END,client_iin=excluded.client_iin,title=excluded.title,updated_at=excluded.updated_at').bind(crypto.randomUUID(),client.external.system,client.external.dealId,client.iin,client.title,now,now).run();
  const row=await this.db.prepare('SELECT * FROM assessment_cases WHERE external_system=? AND external_id=?').bind(client.external.system,client.external.dealId).first<CaseRow>();
  if(!row)throw new RepositoryError('CASE_PERSISTENCE_FAILED',503);return row;
 }
 async document(caseId:string,documentId:string){return this.db.prepare('SELECT * FROM assessment_documents WHERE id=? AND case_id=?').bind(documentId,caseId).first<DocumentRow>();}
 async credentialStatus(record:CaseRow){
  const row=await this.db.prepare("SELECT * FROM assessment_upload_manifests WHERE case_id=? AND identity_revision=? AND json_extract(manifest_json,'$.scope')='credentials' AND state<>'cancelled' ORDER BY rowid DESC LIMIT 1").bind(record.id,record.identity_revision).first<UploadRow>();
  if(!row)return null;
  const manifest=JSON.parse(row.manifest_json),receipt=row.receipt_json?JSON.parse(row.receipt_json):null;
  const verified=row.state==='verified'&&receipt?.verified===true&&manifest.credentialOwnerConfirmed===true;
  const files=verified?(receipt.files as Array<{id:string;sha256:string}>).flatMap(ref=>{const file=(manifest.files as Array<{sha256:string;name:string;byteSize:number}>).find(file=>file.sha256===ref.sha256);return file?[{id:ref.id,name:'ЭЦП'+(/\.(p12|pfx|key|jks)$/i.exec(file.name)?.[0]||'.key'),byteSize:file.byteSize}]:[];}):[];
  return {id:row.id,requestId:row.request_id,state:row.state,verified,identityRevision:row.identity_revision,files,passwordStored:verified,origin:manifest.origin??'uploaded'};
 }
 async extraction(caseId:string,documentId:string,extractionId:string){return this.db.prepare('SELECT e.* FROM assessment_extractions e JOIN assessment_documents d ON d.id=e.document_id WHERE e.id=? AND d.id=? AND d.case_id=?').bind(extractionId,documentId,caseId).first<ExtractionRow>();}
 async original(document:DocumentRow){const file=await this.files.get(document.original_key);if(!file)throw new RepositoryError('ORIGINAL_FILE_MISSING',503);const bytes=new Uint8Array(await file.arrayBuffer());if(await sha256(bytes)!==document.original_sha256)throw new RepositoryError('ORIGINAL_INTEGRITY_FAILED',503);return bytes;}
 async cached(caseId:string,originalHash:string,version:string){
  const document=await this.db.prepare('SELECT * FROM assessment_documents WHERE case_id=? AND original_sha256=?').bind(caseId,originalHash).first<DocumentRow>();if(!document)return null;
  const extraction=await this.db.prepare('SELECT * FROM assessment_extractions WHERE document_id=? AND version=?').bind(document.id,version).first<ExtractionRow>();if(!extraction)return null;
  return {document,extraction,result:await this.readResult(extraction)};
 }
 async readResult(extraction:ExtractionRow):Promise<unknown>{
  const object=await this.files.get(extraction.result_key);if(!object)throw new RepositoryError('EVIDENCE_OBJECT_MISSING',503);
  const text=await object.text();if(await sha256(text)!==extraction.result_sha256)throw new RepositoryError('EVIDENCE_INTEGRITY_FAILED',503);
  return JSON.parse(text);
 }
 async store(caseId:string,bytes:Uint8Array,name:string,actor:Actor,version:string,result:unknown){
  const originalHash=await sha256(bytes),now=new Date().toISOString(),originalKey=`cases/${caseId}/originals/${originalHash}.pdf`;
  const existing=await this.db.prepare('SELECT * FROM assessment_documents WHERE case_id=? AND original_sha256=?').bind(caseId,originalHash).first<DocumentRow>();
  if(!existing){
   await this.files.put(originalKey,bytes,{httpMetadata:{contentType:'application/pdf'},customMetadata:{sha256:originalHash}});
   await this.db.prepare('INSERT INTO assessment_documents (id,case_id,original_sha256,original_key,original_name,byte_size,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(case_id,original_sha256) DO NOTHING').bind(crypto.randomUUID(),caseId,originalHash,originalKey,name.slice(0,240),bytes.length,actor.id,now).run();
  }
  const document=await this.db.prepare('SELECT * FROM assessment_documents WHERE case_id=? AND original_sha256=?').bind(caseId,originalHash).first<DocumentRow>();if(!document)throw new RepositoryError('DOCUMENT_PERSISTENCE_FAILED',503);
  const resultText=JSON.stringify(result),resultHash=await sha256(resultText),resultKey=`cases/${caseId}/extractions/${resultHash}.json`;
  await this.files.put(resultKey,resultText,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:resultHash}});
  await this.db.prepare('INSERT INTO assessment_extractions (id,document_id,version,result_key,result_sha256,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(document_id,version) DO NOTHING').bind(crypto.randomUUID(),document.id,version,resultKey,resultHash,now).run();
  const extraction=await this.db.prepare('SELECT * FROM assessment_extractions WHERE document_id=? AND version=?').bind(document.id,version).first<ExtractionRow>();if(!extraction)throw new RepositoryError('EXTRACTION_PERSISTENCE_FAILED',503);
  // A concurrent request can win; return the winning immutable result, not our discarded result.
  return {document,extraction,result:await this.readResult(extraction)};
 }
 async reviewRecord(caseId:string,reviewId:string){return this.db.prepare('SELECT * FROM assessment_reviews WHERE case_id=? AND id=?').bind(caseId,reviewId).first<ReviewRow>();}
 async appendReview(input:{caseId:string;documentId:string;extractionId:string;identityRevision:number;requestId:string;factKey:string;value:unknown;disposition:'confirmed'|'corrected'|'unresolved';reason:string;expectedReviewId?:string},actor:Actor){
  const doc=await this.document(input.caseId,input.documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE',404);
  const extraction=await this.db.prepare('SELECT * FROM assessment_extractions WHERE id=? AND document_id=?').bind(input.extractionId,doc.id).first<ExtractionRow>();if(!extraction)throw new RepositoryError('EXTRACTION_NOT_IN_DOCUMENT',404);
  const payloadHash=await sha256(JSON.stringify({...input,actorId:actor.id,authentication:actor.authentication}));
  const old=await this.db.prepare('SELECT * FROM assessment_reviews WHERE case_id=? AND request_id=?').bind(input.caseId,input.requestId).first<ReviewRow>();
  if(old){if(old.payload_hash!==payloadHash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');return old;}
  // Revision condition is part of the insert, closing the check/write race if CRM identity changed.
  await this.db.prepare('INSERT INTO assessment_reviews (id,request_id,case_id,document_id,extraction_id,identity_revision,fact_key,value_json,disposition,reason,actor_id,authentication,payload_hash,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) AND (? IS NULL OR (SELECT id FROM assessment_reviews WHERE case_id=? AND document_id=? AND extraction_id=? AND identity_revision=? AND fact_key=? ORDER BY rowid DESC LIMIT 1)=?) ON CONFLICT(case_id,request_id) DO NOTHING').bind(crypto.randomUUID(),input.requestId,input.caseId,doc.id,extraction.id,input.identityRevision,input.factKey,JSON.stringify(input.value),input.disposition,input.reason,actor.id,actor.authentication,payloadHash,new Date().toISOString(),input.caseId,input.identityRevision,input.expectedReviewId??null,input.caseId,doc.id,extraction.id,input.identityRevision,input.factKey,input.expectedReviewId??null).run();
  const saved=await this.db.prepare('SELECT * FROM assessment_reviews WHERE case_id=? AND request_id=?').bind(input.caseId,input.requestId).first<ReviewRow>();
  if(!saved)throw new RepositoryError(input.expectedReviewId?'REVIEW_CHANGED':'CASE_IDENTITY_CHANGED');if(saved.payload_hash!==payloadHash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');return saved;
 }
 async currentReviews(caseId:string,documentId:string,extractionId:string,identityRevision:number){
  const rows=(await this.db.prepare('SELECT rowid AS sequence,* FROM assessment_reviews WHERE case_id=? AND document_id=? AND extraction_id=? AND identity_revision=? ORDER BY rowid DESC').bind(caseId,documentId,extractionId,identityRevision).all<ReviewRow>()).results;
  const seen=new Set<string>();return rows.filter(row=>{if(seen.has(row.fact_key))return false;seen.add(row.fact_key);return row.disposition!=='unresolved';});
 }
 async exportCase(caseId:string){
  // A single D1 batch is a transaction: mutable submission/upload receipts and
  // the case revision must describe the same snapshot as the immutable history.
  const results=await this.db.batch([
   this.db.prepare('SELECT * FROM assessment_cases WHERE id=?').bind(caseId),
   this.db.prepare('SELECT * FROM assessment_documents WHERE case_id=? ORDER BY created_at,id').bind(caseId),
   this.db.prepare('SELECT e.* FROM assessment_extractions e JOIN assessment_documents d ON d.id=e.document_id WHERE d.case_id=? ORDER BY e.created_at,e.id').bind(caseId),
   this.db.prepare('SELECT rowid AS sequence,* FROM assessment_reviews WHERE case_id=? ORDER BY rowid').bind(caseId),
   this.db.prepare('SELECT * FROM assessment_draft_versions WHERE case_id=? ORDER BY revision').bind(caseId),
   this.db.prepare('SELECT rowid AS sequence,* FROM assessment_submissions WHERE case_id=? ORDER BY rowid').bind(caseId),
   this.db.prepare('SELECT rowid AS sequence,* FROM assessment_upload_manifests WHERE case_id=? ORDER BY rowid').bind(caseId),
  ]);
  if(results.some(result=>!result.success))throw new RepositoryError('EXPORT_SNAPSHOT_FAILED',503);
  const record=results[0].results[0] as CaseRow|undefined;if(!record)throw new RepositoryError('CASE_NOT_FOUND',404);
  return {schemaVersion:2,exportedAt:new Date().toISOString(),case:record,
   documents:results[1].results as DocumentRow[],extractions:results[2].results as ExtractionRow[],
   reviews:results[3].results as (ReviewRow&{sequence:number})[],drafts:results[4].results as DraftRow[],
   submissions:results[5].results as (SubmissionRow&{sequence:number})[],uploads:results[6].results as (UploadRow&{sequence:number})[]};
 }
}
