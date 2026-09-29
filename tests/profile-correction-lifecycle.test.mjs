/** Synthetic browser lifecycle checks for editable profile saves. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const html=fs.readFileSync('public/questionnaire.html','utf8');
const tick=(ms=35)=>new Promise(resolve=>setTimeout(resolve,ms));
const verified={state:'verified',unresolvedCount:0,historySaved:true};

async function setup(t,{latest=null,profileSaves=[],reconciles=[],draftSaveFails=false,holdCheck=false,holdConfirm=false,holdSave=false,edit=false,savedDraft=false,savedDraftAnswer='SYNTHETIC LATER DRAFT'}={}){
 const query=new URLSearchParams({mode:'profile'});if(edit)query.set('edit','1');
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html?'+query,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document;
 const calls=[],errors=[],intervals=[],timeouts=[];let saveIndex=0,reconcileIndex=0,releaseCheck=null,checkStartedResolve,releaseConfirm=null,confirmStartedResolve,releaseSave=null,saveStartedResolve;
 const setInterval=w.setInterval.bind(w),setTimeout=w.setTimeout.bind(w);w.setInterval=(...args)=>{const id=setInterval(...args);intervals.push(id);return id;};w.setTimeout=(...args)=>{const id=setTimeout(...args);timeouts.push(id);return id;};
 const saveStarted=new Promise(resolve=>{saveStartedResolve=resolve;});
 const checkStarted=new Promise(resolve=>{checkStartedResolve=resolve;});
 const confirmStarted=new Promise(resolve=>{confirmStartedResolve=resolve;});
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getClientRects=function(){return this.isConnected&&!this.closest('.hidden,[hidden]')?[{}]:[];};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.addEventListener('error',event=>errors.push(event.error));
 const context={caseId:'case',identityRevision:1,assessmentDay:'2026-09-25',client:{title:'SYNTHETIC CLIENT',iin:'000000000010',external:{system:'bitrix',dealId:'900001'}}};
 const profile={dealId:'900001',title:'SYNTHETIC CLIENT',iin:'000000000010',zviDate:'2026-09-01',procedure:'199',phone:'+7 700 000 00 01',legacyCard:'SYNTHETIC LEGACY CARD',current:{fio:'SYNTHETIC CLIENT FULL',marital:'В браке'},active:null,latest};
 const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
 w.fetch=async(path,options={})=>{
  const method=options.method||'GET';let body=null;try{body=options.body?JSON.parse(options.body):null;}catch{/* file requests are outside this fixture */}
  calls.push({path,method,body});
  if(path==='/api/assessment/900001')return response(context);
  if(path==='/api/assessment/clients')return response({drafts:[],recent:[]});
  if(path==='/api/profile-activity')return response({currentWorker:'azhar',active:[]});
  if(path==='/api/profile-queue')return response({items:[]});
  if(path.endsWith('/draft')){
   if(draftSaveFails&&method==='POST')return response({error:'DRAFT_CHANGED'},409);
   return response(method==='POST'?{revision:2,latestRevision:2}:savedDraft?{draft:{revision:2,identityRevision:1,payload:{schemaVersion:1,answers:[{key:'regAddress',value:savedDraftAnswer,checked:false}],groups:[],docContext:{social:'',salary:'',salaryBank:'',enpf:''},documents:[],pendingFiles:[]}}}:{draft:null});
  }
  if(path.endsWith('/submission'))return response({submission:null});
  if(path.endsWith('/uploads'))return response({unsent:null});
  if(path.endsWith('/credentials'))return response({credentials:{verified:false},identityRevision:1});
  if(path.endsWith('/crm-documents'))return response({files:[]});
  if(path.endsWith('/profile')&&method!=='POST')return response(profile);
  if(path.endsWith('/profile')){
   if(body.action==='check'){
    checkStartedResolve(body);
    if(holdCheck)await new Promise(resolve=>{releaseCheck=resolve;});
    return response({ready:true,issues:[],unresolved:[]});
   }
   if(body.action==='save'){
    saveStartedResolve(body);
    if(holdSave)await new Promise(resolve=>{releaseSave=resolve;});
    const result=profileSaves[saveIndex++]??verified;
    if(result==='transport-lost')throw Error('CONNECTION_LOST');
    return response(typeof result==='function'?await result(body,saveIndex):result,result?.status||200);
   }
   if(body.action==='reconcile'){
    const result=reconciles[reconcileIndex++]??verified;
    return response(typeof result==='function'?await result(body,reconcileIndex):result,result?.status||200);
   }
  }
  if(path.endsWith('/handoff'))return response({handoff:null});
  throw Error('Unexpected request '+path);
 };
 for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  if(match[1].includes('type="module"'))continue;
  const src=match[1].match(/src="([^"]+)"/);vm.runInContext(src?fs.readFileSync('public/'+src[1].replace(/^\//,''),'utf8'):match[2],dom.getInternalVMContext());
 }
 // The real confirmation dialog is an identity gate; this fixture keeps that
 // gate successful so the assertions exercise the profile lifecycle itself.
 w.ClientContextUI.confirm=async()=>{confirmStartedResolve();if(holdConfirm)await new Promise(resolve=>{releaseConfirm=resolve;});return true;};
 w.ClientWorkspace.importDocuments=async()=>{};
 t.after(()=>{intervals.forEach(id=>w.clearInterval(id));timeouts.forEach(id=>w.clearTimeout(id));w.close();assert.deepEqual(errors,[]);});
 await tick(80);
 return {w,d,calls,async load(){d.getElementById('hostDealId').value='900001';await d.getElementById('hostLoadDeal').onclick();await tick(80);await tick(80);},checkStarted,releaseCheck:()=>releaseCheck?.(),confirmStarted,releaseConfirm:()=>releaseConfirm?.(),saveStarted,releaseSave:()=>releaseSave?.()};
}

function setAnswer(s,id,value){const input=s.d.getElementById(id);input.value=value;input.dispatchEvent(new s.w.Event('input',{bubbles:true}));return input;}
function action(s,text){return [...s.d.querySelectorAll('#profileSavePanel button')].find(button=>button.textContent===text);}
function profilePosts(s,actionName){return s.calls.filter(call=>call.path.endsWith('/profile')&&call.method==='POST'&&(!actionName||call.body.action===actionName));}

test('verified save exposes edit mode and a second save publishes the edited snapshot',async t=>{
 const s=await setup(t,{profileSaves:[verified,verified]});await s.load();
 setAnswer(s,'regAddress','SYNTHETIC ADDRESS A');await s.w.ProfileBackfill.save();
 const panel=s.d.getElementById('profileSavePanel'),edit=action(s,'Изменить факты'),save=action(s,'Сохранить изменения');
 assert.equal(edit.hidden,false);assert.equal(save.hidden,true);assert.match(panel.textContent,/Профиль сохранён в Bitrix/);
 assert.ok([...s.d.querySelectorAll('button')].some(button=>button.textContent.includes('Следующая сделка')));
 edit.click();await tick();s.w.AssessmentWorkflow.show('contract',{focus:false});assert.equal(save.hidden,false);assert.equal(edit.hidden,true);assert.ok([...s.d.querySelectorAll('button')].some(button=>!button.closest('#profileSavePanel')&&button.textContent.includes('Сохранить изменения')));
 setAnswer(s,'regAddress','SYNTHETIC ADDRESS B');await s.w.ProfileBackfill.save();
 const saves=profilePosts(s,'save');assert.equal(saves.length,2);assert.equal(saves[0].body.draft.answers.find(a=>a.key==='regAddress').value,'SYNTHETIC ADDRESS A');assert.equal(saves[1].body.draft.answers.find(a=>a.key==='regAddress').value,'SYNTHETIC ADDRESS B');
 assert.equal(action(s,'Изменить факты').hidden,false);assert.equal(action(s,'Сохранить изменения').hidden,true);
});

test('the next action rechecks the snapshot even when a correction had no DOM event',async t=>{
 const s=await setup(t,{profileSaves:[verified]});await s.load();setAnswer(s,'regAddress','SYNTHETIC BASE');await s.w.ProfileBackfill.save();
 s.d.getElementById('regAddress').value='SYNTHETIC SILENT';await s.w.ProfileBackfill.save();
 assert.equal(action(s,'Изменить факты').hidden,true);assert.equal(action(s,'Сохранить изменения').hidden,false);assert.equal(s.calls.some(call=>call.path==='/api/profile-queue'),false);
});

test('an edit during the in-flight save keeps the receipt separate from current answers',async t=>{
 const s=await setup(t,{profileSaves:[verified],holdSave:true});await s.load();setAnswer(s,'regAddress','SYNTHETIC BEFORE');
 const saving=s.w.ProfileBackfill.save();await Promise.race([s.saveStarted,tick(500)]);setAnswer(s,'regAddress','SYNTHETIC DURING');s.releaseSave();await saving;
 const panel=s.d.getElementById('profileSavePanel');assert.equal(action(s,'Сохранить изменения').hidden,false);assert.equal(action(s,'Изменить факты').hidden,true);assert.match(panel.textContent,/Остались изменения/);assert.equal(s.calls.filter(c=>c.path.endsWith('/profile')&&c.method==='POST'&&c.body.action==='save')[0].body.draft.answers.find(a=>a.key==='regAddress').value,'SYNTHETIC BEFORE');
});

test('an edit during checking is not included in the checked snapshot',async t=>{
 const s=await setup(t,{holdCheck:true});await s.load();setAnswer(s,'regAddress','SYNTHETIC BEFORE CHECK');
 const saving=s.w.ProfileBackfill.save();assert.equal(await Promise.race([s.checkStarted.then(()=>true),tick(500).then(()=>false)]),true);
 setAnswer(s,'regAddress','SYNTHETIC DURING CHECK');s.releaseCheck();await saving;
 assert.equal(profilePosts(s,'save').length,0);assert.match(s.d.getElementById('profileSavePanel').textContent,/изменились во время проверки/);assert.equal(action(s,'Сохранить профиль в Bitrix').hidden,false);
});

test('an edit during confirmation is not published as the checked snapshot',async t=>{
 const s=await setup(t,{holdConfirm:true});await s.load();setAnswer(s,'regAddress','SYNTHETIC BEFORE CONFIRM');
 const saving=s.w.ProfileBackfill.save();assert.equal(await Promise.race([s.confirmStarted.then(()=>true),tick(500).then(()=>false)]),true);
 setAnswer(s,'regAddress','SYNTHETIC DURING CONFIRM');s.releaseConfirm();await saving;
 assert.equal(profilePosts(s,'save').length,0);assert.match(s.d.getElementById('profileSavePanel').textContent,/Ответы изменились после проверки/);assert.equal(action(s,'Сохранить профиль в Bitrix').hidden,false);
});

test('a definite pre-write rejection releases the request for a later save',async t=>{
 const s=await setup(t,{profileSaves:[{error:'CASE_IDENTITY_CHANGED',status:409},verified]});await s.load();setAnswer(s,'regAddress','SYNTHETIC RETRY');await s.w.ProfileBackfill.save();
 assert.equal(profilePosts(s,'save').length,1);assert.equal(action(s,'Проверить сохранение').hidden,true);assert.equal(action(s,'Сохранить профиль в Bitrix').disabled,false);
 await s.w.ProfileBackfill.save();assert.equal(profilePosts(s,'save').length,2);assert.equal(action(s,'Изменить факты').hidden,false);
});

test('an explicit uncertain state remains pending even with a 4xx response',async t=>{
 const s=await setup(t,{profileSaves:[{state:'uncertain',error:'PROFILE_SAVE_UNCERTAIN',status:409}]});await s.load();setAnswer(s,'regAddress','SYNTHETIC UNCERTAIN');await s.w.ProfileBackfill.save();
 assert.equal(profilePosts(s,'save').length,1);assert.equal(action(s,'Проверить сохранение').hidden,false);assert.equal(action(s,'Сохранить профиль в Bitrix').disabled,true);
 await s.w.ProfileBackfill.save();assert.equal(profilePosts(s,'save').length,1);
});

test('uncertain publication keeps its request id and reconciliation does not bless newer edits',async t=>{
 const s=await setup(t,{profileSaves:[{state:'uncertain',error:'PROFILE_SAVE_UNCERTAIN'}],reconciles:[verified]});await s.load();setAnswer(s,'regAddress','SYNTHETIC FIRST');await s.w.ProfileBackfill.save();
 const saveCall=profilePosts(s,'save')[0],reconcile=action(s,'Проверить сохранение');assert.equal(reconcile.hidden,false);assert.equal(action(s,'Сохранить профиль в Bitrix').disabled,true);
 setAnswer(s,'regAddress','SYNTHETIC NEWER');await s.w.ProfileBackfill.save();assert.equal(profilePosts(s,'save').length,1);
 reconcile.click();await tick(80);const reconcileCall=s.calls.find(c=>c.path.endsWith('/profile')&&c.body?.action==='reconcile');assert.equal(reconcileCall.body.requestId,saveCall.body.requestId);assert.equal(action(s,'Изменить факты').hidden,true);assert.equal(action(s,'Сохранить изменения').hidden,false);assert.match(s.d.getElementById('profileSavePanel').textContent,/Остались изменения/);
 });

test('a lost save response is reconciled with the original request instead of retried',async t=>{
 const s=await setup(t,{profileSaves:['transport-lost'],reconciles:[verified]});await s.load();setAnswer(s,'regAddress','SYNTHETIC LOST');await s.w.ProfileBackfill.save();
 const saveCall=profilePosts(s,'save')[0];assert.equal(action(s,'Проверить сохранение').hidden,false);await s.w.ProfileBackfill.save();assert.equal(profilePosts(s,'save').length,1);
 action(s,'Проверить сохранение').click();await tick(80);const reconcileCall=s.calls.find(c=>c.path.endsWith('/profile')&&c.body?.action==='reconcile');assert.equal(reconcileCall.body.requestId,saveCall.body.requestId);assert.equal(action(s,'Изменить факты').hidden,false);
});

test('draft failure keeps answers and never starts profile checking',async t=>{
 const s=await setup(t,{draftSaveFails:true});await s.load();setAnswer(s,'regAddress','SYNTHETIC UNSAVED');await s.w.ProfileBackfill.save();
 assert.equal(setAnswer(s,'regAddress','SYNTHETIC UNSAVED').value,'SYNTHETIC UNSAVED');assert.equal(profilePosts(s).length,0);assert.match(s.d.getElementById('profileSavePanel').textContent,/Черновик не сохранён/);
});

test('edit query opens the saved draft in answers while retaining the saved profile receipt',async t=>{
 const s=await setup(t,{latest:{state:'verified',requestId:'saved-request',savedAt:'2026-09-29T08:00:00.000Z'},savedDraft:true,edit:true});await s.load();
 assert.equal(s.d.body.dataset.assessmentWorkflow,'answers');assert.equal(s.d.getElementById('regAddress').value,'SYNTHETIC LATER DRAFT');assert.match(s.d.getElementById('profileSavePanel').textContent,/Сохранить изменения/);assert.equal(action(s,'Сохранить изменения').hidden,false);assert.equal(action(s,'Изменить факты').hidden,true);
});
