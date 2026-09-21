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
