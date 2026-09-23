import {RepositoryError,sha256,type EvidenceRepository,type CaseRow} from '../documents/repository';
import {analysisVersion,type Analysis} from '../documents/analysis-service';
import {checkDocumentPackage} from '../documents/package-check';
import {UploadManifestRepository,type UploadManifest} from '../documents/upload-manifest';
import {uploadStoredDocuments} from '../documents/upload-service';
import {uploadBatchId} from '../documents/upload-plan';
import {HandoffRepository,type HandoffPayload,type HandoffRow} from './handoff-repository';
import {HandoffMoveError,type createHandoffAdapter} from '../crm/lawyer-handoff';
import type {createDocumentUploadAdapter,CrmFileRef} from '../crm/document-upload';
import type {createAssessmentAdapter} from '../crm/assessment-write';
import type {SubmissionRepository,SubmissionPayload} from './submission-repository';
import type {Actor} from '../worker-session';

export async function validateHandoffDocuments(repository:EvidenceRepository,record:CaseRow,powerId:string,signedId:string,day:string){
 if(!record.client_iin||!powerId||!signedId||powerId===signedId)throw new RepositoryError('HANDOFF_DOCUMENTS_REQUIRED');
 const power=await checkDocumentPackage(repository,record,{schemaVersion:1,answers:[],groups:[],docContext:{social:'',salary:''},pendingFiles:[],documents:[{documentId:powerId,type:'Доверенность',person:'Клиент'}]},day,'handoff');
 if(!power.packageReady)throw new RepositoryError('HANDOFF_POWER_NOT_READY');
 const signed=await repository.document(record.id,signedId);if(!signed)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');
 const cached=await repository.cached(record.id,signed.original_sha256,analysisVersion),analysis=cached?.result as Analysis|undefined;
 if(!analysis?.read.totalPages)throw new RepositoryError('HANDOFF_SIGNED_PDF_REQUIRED');
 if(analysis.extraction.identity.iin&&analysis.extraction.identity.iin!==record.client_iin)throw new RepositoryError('WRONG_CLIENT');
 const credentials=await repository.credentialStatus(record);if(!credentials?.verified||!credentials.passwordStored)throw new RepositoryError('HANDOFF_CREDENTIALS_REQUIRED');
 return{reviewIds:power.manuallyReviewed.map(r=>r.reviewId),credentialRequestId:credentials.requestId};
}
type VerifiedReceipt={files:Array<{id:string;sha256:string}>};
function verifiedReceipt(json:string,code:string):VerifiedReceipt{
 let value:unknown;try{value=JSON.parse(json);}catch{throw new RepositoryError(code);}
 if(!value||typeof value!=='object'||!('verified' in value)||value.verified!==true||!('files' in value)||!Array.isArray(value.files)||!value.files.length)throw new RepositoryError(code);
 for(const file of value.files){if(!file||typeof file!=='object'||typeof file.id!=='string'||!file.id||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))throw new RepositoryError(code);}
 return value as VerifiedReceipt;
}
type DeliveryDependencies={repository:Pick<EvidenceRepository,'document'>;submissions:Pick<SubmissionRepository,'latestForCase'>;assessment:Pick<ReturnType<typeof createAssessmentAdapter>,'reconcile'>;manifests:Pick<UploadManifestRepository,'reusableFiles'>;upload:Pick<ReturnType<typeof createDocumentUploadAdapter>,'read'>;readFile:(ref:CrmFileRef)=>Promise<Uint8Array>};
/** Read-only delivery proof. A historical stage receipt is not evidence that the
 * assessment or its originals reached Bitrix. Use the immutable saved submission,
 * never the current editable draft, to determine which originals are required. */
export async function verifyHandoffDelivery(deps:DeliveryDependencies,record:CaseRow,options:{verifyBytes?:boolean}={}){
 const submission=await deps.submissions.latestForCase(record.id);
 if(!submission)throw new RepositoryError('HANDOFF_ASSESSMENT_REQUIRED');
 if(submission.case_id!==record.id||submission.identity_revision!==record.identity_revision||!record.client_iin)throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
 if(submission.state!=='verified'||submission.history_state!=='verified'||!/^[1-9]\d*$/.test(submission.history_comment_id||''))throw new RepositoryError('HANDOFF_ASSESSMENT_PENDING');
 let payload:SubmissionPayload;
 try{payload=JSON.parse(submission.payload_json);}catch{throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');}
 if(!payload?.values||payload.values.iin!==record.client_iin||!Array.isArray(payload.draft?.documents))throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
 let assessment;
 try{assessment=await deps.assessment.reconcile(record.external_id,record.client_iin,payload.values);}catch{throw new RepositoryError('HANDOFF_ASSESSMENT_UNVERIFIED');}
 if(!assessment.verified)throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
 const files:UploadManifest['files']=[],seen=new Set<string>();
 for(const selected of payload.draft.documents){
  if(!selected||typeof selected.documentId!=='string'||!selected.documentId)throw new RepositoryError('HANDOFF_ORIGINALS_REQUIRED');
  // Match documentUploadPlan: these two files belong to the handoff upload
  // phase below, where the selected current originals are verified separately.
  if(['Доверенность','Подписанный договор'].includes(selected.type))continue;
  if(seen.has(selected.documentId))continue;seen.add(selected.documentId);
  const doc=await deps.repository.document(record.id,selected.documentId);
  if(!doc)throw new RepositoryError('HANDOFF_ORIGINALS_REQUIRED');
  files.push({documentId:doc.id,name:doc.original_name,sha256:doc.original_sha256,byteSize:doc.byte_size});
 }
 if(!files.length)throw new RepositoryError('HANDOFF_ORIGINALS_REQUIRED');
 let baseline,receipts;
 try{
  baseline=await deps.upload.read(record.external_id);
  // Existing confirmed Bitrix imports carry the same immutable hash/size receipt
  // as uploads. They must remain attached and have their bytes checked again.
  receipts=await deps.manifests.reusableFiles(record,files,baseline.refs);
 }catch{throw new RepositoryError('HANDOFF_ORIGINALS_UNVERIFIED');}
 if(baseline.iin!==record.client_iin)throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
 for(const file of files){
  const receipt=receipts.find(ref=>ref.sha256===file.sha256&&ref.byteSize===file.byteSize&&baseline.refs.some(current=>current.id===ref.id));
  if(!receipt){
   let previous;
   try{previous=await deps.manifests.reusableFiles(record,[file]);}catch{throw new RepositoryError('HANDOFF_ORIGINALS_UNVERIFIED');}
   if(previous.length)throw new RepositoryError('HANDOFF_ORIGINAL_REMOVED');
   throw new RepositoryError('HANDOFF_ORIGINALS_REQUIRED');
  }
  if(options.verifyBytes!==false){
   let bytes;
   try{bytes=await deps.readFile(receipt);}catch{throw new RepositoryError('HANDOFF_ORIGINALS_UNVERIFIED');}
   if(bytes.byteLength!==file.byteSize||await sha256(bytes)!==file.sha256)throw new RepositoryError('HANDOFF_ORIGINAL_CHANGED');
  }
 }
 return {requestId:submission.request_id,payloadHash:submission.payload_hash,originals:seen.size};
}
type Dependencies=DeliveryDependencies&{repository:EvidenceRepository;handoffs:HandoffRepository;manifests:UploadManifestRepository;upload:ReturnType<typeof createDocumentUploadAdapter>;stages:ReturnType<typeof createHandoffAdapter>};
/** A timeout never authorizes a second stage update. All recovery after claim is read-only. */
export async function runHandoff(deps:Dependencies,record:CaseRow,actor:Actor,row:HandoffRow,day:string){
 const {repository,handoffs,manifests,upload,stages}=deps,payload=JSON.parse(row.payload_json) as HandoffPayload;
 if(row.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(row.state==='verified')return row;
 if(row.actor_id!==actor.id)throw new RepositoryError('HANDOFF_OWNED_BY_ANOTHER_WORKER');
 if(row.state==='writing'||row.state==='uncertain'){
  let verified=false;try{verified=await stages.reconcile(record.external_id,record.client_iin!,payload.destination,row.created_at);}catch{/* Preserve uncertain state. */}
  return handoffs.finish(record,row,verified?'verified':'uncertain',verified?'STAGE_READBACK_VERIFIED':'HANDOFF_OUTCOME_UNCERTAIN');
 }
 if(row.state!=='prepared')throw new RepositoryError('HANDOFF_CANCELLED');
 const delivered=await verifyHandoffDelivery(deps,record);
 const verify=async()=>{
  const current=await validateHandoffDocuments(repository,record,payload.powerId,payload.signedId,day);
  if(current.credentialRequestId!==payload.credentialRequestId||JSON.stringify(current.reviewIds)!==JSON.stringify(payload.reviewIds))throw new RepositoryError('HANDOFF_DOCUMENTS_CHANGED');
 };
 await verify();
 const receipts:Array<{id:string;sha256:string;byteSize:number}>=[];
 const selection=[{documentId:payload.powerId,label:'25 Доверенность'},{documentId:payload.signedId,label:'Подписанный договор TrustMe'}];
 for(let index=0;index<selection.length;index++){
  const selected=selection[index],doc=await repository.document(record.id,selected.documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');
  const batchId=await uploadBatchId(row.request_id,index),name=`${selected.label} - сделка ${record.external_id}.pdf`;
  let uploadRow=await manifests.get(record.id,batchId);
  const manifest=uploadRow?JSON.parse(uploadRow.manifest_json) as UploadManifest:null;
  if(manifest&&(manifest.files.length!==1||manifest.files[0].documentId!==doc.id||manifest.files[0].sha256!==doc.original_sha256||uploadRow!.actor_id!==actor.id||uploadRow!.identity_revision!==record.identity_revision))throw new RepositoryError('HANDOFF_DOCUMENTS_CHANGED');
  if(!uploadRow||uploadRow.state==='prepared'){
   const baseline=manifest?.baseline??(await upload.read(record.external_id)).refs;
   const reused=manifest?.reused??await manifests.reusableFiles(record,[{documentId:doc.id,name,sha256:doc.original_sha256,byteSize:doc.byte_size}],baseline);
   uploadRow=await uploadStoredDocuments(repository,manifests,upload,record,batchId,baseline,[{documentId:doc.id,name}],actor,{planHash:await sha256('handoff:'+row.request_id),rootRequestId:row.request_id,batchIndex:index,reviewIds:payload.reviewIds,reused});
  }else if(uploadRow.state==='writing'||uploadRow.state==='uncertain'){
   try{const receipt=await upload.reconcile(record.external_id,record.client_iin!,manifest!.baseline,manifest!.files,manifest!.reused);uploadRow=await manifests.finish(record.id,batchId,receipt,'HANDOFF_FILES_VERIFIED');}
   catch{throw new RepositoryError('HANDOFF_UPLOAD_UNCERTAIN');}
  }
  if(uploadRow?.state!=='verified'||!uploadRow.receipt_json)throw new RepositoryError('HANDOFF_UPLOAD_UNCERTAIN');
  const receipt=verifiedReceipt(uploadRow.receipt_json,'HANDOFF_UPLOAD_UNCERTAIN'),ref=receipt.files.find(f=>f.sha256===doc.original_sha256);if(!ref)throw new RepositoryError('HANDOFF_UPLOAD_UNCERTAIN');
  receipts.push({id:ref.id,sha256:doc.original_sha256,byteSize:doc.byte_size});
 }
 // Verify all three items are still present, including keys saved in an earlier session.
 const keyRow=await manifests.get(record.id,payload.credentialRequestId);
 if(keyRow?.state!=='verified'||!keyRow.receipt_json)throw new RepositoryError('HANDOFF_CREDENTIALS_REQUIRED');
 const keyManifest=JSON.parse(keyRow.manifest_json) as UploadManifest,keyReceipt=verifiedReceipt(keyRow.receipt_json,'HANDOFF_CREDENTIALS_REQUIRED');
 if(keyManifest.scope!=='credentials'||!keyManifest.credentialOwnerConfirmed||keyRow.identity_revision!==record.identity_revision)throw new RepositoryError('HANDOFF_CREDENTIALS_REQUIRED');
 for(const ref of keyReceipt.files){const file=keyManifest.files.find(f=>f.sha256===ref.sha256);if(!file)throw new RepositoryError('HANDOFF_CREDENTIALS_REQUIRED');receipts.push({id:ref.id,sha256:file.sha256,byteSize:file.byteSize});}
 const baseline=await upload.read(record.external_id);if(baseline.iin!==record.client_iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 for(const file of receipts){
  if(!baseline.refs.some(ref=>ref.id===file.id))throw new RepositoryError('HANDOFF_FILE_REMOVED');
  const bytes=await deps.readFile(file);if(bytes.byteLength!==file.byteSize||await sha256(bytes)!==file.sha256)throw new RepositoryError('HANDOFF_FILE_CHANGED');
 }
 await verify();
 const currentDelivery=await verifyHandoffDelivery(deps,record);
 if(currentDelivery.requestId!==delivered.requestId||currentDelivery.payloadHash!==delivered.payloadHash)throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
 if(!await handoffs.claim(record,row))return handoffs.get(record.id,row.request_id);
 let verified=false;
 try{verified=await stages.move(record.external_id,record.client_iin!,payload.destination,row.created_at);}
 catch(error){if(error instanceof HandoffMoveError&&error.notStarted)return handoffs.finish(record,row,'prepared',error.code);}
 return handoffs.finish(record,row,verified?'verified':'uncertain',verified?'STAGE_READBACK_VERIFIED':'HANDOFF_OUTCOME_UNCERTAIN');
}
