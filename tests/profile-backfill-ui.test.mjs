/** Browser-level check of the documentologist profile mode. Synthetic data only. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const html=fs.readFileSync('public/questionnaire.html','utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));

async function setup(t,{mode='profile',draftSaveFails=false,check={ready:false,issues:[{key:'regAddress',code:'ANSWER_REQUIRED',label:'Адрес прописки*'}],unresolved:[]}}={}){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html'+(mode?'?mode='+mode:''),runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,run=code=>vm.runInContext(code,dom.getInternalVMContext()),calls=[],errors=[];
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener('error',event=>errors.push(event.error));
 const context={caseId:'case',identityRevision:1,assessmentDay:'2026-09-25',client:{title:'SYNTHETIC CLIENT',iin:'000000000010',external:{system:'bitrix',dealId:'900001'}}};
 const profile={dealId:'900001',title:'SYNTHETIC CLIENT',iin:'000000000010',zviDate:'2026-09-01',procedure:'199',phone:'+7 700 000 00 01',legacyCard:'SYNTHETIC LEGACY CARD',current:{fio:'SYNTHETIC CLIENT FULL',marital:'В браке'},active:null,latest:null};
 w.fetch=async(path,options={})=>{
  calls.push({path,method:options.method||'GET',body:options.body});let result;
  if(draftSaveFails&&path.endsWith('/draft')&&options.method==='POST')return{ok:false,status:409,json:async()=>({error:'DRAFT_CHANGED'})};
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

for(const mode of ['', 'profile'])test(`${mode || 'contract'} actual address follows the choice and survives draft restore`,async t=>{
 const s=await setup(t,{mode});await s.load();const {d,w}=s;
 const choice=d.getElementById('factAddressSame'),field=d.getElementById('factAddressField'),address=d.getElementById('factAddress');
 choice.value='other';choice.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(field.classList.contains('hidden'),false,'a different residence must expose its input');
 address.value='SYNTHETIC ACTUAL ADDRESS';
 const payload=w.ServerDrafts.capture();
 for(const value of ['same','unknown','']){
  choice.value=value;choice.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(field.classList.contains('hidden'),true);
  assert.equal(address.value,'SYNTHETIC ACTUAL ADDRESS','toggling the choice must preserve entered text');
 }
 // Discard only this isolated synthetic screen state before restoring the saved payload.
 await w.ServerDrafts.restore({automatic:true,draft:{revision:3,identityRevision:1,payload}});
 assert.equal(choice.value,'other');
 assert.equal(field.classList.contains('hidden'),false,'restored other-address answers must be editable');
 assert.equal(address.value,'SYNTHETIC ACTUAL ADDRESS');
});

test('profile mode hides the contract, prefills from Bitrix, shows the old card and imports deal documents',async t=>{
 const s=await setup(t);await s.load();
 const {d,w,calls}=s;
 assert.ok(d.body.hasAttribute('data-profile-backfill'));
 assert.equal(d.body.dataset.uxMode,'contract');
 assert.ok(d.getElementById('dognum').closest('section.card').hasAttribute('data-profile-hidden'));
 assert.ok(d.getElementById('profileOnly').hasAttribute('data-profile-hidden'));
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

test('profile reuses the contract form with phone and three addresses, without family or extra contact questions',async t=>{
 const s=await setup(t);await s.load();
 const {d,w}=s;d.getElementById('count-profilefamily').value='1';d.getElementById('count-profilefamily').dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
 const phone=d.getElementById('clientPhone'),addresses=d.getElementById('regAddress').closest('section.card');
 assert.equal(phone.closest('section.card'),d.getElementById('fio').closest('section.card'));
 assert.notEqual(w.getComputedStyle(phone.closest('.field')).display,'none');
 assert.equal(phone.required,false,'the existing contact does not become a new save gate');
 for(const id of ['factAddressSame','factAddress','filingDestination'])assert.equal(d.getElementById(id).closest('section.card'),addresses,id);
 for(const id of ['profilefamily','contactChannel','postAddress'])assert.ok(d.getElementById(id).closest('[data-profile-hidden]'),id);
 const spouseStatus=d.getElementById('partnerSocialStatusField');
 assert.equal(spouseStatus.closest('[data-profile-hidden]'),null,'married profile keeps the shared spouse status block available');
 assert.notEqual(w.getComputedStyle(spouseStatus).display,'none','married profile shows the shared spouse status block');
 assert.equal(d.getElementById('partnerSocialStatusRequired').hidden,true,'profile keeps spouse status optional');
 assert.equal(d.querySelector('input[type="email"]'),null);
 const suggestions=d.getElementById('recommendedCourt').closest('details');
 assert.ok(suggestions.classList.contains('pb-address-details'));
 assert.equal(suggestions.open,false);
 assert.equal(d.querySelectorAll('#filingDestination').length,1);
 assert.equal(d.querySelectorAll('#clientPhone').length,1);
 const saved=w.ServerDrafts.capture();
 assert.ok(saved.groups.find(group=>group.id==='profilefamily').rows.length===1,'legacy rows stay in drafts');
});

test('profile unknown addresses survive saved-draft restore and stay explicit',async t=>{
 const s=await setup(t);await s.load();const {d,w}=s;
 for(const id of ['regAddress','filingDestination'])d.getElementById(id).value='Не знаю';
 d.getElementById('factAddressSame').value='unknown';
 const payload=w.ServerDrafts.capture();
 for(const id of ['regAddress','filingDestination','factAddressSame','clientPhone'])d.getElementById(id).value='';
 await w.ServerDrafts.restore({draft:{revision:2,identityRevision:1,payload},automatic:true});
 for(const id of ['regAddress','filingDestination'])assert.equal(d.getElementById(id).value,'Не знаю',id);
 assert.equal(d.getElementById('factAddressSame').value,'unknown');
 const restored=w.ServerDrafts.capture();
 for(const key of ['regAddress','factAddressSame','filingDestination','clientPhone'])assert.equal(restored.answers.find(answer=>answer.key===key).value,payload.answers.find(answer=>answer.key===key).value,key);
});

test('profile explanation prompts show the hard minimum and restore partial text without an unknown shortcut',async t=>{
 const s=await setup(t);await s.load();const {d,w}=s;
 w.AssessmentWorkflow.show('answers',{focus:false});
 const purpose=d.getElementById('debtPurposeOther'),hardship=d.getElementById('n12008'),reason=d.getElementById('hardshipReason');
 assert.ok(!d.getElementById('debtPurposeOtherField').classList.contains('hidden'),'the explanation is visible without Other');
 assert.match(purpose.closest('.field').textContent,/кто пользовался деньгами/);
 assert.match(hardship.closest('.field').textContent,/месяц\/год/);
 for(const field of [purpose,hardship]){
  assert.equal(field.minLength,30);
  assert.equal(field.closest('.field').querySelector('.pb-unknown,[data-unknown],[data-legacy-unknown]'),null);
 }
 const original='Кредитные деньги потратили на покупку жилья для проживания семьи клиента.';
 purpose.value=(original.slice(0,28)+'.')+' \n ';purpose.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.match(d.getElementById('debtPurposeOtherCount').textContent,/29 \/ 30.*ещё 1/);
 assert.equal(purpose.validity.customError,true);
 const draft=w.ServerDrafts.capture();purpose.value='';
 await w.ServerDrafts.restore({draft:{revision:2,identityRevision:1,payload:draft},automatic:true});
 assert.equal(purpose.value,(original.slice(0,28)+'.')+' \n ');
 assert.equal(purpose.validity.customError,true);
 assert.match(d.getElementById('debtPurposeOtherCount').textContent,/29 \/ 30/);
 purpose.value=original.slice(0,29)+'.';purpose.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(purpose.validity.customError,false);
 assert.match(d.getElementById('debtPurposeOtherCount').textContent,/30 \/ 30/);
 reason.value='Снижение дохода';reason.dispatchEvent(new w.Event('change',{bubbles:true}));
 const unicode='Доход с января упал 🏠 на треть';
 for(const field of [purpose,hardship])for(const length of [29,30]){
  field.value='\u00a0'+Array.from(unicode).slice(0,length).join('').replaceAll(' ',' \u2003\n ')+'\u00a0';
  field.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(field.validity.customError,length===29,field.id+': normalized Unicode boundary');
  assert.match(d.getElementById(field.id+'Count').textContent,new RegExp(length+' / 30'));
 }
 hardship.value='Не знаю';hardship.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(hardship.validity.customError,true);
 hardship.value='С марта сократились рабочие часы и доход. После оплаты жилья денег на платежи не хватает.';
 hardship.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(hardship.validity.customError,false);
 reason.value='Платежи вношу, трудностей нет';reason.dispatchEvent(new w.Event('change',{bubbles:true}));
 hardship.value='';hardship.dispatchEvent(new w.Event('input',{bubbles:true}));
 assert.equal(hardship.validity.customError,false,'hidden inapplicable details do not block');
});

test('a failed draft save stops profile publication and retains entered answers',async t=>{
 const s=await setup(t,{draftSaveFails:true,check:{ready:true,issues:[],unresolved:[]}});await s.load();
 const {d,w,calls}=s;d.getElementById('regAddress').value='SYNTHETIC UNSAVED ADDRESS';
 d.getElementById('regAddress').dispatchEvent(new w.Event('input',{bubbles:true}));
 await w.ProfileBackfill.save();
 assert.equal(d.getElementById('regAddress').value,'SYNTHETIC UNSAVED ADDRESS');
 assert.match(d.getElementById('profileSavePanel').textContent,/Черновик не сохранён/);
 assert.ok(!calls.some(call=>call.path.endsWith('/profile')&&call.method==='POST'),'no profile check or publication follows the rejected draft');
});

test('built Worker protects the profile queue page and its APIs; signed-in page renders the queue',async()=>{
 const {session,TEST_SECRET}=await import('./session-helper.mjs');
 const {default:worker}=await import('../dist/server/index.js');
 const env={SITE_SESSION_TOKEN:TEST_SECRET,ASSETS:{fetch:async()=>new Response('',{status:404})}},ctx={waitUntil(){},passThroughOnException(){}};
 for(const path of ['/profile-backfill','/profile-backfill?dealId=11665','/profile-backfill?dealId=11665&edit=1','/api/profile-queue','/api/assessment/11665/profile']){
  const response=await worker.fetch(new Request('https://site.test'+path),env,ctx);
  assert.equal(response.status,path.startsWith('/api/')?401:303,path);
 }
 const unauthEdit=await worker.fetch(new Request('https://site.test/profile-backfill?dealId=11665&edit=1'),env,ctx);assert.match(decodeURIComponent(unauthEdit.headers.get('location')||''),/dealId=11665&edit=1/);
 const cookie=session.SESSION_COOKIE+'='+await session.issueSession('darkhan',TEST_SECRET);
 const previous=process.env.SITE_SESSION_TOKEN;process.env.SITE_SESSION_TOKEN=TEST_SECRET; // pages read the secret from process.env
 try{
 const page=await worker.fetch(new Request('https://site.test/profile-backfill',{headers:{cookie}}),env,ctx);
 assert.equal(page.status,200);assert.match(page.headers.get('cache-control'),/no-store/);assert.match(await page.text(),/Дозаполнить профили клиентов/);
 const frame=await worker.fetch(new Request('https://site.test/profile-backfill?dealId=11665&edit=1',{headers:{cookie}}),env,ctx);
 assert.match(await frame.text(),/questionnaire\.html\?dealId=11665&amp;mode=profile&amp;edit=1/);
 }finally{if(previous===undefined)delete process.env.SITE_SESSION_TOKEN;else process.env.SITE_SESSION_TOKEN=previous;}
});
