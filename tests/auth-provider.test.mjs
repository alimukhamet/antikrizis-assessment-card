import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],TextEncoder,TextDecoder,AbortSignal,fetch});return exports;}
const sessions=load('lib/worker-session.ts'),{authenticateStaff}=load('lib/auth-provider.ts',{'./worker-session':sessions});
const config={provider:'payment-control',localPassword:'synthetic-password'};
test('provider uses fixed origin and exact expected response; upstream cookie never becomes actor data',async()=>{
 let request;const actor=await authenticateStaff('ramazan','synthetic-password',config,async(url,options)=>{request={url,options};return Response.json({ok:true,data:{displayName:'Ramazan'}},{headers:{'set-cookie':'private-provider-session=test'}});});
 assert.equal(actor.id,'worker:ramazan');assert.equal(actor.authentication,'shared-password-worker-selection');assert.equal(request.url,'https://antikrizis-payment-control.mukhamet-ali-ma.chatgpt.site/api/session');assert.equal(request.options.redirect,'manual');assert.equal(request.options.credentials,'omit');assert.equal(request.options.headers.origin,new URL(request.url).origin);assert.equal(JSON.stringify(actor).includes('private-provider-session'),false);
});
test('invalid worker and empty password never contact provider',async()=>{let calls=0;const send=async()=>{calls++;throw Error();};for(const worker of ['constructor','unknown'])assert.equal(await authenticateStaff(worker,'x',config,send),null);assert.equal(await authenticateStaff('ali','',config,send),null);assert.equal(calls,0);});
test('wrong password never falls back to a local matching password',async()=>{assert.equal(await authenticateStaff('ali','synthetic-password',config,async()=>new Response(null,{status:401})),null);});
test('redirects, outages, wrong worker response and oversized response cannot mint an actor',async()=>{
 for(const send of [async()=>new Response(null,{status:302}),async()=>new Response(null,{status:503}),async()=>{throw Error('offline')},async()=>Response.json({ok:true,data:{displayName:'Darkhan'}}),async()=>new Response('x'.repeat(4097))])await assert.rejects(authenticateStaff('ali','synthetic-password',config,send),/AUTH_PROVIDER_UNAVAILABLE/);
});
test('local test provider remains isolated and unknown configuration fails closed',async()=>{
 assert.equal((await authenticateStaff('ali','local-test',{provider:'local',localPassword:'local-test'})).id,'worker:ali');
 await assert.rejects(authenticateStaff('ali','x',{provider:'https://caller-controlled.invalid'}),/AUTH_PROVIDER_UNAVAILABLE/);
});
