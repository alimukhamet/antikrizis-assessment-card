import { requireStaffRequest } from '../staff-access';
import { boundedJson, evidenceError } from '../../../lib/documents/request-context';
import { RepositoryError } from '../../../lib/documents/repository';
import { readSessionCookie, verifySession } from '../../../lib/worker-session';
import { ProfileActivityRepository } from '../../../lib/questionnaire/profile-activity';

const headers={'cache-control':'no-store'};
async function context(request:Request) {
 const {env}=await import('cloudflare:workers');
 const db=(env as typeof env & {DB?:D1Database}).DB;
 if(!db)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
 const actor=await verifySession(readSessionCookie(request.headers.get('cookie')),process.env.SITE_SESSION_TOKEN??'');
 if(!actor)throw new RepositoryError('SIGN_IN_REQUIRED',401);
 return {repo:new ProfileActivityRepository(db),actor};
}
/** Lightweight staff activity: no Bitrix calls, client answers or save mutations. */
export async function GET(request:Request) {
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{const {repo,actor}=await context(request);return Response.json(await repo.read(actor.worker),{headers});}
 catch(error){return evidenceError(error);}
}
export async function POST(request:Request) {
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,2048),{repo,actor}=await context(request);
  await repo.update(actor,body);
  return Response.json(body.action==='release'?{ok:true}:await repo.read(actor.worker),{headers});
 }catch(error){return evidenceError(error);}
}
