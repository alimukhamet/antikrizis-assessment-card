import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const source=fs.readFileSync('scripts/reconcile-handoff.mjs','utf8').replace(/^import .*;\n/gm,''),requestId='10000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
async function run(options={}){
 const calls=[],outputs={},logs=[],process={env:{AUDIT_DEAL_ID:'900001',RECONCILE_HANDOFF_REQUEST_ID:requestId,RECONCILE_HANDOFF_EXPECTED_HASH:hash,ASSESSMENT_TEST_PASSWORD:'private-password',...options.env}};
 let sent=false,crmReads=0;
 await vm.runInNewContext('(async()=>{'+source+'})()',{
  process,createHash,AbortSignal,
  fetch:async(url,init)=>{
   const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;calls.push({path,body,method:init.method});
   if(path==='/api/session')return Response.json({},{headers:{'set-cookie':'session=private-cookie'}});
   if(path==='/api/assessment/900001')return Response.json({client:{iin:'private-iin'},identityRevision:1});
   if(path.endsWith('/draft')||path.endsWith('/uploads')||path.endsWith('/submission'))return Response.json({saved:'private-data'});
   if(path==='/api/bitrix/crm.deal.get'){crmReads++;return Response.json({result:{ID:'900001',TITLE:'private-title',STAGE_ID:options.changed&&crmReads>1?'C1:LATER':'C1:NEW',UF_CRM_PRIVATE:'private-value'}});}
   assert.equal(path,'/api/assessment/900001/handoff');
   if(body){assert.equal(body.action,'reconcile');assert.equal(body.requestId,requestId);assert.equal(body.expectedHash,hash);sent=true;if(options.lost)throw Error('private-upstream');}
   return Response.json({handoff:{requestId,state:sent&&!options.uncertain?'verified':options.state||'uncertain',outcomeCode:'SAFE_CODE'}});
  },writeFile:async(path,text)=>outputs[path]=text,console:{log:text=>logs.push(text)},
 });
 const text=outputs['handoff-reconciliation.json'];assert.ok(text);assert.equal(/private-/.test(text+logs.join('')),false);return {report:JSON.parse(text),calls,process};
}
test('owner runner only reconciles an exact receipt and verifies unchanged CRM and saved data',async()=>{
 const r=await run();assert.equal(r.report.verified,true);assert.ok(Object.values(r.report.checks).every(Boolean));
 const posts=r.calls.filter(c=>c.method==='POST');assert.equal(posts.filter(c=>c.body.action==='reconcile').length,1);
 assert.ok(posts.every(c=>['/api/session','/api/bitrix/crm.deal.get','/api/assessment/900001/handoff'].includes(c.path)));
});
test('missing pins, prepared operations, uncertain results and lost responses never cause another send',async()=>{
 for(const options of [{env:{RECONCILE_HANDOFF_EXPECTED_HASH:''}},{state:'prepared'},{lost:true},{uncertain:true},{changed:true}]){
  const r=await run(options);assert.equal(r.report.verified,false);assert.equal(r.process.exitCode,1);assert.ok(r.calls.filter(c=>c.body?.action==='reconcile').length<=1);
 }
});
