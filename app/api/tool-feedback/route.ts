import {requireStaffRequest} from '../staff-access';
import {readSessionCookie,verifySession} from '../../../lib/worker-session';
import {boundedJson} from '../../../lib/documents/request-context';
import {FeedbackError,feedbackRepository,validateFeedback} from '../../../lib/tool-feedback';

export const dynamic='force-dynamic';
const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
const actorFor=(request:Request)=>verifySession(readSessionCookie(request.headers.get('cookie')),process.env.SITE_SESSION_TOKEN??'');
function failure(error:unknown){
  const status=error instanceof FeedbackError?error.status:503;
  return Response.json({error:error instanceof FeedbackError?error.code:'FEEDBACK_UNAVAILABLE'},{status,headers});
}
export async function POST(request:Request){
  const denied=await requireStaffRequest(request);if(denied)return denied;
  try{
    const actor=await actorFor(request);if(!actor)return Response.json({error:'SIGN_IN_REQUIRED'},{status:401,headers});
    let raw:Record<string,unknown>;
    try{raw=await boundedJson(request,16000);}catch{return Response.json({error:'INVALID_FEEDBACK'},{status:400,headers});}
    const input=validateFeedback(raw),repository=await feedbackRepository();
    return Response.json({ok:true,...await repository.create(input,actor)},{status:201,headers});
  }catch(error){return failure(error);}
}
export async function GET(request:Request){
  const denied=await requireStaffRequest(request);if(denied)return denied;
  try{
    const actor=await actorFor(request);if(!actor)return Response.json({error:'SIGN_IN_REQUIRED'},{status:401,headers});
    const params=new URL(request.url).searchParams,before=params.get('before');
    if(before!==null&&(!/^[1-9]\d*$/.test(before)||!Number.isSafeInteger(Number(before))))throw new FeedbackError('INVALID_CURSOR');
    const repository=await feedbackRepository();
    if(params.get('format')!=='ndjson'){
      const items=await repository.page(actor,before?Number(before):undefined);
      return Response.json({items,nextCursor:items.length===50?String(items.at(-1)!.sequence):null,allWorkers:actor.worker==='ali'},{headers});
    }
    // Rows never change. Descending rowid pagination excludes reports arriving after the first page.
    const first=await repository.page(actor),exportedAt=new Date().toISOString();
    async function* lines(){
      yield {type:'manifest',format:'assessment-feedback-ndjson',schemaVersion:1,exportedAt,scope:actor!.worker==='ali'?'all-workers':'own-reports'};
      let rows=first,count=0;
      while(rows.length){for(const row of rows){yield {type:'feedback',...row};count++;}if(rows.length<50)break;rows=await repository.page(actor!,rows.at(-1)!.sequence);}
      yield {type:'complete',reports:count};
    }
    const iterator=lines(),encoder=new TextEncoder();
    const stream=new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(JSON.stringify(next.value)+'\n'));}catch(error){controller.error(error);}},async cancel(){await iterator.return();}});
    return new Response(stream,{headers:{...headers,'content-type':'application/x-ndjson; charset=utf-8','content-disposition':'attachment; filename="assessment-feedback.ndjson"'}});
  }catch(error){return failure(error);}
}
