import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {finalCheck} from '../../../../../lib/questionnaire/final-check';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,256000);
  const {dealId}=await context.params,{record,repository}=await evidenceContext(request,dealId);
  const checked=await finalCheck(repository,record,body.payload,body.bindings,operatingDay());
  return Response.json(checked.publicResult,{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
