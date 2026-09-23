import {RepositoryError,type EvidenceRepository,type CaseRow} from './repository';
import {UploadManifestRepository,type UploadManifest} from './upload-manifest';
import {DocumentUploadError,type createDocumentUploadAdapter,type CrmFileRef,type ReusedUpload} from '../crm/document-upload';
import type {Actor} from '../worker-session';
/** Internal operation after document approval; no browser-supplied bytes or hashes trusted. */
export async function uploadStoredDocuments(repository:EvidenceRepository,manifests:UploadManifestRepository,adapter:ReturnType<typeof createDocumentUploadAdapter>,record:CaseRow,requestId:string,baseline:CrmFileRef[],selection:Array<{documentId:string;name:string}>,actor:Actor,context?:{planHash:string;rootRequestId?:string;batchIndex?:number;reviewIds:string[];reused?:ReusedUpload[]}){
 if(!record.client_iin||!selection.length||selection.length>200)throw new RepositoryError('INVALID_UPLOAD_SELECTION',400);
 const documents=[];
 for(const selected of selection){const doc=await repository.document(record.id,selected.documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');if(!selected.name||selected.name.length>240||/[\r\n/\\]/.test(selected.name))throw new RepositoryError('INVALID_UPLOAD_NAME',400);documents.push({doc,name:selected.name});}
 if(documents.reduce((n,d)=>n+d.doc.byte_size,0)>35*1024*1024)throw new RepositoryError('UPLOAD_BATCH_TOO_LARGE',413);
 const manifest:UploadManifest={version:1,...context,baseline,files:documents.map(({doc,name})=>({documentId:doc.id,name,sha256:doc.original_sha256,byteSize:doc.byte_size}))};
 const intent=await manifests.prepare(record,requestId,manifest,actor);if(intent.state==='verified'||intent.state==='writing'||intent.state==='uncertain')return intent;
 const files=[];for(const {doc,name} of documents)files.push({name,bytes:await repository.original(doc)});
 if(!await manifests.claim(record,requestId))return manifests.get(record.id,requestId);
 let receipt;
 try{receipt=await adapter.append(record.external_id,record.client_iin,baseline,files,manifest.reused);}
 catch(error){if(error instanceof DocumentUploadError&&error.notStarted)return manifests.releaseUnsent(record.id,requestId,error.code);return manifests.finish(record.id,requestId,null,error instanceof DocumentUploadError?error.code:'UPLOAD_OUTCOME_UNCERTAIN');}
 return manifests.finish(record.id,requestId,receipt,'UPLOAD_READBACK_VERIFIED');
}
