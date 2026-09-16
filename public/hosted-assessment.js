/* Browser adapter only. Identity, eligibility and reviews are enforced by the server. */
window.HostedAssessment=(()=>{
 let context=null,loadSequence=0;
 const errors={IDENTITY_CONFLICT:'ИИН документа не совпадает с уже сохранённым клиентом. Ничего не заменено; проверьте выбранную сделку и документ.',IDENTITY_SAVE_UNCERTAIN:'Не удалось подтвердить сохранение ИИН. Ответы и файлы не удалены. Повторите подтверждение: уже сохранённый ИИН не будет записан повторно.',IDENTITY_CONFIRMATION_REQUIRED:'Подтвердите, что документ принадлежит клиенту выбранной сделки.',BITRIX_TEMPORARILY_UNAVAILABLE:'Bitrix временно не отвечает. Повторите открытие карточки. Сохранённые ответы и файлы не удалены.',ENPF_PERIOD_NOT_ACCEPTABLE:'ЕНПФ охватывает меньше года. Добавьте справку за 12 месяцев до даты выдачи.',ENPF_PERIOD_UNVERIFIED:'Не удалось прочитать период ЕНПФ. Сверьте его по оригиналу.',SHORT_CONTRACT_ID_TRUNCATED:'В кратком ГКБ сокращён номер договора. Сверьте его с полным отчётом.',SHORT_CREDIT_LIST_UNVERIFIED:'Список долгов краткого ГКБ требует сверки с полным отчётом.',TOO_MANY_PAGES:'В PDF больше 300 страниц — такой файл пока нельзя обработать автоматически.',EXTRACTED_TEXT_LIMIT:'В этом PDF слишком много текста для текущего лимита обработки.',EMPTY_FILE:'Файл пустой. Загрузите исходный документ заново.',CRM_FILE_TOO_LARGE:'Файл в сделке больше 35 МБ.',CRM_FILE_DOWNLOAD_FAILED:'Не удалось скачать файл из сделки. Повторите попытку.',CRM_FILE_LINK_UNAVAILABLE:'Bitrix не предоставил доступ к файлу.',CRM_FILE_REDIRECT_UNTRUSTED:'Не удалось подтвердить адрес хранения файла. Выберите скачанный PDF вручную.',EVIDENCE_REQUEST_FAILED:'Не удалось получить документы сделки. Повторите попытку.',POWER_AUTHORITY_REVIEW_REQUIRED:'Сверьте доверенность по оригиналу.',POWER_DATES_UNVERIFIED:'Не удалось прочитать дату выдачи или срок. Укажите даты по оригиналу.',POWER_DATE_NOT_ACCEPTABLE:'Срок доверенности истёк или указана будущая дата выдачи. Проверьте даты.',POWER_SCOPE_REVIEW_REQUIRED:'Текст полномочий отличается от рабочего шаблона. Подтвердите по оригиналу.',REPRESENTATIVE_IDENTITY_UNVERIFIED:'Личность поверенного не установлена.',REPRESENTATIVE_NOT_APPROVED:'Поверенный не совпадает с утверждёнными реквизитами Айжан или Aplus Corporation.',STATEMENT_RECONCILIATION_REQUIRED:'Операции и остатки выписки не сошлись. Проверьте полноту файла.',STATEMENT_PERIOD_UNVERIFIED:'Период выписки не установлен.',STATEMENT_PERIOD_NOT_ACCEPTABLE:'Нужна выписка за последние 12 месяцев, включая год до даты выписки.',CACHE_REPROCESS_REQUIRED:'Версия обработки изменилась. Нажмите «Распознать и заполнить» для повторного анализа.',SIGN_IN_REQUIRED:'Войдите на сайт заново.',DEAL_READ_FAILED:'Не удалось открыть сделку.',EVIDENCE_STORAGE_NOT_CONFIGURED:'Хранилище оценки ещё не настроено.',WRONG_CLIENT:'Документ другого клиента.',GKB_TOO_OLD:'ГКБ старше 30 дней. Нужен новый отчёт.',FUTURE_DOCUMENT_DATE:'Дата документа находится в будущем.',PAGE_COMPLETENESS_UNVERIFIED:'Полнота страниц не подтверждена.',DOCUMENT_IDENTITY_UNVERIFIED:'ИИН владельца документа не подтверждён.',DEAL_IDENTITY_UNVERIFIED:'Подтвердите клиента в ГКБ — ИИН будет заполнен из документа.',EXTRACTION_VERSION_CHANGED:'Версия распознавания изменилась. Повторите распознавание документа.',CASE_IDENTITY_CHANGED:'Личность в сделке изменилась. Откройте оценку заново.',CLIENT_IDENTITY_UNVERIFIED:'Личность документа не совпадает с текущей сделкой.',DOCUMENT_REQUIRES_VALIDATION:'Документ ещё не прошёл необходимые проверки.',FACT_NOT_IN_EXTRACTION:'Ответ не найден в сохранённом результате распознавания.',IDEMPOTENCY_KEY_REUSED:'Этот запрос уже использован для другого ответа. Проверьте сохранённый результат.',CONFIRMATION_VALUE_MISMATCH:'Значение изменено. Сохраните его как исправление.',NOT_A_SUPPORTED_PDF:'Этот формат пока не поддерживается. Используйте PDF.',PDF_UNREADABLE_OR_ENCRYPTED:'PDF не читается или защищён паролем.',FILE_TOO_LARGE:'Файл больше 35 МБ.',GKB_DATE_NOT_ACCEPTABLE:'ГКБ не соответствует правилу 30 дней.',CREDENTIAL_NOT_ANALYSED:'Ключ ЭЦП не отправляется на распознавание.'};
 const error=code=>errors[code]||'Не удалось завершить действие. Ответ не отмечен как сохранённый.';
 const el=id=>document.getElementById(id);
 function sessionRecovery(){
  if(document.getElementById('assessmentSessionNotice'))return;
  const notice=document.createElement('div');notice.id='assessmentSessionNotice';notice.setAttribute('role','alert');
  notice.style.cssText='position:sticky;top:0;z-index:10000;background:#fff4d6;color:#302400;padding:12px;border:1px solid #d6af40';
  notice.append(document.createTextNode('Сессия закончилась. Не закрывайте анкету: ответы остаются в этой вкладке. '));
  const login=document.createElement('a');login.href='/login';login.target='_blank';login.rel='noopener';login.textContent='Войти заново в другой вкладке';notice.append(login);
  notice.append(document.createTextNode('. После входа под тем же сотрудником вернитесь и повторите действие.'));
  document.body.prepend(notice);
 }
 // Bound both headers and body; never replay a write or discard answers after an HTTP error.
 async function requestJson(url,options={},settings={}){
  const controller=new AbortController();let timer;
  const cancel=()=>controller.abort();
  if(options.signal?.aborted)cancel();else options.signal?.addEventListener('abort',cancel,{once:true});
  const failure=code=>{
   if(code==='SIGN_IN_REQUIRED')sessionRecovery();
   const messages={SERVER_UNAVAILABLE:'Сервис временно недоступен. Ответы не удалены. Повторите действие.',INVALID_SERVER_RESPONSE:'Не удалось прочитать ответ сервера. Ответы не удалены. Повторите действие.'};
   return Object.assign(Error(messages[code]||(settings.message||error)(code)),{code});
  };
  try{
   return await Promise.race([(async()=>{
    const response=await fetch(url,{...options,signal:controller.signal});
    if(response.status===401||response.redirected)throw failure('SIGN_IN_REQUIRED');
    let body;
    try{body=await response.json();}catch{throw failure(response.status>=500?'SERVER_UNAVAILABLE':'INVALID_SERVER_RESPONSE');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw failure('INVALID_SERVER_RESPONSE');
    if(!response.ok)throw failure(typeof body.error==='string'?body.error:response.status>=500?'SERVER_UNAVAILABLE':'INVALID_SERVER_RESPONSE');
    document.getElementById('assessmentSessionNotice')?.remove();
    return body;
   })(),new Promise((_,reject)=>{
    timer=setTimeout(()=>{
     reject(Object.assign(Error('Сервер не ответил вовремя. Повторите действие. Сохранённые данные не удалены.'),{code:'REQUEST_TIMEOUT'}));controller.abort();
    },settings.timeoutMs||30000);
   })]);
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
 }
 const json=requestJson;
 async function load(){
  const dealId=el('hostDealId').value.trim();if(!/^[1-9]\d*$/.test(dealId)){afStatus('Укажите числовой ID сделки.',true);return;}
  if(context&&context.client.external.dealId!==dealId){if(window.ClientWorkspace)await ClientWorkspace.switchTo(dealId);else afStatus('Сохраните черновик перед сменой клиента.',true);return;}
  const sequence=++loadSequence;el('hostLoadDeal').disabled=true;afStatus('Открываем выбранную сделку…');
  try{
   const fresh=await json('/api/assessment/'+dealId);
   if(sequence!==loadSequence)return;
   if(fresh.client?.external?.dealId!==dealId)throw Error('Получена другая сделка. Карточка не открыта; выберите клиента заново.');
   if(context&&context.client.iin!==fresh.client.iin&&af.sources.size){throw Error('ИИН в сделке изменился. Сохраните текущий черновик и начните новую оценку.');}
   context=fresh;el('hostDealName').textContent=fresh.client.title+' · сделка #'+dealId+(fresh.client.iin?' · ИИН '+fresh.client.iin:' · ИИН не заполнен');
   if(fresh.client.iin&&!el('iin').value)el('iin').value=fresh.client.iin;
   if(fresh.assessmentDay)el('afDate').value=fresh.assessmentDay;
   afStatus(fresh.client.iin?'Сделка открыта. Выберите документы этого клиента.':'Загрузите ГКБ: после подтверждения клиента заполним черновик из отчёта. ИИН будет сохранён автоматически, без ручного ввода в Bitrix.',!fresh.client.iin);afRefresh();document.dispatchEvent(new Event('assessment-case-opened'));
  }catch(e){if(sequence===loadSequence)afStatus(e.message,true);}finally{if(sequence===loadSequence)el('hostLoadDeal').disabled=false;}
 }
 const base=()=>'/api/assessment/'+context.client.external.dealId;
 async function confirmIdentity(result){
  const before=context,source=result.server;
  if(!source||source.dealId!==before?.client.external.dealId)throw Error('Выберите документы текущего клиента.');
  const path=base()+'/identity',options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentId:source.documentId,extractionId:source.extractionId,identityRevision:before.identityRevision,confirmed:true})};let response;
  for(let attempt=0;attempt<2;attempt++){
   if(context!==before)throw Error('Клиент изменился. Откройте карточку заново.');
   try{response=await json(path,options,{timeoutMs:60000});break;}
   catch(error){
    // Only a known pre-write CRM read failure is retried. A timeout or uncertain
    // save must keep its explicit recovery state and must not resend a write.
    if(attempt||error.code!=='BITRIX_TEMPORARILY_UNAVAILABLE')throw error;
    afStatus('Bitrix не ответил. Повторяем проверку связи один раз; документы загружать заново не нужно…');
   }
  }
  if(context!==before||response.client?.external?.dealId!==source.dealId||response.identityRevision!==before.identityRevision||response.client.iin!==result.identity.iin)throw Error('Клиент изменился. Откройте карточку заново.');
  context={...before,client:response.client,identitySource:response.identitySource};
  el('hostDealName').textContent=context.client.title+' · сделка #'+source.dealId+' · ИИН '+context.client.iin+' · из документа';
  document.dispatchEvent(new Event('assessment-identity-confirmed'));
  return response.analysis;
 }
 async function analyzeFile(item,preferences={}){const path=item.storedDocumentId?base()+'/documents/'+encodeURIComponent(item.storedDocumentId)+'/analyze':base()+'/documents';const options=item.storedDocumentId?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cacheOnly:preferences.cacheOnly===true})}:{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Document-Name':encodeURIComponent(item.file.name)},body:item.file};let result;try{result=await json(path,options,{timeoutMs:preferences.restoreOnly?25000:60000});}catch(error){if(error.code!=='CACHE_REPROCESS_REQUIRED'||!item.storedDocumentId||preferences.restoreOnly)throw error;result=await json(path,{...options,body:JSON.stringify({cacheOnly:false})},{timeoutMs:60000});}if(result.documentId)item.storedDocumentId=result.documentId;return result;}
 function ready(){return !!context;}
 function adapt(payload){
  if(!ready()||payload.client.external.dealId!==context.client.external.dealId)throw Error('Ответ получен для другой сделки. Ничего не заполнено.');
  const data=payload.document.extraction,read=payload.document;
  // Independent report evidence. Employee corrections belong to form fields,
  // never to the comparison between the two original reports.
  const creditEvidence={credits:data.credits.map(c=>({...c,facts:c.facts.map(f=>({...f}))})),creditList:data.creditList,findings:[...new Set([...(data.findings||[]),...(payload.findings||[])])],readable:read.pages.length>0&&read.pages.every(p=>!p.needsOcr)};
  const keys={'identity.iin':'iin','identity.name':'fio','statement.topUps':'kaspiAnnual','employment.payersCount':'count-clientjobs','benefits.count':'clientBenefitsCount'};
  const loanKeys={creditor:'n8038',contractIdentifier:'loanContractId',loanStatus:'loanStatus',startedAtMonth:'n8038Start',monthlyPayment:'n8041',overdueDays:'n8042',debtOutstanding:'n8040',creditType:'n8039',relatedParties:'loanParticipants'};
  const draftOnly=payload.eligibleForDraftAutofill===true&&!payload.eligibleForAutofill&&!context.client.iin;
  const server={dealId:payload.client.external.dealId,documentId:payload.documentId,extractionId:payload.extractionId,identityRevision:payload.identityRevision,...(draftOnly?{draftOnly:true}:{})};
  const reviews=new Map((payload.reviews||[]).map(r=>[r.fact_key,r]));
  const reviewed=(key,f)=>{const review=reviews.get(key);if(!review)return{value:f.value};let value;try{value=JSON.parse(review.value_json);}catch{return{value:f.value};}return typeof value==='string'?{value,originalValue:f.value,priorReview:review}:{value:f.value};};
  const fields=data.facts.filter(f=>keys[f.key]).map(f=>({key:keys[f.key],...reviewed(f.key,f),page:f.page,quote:f.source,serverFactKey:f.key,server}));
  const loans=data.credits.map((c,i)=>{const fields={},fieldKeys={},fieldReview={};for(const f of c.facts){const key=loanKeys[f.key];if(key){const factKey=`credits.${i}.${f.key}`,saved=reviewed(factKey,f);fields[key]=saved.value;fieldKeys[key]=factKey;fieldReview[key]={...saved,page:f.page,quote:f.source};}}return {key:(c.facts.find(f=>f.key==='creditor')?.value||'')+'|'+(c.contractCode||c.contractNumber),aliases:[c.contractNumber,c.contractCode].filter(Boolean).map(number=>(c.facts.find(f=>f.key==='creditor')?.value||'')+'|'+number),number:c.contractNumber,page:c.page,fields,fieldKeys,fieldReview,server,relatedPartiesNotice:c.relatedPartiesNotice,quote:c.facts.map(f=>f.source+': '+f.value).join('; ')};});
  const kinds={gkb_full:'gkbFull',gkb_short:'gkbShort',identity:'id',property:'f6',kaspi:'kaspi',power_of_attorney:'power',benefits:'benefits',enpf:'enpf',salary:'salary'};
  const types={gkb_full:'ГКБ — полный отчёт',gkb_short:'ГКБ — краткий отчёт',identity:'Удостоверение личности',property:'Ф6 об отсутствии имущества',kaspi:'Выписка Kaspi Gold',power_of_attorney:'Доверенность',benefits:'Справка по выплатам пенсии и пособий',enpf:'Справка ЕНПФ',salary:'Выписка зарплатного банка'};
  const findings=[...(payload.findings||[])];
  const notes=findings.map(f=>errors[f]||({TOTAL_DEBT_REQUIRES_RECONCILIATION:'Общую задолженность нужно сверить: есть отдельные суммы просрочки или санкций.',DETAILED_EXTRACTION_PENDING:'Подробные поля этого типа документа пока заполняются вручную.',OCR_OR_PAGE_REVIEW_REQUIRED:'Есть страницы, требующие распознавания или ручной проверки.',DOCUMENT_TYPE_UNVERIFIED:'Тип документа не установлен по содержимому.',CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES:'Проверьте полноту списка и роль клиента в обязательствах.'}[f]||'Есть сведения, требующие ручной проверки.'));
  if(payload.powerValidation?.accepted)notes.push('Рабочий шаблон: поверенный, даты и текст полномочий совпали.');else if(payload.powerValidation?.representativeMatched)notes.push('Реквизиты поверенного совпали. Уточните отмеченные данные.');notes.push('Подлинность документа не проверена.');if(payload.cacheHit)notes.push('Использован ранее сохранённый результат; даты и личность проверены заново.');
  return {engineVersion:3,draftOnly,creditEvidence,kind:kinds[data.kind]||'other',type:types[data.kind]||'Другой документ',identity:{iin:data.identity.iin,fio:data.identity.name},fields,loans,properties:[],gambling:data.facts.find(f=>f.key==='statement.gambling'),statement:data.bankStatement?{...data.bankStatement,period:data.bankStatement.from+' — '+data.bankStatement.to}:null,pages:read.totalPages,pageText:read.pages.map(p=>p.text),date:data.issuedAt,hash:read.pdfSha256,ocrPages:[],coverage:data.coverage||null,documentReview:payload.documentReview||null,reviewContext:payload.reviewContext||null,findings,notes,blocked:!payload.eligibleForAutofill,server,sourcePreview:'/api/assessment/'+server.dealId+'/documents/'+server.documentId+'?view=pdf'};
 }
 function reviewPayload(input,src){
  if(!ready()||!src.server||!src.serverFactKey||src.server.dealId!==context.client.external.dealId)throw Error('У ответа нет действующего источника для этой сделки. Повторите распознавание.');
  const corrected=String(input.value)!==String(src.value);let reason='';
  if(corrected){reason=String(src.correctionReason||'');if(!reason.trim())throw Error('Для исправления нужно пояснение.');src.correctionReason=reason;}
  const payload={...src.server,factKey:src.serverFactKey,value:input.value,disposition:corrected?'corrected':'confirmed',reason};delete payload.dealId;
  const signature=JSON.stringify(payload);if(src.reviewRequest?.signature!==signature)src.reviewRequest={signature,requestId:crypto.randomUUID()};payload.requestId=src.reviewRequest.requestId;
  return payload;
 }
 async function review(input,src){
  const payload=reviewPayload(input,src);
  const response=await json(base()+'/reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok||!response.review?.id)throw Error('Сохранение не подтверждено. Повторите действие.');src.reviewId=response.review.id;src.edited=payload.disposition==='corrected';
 }
 async function reviewMany(entries){
  const before=context,prepared=entries.map(([input,src])=>({input,src,payload:reviewPayload(input,src),value:input.value}));let failure=null;
  for(let offset=0;offset<prepared.length;offset+=100){
   const batch=prepared.slice(offset,offset+100);
   const response=await json(base()+'/reviews/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviews:batch.map(item=>item.payload)})});
   if(context!==before)throw Error('Клиент изменился. Откройте карточку заново.');
   for(const item of batch){
    const saved=response.outcomes?.find(row=>row.requestId===item.payload.requestId);
    if(!saved?.review?.id){failure ||= error(saved?.error);continue;}
    // A response for an older value must never approve a newer edit or replacement source.
    if(!item.input.isConnected||af.sources.get(item.input.id)!==item.src||item.input.value!==item.value||item.src.stale||JSON.stringify(reviewPayload(item.input,item.src))!==JSON.stringify(item.payload)){failure ||= 'Ответы изменились во время проверки. Проверьте текущие значения.';continue;}
    item.src.reviewId=saved.review.id;item.src.edited=item.payload.disposition==='corrected';item.src.pending=false;
    afBadge(item.input,item.src);
   }
  }
  if(failure)throw Error(failure);
 }
 function acceptableFile(item){
  if(item.type==='ЭЦП файл')return Boolean(window.CredentialUpload?.verified());
  const r=af.results.get(item.id);return !!r&&!r.error&&(r.documentReview?.type===item.type||!r.blocked&&r.type===item.type)&&r.server?.dealId===context?.client.external.dealId;
 }
 function mount(){
  missingDocuments=function(){return requiredDocumentLabels().filter(type=>!(type==='ЭЦП файл'&&window.CredentialUpload?.verified())&&!selectedFiles.some(item=>item.type===type&&item.person==='Клиент'&&acceptableFile(item)));};
  const oldState=documentState;documentState=function(){oldState();document.querySelectorAll('[data-required-document]').forEach(row=>{
   const found=selectedFiles.filter(item=>item.type===row.dataset.requiredDocument&&item.person==='Клиент');
   if(found.length&&!found.some(acceptableFile))row.querySelector('[data-document-status]').textContent='Файл выбран, но проверка не пройдена';
  });};
  el('hostLoadDeal').onclick=load;el('afDate').disabled=true;el('afApply').style.display='none';el('afClient').disabled=true;
  const query=new URLSearchParams(location.search);const id=query.get('dealId');if(id&&/^[1-9]\d*$/.test(id)){el('hostDealId').value=id;if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{if(!context)load();},{once:true});else load();}
  const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent='Скачать историю и доказательства';button.onclick=()=>{if(!ready()){afStatus('Сначала откройте сделку.',true);return;}location.assign(base()+'/export');};document.querySelector('.draft-toolbar').append(button);
 }
 return {mount,ready,adapt,review,reviewMany,error,requestJson,analyzeFile,confirmIdentity,uploadPath:()=>base()+'/documents',getContext:()=>context};
})();
