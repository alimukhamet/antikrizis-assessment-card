import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path,require=()=>{throw Error('Unexpected import');}){
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,process,Response,Request,URL});
 return exports;
}
const rules=load('lib/personal-sales.ts');
const deal=(id,contractValue=100025,extra={})=>({id:String(id),title:'Synthetic contract',contractValue,paymentType:'261',stageId:'C1:NEW',outcomeId:'',firstPayment:10000,...extra});
const sum=values=>values.reduce((total,value)=>total+value,0);
const plain=value=>JSON.parse(JSON.stringify(value));

test('additional 6% never changes the independently rounded original period commission',()=>{
 const first=rules.allocateCommissionForDeals([deal(1)],2);
 assert.deepEqual(plain(first),{parts:[{standard:2001,receipt:6002,other:0}],amounts:[8003],legacy:2001,receipt:6002,total:8003});
 const second=rules.allocateCommissionForDeals([deal(1,400007)],2);
 assert.equal(second.legacy,8000);assert.equal(second.receipt,24000);assert.equal(second.total,32000);
 assert.equal(rules.commissionForDeals([deal(1,400007)],2),32000);
});

test('fractional period totals are allocated once with stable deal-ID ties, not rounded per deal',()=>{
 const deals=[deal(2),deal(1)];
 const allocation=rules.allocateCommissionForDeals(deals,2);
 assert.equal(allocation.legacy,4001);assert.equal(allocation.receipt,12003);assert.equal(allocation.total,16004);
 assert.equal(sum(allocation.amounts),16004);
 assert.equal(sum(allocation.parts.map(part=>part.standard)),4001);
 assert.equal(sum(allocation.parts.map(part=>part.receipt)),12003);
 const byId=Object.fromEntries(deals.map((item,index)=>[item.id,plain(allocation.parts[index])]));
 assert.deepEqual(byId,{'1':{standard:2001,receipt:6002,other:0},'2':{standard:2000,receipt:6001,other:0}});
 const reversed=rules.allocateCommissionForDeals([...deals].reverse(),2);
 assert.deepEqual(plain(reversed.parts),plain([...allocation.parts].reverse()));
});

test('263 and 461 retain their original shared period rounding alongside handoff commission',()=>{
 const deals=[deal(1),deal(2,100001,{paymentType:'263',firstPayment:10003}),deal(3,100006,{paymentType:'461',outcomeId:'311',stageId:'C1:WON'})];
 const allocation=rules.allocateCommissionForDeals(deals,2);
 // Original raw amounts: 2000.5 + 5100.37 + 8000.48 = 15101.35.
 assert.equal(allocation.legacy,15101);assert.equal(allocation.receipt,6002);assert.equal(allocation.total,21103);
 assert.equal(sum(allocation.parts.flatMap(part=>[part.standard,part.other])),15101);
 assert.equal(sum(allocation.amounts),21103);
 const noReceipt=deals.map(item=>item.paymentType==='261'?{...item,firstPayment:null}:item);
 assert.equal(rules.commissionForDeals(noReceipt,2),15101);
});

test('unresolved 6% retains known rounded handoff lines without claiming a complete total',()=>{
 const allocation=rules.allocateCommissionForDeals([deal(1,100025,{firstPayment:null,paymentEvidence:{status:'review_required'}}),deal(2)],2);
 assert.equal(allocation.legacy,4001);assert.equal(allocation.receipt,null);assert.equal(allocation.total,null);
 assert.equal(sum(allocation.parts.map(part=>part.standard)),4001);
 assert.equal(allocation.parts[0].receipt,null);assert.equal(allocation.parts[1].receipt,6002);
 assert.equal(allocation.amounts[0],null);assert.equal(allocation.amounts[1],8002);
});

async function report(deals){
 const route=load('app/api/personal-sales/route.ts',name=>{
  if(name.includes('worker-session'))return {readSessionCookie:()=>'',verifySession:async()=>({worker:'ali'})};
  if(name.includes('crm/personal-compensation'))return {loadCompensationDeals:async()=>deals,loadSalesCompetitionTotals:async()=>({})};
  if(name.includes('sales-compensation'))return {compensationRepository:async()=>({payments:async()=>[],plans:async()=>[]}),storedPlan:row=>row};
  if(name.includes('sales-leader-bonus'))return {leaderAwardsFor:async()=>[],leaderCompetitionFor:()=>undefined};
  if(name.includes('personal-sales'))return {...rules,todayAlmaty:()=> '2026-10-14'};
  throw Error('Unexpected import '+name);
 });
 const response=await route.GET(new Request('https://example.test/api/personal-sales?person=ramazan&month=2026-08'));
 assert.equal(response.status,200);
 return response.json();
}
const datedDeal=(id,date,extra={})=>deal(id,100025,{handoffDate:date,commissionDate:date,...extra});

test('API lines, separate categories and month totals reconcile across historical rates and a 2% gap',async()=>{
 const data=await report([datedDeal(1,'2026-08-01'),datedDeal(2,'2026-08-16'),datedDeal(3,'2026-08-31')]);
 const month=data.earningsMonths[0];
 // August uses 1.7%, then 2%; August 31 is outside the saved plans and uses 2%.
 assert.deepEqual(data.periods.map(period=>period.rate),[1.7,2]);
 assert.equal(month.commission,23708);assert.equal(month.earned,123708);
 assert.deepEqual(Object.fromEntries(month.commissionGroups.map(group=>[group.id,group.amount])),{'handoff-1.7':1700,'receipt-6':18006,'handoff-2':4002});
 assert.equal(sum(month.commissionGroups.map(group=>group.amount)),month.commission);
 assert.equal(sum(month.commissionDeals.map(line=>line.amount)),month.commission);
 for(const group of month.commissionGroups)assert.equal(sum(group.deals.map(line=>line.amount)),group.amount);
 for(const line of month.commissionDeals)assert.equal(sum(line.components.map(component=>component.amount)),line.amount);
});

test('API aggregates unresolved receipt evidence as unknown while showing the complete handoff category',async()=>{
 const data=await report([datedDeal(1,'2026-08-16',{firstPayment:null,paymentEvidence:{status:'review_required'}}),datedDeal(2,'2026-08-17')]);
 const month=data.earningsMonths[0];
 assert.equal(month.commission,null);assert.equal(month.earned,null);assert.equal(month.owed,null);
 const standard=month.commissionGroups.find(group=>group.id==='handoff-2');
 assert.equal(standard.amount,4001);assert.equal(sum(standard.deals.map(line=>line.amount)),4001);
 assert.equal(month.commissionGroups.find(group=>group.id==='receipt-6').amount,null);
});
