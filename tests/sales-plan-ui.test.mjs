import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';

async function mount(t,post,canChoosePerson=true){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://site.test/my-results'});
 const previous={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const report={person:'ramazan',canChoosePerson,name:'Рамазан',periods:[],futurePlans:[],earningsMonths:[],payments:[],earned:0,paid:null,owed:null,today:'2026-10-02',generatedAt:'2026-10-02T10:00:00Z'};
 const requests=[];
 const context=vm.createContext({exports:{},Intl,Date,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,FormData:dom.window.FormData,
  fetch:async(url,options)=>{if(options?.method==='POST'){const body=JSON.parse(options.body);requests.push(body);return post(body,requests.length);}return{ok:true,json:async()=>report};},
  require:name=>name==='react'?React:name==='next/link'?{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}:(()=>{throw Error(name);})()});
 const source=await readFile(new URL('../app/PersonalSales.tsx',import.meta.url),'utf8');
 vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText.replace('"use strict";','"use strict"; const React = require("react");'),context);
 const root=createRoot(document.getElementById('root'));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();globalThis.window=previous.window;globalThis.document=previous.document;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.act;});
 await act(async()=>root.render(React.createElement(context.exports.default,{mode:'results'})));
 const open=async()=>{await act(async()=>document.querySelector('.ps-action').click());for(const [key,value] of Object.entries({start:'2026-10-03',end:'2026-10-31',target:'12000000',baseRate:'1.5',targetRate:'2'}))document.querySelector(`[name="${key}"]`).value=value;};
 const submit=()=>act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 return{requests,open,submit,report};
}
const success=()=>({ok:true,status:201,json:async()=>({ok:true})});

test('enter terms once, select any employees or all, and send one full target',async t=>{
 const {requests,open,submit}=await mount(t,success);await open();
 const selected=()=>[...document.querySelectorAll('[name="people"]:checked')].map(input=>input.value);
 assert.deepEqual(selected(),['ramazan']);
 await act(async()=>document.querySelector('[name="people"][value="ramazan"]').click());
 assert.equal(document.querySelector('.ps-entry-actions button:last-child').disabled,true);
 await submit();assert.equal(requests.length,0);
 await act(async()=>document.querySelector('.ps-plan-people button').click());
 assert.deepEqual(selected(),['darkhan','ramazan','nurdaulet']);
 await act(async()=>document.querySelector('[name="people"][value="nurdaulet"]').click());
 await submit();assert.equal(requests.length,1);
 assert.deepEqual(requests[0].people,['darkhan','ramazan']);assert.equal(requests[0].kind,'plans');assert.equal(requests[0].target,12000000);assert.equal(requests[0].person,undefined);
 assert.equal(document.querySelector('form'),null);
});
test('lost response keeps the exact selection and terms locked for a safe retry',async t=>{
 const {requests,open,submit}=await mount(t,(_body,attempt)=>{if(attempt===1)throw Error('Connection lost');return success();});await open();
 await act(async()=>document.querySelector('.ps-plan-people button').click());
 await submit();assert.equal(document.querySelector('.ps-entry-fields').disabled,true);
 assert.equal(document.querySelector('.rop-people button').disabled,true);
 assert.equal(document.querySelector('.ps-entry-actions button').disabled,true);
 assert.equal(document.querySelector('.ps-entry-actions button:last-child').textContent,'Проверить сохранение');
 await submit();assert.deepEqual(requests[1],requests[0]);assert.equal(document.querySelector('form'),null);
});
test('overlap identifies the employee and preserves typed terms for correcting selection',async t=>{
 const {requests,open,submit}=await mount(t,(_body,attempt)=>attempt===1?{ok:false,status:409,json:async()=>({error:'PLAN_OVERLAPS_EXISTING',people:['ramazan']})}:success());await open();
 await act(async()=>document.querySelector('.ps-plan-people button').click());await submit();
 assert.match(document.querySelector('[role="alert"]').textContent,/Период уже занят: Рамазан/);
 assert.equal(document.querySelector('.ps-entry-fields').disabled,false);assert.equal(document.querySelector('[name="target"]').value,'12000000');
 await act(async()=>document.querySelector('[name="people"][value="ramazan"]').click());await submit();
 assert.deepEqual(requests[1].people,['darkhan','nurdaulet']);assert.equal(requests[1].target,12000000);
});
test('payments stay single-person and employees have no plan-writing controls',async t=>{
 const {requests,submit}=await mount(t,success);
 await act(async()=>document.querySelectorAll('.rop-nav button')[1].click());
 await act(async()=>document.querySelector('.ps-action').click());
 assert.equal(document.querySelector('.ps-plan-people'),null);assert.match(document.querySelector('h3').textContent,/Выплата · Рамазан/);
 document.querySelector('[name="amount"]').value='100000';await submit();assert.equal(requests[0].kind,'payment');assert.equal(requests[0].person,'ramazan');assert.equal(requests[0].people,undefined);
});
test('employee view never exposes plan creation',async t=>{await mount(t,success,false);assert.equal(document.querySelector('.ps-action'),null);});
test('earned first-place bonus has its own line and does not become a recorded payment',async t=>{
 const {report}=await mount(t,success);
 report.earningsMonths=[{id:'2026-09',ongoing:false,baseSalary:100000,contractBonus:0,leaderBonus:100000,commission:40000,performanceCommission:40000,earned:240000,count:4,volume:2000000,missing:0,paid:null,owed:null,periods:[],commissionDeals:[]}];report.earned=240000;
 await act(async()=>document.querySelectorAll('.rop-nav button')[1].click());
 const row=[...document.querySelectorAll('.ps-sum-row')].find(row=>row.textContent.includes('Бонус за 1-е место'));
 assert.match(row.textContent,/100.000 ₸/);assert.match(document.querySelector('.ps-overall').textContent,/Начислено240.000 ₸/);
 await act(async()=>document.querySelectorAll('.ps-overall button')[1].click());
 assert.equal(document.querySelectorAll('.ps-payment-row').length,0);assert.match(document.querySelector('#ps-earnings-history').textContent,/Выплаты не подтверждены/);
});
test('current plan shows both commission tiers and the unawarded first-place prize',async t=>{
 const {report}=await mount(t,success);
 report.periods=[{id:'synthetic-plan',start:'2026-10-01',end:'2026-10-21',target:12000000,metric:'volume',tiers:[[0,1.5],[12000000,2]],leaderBonus:100000,count:0,volume:0,missing:0,progress:0,remaining:12000000,ongoing:true}];
 await act(async()=>document.querySelectorAll('.rop-nav button')[1].click());await act(async()=>document.querySelectorAll('.rop-nav button')[0].click());
 assert.match(document.querySelector('.ps-current').textContent,/До цели — 1,5% · При выполнении — 2%/);
 assert.match(document.querySelector('.ps-current').textContent,/За 1-е место — 100.000 ₸ · итоги после 21 октября/);
});
