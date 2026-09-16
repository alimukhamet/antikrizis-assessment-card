import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import {confirmDocumentIdentity} from '../../../../../lib/documents/identity-service';
import {createDocumentIdentityAdapter} from '../../../../../lib/crm/document-identity';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request);
  if(typeof body.documentId!=='string'||typeof body.extractionId!=='string'||!Number.isInteger(body.identityRevision))throw new RepositoryError('INVALID_IDENTITY_REQUEST',400);
  const {dealId}=await context.params,{repository,record,client,actor}=await evidenceContext(request,dealId);
  const result=await confirmDocumentIdentity(repository,record,client,actor,{documentId:body.documentId,extractionId:body.extractionId,identityRevision:body.identityRevision as number,confirmed:body.confirmed===true},createDocumentIdentityAdapter(process.env.BITRIX_WEBHOOK??''));
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
