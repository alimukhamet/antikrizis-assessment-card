(()=>{
 const previous=document.getElementById('checkQuestions');
 const button=previous.cloneNode(true);previous.replaceWith(button);
 const preview=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');
 summary.textContent='Предпросмотр карточки для юриста';text.style.whiteSpace='pre-wrap';text.style.fontFamily='inherit';
 preview.append(summary,text);preview.hidden=true;button.after(preview);
 const answerIssues=document.createElement('ul');answerIssues.id='answerCheckIssues';answerIssues.hidden=true;button.after(answerIssues);
 function answerTarget(issue){
  if(!issue.group){
   if(issue.key?.startsWith('choice:'))return [...document.querySelectorAll('#questionnaireStep input')].find(input=>input.name===issue.key.split(':')[1]);
   if(issue.key?.startsWith('holding:'))return [...document.querySelectorAll('#questionnaireStep [data-holding]')].find(input=>input.dataset.owner===issue.key.split(':')[1]&&(issue.key.endsWith(':business')?['ip','too','kh','businessNone'].includes(input.dataset.holding):['real','land','car','other','none','unknown'].includes(input.dataset.holding)));
   return document.getElementById(issue.key?.replace(/^exact:/,''));
  }
  const row=document.getElementById(issue.group)?.querySelector('.repeat-rows')?.children[issue.row??0];
  return [...row?.querySelectorAll('input,select,textarea')||[]].find(e=>e.id.replace(/_r\d+$/,'')===issue.key);
 }
 function focusAnswer(issue,result){
  if(issue.code==='ACTIVE_LOAN_DUPLICATE'){
   const matches=result?.documents?.loanCoverage?.rows.filter(loan=>loan.status==='duplicate'&&(loan.duplicateRows||loan.rows).includes(issue.row))||[];
   if(matches.length===1&&window.LoanDuplicates?.open(matches[0]))return;
  }
  const target=answerTarget(issue);if(target){window.AssessmentWorkflow?.reveal(target);target.focus();}
 }
 const documentActions=document.createElement('section');documentActions.className='af-workspace';documentActions.id='documentReviewStep';
 const documentHeading=document.createElement('h2');documentHeading.textContent='Проверка документов';
 const documentButton=document.createElement('button');documentButton.type='button';documentButton.className='btn btn-main';documentButton.id='checkDocuments';documentButton.textContent='Проверить документы';
 const documentStatus=document.createElement('p');documentStatus.id='documentCheckStatus';documentStatus.setAttribute('role','status');documentStatus.textContent='После распознавания проверьте владельца, сроки и содержимое документов.';
 const documents=document.createElement('div');documents.id='documentReviewResults';
 const continueButton=document.createElement('button');continueButton.type='button';continueButton.className='btn btn-ghost';continueButton.textContent='Перейти к анкете ↓';
 continueButton.id='continueToAnswers';
 continueButton.onclick=()=>{if(window.AssessmentWorkflow){window.AssessmentWorkflow.show('answers');return;}const target=document.getElementById('questionnaireStep');if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({behavior:'smooth',block:'start'});}};
 documentActions.append(documentHeading,documentButton,documentStatus,documents,continueButton);
 const documentStep=document.getElementById('documentStep');if(documentStep)documentStep.after(documentActions);else button.before(documentActions);
 const upload=DocumentUpload.mount(documentButton,documentStatus);window.AssessmentDocumentUpload=upload;let lastResult=null;
 const submission=SubmissionFlow.mount(button,document.getElementById('checkStatus'));
 const contract=document.createElement('button');contract.type='button';contract.className='btn btn-ghost';contract.textContent='Скачать предварительный договор';contract.hidden=true;preview.append(contract);let contractValues=null;
 for(const event of ['input','change','assessment-case-opened'])document.addEventListener(event,event=>{if(event.target.closest?.('[data-document-review]'))return;if(event.type!=='assessment-case-opened'&&!event.target.closest?.('#questionnaireStep,#documentStep')&&event.target.id!=='afDate')return;upload.invalidate();submission.invalidate();preview.hidden=true;answerIssues.hidden=true;answerIssues.replaceChildren();documents.textContent='';contract.hidden=true;contractValues=null;});
 contract.onclick=async()=>{if(!contractValues||!HostedAssessment.ready())return;contract.disabled=true;try{const selected=contractValues,dealId=HostedAssessment.getContext().client.external.dealId,blob=await ContractRenderer.render(selected);if(contractValues!==selected||!HostedAssessment.ready()||HostedAssessment.getContext().client.external.dealId!==dealId)throw Error('Клиент или ответы изменились. Проверьте анкету заново.');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=SubmissionFlow.contractFilename(selected,dealId);link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){document.getElementById('checkStatus').textContent=error.message;}finally{contract.disabled=false;}};
 window.AssessmentCheck={run:()=>check('answers'),documents:()=>check('documents'),result:()=>lastResult};
 button.onclick=()=>check('answers');
 documentButton.onclick=()=>check('documents');
 async function check(mode){
  lastResult=null;answerIssues.replaceChildren();answerIssues.hidden=true;
  if(button.disabled||documentButton.disabled)return;
  const status=mode==='documents'?documentStatus:document.getElementById('checkStatus');
  if(!HostedAssessment.ready()){status.textContent='Сначала откройте сделку.';return;}
  const dealId=HostedAssessment.getContext().client.external.dealId;
  upload.invalidate();submission.invalidate();button.disabled=true;documentButton.disabled=true;preview.hidden=true;contract.hidden=true;contractValues=null;status.textContent=mode==='documents'?'Проверяю документы…':'Проверяю ответы…';
  try{
   // Both normal actions resolve the document identity first; employees do not
   // need to discover a separate IIN button before checking or downloading.
   if(typeof afEnsureIdentity==='function'&&!await afEnsureIdentity()){status.textContent=document.getElementById('afStatus').textContent;return;}
   if(!HostedAssessment.ready()||HostedAssessment.getContext().client.external.dealId!==dealId)throw Error('Клиент изменился. Откройте нужную сделку заново.');
   const initialPayload=JSON.stringify(ServerDrafts.capture());
   // A single explicit review replaces dozens of separate field confirmations.
   if(mode==='answers'&&!await afConfirmPending()){status.textContent='Подтверждение отменено. Ответы не отправлены на итоговую проверку.';return;}
   if(!HostedAssessment.ready()||HostedAssessment.getContext().client.external.dealId!==dealId||JSON.stringify(ServerDrafts.capture())!==initialPayload){status.textContent='Ответы или сделка изменились. Запустите проверку ещё раз.';return;}
   const payload=ServerDrafts.capture(),bindings=ServerDrafts.reviewBindings(),snapshot=JSON.stringify({payload,bindings});
   const result=await HostedAssessment.requestJson(`/api/assessment/${encodeURIComponent(dealId)}/check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,bindings})},{message:()=>mode==='documents'?'Не удалось проверить документы. Нажмите «Проверить и продолжить» ещё раз.':'Не удалось проверить ответы. Сохраните черновик и повторите проверку.'});
   if(!HostedAssessment.ready()||HostedAssessment.getContext().client.external.dealId!==dealId||JSON.stringify({payload:ServerDrafts.capture(),bindings:ServerDrafts.reviewBindings()})!==snapshot){status.textContent='Ответы или сделка изменились. Запустите проверку ещё раз.';return;}
   documents.replaceChildren();
   if(result.documents?.issues.length){const notes=document.createElement('details'),heading=document.createElement('summary'),list=document.createElement('ul');heading.textContent='Замечания · '+result.documents.issues.length;for(const message of new Set(result.documents.issues.map(i=>i.message))){const item=document.createElement('li');item.textContent=message;list.append(item);}notes.append(heading,list);documents.append(notes);}
   lastResult=result;
   upload.checked(result,{dealId,payload,signature:JSON.stringify(payload)});
   submission.checked(result,{dealId,payload,bindings,signature:snapshot});
   DocumentReview.render(documents,result,dealId,payload.documents,()=>check('documents'));
   document.dispatchEvent(new CustomEvent('assessment-checked',{detail:{...result,checkMode:mode}}));
   if(mode==='documents'){
    const issues=result.documents?.issues||[];
    const visible=issues.filter(issue=>issue.code!=='EDS_SEPARATE_UPLOAD_REQUIRED'||!window.CredentialUpload?.collected());
    status.textContent=visible.length?'Проверка обновлена · замечаний: '+visible.length+'.':'Документы проверены. Можно перейти к ответам.';
    return result;
   }
   if(result.evidence?.issues.length&&!result.issues?.length){status.textContent=`Нужна повторная проверка ответов из документов: ${result.evidence.issues.length}. Откройте источники и подтвердите актуальные значения.`;return;}
   if(result.answersComplete){text.textContent=result.preview?.lawyerCard||'';preview.hidden=!text.textContent;contractValues=result.preview?.contractData||null;contract.hidden=!contractValues;status.textContent=result.readyToSubmit?'Ответы и документы проверены. Можно сохранить карточку и скачать договор.':'Обязательные ответы заполнены. Можно скачать предварительный договор для проверки. Перед сохранением завершите проверку документов.';return;}
   status.textContent=`Нужно проверить ответы: ${result.issues.length}. Нажмите на пункт, чтобы перейти к полю.`;
   for(const issue of result.issues){
    const row=document.createElement('li'),link=document.createElement('button');link.type='button';link.className='btn btn-ghost';
    const group=issue.group?document.getElementById(issue.group)?.querySelector('h2,h3,h4')?.textContent?.trim():'';
    link.textContent=(issue.group?(issue.group==='creditors'?'Кредит':group||'Запись')+' '+((issue.row??0)+1)+' — ':'')+issue.label;
    if(issue.code==='ACTIVE_LOAN_DUPLICATE')link.textContent+=' · Сравнить записи';
    link.onclick=()=>focusAnswer(issue,result);row.append(link);answerIssues.append(row);
   }
   answerIssues.hidden=false;if(result.issues[0])focusAnswer(result.issues[0],result);
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;documentButton.disabled=false;}
 }
})();
