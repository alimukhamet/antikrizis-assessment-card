import {requireStaffRequest} from '../../../../staff-access';
import {boundedJson,evidenceContext,evidenceError} from '../../../../../../lib/documents/request-context';
import {cachedAnalyses} from '../../../../../../lib/documents/batch-analysis';
export async function POST(request:Request,ctx:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request),{dealId}=await ctx.params,context=await evidenceContext(request,dealId);
  return Response.json(await cachedAnalyses(body,context),{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
