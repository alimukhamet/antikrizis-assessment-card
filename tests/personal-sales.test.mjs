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
const leaderRules=await moduleAt('../lib/sales-leader-bonus.ts',{require:()=>rules});
async function api(worker='ramazan',query='',fail=false,missing=0,payments=[],options={}) {
 const calls=[];
 const compensationDeals={loadCompensationDeals:async(_webhook,managerId,from,to)=>{calls.push({managerId,from,to});if(fail)throw Error('down');if(options.deals)return options.deals;return Array.from({length:30},(_,index)=>{const handoffDate=from==='2026-08-01'?(index<15?'2026-08-08':'2026-08-22'):from;return {id:String(index+1),title:'Клиент '+(index+1),handoffDate,commissionDate:handoffDate,contractValue:index<missing?null:options.contractValue??400000,paymentType:'261',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:100000}})}};
 const compensation={compensationRepository:async()=>({payments:async()=>payments,plans:async()=>[]}),storedPlan:row=>row};
 compensationDeals.loadSalesCompetitionTotals=async()=>{if(options.rankingFails)throw Error('ranking unavailable');return options.totals||{darkhan:{count:30,volume:12000000,missing:0},ramazan:{count:20,volume:10000123,missing:0},nurdaulet:{count:25,volume:11000000,missing:0}};};
 const route=await moduleAt('../app/api/personal-sales/route.ts',{require:name=>name.includes('personal-compensation')?compensationDeals:name.includes('worker-session')?session:name.includes('sales-compensation')?compensation:name.includes('sales-leader-bonus')?leaderRules:{...rules,todayAlmaty:()=>options.today||'2026-09-10'}});
 const cookie=worker?session.SESSION_COOKIE+'='+await session.issueSession(worker,TEST_SECRET):'';
 const response=await route.GET(new Request('https://site.test/api/personal-sales?'+query,{headers:{cookie}}));return {response,data:await response.json(),calls};
}
test('historical rates, boundaries and person-specific terms',()=>{
 const june=rules.plansFor('darkhan')[0];assert.equal(june.target,19);assert.equal(rules.calculate(june,{count:19,volume:7600000,missing:0}).earned,174800);
 const july=rules.plansFor('ramazan')[2];assert.equal(rules.calculate(july,{count:14,volume:5600000,missing:0}).rate,1.3);assert.equal(rules.calculate(july,{count:15,volume:6000000,missing:0}).earned,138000);
 assert.equal(rules.calculate(rules.plansFor('darkhan')[2],{count:14,volume:5600000,missing:0}).rate,2);
 for(const person of ['darkhan','ramazan','nurdaulet']){
  const sep=rules.plansFor(person).at(-1);assert.equal(sep.target,10000000);
  assert.equal(rules.calculate(sep,{count:20,volume:9999999,missing:0}).rate,person==='darkhan'?2:1.6);
  const reached=rules.calculate(sep,{count:20,volume:10000000,missing:0});
  assert.equal(reached.rate,2.3);assert.equal(reached.earned,230000);assert.equal(reached.progress,100);assert.equal(reached.remaining,0);
  assert.equal(rules.calculate(sep,{count:20,volume:10500000,missing:0}).rate,2.3);
  assert.equal(rules.calculate(sep,{count:20,volume:10000000,missing:1}).earned,null);
 }
});
test('September sales between 10 and 11 million earn the reached-target commission through the API',async()=>{
 const {data,response}=await api('ramazan','month=2026-09',false,0,[],{today:'2026-10-02',contractValue:350000});
 assert.equal(response.status,200);assert.equal(data.periods.length,1);
 const period=data.periods[0];assert.equal(period.target,10000000);assert.equal(period.volume,10500000);assert.equal(period.rate,2.3);assert.equal(period.progress,105);assert.equal(period.remaining,0);
 assert.equal(data.earningsMonths[0].commission,630000);assert.equal(data.earningsMonths[0].leaderBonus,0);assert.equal(data.earned,730000);assert.equal(data.paid,null);
});
test('payment-type commission rules use first payment, remaining contract and won decision stage',()=>{
 const standard=[
  {contractValue:500000,paymentType:'261',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:null},
  {contractValue:400000,paymentType:'423',stageId:'C1:PREPARATION',outcomeId:'',firstPayment:null},
 ];
 assert.equal(rules.commissionForDeals(standard,2),0);
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
test('closed first-place bonus increases only the winner earnings and never creates a payment',async()=>{
 for(const person of ['darkhan','ramazan','nurdaulet']){
  const {data,response}=await api('ali','person='+person+'&month=2026-09',false,0,[],{today:'2026-10-02'});
  assert.equal(response.status,200);const month=data.earningsMonths[0];
  assert.equal(month.leaderBonus,person==='darkhan'?100000:0);
  assert.equal(month.earned,month.baseSalary+month.commission+month.contractBonus+month.leaderBonus);
  assert.equal(data.paid,null);assert.equal(data.payments.length,0);
  assert.equal(data.leaderAwards.length,1);assert.equal(data.leaderAwards[0].status,person==='darkhan'?'won':'not_won');
  assert.ok(!JSON.stringify(data).includes('10000123'),'Another employee sales total must not leak');
 }
});
test('unavailable first-place evidence preserves known commission but cannot claim a settled earned total',async()=>{
 const {data,response}=await api('ali','person=darkhan&month=2026-09',false,0,[],{today:'2026-10-02',rankingFails:true});
 assert.equal(response.status,200);assert.equal(data.earningsMonths[0].commission,720000);assert.equal(data.earningsMonths[0].leaderBonus,null);assert.equal(data.earned,null);assert.equal(data.leaderAwards[0].status,'needs_review');
});
test('personal route denies anonymous and cross-person requests without loading CRM',async()=>{for(const [worker,query,status]of [[null,'',401],['ramazan','person=darkhan',403],['ali','person=unknown',400]]){const {response,calls}=await api(worker,query);assert.equal(response.status,status);assert.equal(calls.length,0)}});
test('personal month contains only signed-in manager, monthly salary, auditable deal commissions, no post-June bonus, and keeps unrecorded payouts unknown',async()=>{const {response,data,calls}=await api('ramazan','month=2026-08');assert.equal(response.status,200);assert.equal(data.name,'Рамазан');assert.equal(data.canChoosePerson,false);assert.equal(data.earned,820000);assert.equal(data.earningsMonths[0].baseSalary,100000);assert.equal(data.earningsMonths[0].contractBonus,0);assert.equal(data.earningsMonths[0].commissionDeals.length,30);assert.equal(data.earningsMonths[0].commissionDeals.reduce((sum,row)=>sum+row.amount,0),720000);assert.deepEqual({...data.earningsMonths[0].commissionDeals[0]},{id:'1',title:'Клиент 1',date:'2026-08-08',paymentType:'После определения',formula:'400000 × 6%',amount:24000,contractValue:400000,firstPayment:100000});assert.equal(data.paid,null);assert.equal(data.owed,null);assert.equal(data.uncoveredDays,1);assert.equal(data.periods.length,2);assert.ok(calls.every(call=>call.managerId==='2093'&&call.from==='2026-08-01'&&call.to==='2026-08-31'));assert.ok(!JSON.stringify(data).includes('must not leak'));assert.match(response.headers.get('cache-control'),/no-store/)});
test('bank transfers remain whole while balances apply them oldest-first',async()=>{const payments=[{id:'p-100',person:'ramazan',month:'2026-09',amount:100000,paidAt:'2026-09-09',note:'Kaspi выписка · документ 277',createdAt:''},{id:'p-150',person:'ramazan',month:'2026-08',amount:150000,paidAt:'2026-08-22',note:'Kaspi выписка · документ 269',createdAt:''}];const {data}=await api('ramazan','',false,0,payments);assert.deepEqual(Array.from(data.payments,row=>row.amount),[100000,150000]);assert.equal(data.paid,250000);assert.equal(data.earningsMonths.reduce((sum,row)=>sum+(row.paid??0),0),250000);assert.deepEqual(Array.from(data.earningsMonths,row=>row.paid),[250000,0,0,0]);});
test('ROP can select each manager while personal profiles remain scoped',async()=>{for(const person of ['darkhan','ramazan','nurdaulet']){const owner=await api('ali','person='+person);assert.equal(owner.response.status,200);assert.equal(owner.data.person,person);assert.equal(owner.data.canChoosePerson,true);assert.equal(owner.data.periods.length,8);assert.equal(typeof owner.data.earningsMonths.at(-1).performanceCommission,'number');}const all=await api('nurdaulet','month=2026-09');assert.equal(all.data.name,'Нурдаулет');assert.equal(all.data.canChoosePerson,false);assert.equal(all.data.periods.length,1);assert.equal(all.data.earningsMonths[0].performanceCommission,720000);assert.equal(all.data.earningsMonths[0].earned,0);assert.equal(all.data.uncoveredDays,0);assert.ok(all.calls.every(call=>call.managerId==='4351'));});
test('open months stay unaccrued, while missing values remain unknown after closing',async()=>{const missing=await api('ramazan','month=2026-09',false,1);assert.equal(missing.data.earned,0);const plan=rules.plansFor('ramazan').at(-1),values={count:1,volume:0,missing:1},period={...plan,...values,...rules.calculate(plan,values),ongoing:false};assert.equal(rules.monthlyEarnings('2026-09',[period],'2026-09-30').earned,null);const failed=await api('ramazan','month=2026-09',true);assert.equal(failed.response.status,502);assert.equal(failed.data.earned,undefined)});
test('home preserves the reviewed canonical form and renderer and keeps personal entry links',async()=>{const {createHash}=await import('node:crypto');const baseline=JSON.parse(await readFile(new URL('./fixtures/canonical-workflow-hashes.json',import.meta.url),'utf8'));const updated=await readFile(new URL('../templates/assessment-card.html',import.meta.url),'utf8');const originalRenderer=await readFile(new URL('../public/contract-renderers/934ed4d7b5eee6c47a8dfca740d4faf4142e8d2aadf555bd94fcea28b036a295.js',import.meta.url),'utf8');const templatePattern=/const TEMPLATE_B64 = '[^']+';/;assert.equal(createHash('sha256').update(Buffer.from(updated.match(templatePattern)[0].split("'")[1],'base64')).digest('hex'),'e3299ff99e0c0360bed85d1f791f87d098c511226889ec79c741b9a719b38cf9');const workflow=updated.replace(templatePattern,originalRenderer.match(templatePattern)[0]).replace(/        <a class="task-card"[^>]*data-fourth-tool>[\s\S]*?<\/a>\n/,'');for(const [marker,hash]of Object.entries(baseline.suffixHashes)){if(marker==='<div class="task-grid">')continue; // Launcher topology is covered separately; preserve the deep form fingerprint.
assert.ok(updated.includes(marker));assert.equal(createHash('sha256').update(workflow.slice(workflow.indexOf(marker))).digest('hex'),hash);}assert.match(updated,/class="profile-link" href="\/my-results" target="_top"/);assert.doesNotMatch(updated,/class="personal-shortcuts"/);assert.doesNotMatch(updated,/href="\/my-earnings" target="_top"/)});
test('built Worker protects both pages and API; signed-in views render',async()=>{const {default:worker}=await import('../dist/server/index.js');const env={SITE_SESSION_TOKEN:TEST_SECRET,ASSETS:{fetch:async()=>new Response('',{status:404})}},ctx={waitUntil(){},passThroughOnException(){}};for(const path of ['/my-results','/my-earnings','/api/personal-sales']){const response=await worker.fetch(new Request('https://site.test'+path),env,ctx);assert.equal(response.status,path.startsWith('/api/')?401:303)}for(const path of ['/my-results','/my-earnings']){const cookie=session.SESSION_COOKIE+'='+await session.issueSession('ramazan',TEST_SECRET);const response=await worker.fetch(new Request('https://site.test'+path,{headers:{cookie}}),env,ctx);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(await response.text(),/Назад/);}});

test('6% of the full contract requires a positive first payment for both eligible types, independently of plan rates',()=>{
 for(const paymentType of ['261','423']){
  const deal={contractValue:400000,paymentType,stageId:'C1:NEW',outcomeId:'',firstPayment:200000};
  for(const rate of [null,1.6,2,2.3])assert.equal(rules.commissionForDeals([deal],rate),24000);
  assert.equal(rules.commissionForDeals([{...deal,firstPayment:10000}]),24000);
  for(const firstPayment of [null,0])assert.equal(rules.commissionForDeals([{...deal,firstPayment}]),0);
  assert.equal(rules.commissionForDeals([{...deal,contractValue:null}]),null);
 }
});
test('retroactive 6% covers plan gaps once, retains handoff dates, exclusions and actual payout records',async()=>{
 const deal=(id,paymentType,date,firstPayment,title='Test')=>({id,title,paymentType,handoffDate:date,commissionDate:date,firstPayment,contractValue:400000,stageId:'C1:NEW',outcomeId:''});
 const deals=[deal('1','261','2026-06-01',10000),deal('2','423','2026-06-15',200000),deal('3','261','2026-06-20',null),deal('4','261','2026-06-18',10000,'НАЛЬТАЕВ РАШИД СЕЙТБЕКОВИЧ ВП')];
 const payments=[{id:'paid',person:'ramazan',month:'2026-06',amount:125000,paidAt:'2026-07-02',note:'Existing transfer',createdAt:''}];
 const {response,data}=await api('ramazan','month=2026-06',false,0,payments,{today:'2026-10-14',deals});
 assert.equal(response.status,200);
 const month=data.earningsMonths[0];
 assert.equal(month.commission,48000);assert.equal(month.earned,148000);assert.equal(month.paid,125000);assert.equal(month.owed,23000);
 assert.deepEqual(data.payments,payments);assert.equal(data.monthly.count,4);assert.equal(data.periods[0].count,3);
 assert.deepEqual(month.commissionDeals.map(row=>[row.id,row.date,row.formula,row.amount]),[
  ['1','2026-06-01','400000 × 6%',24000],['2','2026-06-15','400000 × 6%',24000],['3','2026-06-20','0 · Нет зарегистрированной оплаты по договору',0],
 ]);
});
test('current fixed commission without any plan is visible but remains unaccrued until month end',async()=>{
 const deals=[{id:'1',title:'Test',paymentType:'423',handoffDate:'2026-10-10',commissionDate:'2026-10-10',firstPayment:50000,contractValue:500000,stageId:'C1:NEW',outcomeId:''}];
 const {data}=await api('ramazan','month=2026-10',false,0,[],{today:'2026-10-14',deals});
 assert.equal(data.periods.length,0);assert.equal(data.earningsMonths[0].performanceCommission,30000);
 assert.equal(data.earningsMonths[0].commission,0);assert.equal(data.earned,0);assert.equal(data.earningsMonths[0].commissionDeals.length,1);
});

test('unresolved register evidence keeps a closed month commission, earned and owed unknown',async()=>{
 const deals=[{id:'1',title:'Test',paymentType:'261',handoffDate:'2026-06-10',commissionDate:'2026-06-10',firstPayment:null,contractValue:400000,stageId:'C1:NEW',outcomeId:'',paymentEvidence:{status:'review_required',source:'payment_register'}}];
 const payments=[{id:'paid',person:'ramazan',month:'2026-06',amount:125000,paidAt:'2026-07-02',note:'Existing transfer',createdAt:''}];
 const {data}=await api('ramazan','month=2026-06',false,0,payments,{today:'2026-10-14',deals});
 assert.equal(data.earningsMonths[0].commission,null);assert.equal(data.earned,null);assert.equal(data.owed,null);assert.equal(data.paid,125000);
 assert.equal(data.earningsMonths[0].commissionDeals[0].amount,null);
 assert.equal(data.earningsMonths[0].commissionDeals[0].formula,'Оплату нужно сверить — расчёт не подтверждён');
 assert.deepEqual(data.payments,payments);
});
