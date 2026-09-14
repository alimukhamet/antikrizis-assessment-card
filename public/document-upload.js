window.DocumentUpload={mount(anchor,status){
 const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent='Загрузить проверенные документы в Bitrix';button.disabled=true;button.hidden=true;anchor.after(button);
 const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn-ghost';cancel.textContent='Отменить неотправленную загрузку';cancel.hidden=true;button.after(cancel);
 let selection=null,attempt=null,busy=false,cancellable=null;
 const signatureOf=p=>JSON.stringify({docContext:p.docContext,documents:p.documents,pendingFiles:p.pendingFiles,fio:p.answers?.find(a=>a.key==='fio')?.value||''});
 const signature=()=>signatureOf(ServerDrafts.capture());const currentDeal=()=>HostedAssessment.ready()?HostedAssessment.getContext().client.external.dealId:null;
 async function refreshCancellation(){
  const dealId=currentDeal();if(!dealId)return;
  try{const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/uploads`),data=await response.json();if(!response.ok||currentDeal()!==dealId||busy)return;
   cancellable=data.unsent?{dealId,uploadId:data.unsent.requestId}:null;cancel.hidden=!cancellable;
  }catch{/* Keep any already confirmed unsent operation available. */}
 }
 document.addEventListener('assessment-case-opened',()=>{cancellable=null;cancel.hidden=true;refreshCancellation();});if(currentDeal())refreshCancellation();
 async function submit(){
  if(busy)throw Error('Дождитесь сохранения документов.');if(!selection)throw Error('Проверьте документы перед скачиванием договора.');const chosen=selection;if(currentDeal()!==chosen.dealId||signature()!==chosen.signature){throw Error('Проверьте текущий список документов заново.');}
  if(attempt?.signature!==chosen.signature||attempt?.dealId!==chosen.dealId)attempt={requestId:crypto.randomUUID(),signature:chosen.signature,dealId:chosen.dealId,batchIndex:0};
  busy=true;button.disabled=true;cancel.hidden=true;cancellable=null;
  try{
   for(;;){
    if(currentDeal()!==chosen.dealId||signature()!==chosen.signature)throw Error('Сделка или список изменились. Текущая загрузка остановлена; уже подтверждённые файлы сохранены.');
    status.textContent=`Загружаю документы: часть ${attempt.batchIndex+1}…`;
    const response=await fetch(`/api/assessment/${encodeURIComponent(chosen.dealId)}/uploads`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:attempt.requestId,batchIndex:attempt.batchIndex,identityRevision:chosen.identityRevision,payload:chosen.payload})});
    const result=await response.json();if(!response.ok)throw Error(({UPLOAD_OWNED_BY_ANOTHER_WORKER:'Этот список уже загружает другой сотрудник. Обратитесь к нему для проверки результата.',UPLOAD_LEGACY_RECOVERY_REQUIRED:'Для прежней загрузки нужна сверка сохранённых файлов. Новая отправка остановлена.',DOCUMENT_PACKAGE_NOT_READY:'Сначала завершите проверку документов.',UPLOAD_REVIEW_CHANGED:'Подтверждения документов изменились. Проверьте список заново.',UPLOAD_PENDING_OR_IDENTITY_CHANGED:'Есть незавершённая загрузка или изменился клиент.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился.',IDEMPOTENCY_KEY_REUSED:'Для этой загрузки уже зафиксирован другой список.'})[result.error]||'Загрузка не подтверждена. Повторите действие с тем же списком.');
    if(typeof result.requestId==='string')attempt.requestId=result.requestId;
   if(result.state==='prepared'){cancellable={...attempt};cancel.hidden=false;}
   if(result.state==='prepared')throw Error('Файлы ещё не отправлены. Устраните причину ошибки и повторите загрузку.');
    if(result.state!=='verified')throw Error('Результат загрузки ещё не подтверждён. Нажмите ещё раз, чтобы проверить сохранённые файлы без повторной отправки.');
    if(result.documentsUploaded){status.textContent='Документы сохранены в сделке.';return true;}
    if(!Number.isInteger(result.nextBatch)||result.nextBatch!==attempt.batchIndex+1)throw Error('Не удалось определить следующую часть загрузки.');attempt.batchIndex=result.nextBatch;
   }
  }catch(error){status.textContent=error.message;throw error;}finally{busy=false;button.disabled=!selection;await refreshCancellation();}
 };
 cancel.onclick=async()=>{
  if(busy||!cancellable||currentDeal()!==cancellable.dealId)return;
  busy=true;cancel.disabled=button.disabled=true;
  try{
   const response=await fetch(`/api/assessment/${encodeURIComponent(cancellable.dealId)}/uploads`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',uploadId:cancellable.uploadId,requestId:cancellable.requestId,batchIndex:cancellable.batchIndex})});
   const result=await response.json();if(!response.ok||result.state!=='cancelled')throw Error('Загрузка уже началась или изменилась. Отмена не выполнена; проверьте результат.');
   attempt=cancellable=null;selection=null;cancel.hidden=true;status.textContent='Неотправленная загрузка отменена. Проверьте документы заново перед новой попыткой.';
  }catch(error){status.textContent=error.message;}finally{busy=false;cancel.disabled=false;button.disabled=!selection;}
 };
 button.onclick=()=>submit().catch(()=>{});
 return{submit,invalidate(){selection=null;button.disabled=true;},checked(result,context){selection=result.documents&&!result.documents.issues.some(i=>i.code!=='EDS_SEPARATE_UPLOAD_REQUIRED')?{...context,signature:signatureOf(context.payload),identityRevision:result.identityRevision}:null;button.disabled=busy||!selection;}};
}};
