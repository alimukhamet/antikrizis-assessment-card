window.SubmissionFlow={mount(anchor,status){
 const save=document.createElement('button');save.type='button';save.id='saveAssessment';save.className='btn btn-main';save.textContent='Скачать договор';save.disabled=false;anchor.after(save);
 const fileLink=document.createElement('a');fileLink.id='downloadContractFile';fileLink.className='btn btn-ghost';fileLink.textContent='Скачать готовый файл договора';fileLink.hidden=true;save.after(fileLink);let fileUrl=null;
 function clearFile(){if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl=null;fileLink.hidden=true;fileLink.removeAttribute('href');}
 const recovery=document.createElement('details'),summary=document.createElement('summary'),savedText=document.createElement('pre'),resume=document.createElement('button'),cancel=document.createElement('button');
 summary.textContent='Сохранённая версия анкеты';savedText.style.whiteSpace='pre-wrap';resume.type=cancel.type='button';resume.className=cancel.className='btn btn-ghost';cancel.textContent='Отменить подготовку';recovery.append(summary,savedText,resume,cancel);recovery.hidden=true;save.after(recovery);
 const currentRenderer=window.ContractRenderer;
 let checked=null,attempt=null,latest=null,busy=false,busyLabel='Скачать договор',generation=0,destination=null,destinationSnapshot=null;
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
 const messages={SUBMISSION_DESTINATION_CHANGED:'Получатель изменился. Откройте сделку заново.',ASSESSMENT_NOT_READY:'Ответы или документы требуют проверки.',SUBMISSION_PENDING_OR_IDENTITY_CHANGED:'Предыдущая отправка в Bitrix ещё не подтверждена или изменился сотрудник/клиент. Новая отправка не выполнена.',SUBMISSION_EVIDENCE_CHANGED:'Источники изменились. Отмените подготовку и проверьте анкету заново.',SUBMISSION_VALIDATION_CHANGED:'Правила проверки обновились. Отмените подготовку и проверьте анкету заново.',IDEMPOTENCY_KEY_REUSED:'Для этого сохранения уже зафиксирована другая версия ответов.',SUBMISSION_ACTOR_OR_IDENTITY_CHANGED:'Сотрудник или клиент изменился. Откройте сделку заново.',CONTRACT_SNAPSHOT_UNAVAILABLE:'Версия договора недоступна; требуется восстановление.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился.'};
 async function post(dealId,body){if(['generate','complete','prepare','commit','history'].includes(body.action)){guardDestination();body={...body,destination};}const url=`/api/assessment/${encodeURIComponent(dealId)}/submission`,options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},message=code=>messages[code]||'Операция не подтверждена. Проверьте сохранённую версию и повторите.';if(HostedAssessment.requestJson)return HostedAssessment.requestJson(url,options,{timeoutMs:120000,message});const response=await fetch(url,options),data=await response.json();if(!response.ok)throw Error(message(data.error));return data;}
 async function refresh(){
  const dealId=currentDeal(),token=++generation;latest=null;recovery.hidden=true;if(!dealId)return;
  try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/submission`,{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(token!==generation||currentDeal()!==dealId)return;
   if(!data.submission)return;latest={...data.submission,dealId};recovery.hidden=false;savedText.textContent=latest.reviewText||`${latest.clientName} — договор ${latest.contractNumber}`;
   resume.textContent=latest.state==='verified'&&latest.historySaved?'Скачать сохранённый договор':`Продолжить сохранение договора ${latest.contractNumber}`;cancel.hidden=latest.state!=='prepared';
  }catch{/* A failed status fetch never authorizes a new write. */}
 }
 async function download(dealId,requestId,generatedContract){
  const savedSignature=signature();
  const guardDownload=()=>{if(currentDeal()!==dealId||signature()!==savedSignature)throw Error('Клиент или ответы изменились во время подготовки договора. Проверьте текущую версию и скачайте договор заново.');};
  const contract=generatedContract||(await post(dealId,{action:'contract',requestId})).contract;const version=contract?.rendererVersion;
  guardDownload();
  if(!contract?.data||typeof contract.data!=='object'||Array.isArray(contract.data))throw Error('Сервер не вернул данные договора. Повторите скачивание.');
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
 // Download availability and CRM confirmation are separate facts.
 function syncMessage(row){
  if(row.outcomeCode==='NOT_SENT:ASSESSMENT_CHANGED_IN_CRM')return 'Карточка изменилась в Bitrix. Ничего не перезаписано. Сверьте изменения перед сохранением; сформированный файл доступен.';
  if(row.assessmentSaved&&row.historySaved)return 'Карточка и история сохранены в Bitrix.';
  if(row.assessmentSaved)return 'Карточка сохранена в Bitrix, но история ещё не подтверждена.';
  return 'Сохранение в Bitrix пока не подтверждено. Повторное нажатие продолжит безопасную проверку без дублирования отправки.';
 }
 async function resumeSaved(selected,snapshot){
  const unchanged=()=>currentDeal()===selected.dealId&&signature()===snapshot;
  await confirmDestination();
  const row=await post(selected.dealId,{action:'complete',requestId:selected.requestId});
  if(!unchanged())throw Error('Клиент или ответы изменились. Откройте нужную версию договора.');
  if(!row.assessmentSaved||!row.historySaved)throw Error(syncMessage(row)+' Для договора по текущим ответам нажмите «Скачать договор».');
  await download(selected.dealId,row.requestId);
  report('Сохранённый договор готов. '+syncMessage(row));
 }
 async function operate(action){if(busy)return;const operationDeal=currentDeal();busy=true;busyLabel='Проверяю…';destination=null;destinationSnapshot=null;clearFile();save.disabled=resume.disabled=cancel.disabled=true;save.textContent=busyLabel;report('Проверяю данные для договора…');try{await action();}catch(error){if(currentDeal()===operationDeal){recovery.open=true;report(error.message);}}finally{busy=false;busyLabel='Скачать договор';resume.disabled=cancel.disabled=false;save.disabled=false;save.textContent=busyLabel;progress();void refresh();}}
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
  guardDestination();
  if(!selectionUnchanged())throw Error('Ответы изменились. Проверьте анкету ещё раз.');
  if(attempt?.signature!==selected.signature||attempt?.dealId!==selected.dealId)attempt={signature:selected.signature,dealId:selected.dealId,requestId:crypto.randomUUID()};
  const input={requestId:attempt.requestId,identityRevision:selected.identityRevision,payload:selected.payload,bindings:selected.bindings};
  phase('Готовлю договор…','Формирую договор по проверенным ответам…');
  const {contract}=await post(selected.dealId,{...input,action:'generate'});
  if(!contract)throw Error('Сервер не вернул данные договора. Повторите скачивание.');
  if(!selectionUnchanged())throw Error('Клиент или ответы изменились во время подготовки договора. Проверьте текущую версию.');
  await download(selected.dealId,input.requestId,contract);
  // The file is available BEFORE optional CRM synchronization. A CRM failure must
  // neither remove that file nor be described as a successful save.
  phase('Сохраняю в Bitrix…','Договор готов и доступен по ссылке ниже. Сохранение в Bitrix ещё не подтверждено…');
  try{
   guardDestination();
   if(window.AssessmentDocumentUpload)await window.AssessmentDocumentUpload.submit({onProgress:text=>{if(selectionUnchanged())report('Договор готов. '+text);}});
   if(!selectionUnchanged())throw Error('Ответы изменились после формирования файла. Сохранение текущей версии в Bitrix не подтверждено.');
   const row=await post(selected.dealId,{...input,action:'complete'});
   if(selectionUnchanged())report('Договор готов. '+syncMessage(row));
   else if(currentDeal()===selected.dealId){clearFile();report('Ответы изменились после формирования файла. Нажмите «Скачать договор» для новой версии.');}
  }catch(error){
   if(selectionUnchanged())report('Договор готов и доступен по ссылке ниже. Сохранение в Bitrix НЕ подтверждено. '+error.message);
   else if(currentDeal()===selected.dealId){clearFile();report('Ответы изменились после формирования файла. Сохранение текущей версии не подтверждено. Нажмите «Скачать договор» для новой версии.');}
  }

 });
 resume.onclick=()=>operate(async()=>{const selected=latest,snapshot=signature();if(!selected)throw Error('Сохранение не найдено.');await resumeSaved(selected,snapshot);});
 cancel.onclick=()=>operate(async()=>{if(!latest)return;const row=await post(latest.dealId,{action:'cancel',requestId:latest.requestId});if(row.state!=='cancelled')throw Error('Запись уже отправлялась. Нужно проверить результат сохранения.');attempt=null;status.textContent='Подготовка отменена. История сохранена; можно проверить новую версию.';});
 document.addEventListener('assessment-case-opened',()=>{clearFile();refresh();});window.addEventListener('pagehide',clearFile);
 return {invalidate(){checked=null;clearFile();save.disabled=busy;},checked(result,context){checked=result.readyToSubmit?{...context,identityRevision:result.identityRevision}:null;save.disabled=busy;refresh();}};
}};
