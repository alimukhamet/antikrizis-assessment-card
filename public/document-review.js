/* Whole-document employee inspection; does not approve extracted answers. */
document.addEventListener('assessment-draft-saved',()=>{
 if(window.ServerDrafts?.isDirty?.())return;
 for(const note of document.querySelectorAll('[data-review-draft-status]'))note.textContent='Введённые данные сохранены в черновике.';
});
document.addEventListener('assessment-draft-save-error',event=>{
 for(const note of document.querySelectorAll('[data-review-draft-status]'))note.textContent=event.detail?.message||'Не удалось сохранить введённые данные. Повторите сохранение черновика.';
});
window.DocumentReview={render(container,result,dealId,selection,onSaved){
 const coverage=result.documents?.loanCoverage;
 if(coverage){
  const section=document.createElement('section'),title=document.createElement('strong');section.className='af-loan-coverage';
  title.textContent=`Активные кредиты: ${coverage.present} из ${coverage.expected} в анкете`;section.append(title);
  const note=document.createElement('p');note.textContent=coverage.complete?'Все кредиты полного ГКБ учтены по одному, включая активные договоры с нулевым долгом.':`Нужно добавить: ${coverage.missing}. Проверить повторы: ${coverage.duplicates}.`;section.append(note);
  for(const loan of coverage.rows.filter(r=>r.status!=='present')){
   const action=loan.status==='missing'?(loan.numberReviewRows?.length?'проверьте номер договора в кредитах '+loan.numberReviewRows.map(row=>row+1).join(', '):'добавьте в разделе «Долги»'):'повтор в кредитах '+(loan.duplicateRows||loan.rows).map(row=>row+1).join(', ')+'. Сверьте и оставьте одну запись';
   const row=document.createElement('p'),source=document.createElement('a');row.append(document.createTextNode(`${loan.creditor} · № ${loan.contractNumber} — ${action}. `));
   source.textContent='Полный ГКБ · стр. '+loan.page;source.href=`/document-viewer.html?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(loan.documentId)}&page=${loan.page}`;source.target='_blank';source.rel='noopener';row.append(source);section.append(row);
   if(loan.status==='duplicate'){const compare=document.createElement('button');compare.type='button';compare.className='btn btn-main';compare.textContent='Сравнить записи';compare.onclick=()=>window.LoanDuplicates?.open(loan);section.append(compare);}
  }
  const open=document.createElement('button');open.type='button';open.className='btn btn-ghost';open.textContent='К кредитам в анкете';open.onclick=()=>{const target=document.getElementById('creditors');window.AssessmentWorkflow?.reveal(target);};section.append(open);container.append(section);
 }
 if(result.documents?.issues?.some(issue=>issue.code==='SHORT_CREDIT_REVIEW_REQUIRED')){const compare=document.createElement('button');compare.type='button';compare.className='btn btn-main';compare.textContent='Сверить кредиты';compare.onclick=()=>window.GkbComparison?.open?.();container.append(compare);}
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
 const files=typeof selectedFiles==='undefined'?[]:selectedFiles,results=typeof af==='undefined'?new Map():af.results;
 for(const item of files){const source=results.get(item.id);if(!source?.server)continue;source.documentReview=result.documents?.manuallyReviewed?.find(review=>review.documentId===source.server.documentId&&review.type===item.type)||null;}
 if(typeof afRenderResults==='function')afRenderResults();if(typeof refreshRequiredDocuments==='function')refreshRequiredDocuments();window.AssessmentWorkflow?.refresh();
 for(const selected of selection.filter(s=>s.person==='Клиент'&&supported.includes(s.type))){
  const approved=result.documents.manuallyReviewed?.find(r=>r.documentId===selected.documentId&&r.type===selected.type);
  if(result.documents.structurallyChecked?.includes(selected.type)&&!result.documents.issues?.some(i=>i.documentId===selected.documentId)&&!approved)continue;
  const section=document.createElement('details');section.dataset.documentReview='';section.dataset.reviewDocumentId=selected.documentId;
  const title=document.createElement('summary');title.textContent=selected.type+' — '+(approved?'проверено сотрудником':'сверить');section.append(title);
  const issues=result.documents.issues?.filter(issue=>issue.documentId===selected.documentId&&issue.message)||[];
  if(!approved&&issues.length){const note=document.createElement('p');note.textContent=[...new Set(issues.map(issue=>issue.message))].join(' ');section.append(note);}
  const link=document.createElement('a');link.textContent='Открыть документ';link.href=`/document-viewer.html?dealId=${encodeURIComponent(dealId)}&documentId=${encodeURIComponent(selected.documentId)}`;link.target='_blank';link.rel='noopener';section.append(link);container.append(section);
  const status=document.createElement('p');status.setAttribute('role','status');
  const item=files.find(item=>(results.get(item.id)?.server?.documentId||item.storedDocumentId)===selected.documentId),source=item?results.get(item.id):null,known=source?.reviewContext||{};
  if(approved){
   const note=document.createElement('p');note.textContent='Проверка сохранена · '+new Date(approved.reviewedAt).toLocaleDateString('ru-RU');section.append(note);
   for(const [key,label]of [['issuedAt','Дата выдачи'],['expiresAt','Действует до']])if(known[key]){const date=document.createElement('p');date.textContent=label+': '+known[key].split('-').reverse().join('.');section.append(date);}
   const cancelDetails=document.createElement('details'),cancelTitle=document.createElement('summary');cancelTitle.textContent='Отменить проверку';cancelDetails.append(cancelTitle);
   const reason=document.createElement('input');reason.placeholder='Причина отмены';reason.setAttribute('aria-label','Причина отмены проверки');
   const withdraw=document.createElement('button');withdraw.type='button';withdraw.className='btn btn-ghost';withdraw.textContent='Отменить проверку';cancelDetails.append(reason,withdraw);section.append(cancelDetails,status);let withdrawal=null;
   withdraw.onclick=async()=>{
    const payload={action:'withdraw',documentId:selected.documentId,reviewId:approved.reviewId,identityRevision:result.identityRevision,reason:reason.value.trim()};
    if(payload.reason.length<10){status.textContent='Кратко поясните причину отмены (не менее 10 символов).';return;}
    const signature=JSON.stringify(payload);if(withdrawal?.signature!==signature)withdrawal={signature,requestId:crypto.randomUUID()};withdraw.disabled=true;
    try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/document-reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:withdrawal.requestId})});const data=await response.json();if(!response.ok)throw Error(data.error==='REVIEW_CHANGED'?'Проверка уже изменилась. Обновите её.':'Отмена не подтверждена. Повторите действие.');await onSaved();}catch(error){status.textContent=error.message;}finally{withdraw.disabled=false;}
   };continue;
  }
  const form=document.createElement('div');form.className='document-review-fields';section.append(form);
  const fields={};
  const draft=window.ServerDrafts?.getDocumentReviewDraft?.(selected.documentId,selected.type)||{};
  const input=(key,label,type='text',value='')=>{const wrapper=document.createElement('label');wrapper.textContent=label;const field=document.createElement('input');field.type=type;field.value=type==='checkbox'?value:(draft[key]??value);field.dataset.reviewField=key;wrapper.append(field);form.append(wrapper);fields[key]=field;return field;};
  input('iin','ИИН в документе','text',known.iin||window.HostedAssessment?.getContext()?.client.iin||'');
  const pages=Number(known.pages||source?.pages||0);const pageNote=document.createElement('p');pageNote.className='hint';pageNote.textContent=pages+' стр. · Сверьте данные с открытым документом.';form.prepend(pageNote);
  const periodType=['Выписка зарплатного банка','Выписка Kaspi Gold','Справка ЕНПФ'].includes(selected.type);
  if(['Удостоверение личности','Доверенность','Справка ЕНПФ'].includes(selected.type))input('issuedAt','Дата выдачи','date',known.issuedAt||'');
  if(['Удостоверение личности','Доверенность'].includes(selected.type))input('expiresAt','Действует до','date',known.expiresAt||'');
  const allHistory=selected.type==='Справка ЕНПФ'&&known.allHistory===true;
  if(periodType&&!allHistory){input('from','Начало периода','date',known.from||'');input('to','Конец периода','date',known.to||'');}
  if(allHistory){const period=document.createElement('p');period.textContent='Период по оригиналу: весь период'+(known.issuedAt?' до '+known.issuedAt:'')+'.';form.append(period);}
  if(selected.type==='Доверенность'){
   const label=document.createElement('label');label.textContent='Поверенный';const kind=document.createElement('select');for(const [value,text]of[['person','Физическое лицо'],['organization','Организация']]){const option=document.createElement('option');option.value=value;option.textContent=text;kind.append(option);}kind.value=draft.kind??known.representative?.kind??'person';label.append(kind);form.append(label);fields.kind=kind;
   input('legalName','Имя / наименование поверенного','text',known.representative?.legalName||'');input('identifier','ИИН / БИН поверенного','text',known.representative?.identifier||'');
  }
  input('confirmed',selected.type==='Доверенность'?'Я просмотрел все страницы и проверил владельца, срок и полномочия поверенного.':'Я просмотрел все страницы и проверил владельца, содержание и срок документа.','checkbox');
  const extra=document.createElement('details'),extraTitle=document.createElement('summary');extraTitle.textContent='Добавить примечание';extra.append(extraTitle);form.append(extra);const reason=input('reason','Примечание');extra.append(reason.parentElement);
  const draftNote=document.createElement('p');draftNote.className='hint';draftNote.dataset.reviewDraftStatus='';draftNote.setAttribute('aria-live','polite');form.append(draftNote);
  for(const event of ['input','change'])form.addEventListener(event,e=>{
   if(e.target.type==='checkbox')return;
   const values=Object.fromEntries(Object.entries(fields).filter(([,field])=>field.type!=='checkbox').map(([key,field])=>[key,field.value]));
   const retained=window.ServerDrafts?.setDocumentReviewDraft?.(selected.documentId,selected.type,values);
   if(retained===false)draftNote.textContent='Даты пока не сохранены. Дождитесь загрузки черновика и повторите ввод.';
   else if(retained)draftNote.textContent='Сохраняем введённые данные…';
  });
  const save=document.createElement('button');save.type='button';save.className='btn btn-main';save.textContent='Документ проверен';section.append(save,status);let attempt=null;
  save.onclick=async()=>{
   if(!fields.confirmed.checked){status.textContent='Подтвердите, что сверили документ.';fields.confirmed.focus();return;}
   const value=key=>fields[key]?.value.trim()||'';
   const review={type:selected.type,iin:value('iin'),pages,issuedAt:fields.issuedAt?value('issuedAt'):known.issuedAt||'',expiresAt:value('expiresAt'),from:allHistory?'':value('from'),to:allHistory?known.to||known.issuedAt||'':value('to'),complete:true,contentMatches:true,periodChecked:true,reason:value('reason')||'Сотрудник просмотрел все страницы и подтвердил владельца, содержание и сроки документа.',authorityChecked:selected.type==='Доверенность',representative:fields.kind?{kind:value('kind'),legalName:value('legalName'),identifier:value('identifier')}:null};
   const payload={documentId:selected.documentId,identityRevision:result.identityRevision,review},signature=JSON.stringify(payload);if(attempt?.signature!==signature)attempt={signature,requestId:crypto.randomUUID()};
   save.disabled=true;status.textContent='Сохраняем проверку…';
   try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/document-reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:attempt.requestId})});const data=await response.json();if(!response.ok)throw Error(({DOCUMENT_CLIENT_UNVERIFIED:'ИИН не совпал с клиентом сделки.',DOCUMENT_IDENTITY_CONFLICT:'В документе указан другой ИИН. Замените файл или проверьте его владельца.',DOCUMENT_TYPE_CONFLICT:'Содержание относится к другому типу документа.',DOCUMENT_INSPECTION_INCOMPLETE:'Проверьте число страниц и подтверждение просмотра.',DOCUMENT_DATE_NOT_ACCEPTABLE:'Проверьте даты документа.',DOCUMENT_EXPIRY_REQUIRED:'Укажите срок действия удостоверения.',STATEMENT_RECONCILIATION_REQUIRED:'Операции и остатки Kaspi не сошлись. Проверьте полноту выписки.',ENPF_PERIOD_NOT_ACCEPTABLE:'Нужен период ЕНПФ за 12 месяцев до даты выдачи.',STATEMENT_PERIOD_NOT_ACCEPTABLE:'Период должен совпадать с выпиской и охватывать последние 12 месяцев.',POWER_AUTHORITY_REVIEW_REQUIRED:'Укажите даты доверенности и подтвердите проверку полномочий.',REPRESENTATIVE_NOT_APPROVED:'Реквизиты поверенного не совпали с Айжан или Aplus Corporation.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился. Откройте сделку заново.',DOCUMENT_PROCESSING_REQUIRED:'Сначала обработайте этот файл.'})[data.error]||'Проверка не сохранена. Проверьте данные и повторите.');await onSaved();}catch(error){status.textContent=error.message;}finally{save.disabled=false;}
  };
 }
},async open(documentId){
 await window.AssessmentCheck?.documents();
 const section=[...document.querySelectorAll('[data-review-document-id]')].find(node=>node.dataset.reviewDocumentId===documentId);if(!section)return;
 for(let parent=section;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
 section.scrollIntoView({block:'start',behavior:'smooth'});section.querySelector('input')?.focus({preventScroll:true});
}};
