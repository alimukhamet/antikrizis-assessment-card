import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../scripts/audit-live-platform-entry.mjs',import.meta.url),'utf8')).replace("import {writeFile} from 'node:fs/promises';",'');
async function audit({denied=false}={}){
 let worker,report;const calls=[],logs=[],redemptions=new Map(),process={env:{ASSESSMENT_TEST_PASSWORD:'SYNTHETIC-PASSWORD'}};
 const fetch=async(url,init)=>{
  const path=new URL(url).pathname;calls.push(path);assert.equal(init.redirect,'manual');
  if(path==='/api/health')return Response.json({release:{gitSha:'synthetic'}});
  if(path==='/api/session'){worker=JSON.parse(init.body).worker;return new Response('{}',{status:denied?401:200,headers:{'set-cookie':'assessment=SYNTHETIC-SESSION; HttpOnly'}});}
  if(path==='/assessment-card.html')return new Response('<form data-platform-entry="" method="post" action="/platform-entry" target="_blank" rel="noopener">');
  if(path==='/platform-entry')return new Response('<form action="https://platform.anti-krizis.kz/api/auth/assessment-entry"><input name="ticket" value="synthetic.'+worker+'">',{headers:{'referrer-policy':'strict-origin','cache-control':'private, no-store'}});
  if(path==='/api/auth/assessment-entry'){const ticket=init.body.get('ticket'),count=redemptions.get(ticket)??0;redemptions.set(ticket,count+1);return new Response(null,{status:count?409:303,headers:{location:'/after-sales#deals','set-cookie':'platform=SYNTHETIC-SESSION; HttpOnly'}});}
  if(path==='/api/auth/session')return Response.json({user:{employeeId:'sales-'+worker,viewOnly:true,role:'support'}});
  if(path==='/api/crm/operations/workspace')return Response.json({privateClientData:'DO-NOT-EXPORT'});
  if(path==='/api/admin/employee-logins'){assert.equal(init.body,'{}');return new Response(null,{status:403});}
  throw Error('Unexpected request');
 };
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 await new AsyncFunction('fetch','writeFile','process','console',source)(fetch,async(_path,text)=>{report=JSON.parse(text);},process,{log:text=>logs.push(text),error:text=>logs.push(text)});
 return {report,calls,logs,exitCode:process.exitCode};
}
test('explicit live audit verifies all three subjects without exporting cookies, passwords or client data',async()=>{
 const {report,logs,exitCode}=await audit();assert.equal(exitCode,undefined);assert.equal(report.passed,true);assert.deepEqual(report.people.map(p=>p.worker),['darkhan','ramazan','nurdaulet']);assert.ok(report.people.every(p=>p.passed&&p.viewOnlySession&&p.workspaceRead&&p.mutationDenied&&p.replayDenied));assert.doesNotMatch(JSON.stringify({report,logs}),/SYNTHETIC-PASSWORD|SYNTHETIC-SESSION|DO-NOT-EXPORT|synthetic\.darkhan/);
});
test('failed authentication stops without retries or a misleading successful receipt',async()=>{
 const {report,calls,exitCode}=await audit({denied:true});assert.equal(exitCode,1);assert.equal(report.passed,false);assert.equal(report.error,'assessment_login_failed');assert.deepEqual(calls,['/api/health','/api/session']);
});
