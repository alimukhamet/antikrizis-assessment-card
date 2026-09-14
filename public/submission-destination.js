window.SubmissionDestination={async confirm(){
 const context=HostedAssessment.getContext(),dealId=context?.client.external.dealId;
 if(!dealId)throw Error('Сначала выберите клиента.');
 const response=await fetch(`/api/assessment/${encodeURIComponent(dealId)}`,{cache:'no-store'});
 if(!response.ok)throw Error('Не удалось проверить клиента сделки. Повторите попытку.');
 const fresh=await response.json();
 if(HostedAssessment.getContext()!==context||fresh.client?.external.dealId!==dealId||fresh.client.iin!==context.client.iin||fresh.identityRevision!==context.identityRevision)throw Error('Клиент сделки изменился. Откройте сделку заново.');
 const destination={dealId,iin:fresh.client.iin,identityRevision:fresh.identityRevision};
 if(!destination.iin)throw Error('В сделке не указан ИИН клиента.');
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='submission-destination';dialog.setAttribute('aria-labelledby','submissionDestinationTitle');
  const title=document.createElement('h2');title.id='submissionDestinationTitle';title.textContent='Проверьте получателя';
  const name=document.createElement('strong');name.textContent=fresh.client.title;
  const identity=document.createElement('p');identity.textContent=`Сделка № ${dealId} · ИИН ${fresh.client.iin}`;
  const note=document.createElement('p');note.textContent='Ответы, документы и условия договора будут сохранены в этой сделке и её истории.';
  const label=document.createElement('label'),agree=document.createElement('input');agree.type='checkbox';agree.id='confirmSubmissionClient';label.append(agree,document.createTextNode('Это клиент, с которым я работаю'));
  const actions=document.createElement('div');actions.className='af-actions';
  const cancel=document.createElement('button'),send=document.createElement('button');cancel.type=send.type='button';cancel.className='btn btn-ghost';send.className='btn btn-main';cancel.textContent='Назад';send.textContent='Сохранить и скачать договор';send.disabled=true;
  const finish=value=>{dialog.close();dialog.remove();resolve(value);};agree.onchange=()=>send.disabled=!agree.checked;cancel.onclick=()=>finish(null);send.onclick=()=>{if(agree.checked)finish(destination);};dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  actions.append(cancel,send);dialog.append(title,name,identity,note,label,actions);document.body.append(dialog);dialog.showModal();cancel.focus();
 });
}};
