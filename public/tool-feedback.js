/* Reports include location only; input values, files and credentials are never collected. */
(()=>{
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const trigger=make('button','Сообщить об ошибке','feedback-trigger');trigger.type='button';trigger.id='reportMistake';
 const caption=document.querySelector('.wf-bottom-caption');
 if(caption){const wrap=make('div',null,'feedback-navigation');caption.replaceWith(wrap);wrap.append(caption,trigger);}
 else document.querySelector('.draft-toolbar')?.append(trigger);
 const dialog=make('dialog',null,'feedback-dialog');dialog.id='feedbackDialog';dialog.setAttribute('aria-labelledby','feedbackTitle');
 const form=make('form'),title=make('h2','Сообщить об ошибке');title.id='feedbackTitle';
 const context=make('p',null,'feedback-context'),clear=make('button','Убрать привязку к вопросу','feedback-trigger');clear.type='button';
 const label=make('label','Что не так?');label.htmlFor='feedbackMessage';
 const message=make('textarea');message.id='feedbackMessage';message.required=true;message.minLength=5;message.maxLength=3000;message.rows=4;
 message.placeholder='Что произошло и какой результат ожидали';
 const status=make('p');status.id='feedbackStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const actions=make('div',null,'feedback-actions'),close=make('button','Закрыть','btn btn-ghost'),send=make('button','Отправить','btn btn-main');close.type='button';send.type='submit';
 const inbox=make('a','Сообщения об ошибках');inbox.href='/assessment-feedback';inbox.target='_top';
 actions.append(close,send);form.append(title,context,clear,label,message,status,actions,inbox);dialog.append(form);document.body.append(dialog);
 let selected=null,captured=null,attempt=null,busy=false,completed=false;
 const steps={documents:'Документы',answers:'Ответы',contract:'Договор'};
 const currentDeal=()=>window.HostedAssessment?.ready()?String(HostedAssessment.getContext().client.external.dealId):null;
 document.addEventListener('focusin',event=>{
  const node=event.target;
  if(!node.matches?.('input,select,textarea')||!node.closest('#questionnaireStep,#documentStep'))return;
  if(node.type==='password'||node.type==='file'||/eds|password|credential|secret|token/i.test(node.id)){selected=null;return;}
  selected=node;
 });
 function location(){
  const step=document.body.dataset.assessmentWorkflow||'documents';
  const field=selected?.isConnected&&selected.closest('[data-assessment-step]')?.dataset.assessmentStep===step?selected:null;
  return {dealId:currentDeal(),step,fieldId:field?.id||null,fieldLabel:field?.closest('.field')?.querySelector('label.lbl')?.textContent.trim().replace(/\s*\*\s*$/,'').slice(0,300)||null,clientVersion:document.body.dataset.assessmentVersion};
 }
 function renderContext(){context.textContent=(captured.dealId?'Сделка '+captured.dealId+' · ':'')+steps[captured.step]+(captured.fieldLabel?' · '+captured.fieldLabel:'');clear.hidden=!captured.fieldId;}
 trigger.onclick=()=>{
  if(completed){message.value='';attempt=null;completed=false;status.textContent='';send.hidden=false;}
  // Unsent text keeps the context displayed when it was written.
  if(!message.value.trim()||!captured){captured=location();attempt=null;}
  renderContext();dialog.showModal();message.focus();
 };
 clear.onclick=()=>{captured.fieldId=null;captured.fieldLabel=null;attempt=null;renderContext();};
 close.onclick=()=>dialog.close();
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||completed||!form.reportValidity())return;
  const payload={...captured,message:message.value.trim()};
  const signature=JSON.stringify(payload);
  if(attempt?.signature!==signature)attempt={signature,body:{...payload,requestId:crypto.randomUUID()}};
  busy=true;send.disabled=message.disabled=clear.disabled=true;send.textContent='Отправляем…';status.textContent='';
  try{
   const response=await fetch('/api/tool-feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(attempt.body)});
   const result=await response.json();
   if(!response.ok||!result.ok)throw Error(response.status===401?'Войдите заново, затем повторите отправку.':response.status===429?'Слишком много сообщений. Текст сохранён здесь — отправьте позже.':'Не удалось подтвердить отправку. Текст сохранён здесь — повторите.');
   status.textContent='Сообщение сохранено. Ali увидит его в списке ошибок.';completed=true;send.hidden=true;close.focus();
  }catch(error){status.textContent=error.message==='Failed to fetch'?'Нет связи. Текст сохранён здесь — повторите отправку.':error.message;}
  finally{busy=false;send.disabled=message.disabled=clear.disabled=false;send.textContent='Отправить';}
 });
 document.addEventListener('assessment-case-opened',()=>{selected=null;});
})();
