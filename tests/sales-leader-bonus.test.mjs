import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name],Intl,Date,AbortSignal,Number,Math,Object,Promise});return exports;}
const rules=load('lib/personal-sales.ts');
const bonus=load('lib/sales-leader-bonus.ts',{'./personal-sales':rules});
const crm=load('lib/crm/personal-compensation.ts',{'../personal-sales':rules,'./http-headers':{bitrixHeaders:()=>({'content-type':'application/json'})}});
const competition=bonus.LEADER_COMPETITIONS[0];
const totals={darkhan:{count:3,volume:1300000,missing:0},ramazan:{count:2,volume:1000000,missing:0},nurdaulet:{count:4,volume:1200000,missing:0}};
test('only the highest full contract volume earns one prize after the entire final day',()=>{
 assert.equal(bonus.leaderAward(competition,'darkhan','2026-09-30',totals).amount,0);
 assert.equal(bonus.leaderAward(competition,'darkhan','2026-10-01',totals).amount,100000);
 assert.equal(bonus.leaderAward(competition,'nurdaulet','2026-10-01',totals).amount,0,'More contracts alone does not win the volume competition');
 assert.equal(bonus.LEADER_COMPETITIONS[1].end,'2026-10-21');
 const october=bonus.LEADER_COMPETITIONS[1];
 assert.equal(bonus.leaderAward(october,'darkhan','2026-10-21',totals).status,'pending');
 assert.equal(bonus.leaderAward(october,'darkhan','2026-10-22',totals).status,'won');
});
test('ties, missing amounts, missing employees and no sales require review instead of an invented award',()=>{
 const variants=[null,{...totals,nurdaulet:undefined},{...totals,ramazan:{...totals.ramazan,missing:1}},{...totals,nurdaulet:{...totals.nurdaulet,volume:1300000}},Object.fromEntries(Object.keys(totals).map(person=>[person,{count:0,volume:0,missing:0}]))];
 for(const data of variants)for(const person of Object.keys(totals)){const result=bonus.leaderAward(competition,person,'2026-10-01',data);assert.equal(result.amount,null);assert.equal(result.status,'needs_review');}
});
test('bonus is accrued once at month close while payment-type commissions and payments stay separate',()=>{
 const open=rules.monthlyEarnings('2026-10',[],'2026-10-22',0,'darkhan',100000);assert.equal(open.leaderBonus,0);assert.equal(open.earned,0);
 const closed=rules.monthlyEarnings('2026-10',[],'2026-10-31',0,'darkhan',100000);assert.equal(closed.leaderBonus,100000);assert.equal(closed.earned,200000);assert.equal(closed.commission,0);
 assert.equal(rules.monthlyEarnings('2026-10',[],'2026-11-01',0,'darkhan',null).earned,null);
});
test('competition reads honor month scope and never load an unfinished competition',async()=>{
 const calls=[];const read=async competition=>{calls.push(competition.id);return totals;};
 const current=await bonus.leaderAwardsFor('darkhan','2026-10-02',read,'2026-10');assert.equal(calls.length,0);assert.equal(current[0].status,'pending');
 const all=await bonus.leaderAwardsFor('darkhan','2026-10-02',read);assert.deepEqual(calls,['september-2026']);assert.equal(all.filter(award=>award.amount===100000).length,1);
});
test('ranking reads every page for all three employees and flags unknown amounts',async()=>{
 const calls=[];
 const data=await crm.loadSalesCompetitionTotals('https://crm.test/rest/','2026-09-01','2026-09-30',async(_url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);const offset=Number(body.filter['>ID']||0);
  return Response.json({result:Array.from({length:offset?1:50},(_,i)=>({ID:String(offset+i+1),ASSIGNED_BY_ID:body.filter.ASSIGNED_BY_ID,UF_CRM_1777554129345:'2026-09-15',OPPORTUNITY:offset?null:100}))});
 });
 assert.equal(calls.length,6);for(const person of Object.keys(totals)){assert.equal(data[person].count,51);assert.equal(data[person].volume,5000);assert.equal(data[person].missing,1);}
});
test('a failed or out-of-scope CRM result cannot produce a ranking',async()=>{
 await assert.rejects(()=>crm.loadSalesCompetitionTotals('https://crm.test/rest/','2026-09-01','2026-09-30',async()=>Response.json({result:[{ID:'1',ASSIGNED_BY_ID:'other',UF_CRM_1777554129345:'2026-09-15',OPPORTUNITY:100}]})),/scope mismatch/);
 await assert.rejects(()=>crm.loadSalesCompetitionTotals('https://crm.test/rest/','2026-09-01','2026-09-30',async()=>{throw Error('unavailable');}),/unavailable/);
});
