(()=>{
 const ui=ClientContextUI;if(ui.mode!=='handoff')return;
 const $=id=>document.getElementById(id),make=ui.make,send=$('handoffSend'),signedInput=$('handoffSignedFile'),signedAgree=$('handoffSignedConfirmed');
 let busy=false,stage=null,pending=null,statusLoaded=false,powerCheckedId=null,message='',generation=0;
 const errors={HANDOFF_NOT_IN_SALES:'Сделка уже не в воронке продаж. Стадия не изменена.',HANDOFF_STAGE_UNVERIFIED:'В Bitrix не подтверждена стадия «Сделка завершена». Обратитесь к руководителю.',HANDOFF_ALREADY_COMPLETED:'Сделка уже завершена. Повторная передача не нужна.',HANDOFF_STAGE_CHANGED:'Стадия сделки изменилась. Обновите состояние перед передачей.',HANDOFF_ALREADY_PENDING:'Передача уже начата. Обновите состояние.',HANDOFF_OWNED_BY_ANOTHER_WORKER:'Передачу уже начал другой сотрудник. Обратитесь к нему.',HANDOFF_OUTCOME_UNCERTAIN:'Результат перехода ещё не подтверждён. Нажмите «Проверить результат» — повторного перехода не будет.',HANDOFF_UPLOAD_UNCERTAIN:'Сохранение файлов ещё не подтверждено. Повторите проверку; повторная отправка файлов не выполняется.',HANDOFF_POWER_NOT_READY:'Завершите проверку доверенности.',HANDOFF_CREDENTIALS_REQUIRED:'Сохраните ЭЦП и пароль и подтвердите владельца.',HANDOFF_SIGNED_PDF_REQUIRED:'Загрузите окончательный подписанный PDF из TrustMe.',HANDOFF_DOCUMENTS_CHANGED:'Документы или их подтверждения изменились. Отмените подготовку и проверьте пакет заново.',HANDOFF_FILE_REMOVED:'Один из файлов удалён из Bitrix. Передача остановлена.',HANDOFF_FILE_CHANGED:'Содержимое файла в Bitrix изменилось. Передача остановлена.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился. Откройте клиента заново.',WRONG_CLIENT:'В документе указан другой клиент.',SIGN_IN_REQUIRED:'Войдите заново. Выбранные документы останутся в черновике.'};
 const explanation=code=>errors[code]||'Не удалось подтвердить действие. Проверьте состояние и повторите.';
 const signed=()=>selectedFiles.find(i=>i.type==='Подписанный договор'&&i.person==='Клиент'&&i.storedDocumentId);
 const powers=()=>selectedFiles.filter(i=>i.type==='Доверенность'&&i.person==='Клиент');
 const choice=make('select');choice.id='handoffPowerChoice';choice.setAttribute('aria-label','Доверенность для передачи');$('handoffPowerStatus').before(choice);
 const power=()=>{const list=powers();return list.length===1?list[0]:list.find(i=>String(i.id)===choice.value);};
 function state(id,ready,text){$(id).dataset.ready=String(ready);$(id).textContent=text;}
 function refresh(){
  const list=powers(),signature=list.map(i=>i.id+':'+i.file.name).join('|');
  if(choice.dataset.signature!==signature){const value=choice.value;choice.replaceChildren(new Option('— Выберите доверенность —',''));for(const item of list)choice.add(new Option(item.file.name,String(item.id)));choice.value=value;choice.dataset.signature=signature;}
  choice.hidden=list.length<2;choice.disabled=busy||Boolean(pending);
  for(const input of document.querySelectorAll('#uxHandoff [data-required-picker],#previewEdsPassword'))input.disabled=busy||af.busy||Boolean(pending)||!ui.ready();
  const item=power(),powerReady=Boolean(item?.storedDocumentId&&powerCheckedId===item.storedDocumentId),key=Boolean(CredentialUpload.collected()),contract=Boolean(signed()&&signedAgree.checked),count=Number(key)+Number(powerReady)+Number(contract);
  state('handoffKeyState',key,CredentialUpload.verified()?'Сохранена в Bitrix':key?'Готова к сохранению':'Нужны ключ и пароль');state('handoffPowerState',powerReady,powerReady?'Проверена':item?'Нужна проверка':'Не выбрана');state('handoffSignedState',contract,contract?'Подтверждено сотрудником':signed()?'Проверьте подпись и QR':'Не добавлен');
  $('handoffSignedName').textContent=signed()?.file.name||'Файл не выбран';$('handoffSignedOpen').hidden=!signed();$('handoffPowerOpen').hidden=!item?.storedDocumentId;
  $('handoffCount').textContent='Пакет: '+count+' из 3';signedInput.disabled=busy||Boolean(pending);signedAgree.disabled=busy||Boolean(pending);$('handoffPowerCheck').disabled=busy||!item||!ui.ready();
  send.textContent=pending?.state==='verified'?'Стадия изменена':pending?.state==='writing'||pending?.state==='uncertain'?'Проверить результат':pending?'Продолжить передачу':'Передать юристам →';
  send.disabled=busy||!ui.ready()||!statusLoaded||pending?.state==='verified'||(!pending&&(!stage||count!==3));
  $('handoffCancel').hidden=pending?.state!=='prepared';$('handoffCancel').disabled=busy;
  $('handoffReason').textContent=message||(pending?.state==='verified'?'Сделка переведена в «Сделка завершена». Дальнейшую передачу выполняет робот Bitrix.':pending?'Есть сохранённая попытка передачи.':count===3?'Проверьте клиента и подтвердите переход.':'Подготовьте ЭЦП, доверенность и подписанный договор.');
 }
 async function request(body){
  const current=ui.context(),path='/api/assessment/'+current.client.external.dealId+'/handoff';
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'}),data=await response.json();
  if(ui.context()!==current)throw Error('Клиент изменился. Действие остановлено.');if(!response.ok)throw Error(explanation(data.error));return data;
 }
 async function load(){
  if(!ui.context())return;const token=++generation;statusLoaded=false;
  try{const data=await request();if(token!==generation)return;pending=data.handoff;stage=data.destination;statusLoaded=!data.stageError;
   $('handoffStage').textContent=data.stageError?explanation(data.stageError):pending?.state==='verified'?'Переход подтверждён в Bitrix.':(pending?.destination||stage)?'Переход: «'+(pending?.destination||stage).fromStageName+'» → «'+(pending?.destination||stage).stageName+'». Дальше работает настроенный робот Bitrix.':'';
  }catch(error){message=error.message;statusLoaded=false;}finally{refresh();}
 }
 async function inspectPower(){
  if(!ui.ready())return;const item=power();powerCheckedId=null;if(!item?.storedDocumentId){refresh();return;}
  const current=ui.context(),payload=ServerDrafts.capture();payload.documents=payload.documents.filter(d=>d.documentId===item.storedDocumentId);
  // Load the original's page count and review context without applying its answers.
  if(af.results.get(item.id)?.server?.documentId!==item.storedDocumentId){
   const analysis=await HostedAssessment.analyzeFile(item,{cacheOnly:true});if(ui.context()!==current||power()!==item)return;
   af.results.set(item.id,HostedAssessment.adapt(analysis));
  }
  const response=await fetch('/api/assessment/'+current.client.external.dealId+'/handoff-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload})});
  if(!response.ok)throw Error('Не удалось проверить доверенность.');const result=await response.json();if(ui.context()!==current||power()!==item)return;
  const panel=$('handoffPowerReview');panel.replaceChildren();DocumentReview.render(panel,result,current.client.external.dealId,payload.documents,inspectPower);
  if(result.documents.packageReady)powerCheckedId=item.storedDocumentId;$('handoffPowerStatus').textContent=result.documents.packageReady?'Владелец, срок и полномочия проверены.':result.documents.issues.map(i=>i.message).join(' ');refresh();
 }
 choice.onchange=()=>inspectPower().catch(error=>{message=error.message;refresh();});
 $('handoffPowerOpen').onclick=()=>{const item=power();if(item)afSource({fileId:item.id,page:1});};$('handoffSignedOpen').onclick=()=>{const item=signed();if(item)afSource({fileId:item.id,page:1});};
 $('handoffPowerCheck').onclick=async()=>{if(busy||!power())return;busy=true;refresh();try{if(!power().storedDocumentId)await afAnalyze({onlyNew:true});await inspectPower();if(!await ServerDrafts.save({automatic:true}))throw Error('Не удалось сохранить черновик.');}catch(error){message=error.message;}finally{busy=false;refresh();}};
 const originalOpen=DocumentReview.open;DocumentReview.open=async id=>{const item=selectedFiles.find(i=>i.storedDocumentId===id);if(item?.type!=='Доверенность')return originalOpen(id);if(powers().length>1)choice.value=String(item.id);await inspectPower();const details=$('handoffPowerReview').querySelector('details');if(details){details.open=true;details.scrollIntoView({block:'center'});}};
 signedInput.onchange=async()=>{
  const file=signedInput.files[0];if(!file||busy||pending||!ui.ready())return;const current=ui.context();busy=true;signedAgree.checked=false;message='Сохраняем подписанный PDF…';refresh();
  try{
   if(!/\.pdf$/i.test(file.name)||!file.size||file.size>35*1024*1024)throw Error('Выберите непустой PDF до 35 МБ.');
   const response=await fetch('/api/assessment/'+current.client.external.dealId+'/documents',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Document-Name':encodeURIComponent(file.name)},body:file}),result=await response.json();
   if(!response.ok||!result.documentId)throw Error('PDF не удалось прочитать и сохранить.');
   if(ui.context()!==current||result.client?.external.dealId!==current.client.external.dealId)throw Error('Клиент изменился.');
   const detected=result.document?.extraction?.identity?.iin;if(detected&&detected!==current.client.iin)throw Error('В договоре указан другой ИИН. Проверьте клиента.');
   selectedFiles=selectedFiles.filter(i=>i.type!=='Подписанный договор');selectedFiles.push({id:++fileSequence,file,type:'Подписанный договор',person:'Клиент',storedDocumentId:result.documentId});renderDocuments();
   if(!await ServerDrafts.save({automatic:true}))throw Error('PDF прочитан, но черновик не сохранён. Нажмите «Сохранить черновик» перед продолжением.');message='PDF сохранён. Откройте его и проверьте клиента, подпись и QR.';
  }catch(error){message=error.message;}finally{busy=false;signedInput.value='';refresh();}
 };
 signedAgree.onchange=()=>{message='';refresh();};
 send.onclick=async()=>{
  if(send.disabled)return;busy=true;message='';refresh();const current=ui.context(),selectedPower=power()?.storedDocumentId,selectedSigned=signed()?.storedDocumentId,oldPending=pending;
  try{
   const target=oldPending?.destination||stage,destination=await ui.confirm(oldPending?'Продолжить проверку передачи':'Сохранить пакет и завершить сделку','ЭЦП, доверенность и подписанный договор останутся в этой сделке. Переход: «'+target.fromStageName+'» → «'+target.stageName+'». После перехода сработает робот Bitrix.');if(!destination)return;
   if(ui.context()!==current)throw Error('Клиент изменился.');
   if(!oldPending){
    if(selectedPower!==power()?.storedDocumentId||selectedSigned!==signed()?.storedDocumentId||!signedAgree.checked)throw Error('Пакет изменился. Проверьте документы заново.');
    if(!await ServerDrafts.save({automatic:true}))throw Error('Сначала сохраните черновик.');
    message='Сохраняем ЭЦП и проверяем файлы…';refresh();await CredentialUpload.submit();
    if(ui.context()!==current||selectedPower!==power()?.storedDocumentId||selectedSigned!==signed()?.storedDocumentId||!signedAgree.checked)throw Error('Пакет изменился. Проверьте документы заново.');
   }
   message='Проверяем пакет и переход в Bitrix…';refresh();
   const result=await request({action:oldPending?'resume':'send',requestId:oldPending?.requestId||crypto.randomUUID(),destination,stage:target,powerId:selectedPower,signedId:selectedSigned,signedConfirmed:true});pending=result.handoff;
   message=pending?.state==='verified'?'Сделка переведена в «Сделка завершена». Дальше работает робот Bitrix.':explanation(pending?.outcomeCode);
  }catch(error){message=error.message;}finally{busy=false;await load();refresh();}
 };
 $('handoffCancel').onclick=async()=>{if(busy||pending?.state!=='prepared')return;busy=true;try{const destination=await ui.confirm('Отменить подготовку передачи','Стадия сделки не изменится. Уже сохранённые файлы останутся в Bitrix.');if(destination){await request({action:'cancel',requestId:pending.requestId,destination});message='Подготовка отменена. Файлы сохранены.';}}catch(error){message=error.message;}finally{busy=false;await load();}};
 $('handoffRefresh').onclick=async()=>{message='';await load();};
 document.addEventListener('assessment-case-opened',()=>{signedAgree.checked=false;powerCheckedId=null;load();});
 for(const event of ['assessment-draft-restored','assessment-analysis-complete'])document.addEventListener(event,()=>setTimeout(()=>{inspectPower().catch(error=>{message=error.message;refresh();});},0));
 for(const event of ['assessment-client-readiness-changed','assessment-credentials-changed','assessment-draft-saved','assessment-files-selected','change'])document.addEventListener(event,()=>queueMicrotask(refresh));
 refresh();if(ui.context())load();
})();
