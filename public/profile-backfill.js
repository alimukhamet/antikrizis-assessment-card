/* Profile backfill mode (mode=profile): the documentologist completes the client
 * profile for ЗВИ / «В ожидании» deals. Reuses the documents and answers steps;
 * the last step saves the profile to Bitrix instead of preparing a contract. */
window.ProfileBackfill=(()=>{
 if(new URLSearchParams(location.search).get('mode')!=='profile')return null;
 const $=id=>document.getElementById(id);
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const UNKNOWN='Не знаю';
 const definiteProfileErrors=new Set(['BITRIX_NOT_CONFIGURED','BITRIX_REQUEST_FAILED','DEAL_IDENTITY_UNVERIFIED','CASE_IDENTITY_CHANGED','CLIENT_IDENTITY_UNVERIFIED','PROFILE_CHANGED_IN_CRM','PROFILE_PREFLIGHT_FAILED','INVALID_PROFILE_VALUES','INVALID_PROFILE_REQUEST','DEAL_NOT_FOUND']);
 const messages={
  ANSWERS_INCOMPLETE:'Заполните отмеченные ответы.',
  PROFILE_CHANGED_IN_CRM:'Сделку изменили в Bitrix, пока вы работали. Обновите страницу и проверьте данные.',CASE_IDENTITY_CHANGED:'ИИН сделки изменился. Обновите страницу.',
  DEAL_IDENTITY_UNVERIFIED:'Сначала подтвердите ИИН клиента по ГКБ на шаге «Документы».',PROFILE_SAVE_PENDING:'Предыдущее сохранение ещё не подтверждено. Нажмите «Проверить сохранение».',
  PROFILE_READBACK_MISMATCH:'Bitrix вернул другие значения. Нажмите «Проверить сохранение» ещё раз.',PROFILE_SAVE_UNCERTAIN:'Не удалось подтвердить сохранение. Нажмите «Проверить сохранение» — повторная запись не выполняется.',
  PROFILE_TOO_LARGE:'Профиль слишком большой для поля Bitrix. Сократите комментарии.',SIGN_IN_REQUIRED:'Войдите на сайт заново.',
  PROFILE_NOT_APPLIED:'Bitrix не записал профиль, сделка не изменилась. Нажмите «Сохранить профиль» ещё раз.',PROFILE_SAVE_OWNED_BY_ANOTHER_WORKER:'Это сохранение начал другой сотрудник. Попросите его нажать «Проверить сохранение».',
 };
 const say=code=>messages[code]||'Не удалось сохранить профиль. Ответы не удалены. Повторите.';

 // Hide sales-only parts: contract/payment card and the contract check button.
 const contractCard=$('dognum')?.closest('section.card');if(contractCard)contractCard.dataset.profileHidden='';
 const style=make('style');style.textContent='[data-profile-hidden],body[data-profile-backfill] #checkQuestions,body[data-profile-backfill] #checkStatus,body[data-profile-backfill] .ux-signing-next,body[data-profile-backfill] .wf-draft-note{display:none!important}'
  +'.pb-panel{border:1px solid #cfdad2;border-radius:12px;background:#fff;padding:16px;margin:12px 0}.pb-panel h3{margin:0 0 8px;color:#173c29;font-size:15px}'
  +'.pb-legacy pre{white-space:pre-wrap;font:13px/1.5 inherit;max-height:360px;overflow:auto;background:#f6f8f6;border-radius:8px;padding:12px;margin:8px 0 0}'
  +'.pb-warning{border-color:#e3b6b1;background:#fbeae8;color:#7c231b}.pb-done{border-color:#abc5b3;background:#e5f1e8}'
  +'.pb-unknown{margin-top:6px;border:0;background:transparent;color:#7a5a17;font:inherit;font-size:13px;cursor:pointer;padding:2px 0;text-decoration:underline}'
  +'.pb-issues{margin:8px 0 0;padding-left:18px}.pb-issues button{border:0;background:transparent;color:#a43229;font:inherit;text-decoration:underline;cursor:pointer;padding:0;text-align:left}'
  +'.pb-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}';
 document.head.append(style);
 // Use the same client/financial form as contracts. Keep old controls in the
 // draft, without asking for a separate family or contact questionnaire.
 const section=$('profileOnly');if(section)section.dataset.profileHidden='';
 const phone=$('clientPhone')?.closest('.field');
 if(phone){phone.style.removeProperty('display');$('clientPhone').type='tel';$('iin').closest('.field').after(phone);}
 // Court/destination controls remain hidden for saved-draft roundtrips.
 // The platform support explanation task owns new entries.

 // «Не знаю» saves an open question instead of blocking the profile.
 function addUnknownButtons(){
  for(const input of document.querySelectorAll('#questionnaireStep input[data-profile-text]')){
   if(input.closest('[data-support-only]')||input.nextElementSibling?.classList.contains('pb-unknown'))continue;
   const button=make('button','Не знаю — уточнить позже','pb-unknown');button.type='button';
   button.onclick=()=>{input.value=UNKNOWN;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
   input.after(button);
  }
 }
 addUnknownButtons();new MutationObserver(addUnknownButtons).observe($('questionnaireStep'),{childList:true,subtree:true});

 // Birth dates: type digits only, dots are inserted.
 document.addEventListener('input',event=>{
  const input=event.target;if(!input?.matches?.('input[data-profile-date]')||input.value===UNKNOWN)return;
  const digits=input.value.replace(/\D/g,'').slice(0,8);input.value=[digits.slice(0,2),digits.slice(2,4),digits.slice(4)].filter(Boolean).join('.');
 });

 // Context panels shown above the answers.
 const context=make('section',null,'pb-panel pb-legacy');context.id='profileContext';context.hidden=true;
 const answersIntro=$('workflowAnswers')||$('questionnaireStep').firstElementChild;answersIntro.after(context);

 const panel=make('section',null,'pb-panel');panel.id='profileSavePanel';
 const heading=make('h3','Сохранить профиль');
 const status=make('p','Нажмите «Проверить», чтобы увидеть, чего не хватает.');status.setAttribute('role','status');
 const issues=make('ol',null,'pb-issues');
 const check=make('button','Проверить','btn btn-ghost');check.type='button';
 const saveButton=make('button','Сохранить профиль в Bitrix','btn btn-main');saveButton.type='button';
 const editButton=make('button','Изменить факты','btn btn-ghost');editButton.type='button';editButton.hidden=true;
 const reconcileButton=make('button','Проверить сохранение','btn btn-ghost');reconcileButton.type='button';reconcileButton.hidden=true;
 const nextButton=make('button','Следующая сделка →','btn btn-main');nextButton.type='button';nextButton.hidden=true;
 const actions=make('div',null,'pb-actions');actions.append(check,saveButton,editButton,reconcileButton,nextButton);
 panel.append(heading,status,issues,actions);
 (document.querySelector('.wf-final-actions')||$('questionnaireStep')).prepend(panel);

 let deal=null,prefilled=false,imported=false,busy=false,pendingRequest=null,pendingSnapshot=null;
 let savedMode=false,savedSnapshot=null,profileWasSaved=false,initialModeApplied=false;
 const editRequested=new URLSearchParams(location.search).get('edit')==='1';
 const dealId=()=>HostedAssessment.ready()?HostedAssessment.getContext().client.external.dealId:null;
 const base=()=>'/api/assessment/'+encodeURIComponent(dealId());
 const snapshotKey=snapshot=>{try{return JSON.stringify(snapshot);}catch{return ''}};
 const currentSnapshot=()=>{try{return ServerDrafts.capture();}catch{return null;}};
 const currentKey=()=>snapshotKey(currentSnapshot());
 const currentMatches=key=>Boolean(key)&&currentKey()===key;

 async function api(path,body){
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}:{cache:'no-store'});
  let json={};try{json=await response.json();}catch{/* handled below */}
  if(response.status===401)json.error='SIGN_IN_REQUIRED';
  return {ok:response.ok,status:response.status,body:json};
 }
 function setValue(id,value){
  const node=$(id);if(!node||!value||node.value.trim())return;
  if(node.tagName==='SELECT'&&![...node.options].some(o=>o.value===value))return;
  node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));
 }
 function renderContext(){
  context.replaceChildren();if(!deal)return;context.hidden=false;
  const saved=deal.latest?.state==='verified'?deal.latest:null;
  if(saved){const done=make('p','Последнее сохранение: '+new Date(saved.savedAt).toLocaleString('ru-RU')+'. Прежние значения сохранены в истории сделки.');context.append(done);}
  if(deal.legacyCard){
   const legacy=make('details');legacy.open=!saved;legacy.append(make('summary',saved?'Старая карточка клиента из Bitrix':'Старая карточка клиента из Bitrix — перенесите факты в ответы'),make('pre',deal.legacyCard));context.append(legacy);
  }else context.append(make('p','Старой карточки в сделке нет. Заполните профиль по документам клиента.','hint'));
  if(deal.active){pendingRequest=deal.active.requestId;pendingSnapshot=null;showPending('PROFILE_SAVE_PENDING');}
 }
 async function load(){
  if(!dealId()||deal?.dealId===dealId())return;
  const result=await api(base()+'/profile');
  if(!result.ok){status.textContent=say(result.body.error);return;}
  deal=result.body;renderContext();
 }
 function prefill(){
  if(prefilled||!deal||!ClientContextUI.ready())return;prefilled=true;
  setValue('fio',deal.current.fio||deal.title);setValue('clientPhone',deal.phone);setValue('marital',deal.current.marital);setValue('procedure',deal.procedure);
  syncFactAddress();
 }
 async function autoImport(){
  if(imported||!ClientContextUI.ready()||af.busy)return;imported=true;
  if(typeof selectedFiles!=='undefined'&&selectedFiles.length)return;
  try{await ClientWorkspace.importDocuments();}catch{/* The worker can press «Взять из Bitrix» again. */}
 }
 function draftReady(){return ServerDrafts.loadState?.()?.phase==='ready';}
 function receiptText(body){return 'Профиль сохранён в Bitrix.'+(body?.unresolvedCount?' Требует уточнения: '+body.unresolvedCount+'.':'')+(body?.historySaved===false?' Комментарий в истории сделки не добавлен — это не влияет на профиль.':'');}
 function updateActions(){
  editButton.hidden=!savedMode;nextButton.hidden=!savedMode;saveButton.hidden=savedMode;check.hidden=savedMode;
  reconcileButton.hidden=!pendingRequest;reconcileButton.disabled=busy;
  const blocked=Boolean(pendingRequest);saveButton.disabled=busy||blocked;check.disabled=busy||blocked;
 }
 function resumePresence(){if(window.ProfilePresence?.resume)window.ProfilePresence.resume(dealId());else window.ProfilePresence?.start?.(dealId());}
 function enterEditing({navigate=false,focus=true,reason='',hasSaved}={}){
  const hadSaved=hasSaved===undefined?(savedMode||profileWasSaved):hasSaved;
  savedMode=false;savedSnapshot=null;panel.classList.remove('pb-done');heading.textContent=hadSaved?'Изменить факты':'Сохранить профиль';saveButton.textContent=hadSaved?'Сохранить изменения':'Сохранить профиль в Bitrix';editButton.hidden=true;nextButton.hidden=true;issues.replaceChildren();
  updateActions();document.dispatchEvent(new CustomEvent('profile-backfill-editing',{detail:{hasSaved:hadSaved}}));resumePresence();
  if(reason)status.textContent=reason;else status.textContent=hadSaved?'Измените факты и нажмите «Сохранить изменения».':'Нажмите «Проверить», чтобы увидеть, чего не хватает.';
  if(navigate)window.AssessmentWorkflow?.show?.('answers',{focus,remember:false});
 }
 function enterSaved(body,snapshot){
  const key=snapshotKey(snapshot);savedMode=true;savedSnapshot=key;profileWasSaved=true;pendingRequest=null;pendingSnapshot=null;panel.classList.add('pb-done');heading.textContent='Профиль сохранён';saveButton.textContent='Сохранить изменения';issues.replaceChildren();
  document.dispatchEvent(new Event('profile-backfill-saved'));updateActions();status.textContent=receiptText(body);editButton.focus();
 }
 function showPending(code){
  savedMode=false;panel.classList.remove('pb-done');heading.textContent=profileWasSaved?'Изменить факты':'Сохранить профиль';saveButton.textContent=profileWasSaved?'Сохранить изменения':'Сохранить профиль в Bitrix';editButton.hidden=true;nextButton.hidden=true;reconcileButton.hidden=false;updateActions();status.textContent=say(code||'PROFILE_SAVE_UNCERTAIN');
 }
 function markPending(requestId,snapshot,code){
  if(!pendingRequest)pendingRequest=requestId;
  if(!pendingSnapshot&&snapshot)pendingSnapshot=snapshot;
  showPending(code);
 }
 function applyVerified(body,snapshot){
  const submittedKey=snapshotKey(snapshot),changed=!currentMatches(submittedKey);profileWasSaved=true;
  if(changed){
   pendingRequest=null;pendingSnapshot=null;document.dispatchEvent(new CustomEvent('profile-backfill-receipt-verified',{detail:{snapshot}}));
   enterEditing({reason:'Профиль сохранён. Остались изменения — проверьте их и сохраните ещё раз.',hasSaved:true});
  }else enterSaved(body,snapshot);
 }
 function applyInitialMode(){
  if(!deal||!draftReady()||initialModeApplied)return;
  if(deal.latest?.state==='verified')profileWasSaved=true;
  if(pendingRequest){initialModeApplied=true;showPending('PROFILE_SAVE_PENDING');return;}
  if(deal.latest?.state!=='verified')return;
  initialModeApplied=true;
  // A reload gives us the receipt, but the durable draft may contain newer
  // unsent facts. Keep the form editable until this tab submits a snapshot.
  enterEditing({navigate:editRequested,reason:'Профиль уже сохранён. Проверьте факты и нажмите «Сохранить изменения».',focus:true,hasSaved:true});
 }
 async function onReady(){
  if(!ClientContextUI.ready())return;window.ProfilePresence?.start(dealId());await load();prefill();if(!editRequested)autoImport();applyInitialMode();
 }
 for(const event of ['assessment-client-readiness-changed','assessment-draft-restored','assessment-case-opened','assessment-draft-load-state'])document.addEventListener(event,()=>setTimeout(onReady,0));
 setTimeout(onReady,0);

 function noticeFormChanged(){
  if(!savedMode||busy)return;
  const key=savedSnapshot;if(!currentMatches(key))enterEditing({focus:false});
 }
 for(const event of ['input','change','assessment-analysis-complete','assessment-files-selected','assessment-credentials-changed','assessment-draft-restored','assessment-identity-confirmed','assessment-case-opened'])document.addEventListener(event,()=>queueMicrotask(noticeFormChanged));
 document.addEventListener('click',event=>{
  if(event.target?.closest?.('.add-row,.remove-row,.document-remove,[data-required-picker],#importCrmDocuments'))queueMicrotask(noticeFormChanged);
 });

 function locate(issue){
  if(issue.group!==undefined&&issue.row!==undefined){
   const row=$(issue.group)?.querySelector(':scope > .repeat-rows')?.children[issue.row];
   return row&&[...row.querySelectorAll('input,select,textarea')].find(e=>e.id.replace(/_r\d+$/,'')===issue.key)||row;
  }
  return $(issue.key)||$(issue.group||'')||document.querySelector(`[name="${CSS.escape(String(issue.key).split(':')[1]||'')}"]`);
 }
 function showIssues(list){
  issues.replaceChildren();
  for(const issue of (Array.isArray(list)?list:[]).slice(0,40)){
   const item=make('li'),link=make('button',issue.label.replace(/\*/g,'').trim());link.type='button';
   link.onclick=()=>{const node=locate(issue);if(!node)return;window.AssessmentWorkflow?.reveal?.(node);node.closest('details')?.setAttribute('open','');node.scrollIntoView({block:'center'});node.focus?.({preventScroll:true});};
   item.append(link);issues.append(item);
  }
  if(Array.isArray(list)&&list.length>40)issues.append(make('li','…и ещё '+(list.length-40)));
 }
 async function runCheck(snapshot=currentSnapshot()){
  if(!ClientContextUI.ready())return null;
  const key=snapshotKey(snapshot);let result;
  try{result=await api(base()+'/profile',{action:'check',requestId:crypto.randomUUID(),draft:snapshot});}catch{status.textContent=say('');return null;}
  if(!result.ok){status.textContent=say(result.body.error);return null;}
  showIssues(result.body.issues);
  if(!currentMatches(key)){status.textContent='Ответы изменились во время проверки. Проверьте их ещё раз.';return {...result.body,ready:false,changed:true};}
  const open=Array.isArray(result.body.unresolved)?result.body.unresolved.length:0,problemCount=Array.isArray(result.body.issues)?result.body.issues.length:0;
  status.textContent=result.body.ready?'Можно сохранять.'+(open?' Отмечено «Не знаю»: '+open+' — попадут в раздел «Требует уточнения».':''):'Не хватает ответов: '+problemCount+'. Нажмите на пункт, чтобы перейти к нему.';
  return result.body;
 }
 async function persistDraft(){
  if(!ServerDrafts.isDirty())return true;
  if(!await ServerDrafts.save({automatic:true}))return false;
  if(ServerDrafts.isDirty()){status.textContent='Ответы изменились во время сохранения черновика. Сохраните черновик и повторите.';return false;}
  return true;
 }
 async function save(){
  if(savedMode){if(currentMatches(savedSnapshot))return next();enterEditing({focus:false,hasSaved:true});return;}
  if(pendingRequest){status.textContent=messages.PROFILE_SAVE_PENDING;return;}
  if(busy||!ClientContextUI.ready())return;busy=true;updateActions();
  try{
   if(!await persistDraft()){status.textContent='Черновик не сохранён. Проверьте сообщение об ошибке и повторите.';return;}
   const snapshot=currentSnapshot(),key=snapshotKey(snapshot);if(!snapshot){status.textContent='Не удалось зафиксировать ответы. Повторите.';return;}
   const checked=await runCheck(snapshot);if(!checked?.ready||!currentMatches(key))return;
   if(!await ClientContextUI.confirm('Сохранить профиль в Bitrix','Будут обновлены ФИО, семейное положение и общий долг; полный профиль добавится комментарием в историю сделки. Договор, оплата, процедура и старая карточка не меняются.'))return;
   if(!currentMatches(key)){status.textContent='Ответы изменились после проверки. Проверьте их ещё раз.';return;}
   status.textContent='Сохраняем профиль в Bitrix…';
   const requestId=crypto.randomUUID();pendingRequest=requestId;pendingSnapshot=snapshot;updateActions();let result;
   try{result=await api(base()+'/profile',{action:'save',requestId,draft:snapshot,identityRevision:HostedAssessment.getContext().identityRevision});}
   catch{markPending(requestId,snapshot,'PROFILE_SAVE_UNCERTAIN');return;}
   if(result.ok&&result.body.state==='verified'){applyVerified(result.body,snapshot);return;}
   if(result.body.state==='failed'){pendingRequest=null;pendingSnapshot=null;reconcileButton.hidden=true;status.textContent=say(result.body.error||result.body.outcome);return;}
   const waitingForOther=result.body.error==='PROFILE_SAVE_PENDING'&&result.body.pendingRequestId;
   if(waitingForOther){pendingRequest=result.body.pendingRequestId;pendingSnapshot=null;}
   const inFlightState=result.body.state==='writing'||result.body.state==='uncertain';
   if(!result.ok&&!waitingForOther&&!inFlightState&&(definiteProfileErrors.has(result.body.error)||result.status>=400&&result.status<500)){pendingRequest=null;pendingSnapshot=null;reconcileButton.hidden=true;status.textContent=say(result.body.error||result.body.outcome);return;}
   markPending(pendingRequest,waitingForOther?null:snapshot,result.body.error||result.body.outcome||'PROFILE_SAVE_UNCERTAIN');
  }catch{status.textContent=say('');}
  finally{busy=false;updateActions();}
 }
 async function reconcile(){
  if(busy||!pendingRequest)return;const requestId=pendingRequest,snapshot=pendingSnapshot;busy=true;updateActions();
  try{
   const result=await api(base()+'/profile',{action:'reconcile',requestId});
   if(result.ok&&result.body.state==='verified'){
    pendingRequest=null;pendingSnapshot=null;
    if(snapshot)applyVerified(result.body,snapshot);else{profileWasSaved=true;document.dispatchEvent(new CustomEvent('profile-backfill-receipt-verified',{detail:{requestId}}));enterEditing({reason:'Предыдущее сохранение подтверждено. Проверьте факты и сохраните текущую версию.',hasSaved:true});}
    return;
   }
   if(result.body.state==='failed'){pendingRequest=null;pendingSnapshot=null;reconcileButton.hidden=true;status.textContent=say(result.body.error||result.body.outcome);return;}
   status.textContent=say(result.body.error||result.body.outcome||'PROFILE_SAVE_UNCERTAIN');
  }catch{status.textContent=say('PROFILE_SAVE_UNCERTAIN');}finally{busy=false;updateActions();}
 }
 async function next(){
  if(pendingRequest){status.textContent=messages.PROFILE_SAVE_PENDING;return;}
  if(savedMode&&!currentMatches(savedSnapshot)){enterEditing({focus:false,hasSaved:true});return;}
  if(!savedMode)return;
  nextButton.disabled=true;
  try{
   await window.ProfilePresence?.release();
   const [result,activity]=await Promise.all([api('/api/profile-queue'),api('/api/profile-activity')]);
   const occupied=new Set(activity.ok?activity.body.active.map(s=>s.dealId):[]);
   const item=result.ok&&activity.ok?result.body.items.find(i=>!i.profileSavedAt&&i.dealId!==dealId()&&!occupied.has(i.dealId)):null;
   (window.top||window).location.assign(item?'/profile-backfill?dealId='+encodeURIComponent(item.dealId):'/profile-backfill');
  }catch{(window.top||window).location.assign('/profile-backfill');}
 }
 check.onclick=async()=>{if(pendingRequest||busy)return;check.disabled=true;try{await runCheck();}catch{status.textContent=say('');}finally{updateActions();}};
 saveButton.onclick=save;editButton.onclick=()=>enterEditing({navigate:true,focus:true,hasSaved:true});reconcileButton.onclick=reconcile;nextButton.onclick=next;
 return{save,check:runCheck};
})();
