import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {loadGkbBalanceReview,confirmGkbBalanceReview} from '../../../../../lib/documents/gkb-balance-review';
import {draftRepository} from '../../../../../lib/questionnaire/repository';
import {validateDraft} from '../../../../../lib/questionnaire/draft';
import {RepositoryError} from '../../../../../lib/documents/repository';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request),{dealId}=await context.params,{record,repository,actor}=await evidenceContext(request,dealId),day=operatingDay();
  if(!['inspect','confirm','withdraw'].includes(String(body.action)))throw new RepositoryError('INVALID_GKB_REVIEW',400);
  if(body.action==='inspect'){
   const {inspection}=await loadGkbBalanceReview(repository,record,body,day);
   return Response.json({inspection},{headers:{'cache-control':'no-store'}});
  }
  const draft=await(await draftRepository()).latest(record.id);
  if(!draft||draft.identity_revision!==record.identity_revision)throw new RepositoryError('GKB_ANSWERS_NOT_SAVED');
  const review=await confirmGkbBalanceReview(repository,record,body,validateDraft(JSON.parse(draft.payload_json)),actor,day);
  return Response.json({ok:true,...review},{headers:{'cache-control':'no-store'}});
 }catch(error){return evidenceError(error);}
}
