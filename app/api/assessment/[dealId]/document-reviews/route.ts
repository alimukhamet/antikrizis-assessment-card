import {requireStaffRequest} from '../../../staff-access';
import {evidenceContext,evidenceError,operatingDay,boundedJson} from '../../../../../lib/documents/request-context';
import {reviewDocument,withdrawDocumentReview} from '../../../../../lib/documents/document-review';
import {RepositoryError} from '../../../../../lib/documents/repository';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request);
  if(typeof body.documentId!=='string'||typeof body.requestId!=='string'||!Number.isInteger(body.identityRevision))throw new RepositoryError('INVALID_DOCUMENT_REVIEW',400);
  const {dealId}=await context.params,{repository,record,actor}=await evidenceContext(request,dealId);
  if(body.action!==undefined&&!['confirm','withdraw'].includes(String(body.action)))throw new RepositoryError('INVALID_DOCUMENT_REVIEW',400);
  if(body.action==='withdraw'&&(typeof body.reviewId!=='string'||typeof body.reason!=='string'))throw new RepositoryError('INVALID_DOCUMENT_REVIEW',400);
  const review=body.action==='withdraw'?await withdrawDocumentReview(repository,record,body.documentId,body.reviewId as string,body.requestId,body.identityRevision as number,body.reason as string,actor):await reviewDocument(repository,record,body.documentId,body.requestId,body.identityRevision as number,body.review,actor,operatingDay());
  return Response.json({ok:true,reviewId:review.id,authenticity:'not_verified'},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
