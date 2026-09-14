/* Whole-document employee inspection; does not approve extracted answers. */
window.DocumentReview={render(container,result,dealId,selection,onSaved){
 for(const report of result.documents?.matchedShortReports||[]){
  const section=document.createElement('details'),title=document.createElement('summary');title.textContent='Краткий ГКБ сверён с полным отчётом';section.append(title);
  const note=document.createElement('p');note.textContent='Сокращённые номера сопоставлены однозначно. Ответы берём из полного отчёта; их нужно проверить.';section.append(note);
  for(const [label,id]of [['Краткий ГКБ',report.documentId],['Полный ГКБ',report.fullDocumentId]]){const link=document.createElement('a');link.textContent=label+' · открыть PDF';link.href=`/document-viewer.html?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(id)}`;link.target='_blank';link.rel='noopener';link.style.display='block';section.append(link);}
  const list=document.createElement('ul');for(const match of report.matches){const item=document.createElement('li');item.textContent=`${match.shortNumber} (стр. ${match.shortPage}) → ${match.fullNumber} (стр. ${match.fullPage})`;list.append(item);}section.append(list);container.append(section);
 }
 for(const conflict of result.documents?.conflicts||[]){
  const section=document.createElement('details');
  const title=document.createElement('summary');title.textContent='Расхождение по обязательству: '+conflict.creditor+' · '+conflict.contractNumber;section.append(title);
  const labels={debtOutstanding:'Текущая задолженность',monthlyPayment:'Ежемесячный платёж',overdueDays:'Дни просрочки',startedAtMonth:'Месяц возникновения обязательства'};
  const heading=document.createElement('p');heading.textContent=labels[conflict.field]||conflict.field;section.append(heading);
  const list=document.createElement('ul');for(const source of conflict.sources||[]){
   const item=document.createElement('li'),link=document.createElement('a');
   const selected=selection.find(s=>s.documentId===source.documentId);
   link.textContent=(selected?.type||'Отчёт')+' · '+(source.issuedAt||'дата не определена')+(source.page?' · стр. '+source.page:'');
   link.href=`/document-viewer.html?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(source.documentId)}&page=${source.page||1}`;link.target='_blank';link.rel='noopener';
   item.append(link,document.createTextNode(' — '+source.value));list.append(item);
  }section.append(list);
  const note=document.createElement('p');note.textContent=conflict.clientConfirmedAmount!==undefined?'Сумма для анкеты уточнена у клиента: '+conflict.clientConfirmedAmount+' ₸. Расхождение источников сохранено; это не подтверждение суммы по документам.':'Сверьте значения в исходных отчётах. Если выбран устаревший или неверный файл, уберите его из пакета и добавьте актуальный. Если актуальные отчёты противоречат друг другу, запросите уточнение у источника. Простое изменение ответа анкеты не снимает расхождение.';section.append(note);container.append(section);
 }
 const supported=['Удостоверение личности','Ф6 об отсутствии имущества','Справка ЕНПФ','Справка по выплатам пенсии и пособий','Выписка зарплатного банка','Выписка Kaspi Gold','Доверенность'];
 for(const selected of selection.filter(s=>s.person==='Клиент'&&supported.includes(s.type))){
  if(result.documents.structurallyChecked?.includes(selected.type)&&!result.documents.issues?.some(i=>i.documentId===selected.documentId)&&!result.documents.manuallyReviewed?.some(r=>r.documentId===selected.documentId&&r.type===selected.type))continue;
  const section=document.createElement('details');section.dataset.documentReview='';
  const title=document.createElement('summary');title.textContent=selected.type+' — '+(result.documents.manuallyReviewed?.some(r=>r.documentId===selected.documentId&&r.type===selected.type)?'проверено сотрудником':'проверить документ');section.append(title);
  const link=document.createElement('a');link.textContent='Открыть исходный PDF';link.href=`/document-viewer.html?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(selected.documentId)}`;link.target='_blank';link.rel='noopener';section.append(link);
  const fields={};
  const input=(key,label,type='text')=>{const wrapper=document.createElement('label');wrapper.style.display='block';wrapper.textContent=label;const field=document.createElement('input');field.type=type;wrapper.append(field);section.append(wrapper);fields[key]=field;return field;};
  input('iin','ИИН владельца, указанный в документе');input('pages','Количество проверенных страниц','number').min='1';
  input('issuedAt','Дата выдачи (если указана)','date');input('expiresAt','Действует до (обязательно для удостоверения и доверенности)','date');
  if(['Выписка зарплатного банка','Выписка Kaspi Gold','Справка ЕНПФ'].includes(selected.type)){input('from','Начало периода','date');input('to','Конец периода','date');}
  if(selected.type==='Справка ЕНПФ'){const periodNote=document.createElement('p');periodNote.textContent='Нужна выписка за три года до даты выдачи. Укажите дату выдачи и период из документа.';section.append(periodNote);}
  input('complete','Просмотрены все страницы; документ полный и читаемый','checkbox');input('contentMatches','Содержание соответствует выбранному типу и указанному владельцу','checkbox');input('periodChecked','Проверены срок действия и необходимый период документа','checkbox');
  if(selected.type==='Доверенность'){
   const label=document.createElement('label');label.textContent='Поверенный';const kind=document.createElement('select');for(const [value,text]of[['person','Физическое лицо'],['organization','Организация']]){const option=document.createElement('option');option.value=value;option.textContent=text;kind.append(option);}label.append(kind);section.append(label);fields.kind=kind;
   input('legalName','Полное имя / наименование поверенного из документа');input('identifier','ИИН / БИН поверенного из документа');input('authorityChecked','Проверены исполнение, срок, полномочия на поручение и сведения об отмене доверенности','checkbox');
  }
  input('reason','Что проверено, где указаны владелец, даты и необходимые сведения');
  const note=document.createElement('p');note.textContent='Это запись проверки сотрудником. Она не удостоверяет подлинность и не подтверждает автоматически ответы анкеты.';section.append(note);
  const save=document.createElement('button');save.type='button';save.className='btn btn-ghost';save.textContent='Сохранить проверку';const status=document.createElement('p');status.setAttribute('role','status');section.append(save,status);container.append(section);
  const approved=result.documents.manuallyReviewed?.find(r=>r.documentId===selected.documentId&&r.type===selected.type);
  if(approved){
   const reason=input('withdrawReason','Причина отмены проверки');const withdraw=document.createElement('button');withdraw.type='button';withdraw.className='btn btn-ghost';withdraw.textContent='Отменить проверку';section.append(withdraw);let withdrawal=null;
   withdraw.onclick=async()=>{
    const payload={action:'withdraw',documentId:selected.documentId,reviewId:approved.reviewId,identityRevision:result.identityRevision,reason:reason.value.trim()};
    if(payload.reason.length<10){status.textContent='Укажите причину отмены не короче 10 символов.';return;}
    const signature=JSON.stringify(payload);if(withdrawal?.signature!==signature)withdrawal={signature,requestId:crypto.randomUUID()};withdraw.disabled=true;save.disabled=true;
    try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/document-reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:withdrawal.requestId})});const data=await response.json();if(!response.ok)throw Error(data.error==='REVIEW_CHANGED'?'Проверка уже изменилась. Проверьте анкету заново.':'Отмена не подтверждена. Повторите действие.');status.textContent='Проверка отменена; история сохранена.';onSaved();}catch(error){status.textContent=error.message;}finally{withdraw.disabled=false;save.disabled=false;}
   };
  }
  let attempt=null;
  save.onclick=async()=>{
   const value=key=>fields[key]?.value.trim()||'';
   const review={type:selected.type,iin:value('iin'),pages:Number(value('pages')),issuedAt:value('issuedAt'),expiresAt:value('expiresAt'),from:value('from'),to:value('to'),complete:fields.complete.checked,contentMatches:fields.contentMatches.checked,periodChecked:fields.periodChecked.checked,reason:value('reason'),authorityChecked:fields.authorityChecked?.checked===true,representative:fields.kind?{kind:value('kind'),legalName:value('legalName'),identifier:value('identifier')}:null};
   const payload={documentId:selected.documentId,identityRevision:result.identityRevision,review},signature=JSON.stringify(payload);if(attempt?.signature!==signature)attempt={signature,requestId:crypto.randomUUID()};
   save.disabled=true;status.textContent='Сохраняю проверку…';
   try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/document-reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:attempt.requestId})});const data=await response.json();if(!response.ok)throw Error(({DOCUMENT_CLIENT_UNVERIFIED:'ИИН не совпал с клиентом сделки.',DOCUMENT_IDENTITY_CONFLICT:'В извлечённых данных указан другой ИИН. Нужна сверка файла.',DOCUMENT_TYPE_CONFLICT:'Содержимое определено как другой тип документа.',DOCUMENT_INSPECTION_INCOMPLETE:'Укажите число страниц, отметьте проверки и добавьте пояснение не короче 10 символов.',DOCUMENT_DATE_NOT_ACCEPTABLE:'Проверьте даты: документ не должен быть будущим или просроченным.',DOCUMENT_EXPIRY_REQUIRED:'Укажите срок действия удостоверения.',STATEMENT_RECONCILIATION_REQUIRED:'Операции и остатки Kaspi должны пройти автоматическую сверку; ручная проверка владельца её не заменяет.',ENPF_PERIOD_NOT_ACCEPTABLE:'Укажите дату выдачи и период ЕНПФ: он должен охватывать три года до даты выдачи.',STATEMENT_PERIOD_NOT_ACCEPTABLE:'Период должен совпадать с выпиской и охватывать последние 12 месяцев, включая год до даты выписки.',POWER_AUTHORITY_REVIEW_REQUIRED:'Укажите даты доверенности и подтвердите проверку полномочий.',REPRESENTATIVE_NOT_APPROVED:'Реквизиты поверенного не совпали с Айжан или Aplus Corporation.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился. Откройте сделку заново.',DOCUMENT_PROCESSING_REQUIRED:'Сначала обработайте этот файл.'})[data.error]||'Сохранение не подтверждено. Проверьте поля и повторите.');status.textContent='Проверка сохранена.';onSaved();}catch(error){status.textContent=error.message;}finally{save.disabled=false;}
  };
 }
}};
