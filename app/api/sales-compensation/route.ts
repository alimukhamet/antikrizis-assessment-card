import {requireStaffRequest} from '../staff-access';
import {readSessionCookie,verifySession} from '../../../lib/worker-session';
import {boundedJson} from '../../../lib/documents/request-context';
import {PEOPLE,type Person,todayAlmaty} from '../../../lib/personal-sales';
import {CompensationError,compensationRepository,validateCompensation} from '../../../lib/sales-compensation';

export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const actorFor=(request:Request)=>verifySession(readSessionCookie(request.headers.get('cookie')),process.env.SITE_SESSION_TOKEN??'');
function failure(error:unknown){return Response.json({error:error instanceof CompensationError?error.code:'COMPENSATION_UNAVAILABLE'},{status:error instanceof CompensationError?error.status:503,headers});}
export async function GET(request:Request){
  const denied=await requireStaffRequest(request);if(denied)return denied;
  try{
    const actor=await actorFor(request);if(!actor)return Response.json({error:'SIGN_IN_REQUIRED'},{status:401,headers});
    const selected=new URL(request.url).searchParams.get('person');
    if(actor.worker!=='ali'&&selected&&selected!==actor.worker)return Response.json({error:'FORBIDDEN'},{status:403,headers});
    const person=(actor.worker==='ali'?selected||'darkhan':actor.worker) as Person;
    if(!Object.hasOwn(PEOPLE,person))throw new CompensationError('UNKNOWN_PERSON');
    const repository=await compensationRepository();
    const [payments,plans]=await Promise.all([repository.payments(person),repository.plans(person)]);
    return Response.json({person,payments,plans,canEdit:actor.worker==='ali'},{headers});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  const denied=await requireStaffRequest(request);if(denied)return denied;
  try{
    const actor=await actorFor(request);if(!actor)return Response.json({error:'SIGN_IN_REQUIRED'},{status:401,headers});
    const input=validateCompensation(await boundedJson(request,8000),todayAlmaty()),repository=await compensationRepository();
    return Response.json({ok:true,...await repository.create(input,actor)},{status:201,headers});
  }catch(error){return failure(error);}
}
