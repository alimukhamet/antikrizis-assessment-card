import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
test('hosted default delegates to payment-control without requiring a second local password',async()=>{
 let configuration;const exports={},deps={
 '../../../lib/worker-session':{requestOriginAllowed:()=>true,issueSession:async()=> 'synthetic-signed-session',SESSION_COOKIE:'session',SESSION_SECONDS:60},
 '../../../lib/login-rate':{checkLoginRate:async()=>({allowed:true})},
 '../../../lib/login-navigation':{loginDestination:()=> '/',LOGIN_ERRORS:{}},
 '../../../lib/auth-provider':{authenticateStaff:async(worker,password,config)=>{configuration=config;assert.equal(worker,'ramazan');assert.equal(password,'synthetic');return {worker,id:'worker:ramazan'};}}
 };
 const source=fs.readFileSync(new URL('../app/api/session/route.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],process:{env:{SITE_SESSION_TOKEN:'s'.repeat(32)}},Response,TextDecoder,Uint8Array,JSON});
 const response=await exports.POST(new Request('https://synthetic.invalid/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({worker:'ramazan',password:'synthetic'})}));
 assert.equal(response.status,200);assert.equal(configuration.provider,'payment-control');assert.equal(configuration.localPassword,undefined);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
});
