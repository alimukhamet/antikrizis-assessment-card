import {authenticateWorker,WORKERS,type Actor,type WorkerId} from './worker-session';
/** Replace this provider boundary when the legal CRM owns authentication. */
const PAYMENT_ORIGIN='https://antikrizis-payment-control.mukhamet-ali-ma.chatgpt.site';
export class AuthProviderError extends Error {constructor(){super('AUTH_PROVIDER_UNAVAILABLE');}}
export type AuthConfiguration={provider:string;localPassword?:string};
export async function authenticateStaff(worker:string,password:string,configuration:AuthConfiguration,send:typeof fetch=fetch):Promise<Actor|null>{
 if(!Object.prototype.hasOwnProperty.call(WORKERS,worker)||!password||password.length>1024)return null;
 if(configuration.provider==='local')return authenticateWorker(worker,password,configuration.localPassword||'');
 if(configuration.provider!=='payment-control')throw new AuthProviderError();
 let response:Response;
 try{
  response=await send(PAYMENT_ORIGIN+'/api/session',{
   method:'POST',headers:{'content-type':'application/json',origin:PAYMENT_ORIGIN},
   body:JSON.stringify({worker,password}),redirect:'manual',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000),
  });
 }catch{throw new AuthProviderError();}
 if(response.status===401)return null;
 if(response.status!==200)throw new AuthProviderError();
 // Never return, store or forward the provider's session cookie to this browser.
 try{
  const reader=response.body?.getReader();if(!reader)throw new AuthProviderError();
  const decoder=new TextDecoder();let length=0,text='';
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();throw new AuthProviderError();}text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();const body=JSON.parse(text);
  if(body?.ok!==true||body?.data?.displayName!==WORKERS[worker as WorkerId])throw new AuthProviderError();
 }catch{throw new AuthProviderError();}
 return{id:`worker:${worker}`,worker:worker as WorkerId,displayName:WORKERS[worker as WorkerId],authentication:'shared-password-worker-selection'};
}
