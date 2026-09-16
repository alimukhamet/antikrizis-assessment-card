import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {validateDraft} from '../../../../../lib/questionnaire/draft';
import {checkDocumentPackage} from '../../../../../lib/documents/package-check';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{const body=await boundedJson(request,300000),{dealId}=await context.params,{record,repository}=await evidenceContext(request,dealId);return Response.json({identityRevision:record.identity_revision,documents:await checkDocumentPackage(repository,record,validateDraft(body.payload),operatingDay(),'handoff')},{headers:{'cache-control':'no-store'}});}catch(error){return evidenceError(error);}
}
