import {requireStaffRequest} from '../../../staff-access';
import {evidenceContext,evidenceError,operatingDay,boundedJson} from '../../../../../lib/documents/request-context';
import {reviewFact,type StoredResult} from '../../../../../lib/documents/review-service';
import {RepositoryError} from '../../../../../lib/documents/repository';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request);
  const string=(key:string)=>{if(typeof body[key]!=='string')throw new RepositoryError('INVALID_REVIEW_BODY',400);return body[key] as string;};
  const {dealId}=await context.params,{repository,record,actor}=await evidenceContext(request,dealId);
  const doc=await repository.document(record.id,string('documentId'));if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE',404);
  const extraction=await repository.extraction(record.id,doc.id,string('extractionId'));if(!extraction)throw new RepositoryError('EXTRACTION_NOT_IN_DOCUMENT',404);
  const disposition=string('disposition');if(!['confirmed','corrected','unresolved'].includes(disposition)||!Number.isInteger(body.identityRevision))throw new RepositoryError('INVALID_REVIEW_BODY',400);
  const result=await repository.readResult(extraction) as StoredResult;
  const review=await reviewFact(repository,record,doc,extraction,result,{requestId:string('requestId'),factKey:string('factKey'),value:body.value,disposition:disposition as 'confirmed'|'corrected'|'unresolved',reason:string('reason'),identityRevision:body.identityRevision as number},actor,operatingDay());
  return Response.json({ok:true,review},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
