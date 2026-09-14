import {RepositoryError,sha256,type CaseRow} from './repository';
import {MAX_CREDENTIAL_BYTES} from './credential-plan';
import {UploadManifestRepository,type UploadManifest} from './upload-manifest';
import type {Actor} from '../worker-session';
import type {CrmFileRef} from '../crm/document-upload';

type Reader={read:()=>Promise<{iin:unknown;refs:CrmFileRef[]}>;file:(ref:CrmFileRef)=>Promise<{bytes:Uint8Array;name:string}>};
/** Register an existing key after a scoped read. This adapter has no CRM write operation. */
export async function importCredentials(manifests:UploadManifestRepository,record:CaseRow,actor:Actor,input:{requestId:string;identityRevision:number;fileIds:string[];ownerConfirmed:boolean},reader:Reader){
 if(!record.client_iin||record.identity_revision!==input.identityRevision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(!input.ownerConfirmed)throw new RepositoryError('CREDENTIAL_OWNER_CONFIRMATION_REQUIRED',400);
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.requestId))throw new RepositoryError('INVALID_CREDENTIAL_REFERENCE',400);
 if(!input.fileIds.length||input.fileIds.length>10||new Set(input.fileIds).size!==input.fileIds.length||input.fileIds.some(id=>! /^[1-9]\d*$/.test(id)))throw new RepositoryError('INVALID_CREDENTIAL_REFERENCE',400);
 const before=await reader.read();if(before.iin!==record.client_iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 const files:UploadManifest['files']=[],refs:Array<{id:string;sha256:string;name:string;byteSize:number}>=[];let size=0;
 for(const id of [...input.fileIds].sort()){
  if(!before.refs.some(ref=>ref.id===id))throw new RepositoryError('FILE_NOT_IN_DEAL',404);
  const {bytes,name}=await reader.file({id});size+=bytes.length;
  if(!/\.(p12|pfx|key|jks)$/i.test(name)||!bytes.length||size>MAX_CREDENTIAL_BYTES||name.length>240)throw new RepositoryError('INVALID_CREDENTIAL_FILE',400);
  // The approved legacy handoff stores the password in a protected CRM filename.
  // It stays in the credential manifest, never in the public DTO or questionnaire draft.
  if(!/пароль[\s:=-]+\S.*\.(?:p12|pfx|key|jks)$/i.test(name))throw new RepositoryError('CREDENTIAL_PASSWORD_NOT_STORED',422);
  const hash=await sha256(bytes);if(files.some(f=>f.sha256===hash))throw new RepositoryError('DUPLICATE_CREDENTIAL_FILE',400);
  files.push({documentId:'eds:'+hash,sha256:hash,name,byteSize:bytes.length});refs.push({id,sha256:hash,name,byteSize:bytes.length});
 }
 const fresh=await reader.read();if(fresh.iin!==record.client_iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(fresh.refs.length!==before.refs.length||before.refs.some(ref=>!fresh.refs.some(f=>f.id===ref.id)))throw new RepositoryError('DOCUMENTS_CHANGED_IN_CRM');
 const planHash=await sha256(JSON.stringify({origin:'bitrix-existing',files,refs}));
 const requestId=await manifests.rootForPlan(record,planHash,actor)??input.requestId;
 const prior=await manifests.get(record.id,requestId);
 const manifest:UploadManifest=prior?JSON.parse(prior.manifest_json):{version:1,scope:'credentials',origin:'bitrix-existing',credentialOwnerConfirmed:true,planHash,rootRequestId:requestId,batchIndex:0,baseline:before.refs,files,reused:refs.map(({id,sha256,byteSize})=>({id,sha256,byteSize}))};
 if(manifest.origin!=='bitrix-existing'||manifest.planHash!==planHash||prior&&(prior.actor_id!==actor.id||prior.identity_revision!==record.identity_revision||prior.state==='cancelled'))throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');
 if(prior?.state==='verified')return prior;
 const row=prior??await manifests.prepare(record,requestId,manifest,actor);
 if(row.state==='prepared'&&!await manifests.claim(record,requestId))throw new RepositoryError('CREDENTIAL_IMPORT_BUSY');
 return manifests.finish(record.id,requestId,{verified:true,preserved:before.refs,files:refs.map(({id,sha256,name})=>({id,sha256,name}))},'CREDENTIAL_EXISTING_READBACK_VERIFIED');
}
