/* Profile backfill mode (mode=profile): the documentologist completes the client
 * profile for ЗВИ / «В ожидании» deals. Reuses the documents and answers steps;
 * the last step saves the profile to Bitrix instead of preparing a contract. */
window.ProfileBackfill=(()=>{
 if(new URLSearchParams(location.search).get('mode')!=='profile')return null;
 const $=id=>document.getElementById(id);
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const UNKNOWN='Не знаю';
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
 const section=$('profileOnly');section?.classList.remove('hidden');

 // Fact address only when it differs from the registration address.
 function syncFactAddress(){$('factAddressField')?.classList.toggle('hidden',$('factAddressSame')?.value!=='other');}
 $('factAddressSame')?.addEventListener('change',syncFactAddress);

 // «Не знаю» saves an open question instead of blocking the profile.
 function addUnknownButtons(){
  for(const input of document.querySelectorAll('#questionnaireStep input[data-profile-text]')){
   if(input.nextElementSibling?.classList.contains('pb-unknown'))continue;
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
 const status=make('p','Нажмите «Проверить», чтобы увидеть, чего не хватает.');status.setAttribute('role','status');
 const issues=make('ol',null,'pb-issues');
 const check=make('button','Проверить','btn btn-ghost');check.type='button';
 const saveButton=make('button','Сохранить профиль в Bitrix','btn btn-main');saveButton.type='button';
 const reconcileButton=make('button','Проверить сохранение','btn btn-ghost');reconcileButton.type='button';reconcileButton.hidden=true;
 const nextButton=make('button','Следующая сделка →','btn btn-main');nextButton.type='button';nextButton.hidden=true;
 const actions=make('div',null,'pb-actions');actions.append(check,saveButton,reconcileButton,nextButton);
 panel.append(make('h3','Сохранить профиль'),status,issues,actions);
 (document.querySelector('.wf-final-actions')||$('questionnaireStep')).prepend(panel);

 let deal=null,prefilled=false,imported=false,busy=false,pendingRequest=null;
 const dealId=()=>HostedAssessment.ready()?HostedAssessment.getContext().client.external.dealId:null;
 const base=()=>'/api/assessment/'+encodeURIComponent(dealId());

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
  if(saved){const done=make('p','Профиль уже сохранён: '+new Date(saved.savedAt).toLocaleString('ru-RU')+'. Повторное сохранение заменит его; прежние значения останутся в истории сделки.');context.append(done);}
  if(deal.legacyCard){
   const legacy=make('details');legacy.open=true;legacy.append(make('summary','Старая карточка клиента из Bitrix — перенесите факты в ответы'),make('pre',deal.legacyCard));context.append(legacy);
  }else context.append(make('p','Старой карточки в сделке нет. Заполните профиль по документам клиента.','hint'));
  if(deal.active){pendingRequest=deal.active.requestId;reconcileButton.hidden=false;status.textContent=messages.PROFILE_SAVE_PENDING;}
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
 async function onReady(){if(!ClientContextUI.ready())return;await load();prefill();autoImport();}
 for(const event of ['assessment-client-readiness-changed','assessment-draft-restored','assessment-case-opened'])document.addEventListener(event,()=>setTimeout(onReady,0));
 setTimeout(onReady,0);

 function locate(issue){
  if(issue.group!==undefined&&issue.row!==undefined){
   const row=$(issue.group)?.querySelector(':scope > .repeat-rows')?.children[issue.row];
   return row&&[...row.querySelectorAll('input,select,textarea')].find(e=>e.id.replace(/_r\d+$/,'')===issue.key)||row;
  }
  return $(issue.key)||$(issue.group||'')||document.querySelector(`[name="${CSS.escape(String(issue.key).split(':')[1]||'')}"]`);
 }
 function showIssues(list){
  issues.replaceChildren();
  for(const issue of list.slice(0,40)){
   const item=make('li'),link=make('button',issue.label.replace(/\*/g,'').trim());link.type='button';
   link.onclick=()=>{const node=locate(issue);if(!node)return;window.AssessmentWorkflow?.reveal?.(node);node.closest('details')?.setAttribute('open','');node.scrollIntoView({block:'center'});node.focus?.({preventScroll:true});};
   item.append(link);issues.append(item);
  }
  if(list.length>40)issues.append(make('li','…и ещё '+(list.length-40)));
 }
 async function runCheck(){
  if(!ClientContextUI.ready())return null;
  const result=await api(base()+'/profile',{action:'check',requestId:crypto.randomUUID(),draft:ServerDrafts.capture()});
  if(!result.ok){status.textContent=say(result.body.error);return null;}
  showIssues(result.body.issues);
  const open=result.body.unresolved.length;
  status.textContent=result.body.ready?'Можно сохранять.'+(open?' Отмечено «Не знаю»: '+open+' — попадут в раздел «Требует уточнения».':''):'Не хватает ответов: '+result.body.issues.length+'. Нажмите на пункт, чтобы перейти к нему.';
  return result.body;
 }
 let done=false;
 function finished(body){
  done=true;document.dispatchEvent(new Event('profile-backfill-saved'));
  panel.classList.add('pb-done');saveButton.hidden=true;check.hidden=true;reconcileButton.hidden=true;nextButton.hidden=false;issues.replaceChildren();pendingRequest=null;
  status.textContent='Профиль сохранён в Bitrix.'+(body.unresolvedCount?' Требует уточнения: '+body.unresolvedCount+'.':'')+(body.historySaved===false?' Комментарий в истории сделки не добавлен — это не влияет на профиль.':'');
  nextButton.focus();
 }
 async function save(){
  if(done)return next();
  if(busy||!ClientContextUI.ready())return;busy=true;saveButton.disabled=check.disabled=true;
  try{
   if(ServerDrafts.isDirty())await ServerDrafts.save({automatic:true});
   const checked=await runCheck();if(!checked?.ready)return;
   if(!await ClientContextUI.confirm('Сохранить профиль в Bitrix','Будут обновлены ФИО, семейное положение и общий долг; полный профиль добавится комментарием в историю сделки. Договор, оплата, процедура и старая карточка не меняются.'))return;
   status.textContent='Сохраняем профиль в Bitrix…';
   const requestId=crypto.randomUUID();pendingRequest=requestId;
   const result=await api(base()+'/profile',{action:'save',requestId,draft:ServerDrafts.capture(),identityRevision:HostedAssessment.getContext().identityRevision});
   if(result.ok&&result.body.state==='verified'){finished(result.body);return;}
   if(result.body.pendingRequestId)pendingRequest=result.body.pendingRequestId;
   reconcileButton.hidden=!(result.body.state==='uncertain'||result.body.pendingRequestId);
   status.textContent=say(result.body.error||result.body.outcome);
  }catch{status.textContent=say('');}
  finally{busy=false;saveButton.disabled=check.disabled=false;}
 }
 async function reconcile(){
  if(busy||!pendingRequest)return;busy=true;reconcileButton.disabled=true;
  try{
   const result=await api(base()+'/profile',{action:'reconcile',requestId:pendingRequest});
   if(result.ok&&result.body.state==='verified'){finished(result.body);return;}
   if(result.body.state==='failed'){pendingRequest=null;reconcileButton.hidden=true;}
   status.textContent=say(result.body.error||result.body.outcome);
  }catch{status.textContent=say('');}finally{busy=false;reconcileButton.disabled=false;}
 }
 async function next(){
  nextButton.disabled=true;
  try{
   const result=await api('/api/profile-queue');
   const item=result.ok?result.body.items.find(i=>!i.profileSavedAt&&i.dealId!==dealId()):null;
   (window.top||window).location.assign(item?'/profile-backfill?dealId='+encodeURIComponent(item.dealId):'/profile-backfill');
  }catch{(window.top||window).location.assign('/profile-backfill');}
 }
 check.onclick=async()=>{check.disabled=true;try{await runCheck();}catch{status.textContent=say('');}finally{check.disabled=false;}};
 saveButton.onclick=save;reconcileButton.onclick=reconcile;nextButton.onclick=next;
 return{save,check:runCheck};
})();
