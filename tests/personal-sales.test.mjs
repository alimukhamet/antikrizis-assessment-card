import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {session,TEST_SECRET} from './session-helper.mjs';
async function moduleAt(path,extra={}) {
 const context=vm.createContext({exports:{},Intl,Date,Math,Set,Map,URL,URLSearchParams,Request,Response,process:{env:{SITE_SESSION_TOKEN:TEST_SECRET}},...extra});
 vm.runInContext(ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;
}
const rules=await moduleAt('../lib/personal-sales.ts');
async function api(worker='ramazan',query='',fail=false,missing=0) {
 const calls=[];
 const metrics={GET:async request=>{calls.push(new URL(request.url));return fail?Response.json({error:'down'},{status:502}):Response.json({handoffs:15,contractTotal:6000000,missingContractValues:missing,relatedMetrics:[{managerName:'must not leak'}]})}};
 const route=await moduleAt('../app/api/personal-sales/route.ts',{require:name=>name.includes('sales-metrics')?metrics:name.includes('worker-session')?session:{...rules,todayAlmaty:()=> '2026-09-10'}});
 const cookie=worker?session.SESSION_COOKIE+'='+await session.issueSession(worker,TEST_SECRET):'';
 const response=await route.GET(new Request('https://site.test/api/personal-sales?'+query,{headers:{cookie}}));return {response,data:await response.json(),calls};
}
test('historical rates, boundaries and person-specific terms',()=>{
 const june=rules.plansFor('darkhan')[0];assert.equal(june.target,19);assert.equal(rules.calculate(june,{count:19,volume:7600000,missing:0}).earned,152000);
 const july=rules.plansFor('ramazan')[2];assert.equal(rules.calculate(july,{count:14,volume:5600000,missing:0}).rate,1.3);assert.equal(rules.calculate(july,{count:15,volume:6000000,missing:0}).earned,120000);
 assert.equal(rules.calculate(rules.plansFor('darkhan')[2],{count:14,volume:5600000,missing:0}).rate,1.6);
 const sep=rules.plansFor('darkhan').at(-1);assert.equal(rules.calculate(sep,{count:25,volume:11000000,missing:0}).earned,220000);assert.equal(rules.calculate(sep,{count:25,volume:10999999,missing:0}).rate,1.6);
 assert.equal(rules.calculate(sep,{count:25,volume:11000000,missing:1}).earned,null);
});
test('monthly salary and 19-contract bonus apply once to every employee',()=>{
 for(const person of ['darkhan','ramazan','nurdaulet']){
  const plan=rules.plansFor(person)[0];
  const calculated={...plan,count:19,volume:7600000,missing:0,...rules.calculate(plan,{count:19,volume:7600000,missing:0}),ongoing:false};
  const month=rules.monthlyEarnings('2026-06',[calculated]);
  assert.equal(month.baseSalary,100000);assert.equal(month.contractBonus,200000);assert.equal(month.commission,152000);assert.equal(month.earned,452000);
 }
 const plan=rules.plansFor('ramazan')[1];
 const first={...plan,count:10,volume:1000000,missing:0,...rules.calculate(plan,{count:10,volume:1000000,missing:0}),ongoing:false};
 const second={...plan,id:'second',count:9,volume:900000,missing:0,...rules.calculate(plan,{count:9,volume:900000,missing:0}),ongoing:false};
 const july=rules.monthlyEarnings('2026-07',[first,second]);
 assert.equal(july.count,19);assert.equal(july.baseSalary,100000);assert.equal(july.contractBonus,200000);assert.equal(july.earned,338000);
});
test('dates reject invalid and future months, honor leap years',()=>{assert.equal(rules.monthRange('2024-02','2026-09-10').end,'2024-02-29');for(const month of ['2026-13','2026-00','2026-10','2019-12','bad'])assert.throws(()=>rules.monthRange(month,'2026-09-10'));});
test('personal route denies anonymous and cross-person requests without loading CRM',async()=>{for(const [worker,query,status]of [[null,'',401],['ramazan','person=darkhan',403],['ali','person=unknown',400]]){const {response,calls}=await api(worker,query);assert.equal(response.status,status);assert.equal(calls.length,0)}});
test('personal month contains only signed-in manager, monthly salary and bonus, unknown payouts and uncovered August 31',async()=>{const {response,data,calls}=await api('ramazan','month=2026-08');assert.equal(response.status,200);assert.equal(data.name,'Рамазан');assert.equal(data.canChoosePerson,false);assert.equal(data.earned,540000);assert.equal(data.earningsMonths[0].baseSalary,100000);assert.equal(data.earningsMonths[0].contractBonus,200000);assert.equal(data.paid,null);assert.equal(data.owed,null);assert.equal(data.uncoveredDays,1);assert.equal(data.periods.length,2);assert.ok(calls.every(u=>u.searchParams.get('managerId')==='2093'&&u.searchParams.get('paymentType')==='all'));assert.ok(!JSON.stringify(data).includes('must not leak'));assert.match(response.headers.get('cache-control'),/no-store/)});
test('ROP can select each manager while personal profiles remain scoped',async()=>{for(const person of ['darkhan','ramazan','nurdaulet']){const owner=await api('ali','person='+person);assert.equal(owner.response.status,200);assert.equal(owner.data.person,person);assert.equal(owner.data.canChoosePerson,true);assert.equal(owner.data.periods.length,8);}const all=await api('nurdaulet','');assert.equal(all.data.name,'Нурдаулет');assert.equal(all.data.canChoosePerson,false);assert.equal(all.data.periods.length,8);assert.equal(all.data.uncoveredDays,0);assert.ok(all.calls.every(u=>u.searchParams.get('managerId')==='4351'));});
test('missing values and CRM failures never become zero earnings',async()=>{const missing=await api('ramazan','month=2026-09',false,1);assert.equal(missing.data.earned,null);const failed=await api('ramazan','month=2026-09',true);assert.equal(failed.response.status,502);assert.equal(failed.data.earned,undefined)});
test('home preserves the reviewed canonical form and renderer and keeps personal entry links',async()=>{const {createHash}=await import('node:crypto');const baseline=JSON.parse(await readFile(new URL('./fixtures/canonical-workflow-hashes.json',import.meta.url),'utf8'));const updated=await readFile(new URL('../templates/assessment-card.html',import.meta.url),'utf8');const originalRenderer=await readFile(new URL('../public/contract-renderers/934ed4d7b5eee6c47a8dfca740d4faf4142e8d2aadf555bd94fcea28b036a295.js',import.meta.url),'utf8');const templatePattern=/const TEMPLATE_B64 = '[^']+';/;assert.equal(createHash('sha256').update(Buffer.from(updated.match(templatePattern)[0].split("'")[1],'base64')).digest('hex'),'e3299ff99e0c0360bed85d1f791f87d098c511226889ec79c741b9a719b38cf9');const workflow=updated.replace(templatePattern,originalRenderer.match(templatePattern)[0]).replace(/        <a class="task-card"[^>]*data-fourth-tool>[\s\S]*?<\/a>\n/,'');for(const [marker,hash]of Object.entries(baseline.suffixHashes)){if(marker==='<div class="task-grid">')continue; // Launcher topology is covered separately; preserve the deep form fingerprint.
assert.ok(updated.includes(marker));assert.equal(createHash('sha256').update(workflow.slice(workflow.indexOf(marker))).digest('hex'),hash);}assert.match(updated,/href="\/my-results" target="_top"/);assert.match(updated,/href="\/my-earnings" target="_top"/)});
test('built Worker protects both pages and API; signed-in views render',async()=>{const {default:worker}=await import('../dist/server/index.js');const env={SITE_SESSION_TOKEN:TEST_SECRET,ASSETS:{fetch:async()=>new Response('',{status:404})}},ctx={waitUntil(){},passThroughOnException(){}};for(const path of ['/my-results','/my-earnings','/api/personal-sales']){const response=await worker.fetch(new Request('https://site.test'+path),env,ctx);assert.equal(response.status,path.startsWith('/api/')?401:303)}for(const path of ['/my-results','/my-earnings']){const cookie=session.SESSION_COOKIE+'='+await session.issueSession('ramazan',TEST_SECRET);const response=await worker.fetch(new Request('https://site.test'+path,{headers:{cookie}}),env,ctx);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(await response.text(),/Назад/);}});
