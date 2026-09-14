import {requireStaffRequest} from '../../../staff-access';
import {evidenceContext,evidenceError,boundedJson} from '../../../../../lib/documents/request-context';
import {dealDocumentReferences} from '../../../../../lib/crm/client-directory';
import {createCrmDocumentReader} from '../../../../../lib/crm/document-download';
import {DocumentUploadError} from '../../../../../lib/crm/document-upload';
import {readPdf,DocumentReadError} from '../../../../../lib/documents/read-pdf';
import {extractNative} from '../../../../../lib/documents/extract-native';
import {analysisResponse,analysisVersion,type Analysis} from '../../../../../lib/documents/analysis-service';
import {sha256,RepositoryError} from '../../../../../lib/documents/repository';
import {readClientContext} from '../../../../../lib/crm/bitrix';
const headers={'cache-control':'no-store'};
function failure(error:unknown){
 if(error instanceof DocumentUploadError||error instanceof DocumentReadError)return Response.json({error:error.code},{status:422,headers});
 return evidenceError(error);
}
export async function GET(request:Request,ctx:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{const {dealId}=await ctx.params,{client}=await evidenceContext(request,dealId);return Response.json({files:await dealDocumentReferences(process.env.BITRIX_WEBHOOK??'',dealId,client.iin||'')},{headers});}catch(error){return failure(error);}
}
/** Inbound copy only: this route never updates a Bitrix field or deal. */
export async function POST(request:Request,ctx:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request),{dealId}=await ctx.params,{client,record,repository,actor}=await evidenceContext(request,dealId);
  if(!client.iin)throw new RepositoryError('DEAL_IDENTITY_UNVERIFIED');
  if(typeof body.fileId!=='string'||! /^[1-9]\d*$/.test(body.fileId))throw new RepositoryError('INVALID_FILE_ID',400);
  if(body.identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  let filename='Bitrix-'+body.fileId+'.pdf';
  const bytes=await createCrmDocumentReader(process.env.BITRIX_WEBHOOK??'',dealId,client.iin,fetch,{pdfOnly:true,onFilename:name=>{filename=name;}})({id:body.fileId});
  const hash=await sha256(bytes),cached=await repository.cached(record.id,hash,analysisVersion),result=cached?.result as Analysis|undefined;
  const read=result?.read??await readPdf(bytes),extraction=result?.extraction??extractNative(read.pages);
  const fresh=await readClientContext(dealId,process.env.BITRIX_WEBHOOK??'');
  if(fresh.iin!==client.iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  const current=await repository.syncCase(fresh);
  if(current.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  const stored=cached??await repository.store(record.id,bytes,filename,actor,analysisVersion,{read,extraction});
  // Record an inbound origin receipt in the existing immutable evidence history.
  // Final saving can reuse this exact CRM file after membership and byte-hash readback.
  await repository.appendReview({caseId:record.id,documentId:stored.document.id,extractionId:stored.extraction.id,identityRevision:record.identity_revision,requestId:crypto.randomUUID(),factKey:'document.origin.bitrix.v1',value:{system:'bitrix',fileId:body.fileId,sha256:stored.document.original_sha256,byteSize:stored.document.byte_size},disposition:'confirmed',reason:'Источник: файл прочитан из текущей сделки Bitrix.'},actor);
  return Response.json({...await analysisResponse(fresh,current,repository,stored,Boolean(cached)),originalName:stored.document.original_name,crmFileId:body.fileId},{headers});
 }catch(error){return failure(error);}
}
