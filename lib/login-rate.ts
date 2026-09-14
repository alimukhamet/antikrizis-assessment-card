/** Atomic fixed-window counters shared across Worker instances. No passwords/IPs stored. */
export class LoginRateLimiter{
 constructor(private db:D1Database){}
 async consume(clientKey:string,now=Math.floor(Date.now()/1000)){
  if(!/^[0-9a-f]{64}$/.test(clientKey)||!Number.isSafeInteger(now)||now<0)throw Error('INVALID_LOGIN_RATE_KEY');
  await this.db.prepare('DELETE FROM assessment_login_attempts WHERE expires_at<=?').bind(now).run();
  for(const {name,seconds,max} of [{name:'global',seconds:60,max:120},{name:clientKey,seconds:600,max:20}]){
   const start=Math.floor(now/seconds)*seconds,expires=start+seconds;
   const row=await this.db.prepare('INSERT INTO assessment_login_attempts (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=MIN(attempts+1,1000000) RETURNING attempts').bind(`${name}:${start}`,expires).first<{attempts:number}>();
   if(!row)throw Error('LOGIN_RATE_STORAGE_FAILED');
   if(row.attempts>max)return{allowed:false,retryAfter:expires-now};
  }
  return{allowed:true,retryAfter:0};
 }
}
export async function loginClientKey(request:Request,secret:string){
 if(secret.length<32)throw Error('SESSION_SECRET_NOT_CONFIGURED');
 // CF metadata is set by the runtime, not by an HTTP caller. Local tests share a bucket.
 const cf=(request as Request&{cf?:unknown}).cf;
 const address=cf?request.headers.get('cf-connecting-ip')||'unknown':'local-or-unknown';
 const encoder=new TextEncoder(),key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('assessment-login:'+address)));
 return [...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export async function checkLoginRate(request:Request,secret:string){
 const {env}=await import('cloudflare:workers');
 const db=(env as typeof env&{DB?:D1Database}).DB;if(!db)throw Error('LOGIN_RATE_STORAGE_NOT_CONFIGURED');
 return new LoginRateLimiter(db).consume(await loginClientKey(request,secret));
}
