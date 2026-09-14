import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import {UploadManifestRepository} from '../../../../../lib/documents/upload-manifest';
import {uploadCredentials} from '../../../../../lib/documents/credential-upload';
import {importCredentials} from '../../../../../lib/documents/credential-import';
import {MAX_CREDENTIAL_BYTES} from '../../../../../lib/documents/credential-plan';
import {downloadCredential} from '../../../../../lib/documents/credential-download';
import {createCrmDocumentReader,createVerifiedDocumentUploadAdapter} from '../../../../../lib/crm/document-download';
export async function GET(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const {dealId}=await context.params,{record,repository,actor}=await evidenceContext(request,dealId),url=new URL(request.url);
  if(url.searchParams.has('fileId')){
   const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
   const result=await downloadCredential(new UploadManifestRepository(runtime.DB),record,url.searchParams.get('requestId')??'',url.searchParams.get('fileId')??'',createCrmDocumentReader(process.env.BITRIX_WEBHOOK??'',dealId,record.client_iin??''));
   return new Response(new Uint8Array(result.bytes).buffer,{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename="${result.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff','x-content-sha256':result.sha256}});
  }
  const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  return Response.json({identityRevision:record.identity_revision,credentials:await repository.credentialStatus(record),unsent:await new UploadManifestRepository(runtime.DB).unsentForActor(record,actor,'credentials')},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}

}
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,3*1024*1024);
  if(body.action==='import'){
   if(typeof body.requestId!=='string'||!Number.isInteger(body.identityRevision)||!Array.isArray(body.fileIds)||body.fileIds.some(id=>typeof id!=='string'))throw new RepositoryError('INVALID_CREDENTIAL_REFERENCE',400);
   const {dealId}=await context.params,{record,actor}=await evidenceContext(request,dealId);
   const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
   const webhook=process.env.BITRIX_WEBHOOK??'',adapter=createVerifiedDocumentUploadAdapter(webhook,dealId,record.client_iin??'');
   const row=await importCredentials(new UploadManifestRepository(runtime.DB),record,actor,{requestId:body.requestId,identityRevision:Number(body.identityRevision),fileIds:body.fileIds as string[],ownerConfirmed:body.ownerConfirmed===true},{read:()=>adapter.read(dealId),file:async ref=>{let name='';const bytes=await createCrmDocumentReader(webhook,dealId,record.client_iin??'',fetch,{credentialsOnly:true,onFilename:value=>{name=value;}})(ref);return {bytes,name};}});
   return Response.json({requestId:row?.request_id,state:row?.state,verified:row?.state==='verified'},{headers:{'cache-control':'no-store'}});
  }
  if(body.action==='cancel'){
   if(typeof body.requestId!=='string')throw new RepositoryError('INVALID_UPLOAD_REQUEST',400);
   const {dealId}=await context.params,{record,actor}=await evidenceContext(request,dealId);
   const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
   const manifests=new UploadManifestRepository(runtime.DB),prior=await manifests.get(record.id,body.requestId);
   if(!prior||JSON.parse(prior.manifest_json).scope!=='credentials')throw new RepositoryError('CREDENTIAL_RECEIPT_NOT_VERIFIED',404);
   const row=await manifests.cancelUnsent(record,body.requestId,actor);return Response.json({state:row.state},{headers:{'cache-control':'no-store'}});
  }
  if(typeof body.requestId!=='string'||!Number.isInteger(body.identityRevision)||typeof body.password!=='string'||typeof body.clientName!=='string'||body.clientName.length>500||!Array.isArray(body.files)||body.files.length>10)throw new RepositoryError('INVALID_CREDENTIAL_UPLOAD',400);
  let size=0;const files=body.files.map(raw=>{
   if(!raw||typeof raw!=='object'||typeof raw.name!=='string'||raw.name.length>240||typeof raw.base64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.base64))throw new RepositoryError('INVALID_CREDENTIAL_FILE',400);
   const bytes=Uint8Array.from(atob(raw.base64),c=>c.charCodeAt(0));size+=bytes.length;if(size>MAX_CREDENTIAL_BYTES)throw new RepositoryError('INVALID_CREDENTIAL_FILE',400);return {name:raw.name,bytes};
  });
  const {dealId}=await context.params,{record,actor}=await evidenceContext(request,dealId);
  const {env}=await import('cloudflare:workers');const runtime=env as typeof env&{DB?:D1Database};if(!runtime.DB)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  const adapter=createVerifiedDocumentUploadAdapter(process.env.BITRIX_WEBHOOK??'',dealId,record.client_iin??'');
  const row=await uploadCredentials(new UploadManifestRepository(runtime.DB),adapter,record,actor,{requestId:body.requestId,identityRevision:Number(body.identityRevision),clientName:body.clientName,password:body.password,ownerConfirmed:body.ownerConfirmed===true,files});
  return Response.json({requestId:row?.request_id,state:row?.state,verified:row?.state==='verified'},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
