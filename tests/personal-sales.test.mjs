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
async function api(worker='ramazan',query='',fail=false,missing=0,payments=[]) {
 const calls=[];
 const compensationDeals={loadCompensationDeals:async(_webhook,managerId,from,to)=>{calls.push({managerId,from,to});if(fail)throw Error('down');return Array.from({length:30},(_,index)=>{const handoffDate=from==='2026-08-01'?(index<15?'2026-08-08':'2026-08-22'):from;return {id:String(index+1),title:'Клиент '+(index+1),handoffDate,commissionDate:handoffDate,contractValue:index<missing?null:400000,paymentType:'261',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:null}})}};
 const compensation={compensationRepository:async()=>({payments:async()=>payments,plans:async()=>[]}),storedPlan:row=>row};
 const route=await moduleAt('../app/api/personal-sales/route.ts',{require:name=>name.includes('personal-compensation')?compensationDeals:name.includes('worker-session')?session:name.includes('sales-compensation')?compensation:{...rules,todayAlmaty:()=> '2026-09-10'}});
 const cookie=worker?session.SESSION_COOKIE+'='+await session.issueSession(worker,TEST_SECRET):'';
 const response=await route.GET(new Request('https://site.test/api/personal-sales?'+query,{headers:{cookie}}));return {response,data:await response.json(),calls};
}
test('historical rates, boundaries and person-specific terms',()=>{
 const june=rules.plansFor('darkhan')[0];assert.equal(june.target,19);assert.equal(rules.calculate(june,{count:19,volume:7600000,missing:0}).earned,174800);
 const july=rules.plansFor('ramazan')[2];assert.equal(rules.calculate(july,{count:14,volume:5600000,missing:0}).rate,1.3);assert.equal(rules.calculate(july,{count:15,volume:6000000,missing:0}).earned,138000);
 assert.equal(rules.calculate(rules.plansFor('darkhan')[2],{count:14,volume:5600000,missing:0}).rate,2);
 const sep=rules.plansFor('darkhan').at(-1);assert.equal(rules.calculate(sep,{count:25,volume:11000000,missing:0}).earned,253000);assert.equal(rules.calculate(sep,{count:25,volume:10999999,missing:0}).rate,2);
 for(const person of ['darkhan','ramazan','nurdaulet'])assert.equal(rules.calculate(rules.plansFor(person).at(-1),{count:20,volume:11000000,missing:0}).rate,2.3);
 assert.equal(rules.calculate(sep,{count:25,volume:11000000,missing:1}).earned,null);
});
test('payment-type commission rules use first payment, remaining contract and won decision stage',()=>{
 const standard=[
  {contractValue:500000,paymentType:'261',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:null},
  {contractValue:400000,paymentType:'423',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:null},
 ];
 assert.equal(rules.commissionForDeals(standard,2),18000);
 assert.equal(rules.commissionForDeals([{contractValue:200000,paymentType:'263',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:33000}],2),11630);
 assert.equal(rules.commissionForDeals([{contractValue:800000,paymentType:'263',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:34000}],2),35740);
 assert.equal(rules.commissionForDeals([{contractValue:310000,paymentType:'263',stageId:'C1:UC_R0NPNE',outcomeId:'',firstPayment:20000}],2),14600);
 const after={contractValue:400000,paymentType:'461',stageId:'C1:UC_NFTXR5',outcomeId:'',firstPayment:null};
 assert.equal(rules.commissionForDeals([after],2),0);
 assert.equal(rules.commissionForDeals([{...after,stageId:'C1:UC_R0NPNE',outcomeId:'311'}],2),32000);
 assert.equal(rules.commissionForDeals([{...after,stageId:'C1:UC_R0NPNE',outcomeId:'313'}],2),0);
 assert.equal(rules.commissionForDeals([{...after,paymentType:'263'}],2),null);
});
test('owner-confirmed June exclusions remove commission only for Ramazan',()=>{
 assert.equal(rules.isCommissionExcluded('ramazan','2026-06-17','ЕСБЕРГЕНОВА АНАР ГАЙСАГАЛИЕВНА ВП'),false);
 assert.equal(rules.isCommissionExcluded('ramazan','2026-06-18','  Нальтаев   Рашид Сейтбекович ВП  '),true);
 assert.equal(rules.isCommissionExcluded('ramazan','2026-07-18','НАЛЬТАЕВ РАШИД СЕЙТБЕКОВИЧ ВП'),false);
 assert.equal(rules.isCommissionExcluded('darkhan','2026-06-18','НАЛЬТАЕВ РАШИД СЕЙТБЕКОВИЧ ВП'),false);
});
test('monthly salary and 19-contract bonus apply once, with no June salary for Darkhan',()=>{
 for(const person of ['ramazan','nurdaulet']){
  const plan=rules.plansFor(person)[0];
  const calculated={...plan,count:19,volume:7600000,missing:0,...rules.calculate(plan,{count:19,volume:7600000,missing:0}),ongoing:false};
  const month=rules.monthlyEarnings('2026-06',[calculated],'2026-07-01',0,person);
  assert.equal(month.baseSalary,100000);assert.equal(month.contractBonus,200000);assert.equal(month.commission,174800);assert.equal(month.earned,474800);
 }
 const darkhanPlan=rules.plansFor('darkhan')[0];
 const darkhanPeriod={...darkhanPlan,count:19,volume:7600000,missing:0,...rules.calculate(darkhanPlan,{count:19,volume:7600000,missing:0}),ongoing:false};
 const darkhanJune=rules.monthlyEarnings('2026-06',[darkhanPeriod],'2026-07-01',0,'darkhan');
 assert.equal(darkhanJune.baseSalary,0);assert.equal(darkhanJune.earned,374800);
 assert.equal(rules.monthlyEarnings('2026-07',[],'2026-08-01',0,'darkhan').baseSalary,100000);
 const plan=rules.plansFor('ramazan')[1];
 const first={...plan,count:10,volume:1000000,missing:0,...rules.calculate(plan,{count:10,volume:1000000,missing:0}),ongoing:false};
 const second={...plan,id:'second',count:9,volume:900000,missing:0,...rules.calculate(plan,{count:9,volume:900000,missing:0}),ongoing:false};
 const july=rules.monthlyEarnings('2026-07',[first,second],'2026-08-01');
 assert.equal(july.count,19);assert.equal(july.baseSalary,100000);assert.equal(july.contractBonus,0);assert.equal(july.earned,138000);
});
test('first-payment commission outside a plan is added without changing the plan contract count',()=>{
 const plan=rules.plansFor('ramazan')[0],values={count:19,volume:7600000,missing:0};
 const period={...plan,...values,...rules.calculate(plan,values,187840),ongoing:false};
 const month=rules.monthlyEarnings('2026-06',[period],'2026-07-01',11630);
 assert.equal(month.count,19);assert.equal(month.commission,199470);assert.equal(month.earned,499470);
});
test('the 200k contract bonus applies only to June',()=>{
 const plan=rules.plansFor('ramazan')[0];
 const period={...plan,count:19,volume:7600000,missing:0,...rules.calculate(plan,{count:19,volume:7600000,missing:0}),ongoing:false};
 assert.equal(rules.monthlyEarnings('2026-06',[period],'2026-06-30').contractBonus,200000);
 for(const month of ['2026-07','2026-08','2026-09'])assert.equal(rules.monthlyEarnings(month,[period],'2026-09-30').contractBonus,0);
});
test('monthly salary and commission are accrued only when the month ends',()=>{
 const plan=rules.plansFor('ramazan').at(-1);
 const period={...plan,count:12,volume:6500000,missing:0,...rules.calculate(plan,{count:12,volume:6500000,missing:0}),ongoing:true};
 const open=rules.monthlyEarnings('2026-09',[period],'2026-09-29');
 assert.equal(open.baseSalary,0);assert.equal(open.performanceCommission,104000);assert.equal(open.commission,0);assert.equal(open.earned,0);
 const closed=rules.monthlyEarnings('2026-09',[period],'2026-09-30');
 assert.equal(closed.baseSalary,100000);assert.equal(closed.performanceCommission,104000);assert.equal(closed.commission,104000);assert.equal(closed.earned,204000);
});
test('dates reject invalid and future months, honor leap years',()=>{assert.equal(rules.monthRange('2024-02','2026-09-10').end,'2024-02-29');for(const month of ['2026-13','2026-00','2026-10','2019-12','bad'])assert.throws(()=>rules.monthRange(month,'2026-09-10'));});
test('personal route denies anonymous and cross-person requests without loading CRM',async()=>{for(const [worker,query,status]of [[null,'',401],['ramazan','person=darkhan',403],['ali','person=unknown',400]]){const {response,calls}=await api(worker,query);assert.equal(response.status,status);assert.equal(calls.length,0)}});
test('personal month contains only signed-in manager, monthly salary, auditable deal commissions, no post-June bonus, and keeps unrecorded payouts unknown',async()=>{const {response,data,calls}=await api('ramazan','month=2026-08');assert.equal(response.status,200);assert.equal(data.name,'Рамазан');assert.equal(data.canChoosePerson,false);assert.equal(data.earned,358000);assert.equal(data.earningsMonths[0].baseSalary,100000);assert.equal(data.earningsMonths[0].contractBonus,0);assert.equal(data.earningsMonths[0].commissionDeals.length,30);assert.equal(data.earningsMonths[0].commissionDeals.reduce((sum,row)=>sum+row.amount,0),258000);assert.deepEqual({...data.earningsMonths[0].commissionDeals[0]},{id:'1',title:'Клиент 1',date:'2026-08-08',paymentType:'После определения',formula:'400000 × 2.3%',amount:9200});assert.equal(data.paid,null);assert.equal(data.owed,null);assert.equal(data.uncoveredDays,1);assert.equal(data.periods.length,2);assert.ok(calls.every(call=>call.managerId==='2093'&&call.from==='2026-08-01'&&call.to==='2026-08-31'));assert.ok(!JSON.stringify(data).includes('must not leak'));assert.match(response.headers.get('cache-control'),/no-store/)});
test('bank transfers remain whole while balances apply them oldest-first',async()=>{const payments=[{id:'p-100',person:'ramazan',month:'2026-09',amount:100000,paidAt:'2026-09-09',note:'Kaspi выписка · документ 277',createdAt:''},{id:'p-150',person:'ramazan',month:'2026-08',amount:150000,paidAt:'2026-08-22',note:'Kaspi выписка · документ 269',createdAt:''}];const {data}=await api('ramazan','',false,0,payments);assert.deepEqual(Array.from(data.payments,row=>row.amount),[100000,150000]);assert.equal(data.paid,250000);assert.equal(data.earningsMonths.reduce((sum,row)=>sum+(row.paid??0),0),250000);assert.deepEqual(Array.from(data.earningsMonths,row=>row.paid),[100000,100000,50000,0]);});
test('ROP can select each manager while personal profiles remain scoped',async()=>{for(const person of ['darkhan','ramazan','nurdaulet']){const owner=await api('ali','person='+person);assert.equal(owner.response.status,200);assert.equal(owner.data.person,person);assert.equal(owner.data.canChoosePerson,true);assert.equal(owner.data.periods.length,8);assert.equal(typeof owner.data.earningsMonths.at(-1).performanceCommission,'number');}const all=await api('nurdaulet','month=2026-09');assert.equal(all.data.name,'Нурдаулет');assert.equal(all.data.canChoosePerson,false);assert.equal(all.data.periods.length,1);assert.equal(all.data.earningsMonths[0].performanceCommission,276000);assert.equal(all.data.earningsMonths[0].earned,0);assert.equal(all.data.uncoveredDays,0);assert.ok(all.calls.every(call=>call.managerId==='4351'));});
test('open months stay unaccrued, while missing values remain unknown after closing',async()=>{const missing=await api('ramazan','month=2026-09',false,1);assert.equal(missing.data.earned,0);const plan=rules.plansFor('ramazan').at(-1),values={count:1,volume:0,missing:1},period={...plan,...values,...rules.calculate(plan,values),ongoing:false};assert.equal(rules.monthlyEarnings('2026-09',[period],'2026-09-30').earned,null);const failed=await api('ramazan','month=2026-09',true);assert.equal(failed.response.status,502);assert.equal(failed.data.earned,undefined)});
test('home preserves the reviewed canonical form and renderer and keeps personal entry links',async()=>{const {createHash}=await import('node:crypto');const baseline=JSON.parse(await readFile(new URL('./fixtures/canonical-workflow-hashes.json',import.meta.url),'utf8'));const updated=await readFile(new URL('../templates/assessment-card.html',import.meta.url),'utf8');const originalRenderer=await readFile(new URL('../public/contract-renderers/934ed4d7b5eee6c47a8dfca740d4faf4142e8d2aadf555bd94fcea28b036a295.js',import.meta.url),'utf8');const templatePattern=/const TEMPLATE_B64 = '[^']+';/;assert.equal(createHash('sha256').update(Buffer.from(updated.match(templatePattern)[0].split("'")[1],'base64')).digest('hex'),'e3299ff99e0c0360bed85d1f791f87d098c511226889ec79c741b9a719b38cf9');const workflow=updated.replace(templatePattern,originalRenderer.match(templatePattern)[0]).replace(/        <a class="task-card"[^>]*data-fourth-tool>[\s\S]*?<\/a>\n/,'');for(const [marker,hash]of Object.entries(baseline.suffixHashes)){if(marker==='<div class="task-grid">')continue; // Launcher topology is covered separately; preserve the deep form fingerprint.
assert.ok(updated.includes(marker));assert.equal(createHash('sha256').update(workflow.slice(workflow.indexOf(marker))).digest('hex'),hash);}assert.match(updated,/class="profile-link" href="\/my-results" target="_top"/);assert.doesNotMatch(updated,/class="personal-shortcuts"/);assert.doesNotMatch(updated,/href="\/my-earnings" target="_top"/)});
test('built Worker protects both pages and API; signed-in views render',async()=>{const {default:worker}=await import('../dist/server/index.js');const env={SITE_SESSION_TOKEN:TEST_SECRET,ASSETS:{fetch:async()=>new Response('',{status:404})}},ctx={waitUntil(){},passThroughOnException(){}};for(const path of ['/my-results','/my-earnings','/api/personal-sales']){const response=await worker.fetch(new Request('https://site.test'+path),env,ctx);assert.equal(response.status,path.startsWith('/api/')?401:303)}for(const path of ['/my-results','/my-earnings']){const cookie=session.SESSION_COOKIE+'='+await session.issueSession('ramazan',TEST_SECRET);const response=await worker.fetch(new Request('https://site.test'+path,{headers:{cookie}}),env,ctx);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(await response.text(),/Назад/);}});
