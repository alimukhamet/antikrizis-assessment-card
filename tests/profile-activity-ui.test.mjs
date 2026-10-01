import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
const ordering={};vm.runInNewContext(ts.transpileModule(await readFile('lib/crm/profile-queue-order.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:ordering});

test('profile queue shows coworkers, skips occupied work, updates completions and filters in-progress',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid/profile-backfill',pretendToBeVisual:true});
 const previous={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const items=[3,2,1].map(i=>({dealId:'90000'+i,title:'SYNTHETIC '+i,stageName:'ЗВИ',zviDate:'2026-09-0'+i,procedure:'',hasIin:true,hasLegacyCard:false,profileSavedAt:''}));
 const activity={currentWorker:'azhar',active:[{dealId:'900001',workerId:'ramazan',workerName:'Ramazan'}],completed:[],workers:[{workerId:'ramazan',workerName:'Ramazan',done:0,inProgress:1},{workerId:'azhar',workerName:'Azhar',done:0,inProgress:0}]};
 const timers=[],calls=[];
 const context=vm.createContext({exports:{},window:dom.window,document:dom.window.document,Intl,Date,AbortController,setInterval:f=>(timers.push(f),timers.length),clearInterval:()=>{},fetch:async path=>{calls.push(path);return {ok:true,json:async()=>path==='/api/profile-queue'?{items}:structuredClone(activity)};},require:n=>{if(n==='react')return React;if(n==='../../lib/crm/profile-queue-order')return ordering;throw Error(n);}});
 const source=await readFile('app/profile-backfill/ProfileQueue.tsx','utf8');
 vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText.replace('"use strict";','"use strict"; const React = require("react");'),context);
 const root=createRoot(document.getElementById('root'));
 try{
  await act(async()=>root.render(React.createElement(context.exports.ProfileQueue)));
  assert.deepEqual([...document.querySelectorAll('.profile-queue-name strong')].map(n=>n.textContent),['SYNTHETIC 1','SYNTHETIC 2','SYNTHETIC 3']);
  assert.equal(document.querySelector('.profile-queue-next').getAttribute('href'),'/profile-backfill?dealId=900002');
  const busy=document.querySelector('.profile-queue-list a[aria-disabled=true]');assert.match(busy.textContent,/В работе: Ramazan/);assert.equal(busy.hasAttribute('href'),false);
  await act(async()=>[...document.querySelectorAll('.profile-queue-tools button')].find(b=>b.textContent==='В работе').click());
  assert.equal(document.querySelectorAll('.profile-queue-list li').length,1);
  activity.active=[];activity.completed=[{dealId:'900001',workerId:'ramazan',workerName:'Ramazan',savedAt:'2026-09-29T08:00:00Z'}];activity.workers[0]={...activity.workers[0],done:1,inProgress:0};
  await act(async()=>timers[0]());
  assert.equal(document.querySelectorAll('.profile-queue-list li').length,0);
  assert.equal(document.querySelector('.profile-team-worker strong').textContent,'1');
  assert.equal(calls.filter(p=>p==='/api/profile-queue').length,1,'polling does not repeatedly read the Bitrix queue');
  await act(async()=>[...document.querySelectorAll('.profile-queue-tools button')].find(b=>b.textContent==='Заполнены').click());
  assert.equal(document.querySelectorAll('.profile-queue-list li').length,1);
  assert.match(document.querySelector('.profile-queue-progress').textContent,/1 из 3/);
  activity.completed=[];activity.workers[0].done=0;
  await act(async()=>timers[0]());
  await act(async()=>[...document.querySelectorAll('.profile-queue-tools button')].find(b=>b.textContent==='Не заполнены').click());
  assert.equal(document.querySelector('.profile-queue-name strong').textContent,'SYNTHETIC 1','a reopened older profile returns to its date priority');
  assert.equal(document.querySelector('.profile-queue-next').getAttribute('href'),'/profile-backfill?dealId=900001');
 }finally{await act(async()=>root.unmount());dom.window.close();globalThis.window=previous.window;globalThis.document=previous.document;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.act;}
});

test('profile tab announces presence, warns about another worker and releases after save or closing',async t=>{
 const dom=new JSDOM('<main><section id="documentStep"></section></main>',{url:'https://synthetic.invalid/questionnaire.html?mode=profile&dealId=900001',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,calls=[];
 w.fetch=async(path,options)=>{const body=JSON.parse(options.body);calls.push({path,...body});return {ok:true,json:async()=>({currentWorker:'azhar',active:[{dealId:'900001',workerId:'ramazan',workerName:'Ramazan'}]})};};
 vm.runInContext(await readFile('public/profile-presence.js','utf8'),dom.getInternalVMContext());
 await new Promise(r=>setTimeout(r,10));
 w.dispatchEvent(new w.Event('focus'));w.dispatchEvent(new w.Event('pageshow'));
 assert.equal(calls.length,0,'a URL without a successfully loaded profile must not claim presence');
 assert.equal(w.document.getElementById('profilePresence'),null);
 w.ProfilePresence.start('900001');
 await new Promise(r=>setTimeout(r,10));
 assert.equal(calls[0].action,'heartbeat');assert.match(w.document.getElementById('profilePresence').textContent,/Ramazan/);
 w.document.dispatchEvent(new w.Event('profile-backfill-saved'));await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.at(-1).action,'release');assert.equal(w.document.getElementById('profilePresence').hidden,true);
 const before=calls.length;w.dispatchEvent(new w.Event('focus'));await new Promise(r=>setTimeout(r,10));assert.equal(calls.length,before,'saved profile does not become in-progress again');
 w.document.dispatchEvent(new w.Event('profile-backfill-editing'));await new Promise(r=>setTimeout(r,10));assert.equal(calls.at(-1).action,'heartbeat','editing a saved profile resumes presence for the same deal');assert.equal(calls.at(-1).dealId,'900001');
 w.dispatchEvent(new w.Event('pagehide'));await new Promise(r=>setTimeout(r,10));assert.equal(calls.at(-1).action,'release');
 assert.ok(calls.every(c=>c.path==='/api/profile-activity'),'no client or CRM writes');
});
