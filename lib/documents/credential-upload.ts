import {RepositoryError,type CaseRow} from './repository';
import {credentialUploadPlan} from './credential-plan';
import {UploadManifestRepository,type UploadManifest} from './upload-manifest';
import {DocumentUploadError,type createDocumentUploadAdapter} from '../crm/document-upload';
import type {Actor} from '../worker-session';
/** Separate legacy handoff: no PDF extraction, key storage or questionnaire draft mutation. */
export async function uploadCredentials(manifests:UploadManifestRepository,adapter:ReturnType<typeof createDocumentUploadAdapter>,record:CaseRow,actor:Actor,input:{requestId:string;identityRevision:number;clientName:string;password:string;ownerConfirmed:boolean;files:Array<{name:string;bytes:Uint8Array}>}){
 if(!record.client_iin||record.identity_revision!==input.identityRevision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(input.ownerConfirmed!==true)throw new RepositoryError('CREDENTIAL_OWNER_CONFIRMATION_REQUIRED',400);
 const plan=await credentialUploadPlan({...input,dealId:record.external_id});
 const requestId=await manifests.rootForPlan(record,plan.planHash,actor)??input.requestId;
 const prior=await manifests.get(record.id,requestId);
 let manifest:UploadManifest;
 if(prior){manifest=JSON.parse(prior.manifest_json);if(manifest.scope!=='credentials'||manifest.planHash!==plan.planHash||prior.actor_id!==actor.id||prior.identity_revision!==record.identity_revision)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');}
 else{
  const baseline=(await adapter.read(record.external_id)).refs;
  manifest={version:1,scope:'credentials',credentialOwnerConfirmed:true,planHash:plan.planHash,rootRequestId:requestId,batchIndex:0,baseline,files:plan.files};
 }
 const row=prior??await manifests.prepare(record,requestId,manifest,actor);
 if(row.state==='verified')return row;
 if(row.state==='writing'||row.state==='uncertain'){
  try{return await manifests.finish(record.id,requestId,await adapter.reconcile(record.external_id,record.client_iin,manifest.baseline,manifest.files),'CREDENTIAL_READBACK_VERIFIED');}
  catch(error){return manifests.finish(record.id,requestId,null,error instanceof DocumentUploadError?error.code:'CREDENTIAL_OUTCOME_UNCERTAIN');}
 }
 if(!await manifests.claim(record,requestId))return manifests.get(record.id,requestId);
 try{
  const files=input.files.map((file,index)=>({name:manifest.files[index].name,bytes:file.bytes}));
  const receipt=await adapter.append(record.external_id,record.client_iin,manifest.baseline,files);
  return manifests.finish(record.id,requestId,receipt,'CREDENTIAL_READBACK_VERIFIED');
 }catch(error){if(error instanceof DocumentUploadError&&error.notStarted)return manifests.releaseUnsent(record.id,requestId,error.code);return manifests.finish(record.id,requestId,null,error instanceof DocumentUploadError?error.code:'CREDENTIAL_OUTCOME_UNCERTAIN');}
}
