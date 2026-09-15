import {requireStaffRequest} from '../../staff-access';
import {draftRepository} from '../../../../lib/questionnaire/repository';
import {searchClients,draftContractStates} from '../../../../lib/crm/client-directory';
export async function GET(request:Request){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 const query=new URL(request.url).searchParams.get('q')?.trim()||'';
 if(query.length>80)return Response.json({error:'INVALID_SEARCH'},{status:400});
 const [drafts,recent]=await Promise.allSettled([draftRepository().then(repo=>repo.recent()),searchClients(process.env.BITRIX_WEBHOOK??'',query)]);
 const saved=drafts.status==='fulfilled'?drafts.value:[];
 let states=new Map<string,boolean>();try{states=await draftContractStates(process.env.BITRIX_WEBHOOK??'',saved.map(item=>item.dealId));}catch{/* Keep saved work accessible when CRM status is unavailable. */}
 return Response.json({drafts:saved.map(item=>({...item,hasContract:states.get(item.dealId)??null})),recent:recent.status==='fulfilled'?recent.value:[],draftsUnavailable:drafts.status==='rejected',recentUnavailable:recent.status==='rejected'},{headers:{'cache-control':'no-store'}});
}
