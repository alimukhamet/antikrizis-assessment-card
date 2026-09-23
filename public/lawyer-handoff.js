(()=>{
 const ui=ClientContextUI;if(ui.mode!=='handoff')return;
 const $=id=>document.getElementById(id),make=ui.make,send=$('handoffSend'),signedInput=$('handoffSignedFile'),signedAgree=$('handoffSignedConfirmed');
 let busy=false,stage=null,pending=null,delivery=null,statusLoaded=false,powerCheckedId=null,message='',generation=0,inspection=0,statusBusy=false;
 const errors={HANDOFF_NOT_IN_SALES:'Сделка уже не в воронке продаж. Стадия не изменена.',HANDOFF_STAGE_UNVERIFIED:'Стадия продаж не подтверждена. Обратитесь к руководителю.',HANDOFF_ALREADY_COMPLETED:'Сделка уже завершена. Повторная передача не нужна.',HANDOFF_STAGE_CHANGED:'Стадия сделки изменилась. Обновите состояние перед передачей.',HANDOFF_ALREADY_PENDING:'Передача уже начата. Обновите состояние.',HANDOFF_OWNED_BY_ANOTHER_WORKER:'Передачу уже начал другой сотрудник. Обратитесь к нему.',HANDOFF_OUTCOME_UNCERTAIN:'Результат перехода ещё не подтверждён. Нажмите «Проверить результат» — повторного перехода не будет.',HANDOFF_UPLOAD_UNCERTAIN:'Сохранение файлов ещё не подтверждено. Повторите проверку; повторная отправка файлов не выполняется.',HANDOFF_POWER_NOT_READY:'Завершите проверку доверенности.',HANDOFF_CREDENTIALS_REQUIRED:'Сохраните ЭЦП и пароль и подтвердите владельца.',HANDOFF_SIGNED_PDF_REQUIRED:'Загрузите окончательный подписанный PDF из TrustMe.',HANDOFF_DOCUMENTS_CHANGED:'Документы или их подтверждения изменились. Отмените подготовку и проверьте пакет заново.',HANDOFF_FILE_REMOVED:'Один из файлов удалён из Bitrix. Передача остановлена.',HANDOFF_FILE_CHANGED:'Содержимое файла в Bitrix изменилось. Передача остановлена.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился. Откройте клиента заново.',WRONG_CLIENT:'В документе указан другой клиент.',SIGN_IN_REQUIRED:'Войдите заново. Документы сохранены.',CLIENT_IDENTITY_UNVERIFIED:'Подтвердите ИИН клиента.',HANDOFF_CRM_UNAVAILABLE:'Bitrix не отвечает. Повторите проверку.',INVALID_HANDOFF_RESPONSE:'Не удалось прочитать состояние передачи. Повторите проверку.'};
 const explanation=code=>errors[code]||'Не удалось завершить действие. Повторите проверку.';
 Object.assign(errors,{HANDOFF_TITLE_PLAN_REQUIRED:'Обновите подготовку названия: нажмите «Отменить подготовку», затем «Передать юристам». Сохранённые файлы останутся в Bitrix.',HANDOFF_TITLE_CHANGED:'Название сделки изменилось. Нажмите «Отменить подготовку» и проверьте передачу заново. Сохранённые файлы останутся в Bitrix.',HANDOFF_TITLE_UNVERIFIED:'Переход выполнен, но название сделки не подтверждено. Нажмите «Проверить результат». Если сообщение осталось, обратитесь к руководителю.',HANDOFF_ASSESSMENT_REQUIRED:'Анкета не сохранена в Bitrix. Откройте договор и завершите сохранение.',HANDOFF_ASSESSMENT_PENDING:'Сохранение анкеты не завершено. Откройте договор и проверьте результат.',HANDOFF_ASSESSMENT_CHANGED:'Данные анкеты изменились. Откройте договор и сверьте сохранение.',HANDOFF_ASSESSMENT_UNVERIFIED:'Не удалось проверить анкету в Bitrix. Повторите проверку.',HANDOFF_ORIGINALS_REQUIRED:'Документы анкеты не сохранены в Bitrix. Откройте договор и завершите сохранение.',HANDOFF_ORIGINALS_UNVERIFIED:'Не удалось проверить документы в Bitrix. Повторите проверку.',HANDOFF_ORIGINAL_REMOVED:'В Bitrix не хватает документа анкеты. Откройте договор и проверьте файлы.',HANDOFF_ORIGINAL_CHANGED:'Документ анкеты в Bitrix изменился. Откройте договор и проверьте файл.'});
 const invalid=()=>Object.assign(Error(explanation('INVALID_HANDOFF_RESPONSE')),{code:'INVALID_HANDOFF_RESPONSE'});
 const isStage=value=>Boolean(value&&typeof value==='object'&&['fromStageName','stageName'].every(key=>typeof value[key]==='string'&&value[key]));
 const isHandoff=value=>Boolean(value&&typeof value==='object'&&typeof value.requestId==='string'&&['prepared','writing','uncertain','verified','cancelled'].includes(value.state)&&isStage(value.destination));
 // One bounded request path: preserve the session recovery UI and never replay writes.
 async function json(current,path,options={},timeoutMs=30000){
  try{const data=await HostedAssessment.requestJson(path,options,{timeoutMs,message:explanation});
   if(ui.context()!==current)throw Error('Клиент изменился.');return data;
  }catch(error){if(error.code==='REQUEST_TIMEOUT')throw Error('Ответ не получен. Проверьте состояние; повторной отправки не будет.');throw error;}
 }
 const signed=()=>selectedFiles.find(i=>i.type==='Подписанный договор'&&i.person==='Клиент'&&i.storedDocumentId);
 const powers=()=>selectedFiles.filter(i=>i.type==='Доверенность'&&i.person==='Клиент');
 const choice=make('select');choice.id='handoffPowerChoice';choice.setAttribute('aria-label','Доверенность для передачи');$('handoffPowerStatus').before(choice);
 const power=()=>{const list=powers();return list.length===1?list[0]:list.find(i=>String(i.id)===choice.value);};
 function state(id,ready,text){$(id).dataset.ready=String(ready);$(id).textContent=text;}
 function refresh(){
  const locked=busy||af.busy||statusBusy||Boolean(pending)||!ui.ready();
  document.querySelectorAll('#uxHandoff .ux-handoff-card').forEach(card=>{card.inert=locked;});
  const list=powers(),signature=list.map(i=>i.id+':'+i.file.name).join('|');
  if(choice.dataset.signature!==signature){const value=choice.value;choice.replaceChildren(new Option('— Выберите доверенность —',''));for(const item of list)choice.add(new Option(item.file.name,String(item.id)));choice.value=value;choice.dataset.signature=signature;}
  choice.hidden=list.length<2;choice.disabled=locked;
  for(const input of document.querySelectorAll('#uxHandoff [data-required-picker],#previewEdsPassword'))input.disabled=locked;
  const item=power(),powerReady=Boolean(item?.storedDocumentId&&powerCheckedId===item.storedDocumentId),key=Boolean(CredentialUpload.collected()),contract=Boolean(signed()&&signedAgree.checked),count=Number(key)+Number(powerReady)+Number(contract);
  state('handoffKeyState',key,CredentialUpload.verified()?'Сохранена в Bitrix':key?'Готова к сохранению':'Нужны ключ и пароль');state('handoffPowerState',powerReady,powerReady?'Проверена':item?'Нужна проверка':'Не выбрана');state('handoffSignedState',contract,contract?'Проверен':signed()?'Проверьте подпись и QR':'Не добавлен');
  $('handoffSignedName').textContent=signed()?.file.name||'Файл не выбран';$('handoffSignedOpen').hidden=!signed();$('handoffPowerOpen').hidden=!item?.storedDocumentId;
  $('handoffCount').textContent='Пакет: '+count+' из 3';signedInput.disabled=locked;signedAgree.disabled=locked;$('handoffPowerCheck').disabled=locked||!item;
  send.textContent=busy?'Передаём…':statusBusy?'Проверяем…':pending?.state==='verified'?'Стадия изменена':pending?.state==='writing'||pending?.state==='uncertain'?'Проверить результат':pending?'Продолжить передачу':'Передать юристам →';
  const reconcileOnly=pending?.state==='writing'||pending?.state==='uncertain';
  send.disabled=busy||af.busy||statusBusy||!ui.ready()||!statusLoaded||pending?.state==='verified'||(!reconcileOnly&&delivery?.ready!==true)||(!pending&&(!stage||count!==3));
  $('handoffDelivery').textContent=!ui.ready()?'':statusBusy?'Проверяем анкету и документы в Bitrix…':delivery?.ready?'Анкета и документы сохранены в Bitrix.':delivery?explanation(delivery.code):'Сохранение анкеты ещё не проверено.';
  $('handoffDelivery').dataset.ready=String(delivery?.ready===true);$('handoffAssessmentLink').hidden=!ui.ready()||!delivery||delivery.ready===true;
  $('handoffCancel').hidden=pending?.state!=='prepared';$('handoffCancel').disabled=busy||statusBusy;
  $('handoffRefresh').disabled=busy||statusBusy||!ui.ready();
  const next=!ui.ready()?'Выберите клиента.':statusBusy?'Проверяем состояние…':!statusLoaded?'Нажмите «Проверить состояние».':pending?.state==='verified'?'Передано.':pending?'Можно продолжить сохранённую передачу.':delivery?.ready!==true?'Сначала завершите сохранение анкеты и документов.':!key?'Добавьте ЭЦП и подтвердите владельца.':!powerReady?'Проверьте доверенность.':!contract?'Добавьте подписанный PDF и подтвердите подпись.':'Готово к передаче.';
  $('handoffReason').textContent=pending?.state==='verified'&&delivery?.ready===false?'Стадия уже изменена, но данные переданы не полностью.':message||next;
  window.FileSelectionControls?.refresh();
 }
 async function request(body){
  const current=ui.context(),path='/api/assessment/'+current.client.external.dealId+'/handoff';
  const data=await json(current,path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'},body?120000:30000);
  if(!Object.hasOwn(data,'handoff')||(data.handoff!==null&&!isHandoff(data.handoff)))throw invalid();
  if(data.handoff?.state==='cancelled'&&body?.action!=='cancel')throw invalid();
  if(!body&&data.destination!==null&&!isStage(data.destination))throw invalid();
  if(!body&&(!data.delivery||typeof data.delivery.ready!=='boolean'||(!data.delivery.ready&&typeof data.delivery.code!=='string')))throw invalid();
  if(body&&body.action!=='cancel'&&!data.handoff)throw invalid();
  return data;
 }
 async function load(){
  if(!ui.context())return;
  const current=ui.context(),token=++generation;statusLoaded=false;statusBusy=true;delivery=null;refresh();
  try{const data=await request();if(token!==generation||ui.context()!==current)return;
   pending=data.handoff;stage=data.destination;delivery=data.delivery;statusLoaded=!data.stageError;
   const target=pending?.destination||stage;
   $('handoffStage').textContent=data.stageError?explanation(data.stageError):target?'«'+target.fromStageName+'» → «'+target.stageName+'»':'';
   if(data.stageError)message=explanation(data.stageError);
   else if(!message&&pending?.outcomeCode&&pending.state!=='verified')message=explanation(pending.outcomeCode);
  }catch(error){if(token!==generation||ui.context()!==current)return;message=error.message;statusLoaded=false;}
  finally{if(token===generation&&ui.context()===current){statusBusy=false;refresh();}}
 }
 async function inspectPower(){
  if(!ui.ready()||pending)return;
  const item=power(),current=ui.context(),token=++inspection;powerCheckedId=null;
  const active=()=>token===inspection&&ui.context()===current&&power()===item;
  if(!item){refresh();return;}
  $('handoffPowerStatus').textContent='Проверяем…';refresh();
  try{
   // The second tool reads only the chosen power of attorney. Never run the
   // intake autofill pipeline or apply answers from unrelated client documents.
   if(!item.storedDocumentId||af.results.get(item.id)?.server?.documentId!==item.storedDocumentId){
    const analysis=await HostedAssessment.analyzeFile(item,{cacheOnly:Boolean(item.storedDocumentId)});
    if(!active())return;af.results.set(item.id,HostedAssessment.adapt(analysis));renderDocuments();
   }
   if(!item.storedDocumentId)throw Error('Не удалось сохранить доверенность.');
   const payload={schemaVersion:1,answers:[],groups:[],docContext:{social:'',salary:''},pendingFiles:[],documents:[{documentId:item.storedDocumentId,type:'Доверенность',person:'Клиент'}]};
   const result=await json(current,'/api/assessment/'+current.client.external.dealId+'/handoff-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload})});
   if(!active())return;
   if(result.identityRevision!==current.identityRevision||typeof result.documents?.packageReady!=='boolean'||!Array.isArray(result.documents.issues))throw invalid();
   const panel=$('handoffPowerReview');panel.replaceChildren();DocumentReview.render(panel,result,current.client.external.dealId,payload.documents,inspectPower);
   if(result.documents.packageReady)powerCheckedId=item.storedDocumentId;
   $('handoffPowerStatus').textContent=result.documents.packageReady?'Проверена.':result.documents.issues[0]?.message||'Сверьте доверенность по оригиналу.';
   refresh();
  }catch(error){if(!active())return;powerCheckedId=null;$('handoffPowerStatus').textContent=error.message;refresh();throw error;}
 }
 choice.onchange=()=>inspectPower().catch(error=>{message=error.message;refresh();});
 $('handoffPowerOpen').onclick=()=>{const item=power();if(item)afSource({fileId:item.id,page:1});};$('handoffSignedOpen').onclick=()=>{const item=signed();if(item)afSource({fileId:item.id,page:1});};
 $('handoffPowerCheck').onclick=async()=>{if(busy||statusBusy||pending||!power()||!ui.ready())return;const current=ui.context();busy=true;message='';refresh();try{await inspectPower();if(ui.context()!==current)return;if(!await ServerDrafts.save({automatic:true}))throw Error('Не удалось сохранить черновик.');}catch(error){if(ui.context()===current)message=error.message;}finally{if(ui.context()===current){busy=false;refresh();}}};
 const originalOpen=DocumentReview.open;DocumentReview.open=async id=>{const item=selectedFiles.find(i=>i.storedDocumentId===id);if(item?.type!=='Доверенность')return originalOpen(id);if(powers().length>1)choice.value=String(item.id);await inspectPower();const details=$('handoffPowerReview').querySelector('details');if(details){details.open=true;details.scrollIntoView({block:'center'});}};
 signedInput.onchange=async()=>{
  const file=signedInput.files[0];if(!file||busy||statusBusy||pending||!ui.ready())return;const current=ui.context();busy=true;signedAgree.checked=false;message='Сохраняем подписанный PDF…';refresh();
  try{
   if(!/\.pdf$/i.test(file.name)||!file.size||file.size>35*1024*1024)throw Error('Выберите непустой PDF до 35 МБ.');
   const result=await json(current,'/api/assessment/'+current.client.external.dealId+'/documents',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Document-Name':encodeURIComponent(file.name)},body:file},60000);
   if(!result.documentId)throw Error('PDF не удалось прочитать и сохранить.');
   if(ui.context()!==current||result.client?.external?.dealId!==current.client.external.dealId)throw Error('Клиент изменился.');
   const detected=result.document?.extraction?.identity?.iin;if(detected&&detected!==current.client.iin)throw Error('В договоре указан другой ИИН. Проверьте клиента.');
   selectedFiles=selectedFiles.filter(i=>i.type!=='Подписанный договор');selectedFiles.push({id:++fileSequence,file,type:'Подписанный договор',person:'Клиент',storedDocumentId:result.documentId});renderDocuments();
   if(!await ServerDrafts.save({automatic:true}))throw Error('PDF прочитан, но черновик не сохранён. Нажмите «Сохранить черновик» перед продолжением.');message='PDF сохранён. Проверьте клиента, подпись и QR.';
  }catch(error){if(ui.context()===current)message=error.message;}finally{if(ui.context()===current){busy=false;signedInput.value='';refresh();}}
 };
 async function inspectSigned(current,item){
  if(!item)throw Error(explanation('HANDOFF_SIGNED_PDF_REQUIRED'));
  const analysis=await HostedAssessment.analyzeFile(item,{cacheOnly:true});
  if(ui.context()!==current||signed()!==item)throw Error('Клиент или подписанный PDF изменился. Проверьте текущий файл.');
  if(analysis.client?.external?.dealId!==current.client.external.dealId||analysis.identityRevision!==current.identityRevision)throw Error(explanation('CASE_IDENTITY_CHANGED'));
  if(!analysis.document?.totalPages)throw Error(explanation('HANDOFF_SIGNED_PDF_REQUIRED'));
  const iin=analysis.document.extraction?.identity?.iin;
  if(iin&&iin!==current.client.iin)throw Error(explanation('WRONG_CLIENT'));
  // Read/preview only: a signed contract must never fill intake answers.
  af.results.set(item.id,HostedAssessment.adapt(analysis));
 }
 signedAgree.onchange=async()=>{
  message='';if(!signedAgree.checked||busy||pending){refresh();return;}
  const current=ui.context(),item=signed();busy=true;message='Проверяем сохранённый PDF…';refresh();
  try{await inspectSigned(current,item);if(ui.context()===current&&signed()===item)message='PDF прочитан. Подпись и QR подтверждены вами.';}
  catch(error){if(ui.context()===current&&signed()===item){signedAgree.checked=false;message=error.message;}}
  finally{if(ui.context()===current){busy=false;refresh();}}
 };
 send.onclick=async()=>{
  if(send.disabled)return;busy=true;message='';refresh();const current=ui.context(),selectedPower=power()?.storedDocumentId,selectedSigned=signed()?.storedDocumentId,oldPending=pending;
  try{
   const target=oldPending?.destination||stage,destination=await ui.confirm(oldPending?'Продолжить проверку передачи':'Сохранить пакет и завершить сделку','«'+target.fromStageName+'» → «'+target.stageName+'». Запустится робот Bitrix.');if(!destination)return;
   if(ui.context()!==current)throw Error('Клиент изменился.');
   if(!oldPending){
    if(selectedPower!==power()?.storedDocumentId||selectedSigned!==signed()?.storedDocumentId||!signedAgree.checked)throw Error('Пакет изменился. Проверьте документы заново.');
    if(!await ServerDrafts.save({automatic:true}))throw Error('Сначала сохраните черновик.');
    // Reprocess an older saved signed PDF before any outbound upload/stage write.
    await inspectSigned(current,signed());
    message='Сохраняем ЭЦП и проверяем файлы…';refresh();await CredentialUpload.submit();
    if(ui.context()!==current||selectedPower!==power()?.storedDocumentId||selectedSigned!==signed()?.storedDocumentId||!signedAgree.checked)throw Error('Пакет изменился. Проверьте документы заново.');
   }
   message='Проверяем пакет и переход в Bitrix…';refresh();
   const result=await request({action:oldPending?'resume':'send',requestId:oldPending?.requestId||crypto.randomUUID(),destination,stage:target,powerId:selectedPower,signedId:selectedSigned,signedConfirmed:true});if(ui.context()!==current)return;pending=result.handoff;
   message=pending?.state==='verified'?'Передано. Робот Bitrix продолжит обработку.':explanation(pending?.outcomeCode);
  }catch(error){if(ui.context()===current)message=error.message;}finally{if(ui.context()===current){busy=false;await load();refresh();}}
 };
 $('handoffCancel').onclick=async()=>{if(busy||statusBusy||pending?.state!=='prepared')return;const current=ui.context();busy=true;refresh();try{const destination=await ui.confirm('Отменить подготовку передачи','Стадия сделки не изменится. Уже сохранённые файлы останутся в Bitrix.');if(destination&&ui.context()===current){await request({action:'cancel',requestId:pending.requestId,destination});message='Подготовка отменена. Файлы сохранены.';}}catch(error){if(ui.context()===current)message=error.message;}finally{if(ui.context()===current){busy=false;await load();}}};
 $('handoffRefresh').onclick=async()=>{if(busy||statusBusy)return;message='';await load();};
 function reset(){
  generation++;inspection++;busy=false;statusBusy=false;statusLoaded=false;pending=null;stage=null;delivery=null;message='';powerCheckedId=null;signedAgree.checked=false;
  $('handoffStage').textContent='';$('handoffPowerStatus').textContent='';$('handoffPowerReview').replaceChildren();refresh();load();
 }
 document.addEventListener('assessment-case-opened',reset);
 document.addEventListener('assessment-identity-confirmed',reset);
 document.addEventListener('assessment-client-readiness-changed',()=>{if(ui.ready()&&!pending)inspectPower().catch(()=>{});});
 for(const event of ['assessment-draft-restored','assessment-analysis-complete'])document.addEventListener(event,()=>setTimeout(()=>{inspectPower().catch(error=>{message=error.message;refresh();});},0));
 for(const event of ['assessment-client-readiness-changed','assessment-credentials-changed','assessment-draft-saved','assessment-files-selected','change'])document.addEventListener(event,()=>queueMicrotask(refresh));
 window.HandoffFiles={
  canEdit:()=>!busy&&!af.busy&&!statusBusy&&!pending&&statusLoaded&&ui.ready(),
  selectionChanged(type){
   if(type==='Доверенность'){inspection++;powerCheckedId=null;$('handoffPowerStatus').textContent='Выберите и проверьте доверенность.';$('handoffPowerReview').replaceChildren();}
   if(type==='Подписанный договор')signedAgree.checked=false;
   message='';refresh();
  },
 };
 refresh();if(ui.context())reset();
})();
