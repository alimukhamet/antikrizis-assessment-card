import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
const source=fs.readFileSync('scripts/repair-lawyer-title.mjs','utf8').replace(/^import .*;\n/gm,'');
const hash='a'.repeat(64);
async function run(options={}){
 const calls=[],outputs={},logs=[],process={env:{REPAIR_TITLE_DEAL_ID:'900001',REPAIR_TITLE_EXPECTED_HASH:hash,ASSESSMENT_TEST_PASSWORD:'private-password',...options.env}};
 let crmReads=0;
 const frozen={type:'assessment-submission',request_id:'frozen',payload_hash:hash,state:'verified',history_state:'verified',payload:{answers:'private-answer'},actor_id:'worker:darkhan',created_at:'original-time',updated_at:'original-time'};
 const desiredTitle='ВП private-client';
 await vm.runInNewContext('(async()=>{'+source+'})()',{
  process,createHash,randomUUID,AbortSignal,
  fetch:async(url,init)=>{
   const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;calls.push({path,body,method:init.method});assert.equal(init.redirect,'error');
   if(path==='/api/session')return Response.json({},{headers:{'set-cookie':'session=private-cookie'}});
   if(path.endsWith('/export'))return new Response(JSON.stringify(frozen)+'\n');
   if(path.endsWith('/draft'))return Response.json({draft:{revision:7,payload:'private-draft'}});
   if(path.endsWith('/crm-documents'))return Response.json({files:[{id:'one',name:'private-key'}]});
   if(path==='/api/bitrix/crm.deal.get'){
    crmReads++;return Response.json({result:{ID:'900001',TITLE:crmReads>1?desiredTitle:'private-client - [whatcrm] line #21',CATEGORY_ID:'1',STAGE_ID:options.changed&&crmReads>1?'C1:NEXT':'C1:NEW',UF_CRM_PRIVATE:'private-data'}});
   }
   assert.equal(path,'/api/assessment/900001/title-repair');assert.equal(body.expectedSubmissionHash,hash);
   if(body.action==='inspect')return Response.json({repair:{status:options.status||'PROPOSED',proposalHash:hash,desiredTitle,requestId:options.status?'pinned-request':null}});
   if(options.failedWrite)throw Error('private-upstream-secret');
   return Response.json({repair:{status:options.uncertain?'UNCERTAIN':'VERIFIED',desiredTitle}});
  },writeFile:async(path,text)=>outputs[path]=text,console:{log:text=>logs.push(text)},
 });
 const text=outputs['lawyer-title-repair.json'];assert.ok(text);assert.equal(/private-/i.test(text+logs.join('')),false);return{report:JSON.parse(text),calls,process};
}
test('title runner writes only through pinned guarded endpoint and verifies unchanged protected state',async()=>{
 const r=await run();assert.equal(r.report.verified,true);assert.ok(Object.values(r.report.checks).every(Boolean));
 assert.equal(r.calls.filter(c=>c.body?.action==='repair').length,1);
 assert.ok(r.calls.every(c=>c.method==='GET'||['/api/session','/api/bitrix/crm.deal.get','/api/assessment/900001/title-repair'].includes(c.path)));
});
test('uncertain title receipts are only reconciled and lost responses are never retried blindly',async()=>{
 for(const status of ['WRITING','UNCERTAIN']){
  const r=await run({status});assert.equal(r.report.verified,true);assert.equal(r.calls.filter(c=>c.body?.action==='repair').length,0);assert.equal(r.calls.find(c=>c.body?.action==='reconcile').body.requestId,'pinned-request');
 }
 for(const options of [{failedWrite:true},{uncertain:true},{changed:true}]){
  const r=await run(options);assert.equal(r.report.verified,false);assert.equal(r.process.exitCode,1);assert.equal(r.calls.filter(c=>['repair','reconcile'].includes(c.body?.action)).length,1);
 }
});
test('maintenance without exact target or saved hash refuses access; workflow isolates title repair from submission recovery',async()=>{
 const r=await run({env:{REPAIR_TITLE_EXPECTED_HASH:''}});assert.equal(r.calls.length,0);assert.equal(r.report.error,'EXACT_TITLE_REPAIR_TARGET_REQUIRED');
 const y=fs.readFileSync('.github/workflows/audit-live-tools.yml','utf8');
 assert.match(y,/name: Repair the title[\s\S]*?if: inputs\.audit_lawyer_names != true && inputs\.repair_title_deal_id != ''/);
 assert.match(y,/name: Recover an explicitly selected saved submission\n\s+if: inputs\.audit_lawyer_names != true && inputs\.repair_title_deal_id == '' && inputs\.recover_request_id != ''/);
 assert.match(y,/name: lawyer-title-repair\n\s+path: lawyer-title-repair\.json\n\s+retention-days: 1/);
});
