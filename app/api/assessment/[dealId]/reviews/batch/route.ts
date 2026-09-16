import {requireStaffRequest} from '../../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../../lib/documents/request-context';
import {reviewBatch} from '../../../../../../lib/documents/review-batch';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,256000);
  const {dealId}=await context.params,{repository,record,actor}=await evidenceContext(request,dealId);
  return Response.json(await reviewBatch(repository,record,body.reviews,actor,operatingDay()),{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
