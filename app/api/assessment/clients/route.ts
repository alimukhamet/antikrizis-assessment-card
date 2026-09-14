import {requireStaffRequest} from '../../staff-access';
import {draftRepository} from '../../../../lib/questionnaire/repository';
import {searchClients} from '../../../../lib/crm/client-directory';
export async function GET(request:Request){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 const query=new URL(request.url).searchParams.get('q')?.trim()||'';
 if(query.length>80)return Response.json({error:'INVALID_SEARCH'},{status:400});
 const [drafts,recent]=await Promise.allSettled([draftRepository().then(repo=>repo.recent()),searchClients(process.env.BITRIX_WEBHOOK??'',query)]);
 return Response.json({drafts:drafts.status==='fulfilled'?drafts.value:[],recent:recent.status==='fulfilled'?recent.value:[],draftsUnavailable:drafts.status==='rejected',recentUnavailable:recent.status==='rejected'},{headers:{'cache-control':'no-store'}});
}
