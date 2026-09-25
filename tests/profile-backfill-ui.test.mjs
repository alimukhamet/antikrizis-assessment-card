/** Browser-level check of the documentologist profile mode. Synthetic data only. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync('public/questionnaire.html','utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));

async function setup(t,{mode='profile',check={ready:false,issues:[{key:'regAddress',code:'ANSWER_REQUIRED',label:'Адрес прописки*'}],unresolved:[]}}={}){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html'+(mode?'?mode='+mode:''),runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext()),calls=[],errors=[];
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener('error',event=>errors.push(event.error));
 const context={caseId:'case',identityRevision:1,assessmentDay:'2026-09-25',client:{title:'SYNTHETIC CLIENT',iin:'000000000010',external:{system:'bitrix',dealId:'900001'}}};
 const profile={dealId:'900001',title:'SYNTHETIC CLIENT',iin:'000000000010',zviDate:'2026-09-01',procedure:'199',phone:'+7 700 000 00 01',legacyCard:'SYNTHETIC LEGACY CARD',fieldsReady:true,current:{fio:'SYNTHETIC CLIENT FULL',marital:'В браке',profileAt:''},active:null,latest:null};
 w.fetch=async(path,options={})=>{
  calls.push({path,method:options.method||'GET',body:options.body});let result;
  if(path==='/api/assessment/900001')result=context;
  else if(path==='/api/assessment/clients')result={drafts:[],recent:[]};
  else if(path.endsWith('/draft')){result=options.method==='POST'?{revision:2,latestRevision:2}:{draft:null};}
  else if(path.endsWith('/submission'))result={submission:null};
  else if(path.endsWith('/uploads'))result={unsent:null};
  else if(path.endsWith('/credentials'))result={credentials:{verified:false},identityRevision:1};
  else if(path.endsWith('/crm-documents'))result={files:[]};
  else if(path.endsWith('/profile')&&options.method!=='POST')result=profile;
  else if(path.endsWith('/profile'))result=check;
  else if(path.endsWith('/handoff'))result={handoff:null};
  else throw Error('Unexpected request '+path);
  return{ok:true,status:200,json:async()=>result};
 };
 for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  if(match[1].includes('type="module"'))continue;
  const src=match[1].match(/src="([^"]+)"/);run(src?fs.readFileSync('public/'+src[1].replace(/^\//,''),'utf8'):match[2]);
 }
 t.after(()=>{w.close();assert.deepEqual(errors,[]);});
 await tick();
 return{w,d,run,calls,async load(){d.getElementById('hostDealId').value='900001';await d.getElementById('hostLoadDeal').onclick();await tick();await tick();}};
}

test('sales mode keeps the profile section hidden and has no profile panel',async t=>{
 const s=await setup(t,{mode:''});
 assert.equal(s.w.ProfileBackfill,null);
 assert.ok(s.d.getElementById('profileOnly').classList.contains('hidden'));
 assert.equal(s.d.getElementById('profileSavePanel'),null);
 assert.equal(s.d.body.hasAttribute('data-profile-backfill'),false);
});

test('profile mode hides the contract, prefills from Bitrix, shows the old card and imports deal documents',async t=>{
 const s=await setup(t);await s.load();
 const {d,w,calls}=s;
 assert.ok(d.body.hasAttribute('data-profile-backfill'));
 assert.equal(d.body.dataset.uxMode,'contract');
 assert.ok(d.getElementById('dognum').closest('section.card').hasAttribute('data-profile-hidden'));
 assert.equal(d.getElementById('profileOnly').classList.contains('hidden'),false);
 assert.ok(d.querySelector('.wf-final-actions #profileSavePanel'));
 assert.equal(d.querySelector('.ux-page-title').textContent,'Профиль клиента');
 assert.equal(d.getElementById('fio').value,'SYNTHETIC CLIENT FULL');
 assert.equal(d.getElementById('clientPhone').value,'+7 700 000 00 01');
 assert.equal(d.getElementById('marital').value,'В браке');
 assert.equal(d.getElementById('procedure').value,'199');
 assert.match(d.getElementById('profileContext').textContent,/SYNTHETIC LEGACY CARD/);
 assert.ok(calls.some(c=>c.path.endsWith('/crm-documents')&&c.method==='GET'),'Deal documents are imported automatically');
 // Answers are reachable without the full sales document package.
 assert.equal(w.AssessmentWorkflow.show('answers',{focus:false}),true);
 assert.equal(d.body.dataset.assessmentWorkflow,'answers');
 assert.ok(!calls.some(c=>c.method==='POST'&&/\/(submission|profile)$/.test(c.path)),'Opening a deal never writes');
});

test('«Не знаю» fills an open answer and the check lists missing answers without saving',async t=>{
 const s=await setup(t);await s.load();
 const {d,calls}=s,reg=d.getElementById('regAddress');
 reg.nextElementSibling.click();assert.equal(reg.value,'Не знаю');
 const panel=d.getElementById('profileSavePanel'),[check]=panel.querySelectorAll('button');
 check.click();await tick();
 const sent=calls.filter(c=>c.path.endsWith('/profile')&&c.method==='POST').map(c=>JSON.parse(c.body));
 assert.equal(sent.length,1);assert.equal(sent[0].action,'check');
 assert.match(panel.textContent,/Не хватает ответов: 1/);
 assert.equal(panel.querySelectorAll('.pb-issues li').length,1);
});

test('birth dates are typed as digits and formatted',async t=>{
 const s=await setup(t);await s.load();
 const {d,w}=s;d.getElementById('count-profilefamily').value='1';d.getElementById('count-profilefamily').dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 const input=d.querySelector('#profilefamily .repeat-rows input[data-profile-date]');
 input.value='01022015';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(input.value,'01.02.2015');
});

test('built Worker protects the profile queue page and its APIs; signed-in page renders the queue',async()=>{
 const {session,TEST_SECRET}=await import('./session-helper.mjs');
 const {default:worker}=await import('../dist/server/index.js');
 const env={SITE_SESSION_TOKEN:TEST_SECRET,ASSETS:{fetch:async()=>new Response('',{status:404})}},ctx={waitUntil(){},passThroughOnException(){}};
 for(const path of ['/profile-backfill','/profile-backfill?dealId=11665','/api/profile-queue','/api/profile-fields','/api/assessment/11665/profile']){
  const response=await worker.fetch(new Request('https://site.test'+path),env,ctx);
  assert.equal(response.status,path.startsWith('/api/')?401:303,path);
 }
 const cookie=session.SESSION_COOKIE+'='+await session.issueSession('darkhan',TEST_SECRET);
 const previous=process.env.SITE_SESSION_TOKEN;process.env.SITE_SESSION_TOKEN=TEST_SECRET; // pages read the secret from process.env
 try{
 const page=await worker.fetch(new Request('https://site.test/profile-backfill',{headers:{cookie}}),env,ctx);
 assert.equal(page.status,200);assert.match(page.headers.get('cache-control'),/no-store/);assert.match(await page.text(),/Дозаполнить профили клиентов/);
 const frame=await worker.fetch(new Request('https://site.test/profile-backfill?dealId=11665',{headers:{cookie}}),env,ctx);
 assert.match(await frame.text(),/questionnaire\.html\?dealId=11665&amp;mode=profile/);
 }finally{if(previous===undefined)delete process.env.SITE_SESSION_TOKEN;else process.env.SITE_SESSION_TOKEN=previous;}
});
