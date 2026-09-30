import {requireStaffRequest} from '../../../staff-access';
import {evidenceContext,evidenceError,boundedJson} from '../../../../../lib/documents/request-context';
import {dealDocumentReferences} from '../../../../../lib/crm/client-directory';
import {createCrmDocumentReader} from '../../../../../lib/crm/document-download';
import {DocumentUploadError} from '../../../../../lib/crm/document-upload';
import {DocumentReadError} from '../../../../../lib/documents/read-pdf';
import {readDocument} from '../../../../../lib/documents/read-document';
import {imageFormat} from '../../../../../lib/documents/read-image';
import {extractNative} from '../../../../../lib/documents/extract-native';
import {analysisResponse,analysisVersionForFormat,storedAnalysis,type Analysis} from '../../../../../lib/documents/analysis-service';
import {sha256,RepositoryError} from '../../../../../lib/documents/repository';
import {readClientContext} from '../../../../../lib/crm/bitrix';
const headers={'cache-control':'no-store'};
function failure(error:unknown){
 if(error instanceof DocumentUploadError||error instanceof DocumentReadError)return Response.json({error:error.code},{status:422,headers});
 return evidenceError(error);
}
export async function GET(request:Request,ctx:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const {dealId}=await ctx.params,{client,record,repository,actor}=await evidenceContext(request,dealId),query=new URL(request.url).searchParams;
  if(query.has('fileId')){
   const fileId=query.get('fileId')||'',identityRevision=Number(query.get('identityRevision'));
   if(!/^[1-9]\d*$/.test(fileId))throw new RepositoryError('INVALID_FILE_ID',400);
   if(!Number.isSafeInteger(identityRevision)||identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
   if(!client.iin)throw new RepositoryError('DEAL_IDENTITY_UNVERIFIED');
   // Reconcile a lost inbound-copy response. Never download, reprocess or write
   // evidence here: an absent receipt stays pending and must not imply success.
   const imported=await repository.importedDocument(record,fileId);
   if(!imported)return Response.json({pending:true,crmFileId:fileId},{status:202,headers});
   const refs=await dealDocumentReferences(process.env.BITRIX_WEBHOOK??'',dealId,client.iin);
   if(!refs.some(ref=>ref.id===fileId))throw new DocumentUploadError('FILE_NOT_IN_DEAL');
   const analysis=await storedAnalysis(client,record,repository,imported,actor,true);
   const current=await repository.findCaseByExternal(client.external.system,dealId);
   if(!current||current.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
   return Response.json({...analysis,originalName:imported.original_name,crmFileId:fileId},{headers});
  }
  return Response.json({files:await dealDocumentReferences(process.env.BITRIX_WEBHOOK??'',dealId,client.iin||'')},{headers});
 }catch(error){return failure(error);}
}
/** Inbound copy only: this route never updates a Bitrix field or deal. */
export async function POST(request:Request,ctx:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request),{dealId}=await ctx.params,{client,record,repository,actor}=await evidenceContext(request,dealId);
  if(!client.iin)throw new RepositoryError('DEAL_IDENTITY_UNVERIFIED');
  if(typeof body.fileId!=='string'||! /^[1-9]\d*$/.test(body.fileId))throw new RepositoryError('INVALID_FILE_ID',400);
  if(body.identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  const imported=await repository.importedDocument(record,body.fileId);
  // Owner diagnostics can measure the real Bitrix transfer without changing an
  // origin receipt, client answer or CRM record. Ordinary intake always reuses it.
  if(body.verifyOriginal===true&&actor.worker!=='ali')throw new RepositoryError('FORBIDDEN',403);
  if(body.verifyOriginal===true&&!imported)throw new RepositoryError('DOCUMENT_NOT_FOUND',404);
  if(imported&&body.verifyOriginal!==true){
   // Reuse the immutable inbound copy only while this file still belongs to the
   // same CRM client. Final delivery separately verifies the live file's bytes.
   const refs=await dealDocumentReferences(process.env.BITRIX_WEBHOOK??'',dealId,client.iin);
   if(!refs.some(ref=>ref.id===body.fileId))throw new DocumentUploadError('FILE_NOT_IN_DEAL');
   const current=await repository.findCaseByExternal(client.external.system,dealId);
   if(!current||current.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
   return Response.json({...await storedAnalysis(client,record,repository,imported,actor),originalName:imported.original_name,crmFileId:body.fileId},{headers});
  }
  const started=Date.now();let filename='Bitrix-'+body.fileId+'.pdf';
  const bytes=await createCrmDocumentReader(process.env.BITRIX_WEBHOOK??'',dealId,client.iin,fetch,{documentsOnly:true,onFilename:name=>{filename=name;}})({id:body.fileId});
  const hash=await sha256(bytes);
  if(body.verifyOriginal===true&&imported&&(hash!==imported.original_sha256||bytes.length!==imported.byte_size))throw new RepositoryError('ORIGINAL_INTEGRITY_FAILED',409);
  const version=analysisVersionForFormat(imageFormat(bytes)??undefined);
  const cached=await repository.cached(record.id,hash,version),result=cached?.result as Analysis|undefined;
  const read=result?.read??await readDocument(bytes),extraction=result?.extraction??extractNative(read.pages);
  const fresh=await readClientContext(dealId,process.env.BITRIX_WEBHOOK??'');
  if(fresh.iin!==client.iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  const current=await repository.syncCase(fresh);
  if(current.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  if(body.verifyOriginal===true&&imported)return Response.json({...await storedAnalysis(fresh,current,repository,imported,actor),originalName:imported.original_name,crmFileId:body.fileId,downloadVerification:{verified:true,byteSize:bytes.length,elapsedMs:Date.now()-started}},{headers});
  const stored=cached??await repository.store(record.id,bytes,filename,actor,version,{read,extraction});
  // Record an inbound origin receipt in the existing immutable evidence history.
  // Final saving can reuse this exact CRM file after membership and byte-hash readback.
  await repository.appendReview({caseId:record.id,documentId:stored.document.id,extractionId:stored.extraction.id,identityRevision:record.identity_revision,requestId:crypto.randomUUID(),factKey:'document.origin.bitrix.v1',value:{system:'bitrix',fileId:body.fileId,sha256:stored.document.original_sha256,byteSize:stored.document.byte_size},disposition:'confirmed',reason:'Источник: файл прочитан из текущей сделки Bitrix.'},actor);
  return Response.json({...await analysisResponse(fresh,current,repository,stored,Boolean(cached)),originalName:stored.document.original_name,crmFileId:body.fileId},{headers});
 }catch(error){return failure(error);}
}
