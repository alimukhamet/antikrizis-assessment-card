window.SubmissionFlow={mount(anchor,status){
 const save=document.createElement('button');save.type='button';save.id='saveAssessment';save.className='btn btn-main';save.textContent='Скачать договор';save.disabled=false;anchor.after(save);
 const recovery=document.createElement('details'),summary=document.createElement('summary'),savedText=document.createElement('pre'),resume=document.createElement('button'),cancel=document.createElement('button');
 summary.textContent='Сохранённая версия анкеты';savedText.style.whiteSpace='pre-wrap';resume.type=cancel.type='button';resume.className=cancel.className='btn btn-ghost';cancel.textContent='Отменить подготовку';recovery.append(summary,savedText,resume,cancel);recovery.hidden=true;save.after(recovery);
 let checked=null,attempt=null,latest=null,busy=false,generation=0,destination=null,destinationSnapshot=null;
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
 const messages={SUBMISSION_DESTINATION_CHANGED:'Получатель изменился. Откройте сделку заново.',ASSESSMENT_NOT_READY:'Ответы или документы требуют проверки.',SUBMISSION_PENDING_OR_IDENTITY_CHANGED:'Есть незавершённое сохранение. Откройте сохранённую версию ниже.',SUBMISSION_EVIDENCE_CHANGED:'Источники изменились. Отмените подготовку и проверьте анкету заново.',SUBMISSION_VALIDATION_CHANGED:'Правила проверки обновились. Отмените подготовку и проверьте анкету заново.',IDEMPOTENCY_KEY_REUSED:'Для этого сохранения уже зафиксирована другая версия ответов.',SUBMISSION_ACTOR_OR_IDENTITY_CHANGED:'Сотрудник или клиент изменился. Откройте сделку заново.',CONTRACT_SNAPSHOT_UNAVAILABLE:'Версия договора недоступна; требуется восстановление.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился.'};
 async function post(dealId,body){if(['prepare','commit','history'].includes(body.action)){guardDestination();body={...body,destination};}const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/submission`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(messages[data.error]||'Операция не подтверждена. Проверьте сохранённую версию и повторите.');return data;}
 async function refresh(){
  const dealId=currentDeal(),token=++generation;latest=null;recovery.hidden=true;if(!dealId)return;
  try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/submission`,{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(token!==generation||currentDeal()!==dealId)return;
   if(!data.submission)return;latest={...data.submission,dealId};recovery.hidden=false;savedText.textContent=latest.reviewText||`${latest.clientName} — договор ${latest.contractNumber}`;
   resume.textContent=latest.state==='verified'&&latest.historySaved?'Скачать сохранённый договор':`Продолжить сохранение договора ${latest.contractNumber}`;cancel.hidden=latest.state!=='prepared';
  }catch{/* A failed status fetch never authorizes a new write. */}
 }
 async function download(dealId,requestId){
  const {contract}=await post(dealId,{action:'contract',requestId});const version=contract?.rendererVersion;
  if(!/^[a-f0-9]{64}$/.test(version||''))throw Error('Не удалось определить сохранённую версию договора.');
  if(!window.ContractRenderers?.[version])await new Promise((resolve,reject)=>{const currentRenderer=window.ContractRenderer,script=document.createElement('script');script.src=`/contract-renderers/${version}.js`;script.onload=()=>{window.ContractRenderer=currentRenderer;resolve();};script.onerror=()=>reject(Error('Не удалось загрузить сохранённую версию договора.'));document.head.append(script);});
  const renderer=window.ContractRenderers?.[version];if(!renderer)throw Error('Сохранённая версия договора не найдена.');
  const blob=await renderer.render(contract.data,version);if(currentDeal()!==dealId)throw Error('Открыта другая сделка. Скачайте договор из сохранённой версии нужной сделки.');
  const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=(HostedAssessment.getContext().client.title+` — договор — сделка ${dealId}.docx`).replace(/[\\/:*?"<>|]/g,'_');link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function advance(dealId,row,guard){
  const requestId=row.requestId;if(currentDeal()!==dealId)throw Error('Открыта другая сделка.');
  if(row.state==='prepared'){
   if(guard&&!guard()){await post(dealId,{action:'cancel',requestId});throw Error('Ответы изменились. Проверьте анкету заново.');}
   status.textContent='Сохраняю карточку в Bitrix…';row=await post(dealId,{action:'commit',requestId});
  }else if(['writing','uncertain'].includes(row.state)){status.textContent='Проверяю результат сохранения…';row=await post(dealId,{action:'reconcile',requestId});}
  if(!row.assessmentSaved)throw Error('Сохранение карточки ещё не подтверждено. Повторите проверку через сохранённую версию; повторной отправки не будет.');
  if(!row.historySaved){status.textContent='Сохраняю анкету в историю сделки…';row=await post(dealId,{action:'history',requestId});}
  if(!row.historySaved)throw Error('Карточка сохранена. История ещё не подтверждена; продолжите из сохранённой версии.');
  status.textContent='Готовлю сохранённый договор…';await download(dealId,requestId);status.textContent='Карточка, документы и история сохранены в сделке. Договор передан на скачивание.';
 }
 async function operate(action){if(busy)return;busy=true;destination=null;destinationSnapshot=null;save.disabled=resume.disabled=cancel.disabled=true;try{await action();}catch(error){status.textContent=error.message;}finally{busy=false;resume.disabled=cancel.disabled=false;save.disabled=false;await refresh();}}
 save.onclick=()=>operate(async()=>{
  if(!checked||currentDeal()!==checked.dealId||signature()!==checked.signature){
   await window.AssessmentCheck?.run();
   const result=window.AssessmentCheck?.result();
   const issues=result?.documents?.issues||[],pending=ServerDrafts.capture().pendingFiles||[];
   const keysOnly=issues.some(i=>i.code==='EDS_SEPARATE_UPLOAD_REQUIRED')&&issues.every(i=>i.code==='EDS_SEPARATE_UPLOAD_REQUIRED'||i.code==='DOCUMENT_UPLOAD_PENDING')&&(!pending.length||window.CredentialUpload?.pendingOnly(pending));
   if(!checked&&result?.answersComplete&&!result.evidence?.issues.length&&keysOnly){
    await confirmDestination();guardDestination();await window.CredentialUpload?.submit();await window.AssessmentCheck.run();
   }
   if(!checked){if(!window.AssessmentCheck)throw Error('Проверьте текущую анкету перед сохранением.');return;}
  }
  if(currentDeal()!==checked.dealId||signature()!==checked.signature)throw Error('Ответы изменились. Проверьте анкету ещё раз.');
  await confirmDestination();
  const selected=checked;
  if(window.ServerDrafts.save&&!await window.ServerDrafts.save({automatic:true}))throw Error('Сначала сохраните черновик.');
  guardDestination();if(window.AssessmentDocumentUpload)await window.AssessmentDocumentUpload.submit();
  if(currentDeal()!==selected.dealId||signature()!==selected.signature)throw Error('Ответы изменились во время сохранения документов. Проверьте анкету ещё раз.');
  if(attempt?.signature!==selected.signature||attempt?.dealId!==selected.dealId)attempt={signature:selected.signature,dealId:selected.dealId,requestId:crypto.randomUUID()};
  status.textContent='Фиксирую проверенную версию анкеты…';
  const row=await post(selected.dealId,{action:'prepare',requestId:attempt.requestId,identityRevision:selected.identityRevision,payload:selected.payload,bindings:selected.bindings});
  await advance(selected.dealId,row,()=>currentDeal()===selected.dealId&&signature()===selected.signature);
 });
 resume.onclick=()=>operate(async()=>{if(!latest)throw Error('Сохранение не найдено.');await confirmDestination();await advance(latest.dealId,latest);});
 cancel.onclick=()=>operate(async()=>{if(!latest)return;const row=await post(latest.dealId,{action:'cancel',requestId:latest.requestId});if(row.state!=='cancelled')throw Error('Запись уже отправлялась. Нужно проверить результат сохранения.');attempt=null;status.textContent='Подготовка отменена. История сохранена; можно проверить новую версию.';});
 document.addEventListener('assessment-case-opened',refresh);
 return {invalidate(){checked=null;save.disabled=busy;},checked(result,context){checked=result.readyToSubmit?{...context,identityRevision:result.identityRevision}:null;save.disabled=busy;refresh();}};
}};
