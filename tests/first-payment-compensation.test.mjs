import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name],Intl,Date,AbortSignal,Number,Math,Object,Promise});return exports;}
const rules=load('lib/personal-sales.ts');
const crm=load('lib/crm/personal-compensation.ts',{'../personal-sales':rules,'./http-headers':{bitrixHeaders:()=>({'content-type':'application/json'})}});
const deal=(id,type='261',date='2026-09-15')=>({ID:String(id),TITLE:'Test',ASSIGNED_BY_ID:'2093',OPPORTUNITY:400000,STAGE_ID:'C1:NEW',UF_CRM_1781335943568:type,UF_CRM_1777554129345:date});
const invoice=(id,parent,overrides={})=>({id:String(id),parentId2:Number(parent),stageId:'DT31_3:P',opportunity:200000,ufCrm_SMART_INVOICE_1772428866812:'195',ufCrm_SMART_INVOICE_1773231423587:'2026-10-01',...overrides});
function fixture(rows,pages){
 rows=[...rows].sort((a,b)=>Number(a.ID)-Number(b.ID));
 const calls=[];
 const send=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  if(url.endsWith('crm.deal.list.json'))return Response.json({result:body.filter.UF_CRM_1781335943568?rows.filter(row=>row.UF_CRM_1781335943568==='263'):rows});
  const page=await pages(String(body.filter.parentId2),body.start);
  return Response.json(Array.isArray(page)?{result:{items:page}}:page);
 };
 return {calls,run:(from='2026-09-01',to='2026-09-30')=>crm.loadCompensationDeals('https://crm.test/rest/','2093',from,to,send)};
}
test('only linked positive paid first invoices qualify both types; later payment dates preserve the handoff month',async()=>{
 const invalid=[invoice(1,1,{stageId:'DT31_3:NEW'}),invoice(2,1,{ufCrm_SMART_INVOICE_1772428866812:'other'}),invoice(3,999)];
 const f=fixture([deal(1),deal(2,'423'),deal(3),deal(4,'461')],id=>id==='1'?[...invalid,invoice(4,1,{opportunity:10000})]:id==='2'?[invoice(5,2,{stageId:'DT31_3:N',ufCrm_SMART_INVOICE_1773231423587:''})]:invalid);
 const rows=await f.run();
 assert.equal(rows.length,4);assert.equal(rows[0].firstPayment,10000);assert.equal(rows[1].firstPayment,200000);assert.equal(rows[2].firstPayment,null);
 assert.ok(rows.every(row=>row.commissionDate==='2026-09-15'));assert.equal(rules.commissionForDeals(rows.slice(0,3)),48000);
 assert.equal(f.calls.filter(call=>call.url.endsWith('crm.item.list.json')).length,3);
});
test('first payments on later invoice pages qualify; duplicate invoice-day payments do not duplicate contract commission',async()=>{
 const f=fixture([deal(1,'423')],(_id,start)=>start?{result:{items:[invoice(3,1),invoice(4,1,{opportunity:10000})]}}:{result:{items:[invoice(1,1,{stageId:'DT31_3:NEW'})]},next:50});
 const rows=await f.run();assert.equal(rows[0].firstPayment,210000);assert.equal(rules.commissionForDeals(rows),24000);
 assert.deepEqual(f.calls.filter(call=>call.url.endsWith('crm.item.list.json')).map(call=>call.body.start),[0,50]);
});
test('failed, malformed, missing-amount and truncated invoice reads fail instead of inventing an unpaid or complete result',async()=>{
 for(const page of [()=>{throw Error('unavailable');},()=>({result:{}}),()=>[invoice(1,1,{opportunity:null})],(_id,start)=>({result:{items:[]},next:start+50})]){
  await assert.rejects(()=>fixture([deal(1)],page).run());
 }
});
test('before-decision first-payment sums and owner-confirmed June invoice exceptions remain intact',async()=>{
 const rows=[deal(4913,'263','2026-05-15'),deal(3517,'263','2026-05-15'),deal(9,'263','2026-05-15')];
 const f=fixture(rows,id=>id==='4913'?[invoice(1805,id,{opportunity:33000,ufCrm_SMART_INVOICE_1773231423587:'2026-05-30'}),invoice(9999,id)]:id==='3517'?[invoice(2067,id,{opportunity:20000,ufCrm_SMART_INVOICE_1773231423587:'2026-06-22'})]:[invoice(1,id,{ufCrm_SMART_INVOICE_1773231423587:'2026-06-10'})]);
 const result=await f.run('2026-06-01','2026-06-30');
 assert.deepEqual(Array.from(result,row=>[row.id,row.commissionDate,row.firstPayment]),[['3517','2026-06-22',20000],['4913','2026-06-01',33000]]);
 assert.equal(rules.commissionForDeals(result),37830);
});
test('historical invoice loading is bounded and each returned deal is counted once',async()=>{
 let active=0,maximum=0;
 const f=fixture(Array.from({length:18},(_,i)=>deal(i+1,i%2?'423':'261')),async id=>{
  active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return [invoice(id,id)];
 });
 const rows=await f.run();assert.equal(rows.length,18);assert.equal(new Set(rows.map(row=>row.id)).size,18);assert.ok(maximum<=6);assert.ok(maximum>1);
 assert.equal(rules.commissionForDeals(rows),432000);
});
