(()=>{
 const previous=document.getElementById('checkQuestions');
 const button=previous.cloneNode(true);previous.replaceWith(button);
 const preview=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');
 summary.textContent='Предпросмотр карточки для юриста';text.style.whiteSpace='pre-wrap';text.style.fontFamily='inherit';
 preview.append(summary,text);preview.hidden=true;button.after(preview);
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
 for(const event of ['input','change','assessment-case-opened'])document.addEventListener(event,event=>{if(event.target.closest?.('[data-document-review]'))return;upload.invalidate();submission.invalidate();preview.hidden=true;documents.textContent='';contract.hidden=true;contractValues=null;});
 contract.onclick=async()=>{if(!contractValues)return;contract.disabled=true;try{const selected=contractValues,blob=await ContractRenderer.render(selected);if(contractValues!==selected)throw Error('Ответы изменились. Проверьте анкету заново.');const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Предварительный договор.docx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){document.getElementById('checkStatus').textContent=error.message;}finally{contract.disabled=false;}};
 window.AssessmentCheck={run:()=>check('answers'),result:()=>lastResult};
 button.onclick=()=>check('answers');
 documentButton.onclick=()=>check('documents');
 async function check(mode){
  lastResult=null;
  if(button.disabled||documentButton.disabled)return;
  const status=mode==='documents'?documentStatus:document.getElementById('checkStatus');
  if(!HostedAssessment.ready()){status.textContent='Сначала откройте сделку.';return;}
  const dealId=HostedAssessment.getContext().client.external.dealId;
  const payload=ServerDrafts.capture(),bindings=ServerDrafts.reviewBindings(),snapshot=JSON.stringify({payload,bindings});
  upload.invalidate();submission.invalidate();button.disabled=true;documentButton.disabled=true;preview.hidden=true;contract.hidden=true;contractValues=null;status.textContent=mode==='documents'?'Проверяю документы…':'Проверяю ответы…';
  try{
   const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}/check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,bindings})});
   const result=await response.json();
   if(!response.ok)throw Error('Не удалось проверить ответы. Сохраните черновик и повторите проверку.');
   if(!HostedAssessment.ready()||HostedAssessment.getContext().client.external.dealId!==dealId||JSON.stringify({payload:ServerDrafts.capture(),bindings:ServerDrafts.reviewBindings()})!==snapshot){status.textContent='Ответы или сделка изменились. Запустите проверку ещё раз.';return;}
   documents.replaceChildren();
   if(result.documents?.issues.length){const notes=document.createElement('details'),heading=document.createElement('summary'),list=document.createElement('ul');heading.textContent='Замечания · '+result.documents.issues.length;for(const message of new Set(result.documents.issues.map(i=>i.message))){const item=document.createElement('li');item.textContent=message;list.append(item);}notes.append(heading,list);documents.append(notes);}
   lastResult=result;
   upload.checked(result,{dealId,payload,signature:JSON.stringify(payload)});
   submission.checked(result,{dealId,payload,bindings,signature:snapshot});
   DocumentReview.render(documents,result,dealId,payload.documents,()=>documentButton.click());
   document.dispatchEvent(new CustomEvent('assessment-checked',{detail:{...result,checkMode:mode}}));
   if(mode==='documents'){
    const issues=result.documents?.issues||[];
    status.textContent=issues.length?'Нужна проверка: '+issues.length+'.':'Документы проверены.';
    return;
   }
   if(result.evidence?.issues.length){status.textContent=`Нужна повторная проверка ответов из документов: ${result.evidence.issues.length}. Откройте источники и подтвердите актуальные значения.`;return;}
   if(result.answersComplete){text.textContent=result.preview?.lawyerCard||'';preview.hidden=!text.textContent;contractValues=result.preview?.contractData||null;contract.hidden=!contractValues;status.textContent=result.readyToSubmit?'Ответы и документы проверены. Можно сохранить карточку и скачать договор.':'Обязательные ответы заполнены. Можно скачать предварительный договор для проверки. Перед сохранением завершите проверку документов.';return;}
   status.textContent=`Нужно проверить ответы: ${result.issues.length}. `+result.issues.slice(0,5).map(i=>i.label).join('; ');
   const first=result.issues[0];let target;
   if(first?.group){const row=document.getElementById(first.group)?.querySelector('.repeat-rows')?.children[first.row??0];target=[...row?.querySelectorAll('input,select,textarea')||[]].find(e=>e.id.replace(/_r\d+$/,'')===first.key);}
   else target=document.getElementById(first?.key);
   if(target){window.AssessmentWorkflow?.reveal(target);target.focus();}
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;documentButton.disabled=false;}
 }
})();
