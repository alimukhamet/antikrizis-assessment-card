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
    return Response.json({result:Array.from({length:offset?6:50},(_,i)=>({
      ID:String(offset+i+1),ASSIGNED_BY_ID:"4351",OPPORTUNITY:i?500000:0,UF_CRM_1781335943568:"261"
    }))});
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
  assert.equal(calls[0].filter.ASSIGNED_BY_ID,undefined);
  assert.equal(calls[0].filter.UF_CRM_1781335943568,undefined);
  assert.deepEqual(calls[0].select,["ID","ASSIGNED_BY_ID","OPPORTUNITY","UF_CRM_1781335943568"]);
  assert.equal(calls[1].filter[">=UF_CRM_1777554129345"],"2026-06-01");
  await GET(request());assert.equal(calls.length,2);
  const otherPayment=await GET(new Request(request().url.replace("paymentType=261","paymentType=423")));
  assert.equal(calls.length,2);
  assert.equal((await otherPayment.json()).handoffs,0);
  assert.equal(data.relatedMetrics.length,12);
});

test("a failed page never becomes a partial or cached sales total",async()=>{
  let fail=true;
  const GET=route(async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.filter[">ID"]&&fail) return Response.json({error:"TEMPORARY"});
    return Response.json({result:body.filter[">ID"]?[]:Array.from({length:50},(_,i)=>({
      ID:String(i+1),ASSIGNED_BY_ID:"4351",OPPORTUNITY:100,UF_CRM_1781335943568:"261"
    }))});
  });
  assert.equal((await GET(request())).status,502);
  fail=false;
  assert.equal((await (await GET(request())).json()).handoffs,50);
});


const html=await readFile(new URL("../public/tools-home.js",import.meta.url),"utf8");
function client(){
  const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{textContent:"",innerHTML:"",value:"",classList:{remove(){},add(){}},setAttribute(){},addEventListener(){}});return elements.get(id)};
  const responses=[];let calls=0;const context=vm.createContext({$,URLSearchParams,Intl,Date,Number,JSON,Map,Set,AbortController,setTimeout,clearTimeout,document:{querySelectorAll:()=>[]},fetch:async()=>{calls++;const next=responses.shift();if(!next)throw Error("Unexpected fetch");return next()}});
  vm.runInContext(html.slice(html.indexOf("const salesToday="),html.indexOf('document.querySelectorAll("[data-sales-payment]")')),context);
  return {context,$,responses,calls:()=>calls,load:()=>vm.runInContext("loadSalesMetrics()",context),select:type=>vm.runInContext(`salesSelection.paymentType=${JSON.stringify(type)}`,context)};
}
function payload(values=[600,400,200]){return {periodLabel:"Период",lastSyncAt:new Date().toISOString(),relatedMetrics:['all','261','263','423'].flatMap(paymentType=>['7609','2093','4351'].map((managerId,i)=>({managerId,paymentType,contractTotal:values[i],contractAverage:values[i]/2,handoffs:2,contractsWithValue:2,missingContractValues:0})))}}
test("complete team filters reuse the snapshot and averages remain visible",async()=>{
  const c=client();c.responses.push(()=>Response.json(payload()),()=>Response.json(payload([400,600,200])));await c.load();assert.equal(c.calls(),2);
  assert.match(c.$('rows').innerHTML,/person-average">300 ₸/);assert.match(c.$('rows').innerHTML,/rank-move up/);assert.match(c.$('rows').innerHTML,/rank-move down/);
  c.select('261');await c.load();assert.equal(c.calls(),2);assert.match(c.$('rows').innerHTML,/Нурдаулет/);
});
test("late current-period responses cannot replace the selected period",async()=>{
  const c=client();let finish;c.responses.push(()=>new Promise(r=>finish=r));const old=c.load();c.select('261');c.responses.push(()=>Response.json(payload([100,100,100])),()=>Response.json(payload()));await c.load();finish(Response.json(payload()));await old;assert.match(c.$('rows').innerHTML,/person-value">100 ₸/);
});
test("missing previous results hide arrows without discarding current totals",async()=>{
  const c=client();c.responses.push(()=>Response.json(payload()),()=>{throw Error('Previous unavailable')});await c.load();assert.match(c.$('rows').innerHTML,/person-value">600 ₸/);assert.doesNotMatch(c.$('rows').innerHTML,/rank-move/);assert.match(c.$('salesSummaryStatus').textContent,/Сравнение недоступно/);
});
test("incomplete team data never becomes a partial total",async()=>{
  const c=client();const partial=payload();partial.relatedMetrics=partial.relatedMetrics.filter(x=>x.managerId!=='4351');c.responses.push(()=>Response.json(partial));await c.load();assert.equal(c.$('rows').innerHTML,'');
});
test("ties share places and comparison uses an adjacent equal-length date range",()=>{
  const c=client();c.context.data=payload([500,500,100]);vm.runInContext('renderSalesTeam(data,"all")',c.context);assert.equal((c.$('rows').innerHTML.match(/aria-label="Место 1"/g)||[]).length,2);
  const result=vm.runInContext('salesPreviousQuery(new URLSearchParams({period:"custom",paymentType:"all",from:"2026-03-01",to:"2026-03-10"})).toString()',c.context);const q=new URLSearchParams(result);assert.equal(q.get('from'),'2026-02-19');assert.equal(q.get('to'),'2026-02-28');
});
