import {requireStaffRequest} from '../../staff-access';
import {draftRepository} from '../../../../lib/questionnaire/repository';
import {recentDocumentClients} from '../../../../lib/crm/client-directory';
export async function GET(request:Request){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 const [drafts,recent]=await Promise.allSettled([draftRepository().then(repo=>repo.recent()),recentDocumentClients(process.env.BITRIX_WEBHOOK??'')]);
 return Response.json({drafts:drafts.status==='fulfilled'?drafts.value:[],recent:recent.status==='fulfilled'?recent.value:[],draftsUnavailable:drafts.status==='rejected',recentUnavailable:recent.status==='rejected'},{headers:{'cache-control':'no-store'}});
}
