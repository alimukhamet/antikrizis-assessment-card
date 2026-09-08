import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source=await readFile(new URL("../app/api/sales-metrics/route.ts",import.meta.url),"utf8");
function route(fetch){
  const context=vm.createContext({exports:{},fetch,Request,Response,URL,AbortSignal,console,
    process:{env:{BITRIX_WEBHOOK:"https://bitrix.test/rest/"}}});
  vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return context.exports.GET;
}
const request=(extra="")=>new Request(`https://site.test/api/sales-metrics?managerId=4351&paymentType=261&period=custom&from=2026-06-01&to=2026-08-20${extra}`);

test("fast pagination counts every deal and shares concurrent requests",async()=>{
  const calls=[];
  const GET=route(async(_url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    await new Promise(resolve=>setTimeout(resolve,10));
    const offset=Number(body.filter[">ID"]||0);
    return Response.json({result:Array.from({length:offset?6:50},(_,i)=>({ID:String(offset+i+1),OPPORTUNITY:i?500000:0}))});
  });
  const [a,b]=await Promise.all([GET(request()),GET(request())]);
  const data=await a.json();
  assert.deepEqual(await b.json(),data);
  assert.equal(data.handoffs,56);
  assert.equal(data.contractTotal,27_000_000);
  assert.equal(data.contractAverage,500000);
  assert.equal(data.missingContractValues,2);
  assert.equal(calls.length,2);
  assert.equal(calls[0].start,-1);
  assert.equal(calls[1].filter[">ID"],"50");
  assert.equal(calls[1].filter.UF_CRM_1781335943568,"261");
  assert.equal(calls[1].filter[">=UF_CRM_1777554129345"],"2026-06-01");
  await GET(request());assert.equal(calls.length,2);
  await GET(new Request(request().url.replace("paymentType=261","paymentType=423")));assert.equal(calls.length,4);
  assert.equal(calls[2].filter.UF_CRM_1781335943568,"423");
});

test("a failed page never becomes a partial or cached sales total",async()=>{
  let fail=true;
  const GET=route(async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.filter[">ID"]&&fail) return Response.json({error:"TEMPORARY"});
    return Response.json({result:body.filter[">ID"]?[]:Array.from({length:50},(_,i)=>({ID:String(i+1),OPPORTUNITY:100}))});
  });
  assert.equal((await GET(request())).status,502);
  fail=false;
  assert.equal((await (await GET(request())).json()).handoffs,50);
});

const html=await readFile(new URL("../public/assessment-card.html",import.meta.url),"utf8");
function client(){
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id))elements.set(id,{textContent:"",classList:{remove(){},add(){}},setAttribute(){}});
    return elements.get(id);
  };
  const responses=[];let calls=0;
  const context=vm.createContext({$,URLSearchParams,Intl,Date,Number,JSON,Map,AbortController,setTimeout,clearTimeout,
    document:{querySelectorAll:()=>[]},sessionStorage:{getItem:()=>null,setItem(){}},
    fetch:async()=>{calls++;const next=responses.shift();if(!next)throw new Error("Unexpected fetch");return next();}});
  vm.runInContext(html.slice(html.indexOf("const salesToday="),html.indexOf('document.querySelectorAll("[data-sales-manager]")')),context);
  return {context,$,responses,calls:()=>calls,load:()=>vm.runInContext("loadSalesMetrics()",context),select:id=>vm.runInContext(`salesSelection.managerId=${JSON.stringify(id)}`,context)};
}
function payload(handoffs,lastSyncAt=new Date().toISOString()){
  return Response.json({handoffs,contractTotal:handoffs*100,contractAverage:100,lastSyncAt,periodLabel:"Месяц"});
}
test("returning to the same selection is immediate; another manager never inherits its numbers",async()=>{
  const c=client();
  c.responses.push(()=>payload(46));await c.load();
  await c.load();assert.equal(c.calls(),1);assert.equal(c.$("salesHandoffs").textContent,"46");
  c.select("2093");
  let finish;c.responses.push(()=>new Promise(resolve=>finish=resolve));const pending=c.load();
  assert.equal(c.$("salesHandoffs").textContent,"—");
  finish(payload(12));await pending;assert.equal(c.$("salesHandoffs").textContent,"12");
  c.select("7609");await c.load();assert.equal(c.calls(),2);assert.equal(c.$("salesHandoffs").textContent,"46");
});
test("late responses cannot replace the current selection",async()=>{
  const c=client();let finish;
  c.responses.push(()=>new Promise(resolve=>finish=resolve));const old=c.load();
  c.select("2093");c.responses.push(()=>payload(12));await c.load();
  finish(payload(46));await old;
  assert.equal(c.$("salesHandoffs").textContent,"12");
});
