import {readClientContext} from '../crm/bitrix';
import {readSessionCookie,verifySession} from '../worker-session';
import {evidenceRepository} from './storage';
import {RepositoryError} from './repository';
export async function evidenceContext(request:Request,dealId:string){
 const actor=await verifySession(readSessionCookie(request.headers.get('cookie')),process.env.SITE_SESSION_TOKEN??'');if(!actor)throw new RepositoryError('SIGN_IN_REQUIRED',401);
 const client=await readClientContext(dealId,process.env.BITRIX_WEBHOOK??'');
 const repository=await evidenceRepository(),record=await repository.syncCase(client);
 return {actor,client,repository,record};
}
export function operatingDay(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=(kind:string)=>parts.find(p=>p.type===kind)!.value;return `${part('year')}-${part('month')}-${part('day')}`;}
export function evidenceError(error:unknown){return Response.json({error:error instanceof RepositoryError?error.code:error instanceof Error&&error.message==='BITRIX_TEMPORARILY_UNAVAILABLE'?'BITRIX_TEMPORARILY_UNAVAILABLE':'EVIDENCE_REQUEST_FAILED'},{status:error instanceof RepositoryError?error.status:503,headers:{'cache-control':'no-store'}});}
export async function boundedJson(request:Request,maxBytes=16000){
 const reader=request.body?.getReader();if(!reader)throw new RepositoryError('JSON_REQUIRED',400);let text='';const decoder=new TextDecoder();let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new RepositoryError('BODY_TOO_LARGE',413);}text+=decoder.decode(value,{stream:true});}
 text+=decoder.decode();try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{throw new RepositoryError('INVALID_JSON',400);}
}
