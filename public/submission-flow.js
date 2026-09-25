window.SubmissionFlow={mount(anchor,status){
 const save=document.createElement('button');save.type='button';save.id='saveAssessment';save.className='btn btn-main';save.textContent='Скачать договор';save.disabled=false;anchor.after(save);
 const fileLink=document.createElement('a');fileLink.id='downloadContractFile';fileLink.className='btn btn-ghost';fileLink.textContent='Скачать готовый файл договора';fileLink.hidden=true;save.after(fileLink);let fileUrl=null;
 function clearFile(){if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl=null;fileLink.hidden=true;fileLink.removeAttribute('href');}
 const recovery=document.createElement('details'),summary=document.createElement('summary'),savedText=document.createElement('pre'),resume=document.createElement('button'),cancel=document.createElement('button');
 summary.textContent='Сохранённая версия анкеты';savedText.style.whiteSpace='pre-wrap';resume.type=cancel.type='button';resume.className=cancel.className='btn btn-ghost';cancel.textContent='Отменить подготовку';recovery.append(summary,savedText,resume,cancel);recovery.hidden=true;save.after(recovery);
 const profile=document.createElement('button');profile.type='button';profile.id='saveProfileWithoutContract';profile.className='btn btn-ghost';profile.textContent='Сохранить профиль в CRM (без договора)';save.after(profile);
 const currentRenderer=window.ContractRenderer;
 let checked=null,attempt=null,latest=null,busy=false,busyLabel='Скачать договор',generation=0,destination=null,destinationSnapshot=null;
 let profileBusy=false,profileAttempt=null;
 const progress=()=>document.dispatchEvent(new CustomEvent('assessment-submission-progress',{detail:{busy,label:busy?busyLabel:'Скачать договор',message:status.textContent}}));
 const report=text=>{status.textContent=text;progress();};
 const phase=(label,message)=>{busyLabel=label;save.textContent=label;if(message!==undefined)report(message);else progress();};
 new MutationObserver(()=>{if(busy)progress();}).observe(status,{childList:true,characterData:true,subtree:true});
 const currentDeal=()=>HostedAssessment.ready()?HostedAssessment.getContext().client.external.dealId:null;
 const signature=()=>JSON.stringify({payload:ServerDrafts.capture(),bindings:ServerDrafts.reviewBindings()});
 const assessmentSnapshot=()=>{const payload={...ServerDrafts.capture()};delete payload.pendingFiles;return JSON.stringify(payload);};
 function guardDestination(){if(!destination||destination.dealId!==currentDeal()||destinationSnapshot!==assessmentSnapshot())throw Error('Клиент или ответы изменились. Проверьте получателя заново.');}
 async function confirmDestination(){
  if(destination){guardDestination();return;}
  const before=assessmentSnapshot();if(!window.SubmissionDestination)throw Error('Обновите страницу для проверки получателя.');
  const selected=await SubmissionDestination.confirm();if(!selected)throw Error('Отправка отменена.');
  destination=selected;destinationSnapshot=before;guardDestination();
 }
 const messages={CONTRACT_OPERATION_TIMEOUT:'Проверка сохранения заняла слишком много времени. Нажмите «Скачать договор» ещё раз без изменения ответов: система продолжит ту же операцию.',SUBMISSION_DESTINATION_CHANGED:'Получатель изменился. Откройте сделку заново.',ASSESSMENT_NOT_READY:'Ответы или документы требуют проверки.',SUBMISSION_PENDING_OR_IDENTITY_CHANGED:'Есть незавершённое сохранение. Откройте сохранённую версию ниже.',SUBMISSION_EVIDENCE_CHANGED:'Источники изменились. Отмените подготовку и проверьте анкету заново.',SUBMISSION_VALIDATION_CHANGED:'Правила проверки обновились. Отмените подготовку и проверьте анкету заново.',IDEMPOTENCY_KEY_REUSED:'Для этого сохранения уже зафиксирована другая версия ответов.',SUBMISSION_ACTOR_OR_IDENTITY_CHANGED:'Сотрудник или клиент изменился. Откройте сделку заново.',CONTRACT_SNAPSHOT_UNAVAILABLE:'Версия договора недоступна; требуется восстановление.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился.',PROFILE_NOT_READY:'Заполните профиль: адрес регистрации, фактический адрес, ответ об исполнительных производствах и при ответе «Да» — взыскателя и сумму по каждому производству.',PROFILE_SUBMISSION_PERSISTENCE_FAILED:'Не удалось сохранить профиль. Ответы остаются на экране; повторите попытку.',SUBMISSION_TOO_LARGE:'Профиль слишком большой для отправки. Уменьшите объём комментариев.'};
 async function post(dealId,body){if(['prepare','complete','commit','history'].includes(body.action)){guardDestination();body={...body,destination};}const url=`/api/assessment/${encodeURIComponent(dealId)}/submission`,options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},message=code=>messages[code]||'Операция не подтверждена. Проверьте сохранённую версию и повторите.';if(HostedAssessment.requestJson)return HostedAssessment.requestJson(url,options,{timeoutMs:120000,message});const response=await fetch(url,options),data=await response.json();if(!response.ok)throw Error(message(data.error));return data;}
 async function refresh(){
  const dealId=currentDeal(),token=++generation;latest=null;recovery.hidden=true;if(!dealId)return;
  try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/submission`,{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(token!==generation||currentDeal()!==dealId)return;
   if(!data.submission)return;latest={...data.submission,dealId};recovery.hidden=false;savedText.textContent=latest.reviewText||`${latest.clientName} — договор ${latest.contractNumber}`;
   resume.textContent=latest.state==='verified'&&latest.historySaved?'Скачать сохранённый договор':`Продолжить сохранение договора ${latest.contractNumber}`;cancel.hidden=latest.state!=='prepared';
  }catch{/* A failed status fetch never authorizes a new write. */}
 }
 async function download(dealId,contract){
  const savedSignature=signature();
  const guardDownload=()=>{if(currentDeal()!==dealId||signature()!==savedSignature)throw Error('Клиент или ответы изменились во время подготовки договора. Проверьте текущую версию и скачайте договор заново.');};
  const version=contract?.rendererVersion;
  guardDownload();
  // Preload with the retryable bounded loader even for immutable older renderers.
  if(currentRenderer?.ready)await currentRenderer.ready();
  guardDownload();
  if(!/^[a-f0-9]{64}$/.test(version||''))throw Error('Не удалось определить сохранённую версию договора.');
  if(!window.ContractRenderers?.[version])await new Promise((resolve,reject)=>{const currentRenderer=window.ContractRenderer,script=document.createElement('script');let timer;const fail=()=>{clearTimeout(timer);script.remove();reject(Error('Не удалось загрузить сохранённую версию договора. Повторите скачивание из сохранённой версии.'));};script.src=`/contract-renderers/${version}.js`;script.onload=()=>{clearTimeout(timer);window.ContractRenderer=currentRenderer;resolve();};script.onerror=fail;timer=setTimeout(fail,20000);document.head.append(script);});
  const renderer=window.ContractRenderers?.[version];if(!renderer)throw Error('Сохранённая версия договора не найдена.');
  let renderTimer;
  const renderTimeout=new Promise((_,reject)=>{renderTimer=setTimeout(()=>reject(Error('Подготовка файла договора заняла слишком много времени. Повторите скачивание из сохранённой версии.')),60000);});
  let blob;
  try{blob=await Promise.race([renderer.render(contract.data,version),renderTimeout]);}finally{clearTimeout(renderTimer);}
  guardDownload();
  if(!(blob instanceof Blob)||!blob.size)throw Error('Модуль договора вернул пустой файл. Повторите скачивание из сохранённой версии.');
  clearFile();fileUrl=URL.createObjectURL(blob);fileLink.href=fileUrl;fileLink.download=(HostedAssessment.getContext().client.title+` — договор — сделка ${dealId}.docx`).replace(/[\\/:*?"<>|]/g,'_');fileLink.hidden=false;
  fileLink.onclick=event=>{if(currentDeal()!==dealId||signature()!==savedSignature){event.preventDefault();clearFile();report('Клиент или ответы изменились. Скачайте договор заново для текущей версии.');}};fileLink.click();
  // A visible, persistent link gives Safari/in-app browsers a fresh user gesture.
  fileLink.focus({preventScroll:true});fileLink.scrollIntoView?.({block:'nearest'});
 }
 // The server owns commit, readback and timeline transitions. The browser only
 // guards the user's selection and renders the immutable contract returned to it.
 async function saveProfile(){
  if(profileBusy)return;
  const dealId=currentDeal();
  if(!dealId){report('Сначала откройте сделку.');return;}
  profileBusy=true;const label=profile.textContent;profile.disabled=true;profile.textContent='Сохраняю профиль…';report('Сохраняю профиль без договора…');
  try{
   if(window.ServerDrafts.save&&!await window.ServerDrafts.save({automatic:true}))throw Error('Сначала сохраните черновик.');
   const payload=ServerDrafts.capture(),signature=JSON.stringify(payload);
   if(!profileAttempt||profileAttempt.signature!==signature)profileAttempt={signature,requestId:crypto.randomUUID()};
   const result=await post(dealId,{action:'profile',requestId:profileAttempt.requestId,identityRevision:HostedAssessment.getContext().identityRevision,payload,bindings:ServerDrafts.reviewBindings()});
   profileAttempt=null;
   const sync=result.assessmentIntakeSync?.status;
   report(sync==='synced'?'Профиль сохранён и передан в CRM (без договора).':sync==='pending'?'Профиль сохранён. Передача в CRM ожидает подтверждения — повторите «Сохранить профиль».':sync==='disabled'?'Профиль сохранён в анкете. Передача в CRM не настроена.':'Профиль сохранён.');
  }catch(error){report(error.message);}
  finally{profileBusy=false;profile.disabled=false;profile.textContent=label;}
 }
 async function advance(dealId,row,guard){
  if(currentDeal()!==dealId)throw Error('Открыта другая сделка.');
  if(guard&&!guard()){
   if(row.state==='prepared')await post(dealId,{action:'cancel',requestId:row.requestId});
   throw Error('Ответы изменились. Проверьте анкету заново.');
  }
  phase('Готовлю договор…','Сохраняю проверенную версию и готовлю договор…');
  const result=await post(dealId,{action:'complete',requestId:row.requestId});
  if(guard&&!guard())throw Error('Клиент или ответы изменились во время сохранения. Сохранённая версия не удалена. Проверьте текущие ответы.');
  if(!result.contract)throw Error(result.message||'Сохранение ещё не подтверждено. Нажмите «Скачать договор» ещё раз без изменения ответов.');
  await download(dealId,result.contract);
  report('Договор готов. Если скачивание не началось, нажмите «Скачать готовый файл договора» ниже. Карточка и история сохранены в сделке.');
 }
 async function operate(action){if(busy)return;busy=true;busyLabel='Проверяю…';destination=null;destinationSnapshot=null;clearFile();save.disabled=resume.disabled=cancel.disabled=true;save.textContent=busyLabel;report('Проверяю данные для договора…');try{await action();}catch(error){recovery.open=true;report(error.message);}finally{busy=false;busyLabel='Скачать договор';resume.disabled=cancel.disabled=false;save.disabled=false;save.textContent=busyLabel;progress();void refresh();}}
 save.onclick=()=>operate(async()=>{
  if(!checked||currentDeal()!==checked.dealId||signature()!==checked.signature){
   await window.AssessmentCheck?.run();
   let result=window.AssessmentCheck?.result();
   const issues=result?.documents?.issues||[],pending=ServerDrafts.capture().pendingFiles||[];
   const keysOnly=issues.some(i=>i.code==='EDS_SEPARATE_UPLOAD_REQUIRED')&&issues.every(i=>i.code==='EDS_SEPARATE_UPLOAD_REQUIRED'||i.code==='DOCUMENT_UPLOAD_PENDING')&&(!pending.length||window.CredentialUpload?.pendingOnly(pending));
   if(!checked&&result?.answersComplete&&!result.evidence?.issues.length&&keysOnly){
    await confirmDestination();guardDestination();await window.CredentialUpload?.submit();await window.AssessmentCheck.run();
    result=window.AssessmentCheck?.result();
   }
   if(!checked){
    const documentIssues=result?.documents?.issues||[],evidenceIssues=result?.evidence?.issues||[];
    if(result?.answersComplete&&!evidenceIssues.length&&documentIssues.length){
     document.dispatchEvent(new CustomEvent('assessment-submission-blocked',{detail:{reason:'documents',result}}));
     throw Error(`Договор не скачан: сначала проверьте документы (${documentIssues.length}). Замечания открыты в разделе документов.`);
    }
    throw Error(status.textContent&&status.textContent!=='Проверяю данные для договора…'?status.textContent:'Проверка не завершена. Нажмите «Проверить» и исправьте замечания перед скачиванием.');
   }
  }
  if(currentDeal()!==checked.dealId||signature()!==checked.signature)throw Error('Ответы изменились. Проверьте анкету ещё раз.');
  const selected=checked;
  const selectionUnchanged=()=>currentDeal()===selected.dealId&&signature()===selected.signature;
  // Verify the browser can build a DOCX before starting external writes.
  if(currentRenderer?.ready){phase('Загружаю модуль…','Загружаю модуль формирования договора…');await currentRenderer.ready();}
  if(!checked||!selectionUnchanged())throw Error('Ответы изменились. Проверьте анкету ещё раз.');
  phase('Проверяю…','Проверяю получателя договора…');await confirmDestination();
  if(!checked||!selectionUnchanged())throw Error('Ответы изменились. Проверьте анкету ещё раз.');
  phase('Сохраняю…','Сохраняю черновик…');if(window.ServerDrafts.save&&!await window.ServerDrafts.save({automatic:true}))throw Error('Сначала сохраните черновик.');
  guardDestination();if(window.AssessmentDocumentUpload)await window.AssessmentDocumentUpload.submit({onProgress:report});
  if(currentDeal()!==selected.dealId||signature()!==selected.signature)throw Error('Ответы изменились во время сохранения документов. Проверьте анкету ещё раз.');
  if(attempt?.signature!==selected.signature||attempt?.dealId!==selected.dealId)attempt={signature:selected.signature,dealId:selected.dealId,requestId:crypto.randomUUID()};
  phase('Сохраняю…','Фиксирую проверенную версию анкеты…');
  const row=await post(selected.dealId,{action:'prepare',requestId:attempt.requestId,identityRevision:selected.identityRevision,payload:selected.payload,bindings:selected.bindings});
  await advance(selected.dealId,row,()=>currentDeal()===selected.dealId&&signature()===selected.signature);
 });
 resume.onclick=()=>operate(async()=>{const selected=latest,snapshot=signature();if(!selected)throw Error('Сохранение не найдено.');await confirmDestination();await advance(selected.dealId,selected,()=>currentDeal()===selected.dealId&&signature()===snapshot);});
 cancel.onclick=()=>operate(async()=>{if(!latest)return;const row=await post(latest.dealId,{action:'cancel',requestId:latest.requestId});if(row.state!=='cancelled')throw Error('Запись уже отправлялась. Нужно проверить результат сохранения.');attempt=null;status.textContent='Подготовка отменена. История сохранена; можно проверить новую версию.';});
 profile.onclick=saveProfile;
 document.addEventListener('assessment-case-opened',()=>{clearFile();profileAttempt=null;refresh();});window.addEventListener('pagehide',clearFile);
 return {invalidate(){checked=null;clearFile();save.disabled=busy;},checked(result,context){checked=result.readyToSubmit?{...context,identityRevision:result.identityRevision}:null;save.disabled=busy;refresh();}};
}};
