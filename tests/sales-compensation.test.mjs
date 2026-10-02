import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';

function load(path,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name]||{},crypto:webcrypto,Date,Object,Number,JSON});return exports;}
const people={PEOPLE:{darkhan:{},ramazan:{},nurdaulet:{}},COMPENSATION_START_MONTH:'2026-06'};
const compensation=load('lib/sales-compensation.ts',{'./personal-sales':people});
const actor=worker=>({worker,id:'worker:'+worker,displayName:worker,authentication:'shared-password-worker-selection'});
const requestId=()=>webcrypto.randomUUID();
function setup(){
 const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(query){return{bind(...args){const statement=sql.prepare(query);return{async run(){const result=statement.run(...args);return{meta:{changes:Number(result.changes)}};},async first(){return statement.get(...args)||null;},async all(){return{results:statement.all(...args)}}};}}}};
 return{sql,repo:new compensation.CompensationRepository(db)};
}
test('payment ledger is durable, person-scoped and idempotent',async()=>{
 const {sql,repo}=setup(),input=compensation.validateCompensation({kind:'payment',requestId:requestId(),person:'ramazan',month:'2026-08',amount:150000,paidAt:'2026-09-10',note:'August'},'2026-09-21');
 const first=await repo.create(input,actor('ali')),second=await repo.create(input,actor('ali'));assert.equal(first.id,second.id);
 assert.equal((await repo.payments('ramazan'))[0].amount,150000);assert.equal((await repo.payments('darkhan')).length,0);
 await assert.rejects(()=>repo.create({...input,requestId:requestId()},actor('ramazan')),/ROP_REQUIRED/);sql.close();
});
test('zero payment explicitly confirms that nothing was paid',()=>{
 const input=compensation.validateCompensation({kind:'payment',requestId:requestId(),person:'darkhan',month:'2026-09',amount:0,paidAt:'2026-09-21',note:''},'2026-09-21');
 assert.equal(input.amount,0);
});
test('future plans reject overlap and retain their rates',async()=>{
 const {sql,repo}=setup(),base={kind:'plan',requestId:requestId(),person:'darkhan',start:'2026-10-01',end:'2026-10-31',metric:'volume',target:12000000,baseRate:1.5,targetRate:2};
 const input=compensation.validateCompensation(base,'2026-09-21');await repo.create(input,actor('ali'));
 const row=(await repo.plans('darkhan'))[0];assert.equal(row.target,12000000);assert.equal(row.baseRate,1.5);assert.equal(JSON.stringify(compensation.storedPlan(row).tiers),JSON.stringify([[0,1.5],[12000000,2]]));
 await assert.rejects(()=>repo.create(compensation.validateCompensation({...base,requestId:requestId(),start:'2026-10-15',end:'2026-10-31'},'2026-09-21'),actor('ali')),/PLAN_OVERLAPS_EXISTING/);sql.close();
});
test('validation rejects future payments, past plans and cross-month plans',()=>{
 const bad=[
  {kind:'payment',requestId:requestId(),person:'ramazan',month:'2026-10',amount:1,paidAt:'2026-09-21',note:''},
  {kind:'plan',requestId:requestId(),person:'ramazan',start:'2026-09-20',end:'2026-09-30',metric:'count',target:10,baseRate:1,targetRate:2},
  {kind:'plan',requestId:requestId(),person:'ramazan',start:'2026-10-20',end:'2026-11-05',metric:'count',target:10,baseRate:1,targetRate:2},
 ];for(const value of bad)assert.throws(()=>compensation.validateCompensation(value,'2026-09-21'));
});

const batch=overrides=>compensation.validateCompensation({kind:'plans',requestId:requestId(),people:['ramazan','darkhan'],start:'2026-10-03',end:'2026-10-31',metric:'volume',target:12000000,baseRate:1.5,targetRate:2,...overrides},'2026-10-02');
test('one save gives each selected person the full target and retries return the same receipts',async()=>{
 const {sql,repo}=setup(),input=batch();
 try{
  const first=await repo.create(input,actor('ali'));
  assert.equal(first.plans.length,2);
  for(const person of input.people){const rows=await repo.plans(person);assert.equal(rows.length,1);assert.equal(rows[0].target,12000000);assert.equal(rows[0].baseRate,1.5);assert.equal(rows[0].targetRate,2);}
  assert.equal((await repo.plans('nurdaulet')).length,0);
  assert.equal(JSON.stringify(await repo.create({...input,people:[...input.people].reverse()},actor('ali'))),JSON.stringify(first));
  assert.equal(sql.prepare('SELECT count(*) n FROM sales_plans').get().n,2);
  await assert.rejects(()=>repo.create(batch(),actor('ramazan')),/ROP_REQUIRED/);
 }finally{sql.close();}
});
test('overlap for one selected employee prevents all new plans and names the conflict',async()=>{
 const {sql,repo}=setup();
 try{
  await repo.create(batch({people:['ramazan']}),actor('ali'));
  await assert.rejects(()=>repo.create(batch(),actor('ali')),error=>error.code==='PLAN_OVERLAPS_EXISTING'&&JSON.stringify(error.people)==='["ramazan"]');
  assert.equal((await repo.plans('darkhan')).length,0);
  assert.equal((await repo.plans('ramazan')).length,1);
  await repo.create(batch({people:['darkhan','nurdaulet']}),actor('ali'));
  assert.equal(sql.prepare('SELECT count(*) n FROM sales_plans').get().n,3);
 }finally{sql.close();}
});
test('a saved request cannot change its selected people, dates, target or rates',async()=>{
 const {sql,repo}=setup(),input=batch();
 try{
  await repo.create(input,actor('ali'));
  for(const change of [{people:['darkhan']},{people:['darkhan','ramazan','nurdaulet']},{target:15},{end:'2026-10-30'},{baseRate:2},{targetRate:3},{metric:'count'}])await assert.rejects(()=>repo.create({...input,...change},actor('ali')),/PLAN_REQUEST_CHANGED/);
  assert.equal(sql.prepare('SELECT count(*) n FROM sales_plans').get().n,2);
 }finally{sql.close();}
});
test('racing saves and failures within an insert cannot leave a partial selection',async()=>{
 const {sql,repo}=setup();
 try{
  const input=batch(),results=await Promise.all([repo.create(input,actor('ali')),repo.create(input,actor('ali'))]);
  assert.equal(JSON.stringify(results[0]),JSON.stringify(results[1]));
  assert.equal(sql.prepare('SELECT count(*) n FROM sales_plans').get().n,2);
  const overlapping=await Promise.allSettled([repo.create(batch({start:'2026-11-01',end:'2026-11-30'}),actor('ali')),repo.create(batch({people:['ramazan','nurdaulet'],start:'2026-11-01',end:'2026-11-30'}),actor('ali'))]);
  assert.equal(overlapping.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(sql.prepare("SELECT count(*) n FROM sales_plans WHERE start_date='2026-11-01'").get().n,2);
  sql.exec("CREATE TRIGGER reject_second_person BEFORE INSERT ON sales_plans WHEN NEW.person='ramazan' BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END");
  await assert.rejects(()=>repo.create(batch({start:'2026-12-01',end:'2026-12-31'}),actor('ali')),/synthetic storage failure/);
  assert.equal(sql.prepare("SELECT count(*) n FROM sales_plans WHERE start_date='2026-12-01'").get().n,0);
 }finally{sql.close();}
});
test('batch input rejects empty, duplicate, unknown and ambiguous employee selections',()=>{
 for(const people of [[],['darkhan','darkhan'],['ali'],['darkhan',null],'darkhan'])assert.throws(()=>batch({people}),/INVALID_PLAN_PEOPLE/);
 assert.throws(()=>batch({person:'darkhan'}),/INVALID_PLAN_PEOPLE/);
 assert.throws(()=>batch({start:'2026-10-02'}),/INVALID_PLAN/);
 assert.throws(()=>batch({end:'2026-11-01'}),/INVALID_PLAN/);
});
