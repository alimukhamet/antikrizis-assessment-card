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
test('historical rates, bonus, boundaries and person-specific terms',()=>{
 const june=rules.plansFor('darkhan')[0];assert.equal(rules.calculate(june,{count:20,volume:8000000,missing:0}).earned,360000);assert.equal(rules.calculate(june,{count:19,volume:7600000,missing:0}).earned,152000);
 const july=rules.plansFor('ramazan')[2];assert.equal(rules.calculate(july,{count:14,volume:5600000,missing:0}).rate,1.3);assert.equal(rules.calculate(july,{count:15,volume:6000000,missing:0}).earned,120000);
 assert.equal(rules.calculate(rules.plansFor('darkhan')[2],{count:14,volume:5600000,missing:0}).rate,1.6);
 const sep=rules.plansFor('darkhan').at(-1);assert.equal(rules.calculate(sep,{count:25,volume:11000000,missing:0}).earned,220000);assert.equal(rules.calculate(sep,{count:25,volume:10999999,missing:0}).rate,1.6);
 assert.equal(rules.calculate(sep,{count:25,volume:11000000,missing:1}).earned,null);
});
test('dates reject invalid and future months, honor leap years',()=>{assert.equal(rules.monthRange('2024-02','2026-09-10').end,'2024-02-29');for(const month of ['2026-13','2026-00','2026-10','2019-12','bad'])assert.throws(()=>rules.monthRange(month,'2026-09-10'));});
test('personal route denies anonymous and cross-person requests without loading CRM',async()=>{for(const [worker,query,status]of [[null,'',401],['ramazan','person=darkhan',403],['ali','person=unknown',400]]){const {response,calls}=await api(worker,query);assert.equal(response.status,status);assert.equal(calls.length,0)}});
test('personal month contains only signed-in manager, unknown payouts and uncovered August 31',async()=>{const {response,data,calls}=await api('ramazan','month=2026-08');assert.equal(response.status,200);assert.equal(data.name,'Рамазан');assert.equal(data.canChoosePerson,false);assert.equal(data.earned,240000);assert.equal(data.paid,null);assert.equal(data.owed,null);assert.equal(data.uncoveredDays,1);assert.equal(data.periods.length,2);assert.ok(calls.every(u=>u.searchParams.get('managerId')==='2093'&&u.searchParams.get('paymentType')==='all'));assert.ok(!JSON.stringify(data).includes('must not leak'));assert.match(response.headers.get('cache-control'),/no-store/)});
test('leader can select a manager; missing values and CRM failures never become zero earnings',async()=>{const owner=await api('ali','person=nurdaulet&month=2026-09');assert.equal(owner.data.name,'Нурдаулет');assert.ok(owner.data.canChoosePerson);assert.equal(owner.data.periods[0].ongoing,true);assert.equal(owner.data.periods[0].leaderBonus,100000);assert.equal(owner.data.earned,96000);const missing=await api('ramazan','month=2026-09',false,1);assert.equal(missing.data.earned,null);const failed=await api('ramazan','month=2026-09',true);assert.equal(failed.response.status,502);assert.equal(failed.data.earned,undefined)});
test('home keeps original workflow and adds only the two entry links',async()=>{const {execFileSync}=await import('node:child_process');const old=execFileSync('git',['show','df0486737152303f95335d512d9d20be52d0a8a8:templates/assessment-card.html'],{encoding:'utf8'});const updated=await readFile(new URL('../templates/assessment-card.html',import.meta.url),'utf8');for(const marker of ['<div class="task-grid">','<header class="workflow-header"'])assert.equal(updated.slice(updated.indexOf(marker)),old.slice(old.indexOf(marker)));assert.match(updated,/href="\/my-results" target="_top"/);assert.match(updated,/href="\/my-earnings" target="_top"/)});
test('built Worker protects both pages and API; signed-in views render',async()=>{const {default:worker}=await import('../dist/server/index.js');const env={SITE_SESSION_TOKEN:TEST_SECRET,ASSETS:{fetch:async()=>new Response('',{status:404})}},ctx={waitUntil(){},passThroughOnException(){}};for(const path of ['/my-results','/my-earnings','/api/personal-sales']){const response=await worker.fetch(new Request('https://site.test'+path),env,ctx);assert.equal(response.status,path.startsWith('/api/')?401:303)}for(const path of ['/my-results','/my-earnings']){const cookie=session.SESSION_COOKIE+'='+await session.issueSession('ramazan',TEST_SECRET);const response=await worker.fetch(new Request('https://site.test'+path,{headers:{cookie}}),env,ctx);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(await response.text(),/К инструментам продаж/);}});
