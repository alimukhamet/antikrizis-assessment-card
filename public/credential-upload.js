window.CredentialUpload=(()=>{
 const password=document.getElementById('previewEdsPassword'),host=password.closest('.field');
 const statusChanged=()=>document.dispatchEvent(new Event('assessment-credentials-changed'));
 const label=document.createElement('label'),owner=document.createElement('input');owner.type='checkbox';label.append(owner,document.createTextNode(' Подтверждаю, что ЭЦП и пароль получены от клиента этой сделки.'));
 const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent='Сохранить ЭЦП';button.hidden=true;
 const status=document.createElement('p');status.className='hint';status.setAttribute('role','status');host.append(label,button,status);
 const cancel=document.createElement('button');cancel.type='button';cancel.className='btn btn-ghost';cancel.textContent='Отменить неотправленную ЭЦП';cancel.hidden=true;button.after(cancel);
 let busy=false,verifiedDeal=null,verifiedSelection=null,cancellable=null,available=[];
 const stored=document.createElement('div');stored.className='credential-stored';stored.hidden=true;host.append(stored);
 const useExisting=document.createElement('button');useExisting.type='button';useExisting.className='btn btn-ghost';useExisting.textContent='Взять ЭЦП из Bitrix';useExisting.hidden=true;host.append(useExisting);
 function showEditor(show){password.hidden=label.hidden=!show;const passwordLabel=host.querySelector('label.lbl');if(passwordLabel)passwordLabel.hidden=!show;host.querySelectorAll(':scope > .hint:not([role])').forEach(hint=>hint.hidden=!show);}
 const currentDeal=()=>HostedAssessment.ready()?HostedAssessment.getContext().client.external.dealId:null;
 const keys=()=>selectedFiles.filter(item=>item.type==='ЭЦП файл');
 const selection=()=>JSON.stringify(keys().map(item=>[item.id,item.person,item.file.name,item.file.size,item.file.lastModified]));
 const verified=()=>verifiedDeal===currentDeal()&&verifiedDeal!==null&&(keys().length===0||verifiedSelection===selection());
 const pendingOnly=pending=>{const names=keys().map(item=>item.file.name);return Array.isArray(pending)&&pending.every(name=>{const index=names.indexOf(name);if(index<0)return false;names.splice(index,1);return true;});};
 const invalidate=()=>{verifiedDeal=null;verifiedSelection=null;statusChanged();};
 const collected=()=>verified()||Boolean(currentDeal()&&keys().length&&keys().length<=10&&keys().every(item=>item.person==='Клиент'&&item.file.size>0)&&keys().reduce((sum,item)=>sum+item.file.size,0)<=2*1024*1024&&owner.checked&&password.value.trim());
 function restoreCancellation(deal,data){if(currentDeal()!==deal||busy)return;cancellable=data.unsent?{deal,requestId:data.unsent.requestId}:null;cancel.hidden=!cancellable;}
 async function refreshCancellation(){const deal=currentDeal();if(!deal)return;try{const response=await fetch(`/api/assessment/${encodeURIComponent(deal)}/credentials`),data=await response.json();if(response.ok)restoreCancellation(deal,data);}catch{/* Preserve an already confirmed unsent operation. */}}
 async function refreshStatus(){
  invalidate();owner.checked=false;cancellable=null;cancel.hidden=true;stored.hidden=true;stored.replaceChildren();const deal=currentDeal();if(!deal)return;
  try{const r=await fetch(`/api/assessment/${encodeURIComponent(deal)}/credentials`),data=await r.json();if(r.ok)restoreCancellation(deal,data);if(r.ok&&currentDeal()===deal&&data.credentials?.verified){verifiedDeal=deal;verifiedSelection=selection();useExisting.hidden=true;available=[];status.textContent='ЭЦП и пароль уже есть в Bitrix.';
   for(const file of data.credentials.files||[]){const link=document.createElement('a');link.className='btn btn-ghost';link.textContent='Скачать '+file.name;link.href=`/api/assessment/${encodeURIComponent(deal)}/credentials?requestId=${encodeURIComponent(data.credentials.requestId)}&fileId=${encodeURIComponent(file.id)}`;link.download='';stored.append(link);}stored.hidden=!stored.children.length;
   const replace=document.createElement('button');replace.type='button';replace.className='btn btn-ghost';replace.textContent='Заменить';replace.onclick=()=>{showEditor(true);status.textContent='Выберите новый ключ и укажите его пароль.';password.focus();};stored.append(replace);stored.hidden=false;showEditor(false);
   refreshRequiredDocuments();statusChanged();}}catch{status.textContent='Не удалось проверить сохранённую ЭЦП. Повторите проверку.';}
 }
 document.addEventListener('assessment-case-opened',()=>{available=[];useExisting.hidden=true;showEditor(true);refreshStatus();});if(currentDeal())refreshStatus();
 document.addEventListener('change',event=>{if(event.target.type==='file'&&keys().length&&!verified())showEditor(true);});
 function offerExisting(fileId){if(verified()||! /^[1-9]\d*$/.test(fileId))return;if(!available.includes(fileId))available.push(fileId);useExisting.hidden=false;status.textContent='ЭЦП найдена в сделке. Подтвердите владельца, чтобы использовать её.';}
 useExisting.onclick=async()=>{
  if(busy||af.busy||!currentDeal()||!available.length)return;
  if(!owner.checked){status.textContent='Подтвердите, что ЭЦП принадлежит этому клиенту.';owner.focus();return;}
  const deal=currentDeal();busy=true;useExisting.disabled=true;
  try{const response=await fetch(`/api/assessment/${encodeURIComponent(deal)}/credentials`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'import',requestId:crypto.randomUUID(),identityRevision:HostedAssessment.getContext().identityRevision,fileIds:available,ownerConfirmed:true})});const result=await response.json();if(!response.ok||!result.verified)throw Error(result.error==='CREDENTIAL_PASSWORD_NOT_STORED'?'В Bitrix не найден пароль ЭЦП. Добавьте ключ и пароль клиента.':'Не удалось получить ЭЦП из сделки. Повторите действие.');if(currentDeal()===deal)await refreshStatus();}
  catch(error){status.textContent=error.message;}finally{busy=false;useExisting.disabled=false;statusChanged();}
 };
 password.addEventListener('input',invalidate);
 async function submit(){
  if(verified())return true;if(busy)throw Error('Дождитесь сохранения ключа.');const deal=currentDeal(),chosen=keys(),signature=selection();
  if(!deal||!chosen.length||chosen.some(item=>item.person!=='Клиент')||!owner.checked||!password.value.trim()){throw Error('Выберите ключ ЭЦП, укажите пароль и подтвердите владельца в разделе документов.');}
  if(chosen.length>10||chosen.reduce((sum,item)=>sum+item.file.size,0)>2*1024*1024){throw Error('Выберите не более 10 ключей общим размером до 2 МБ.');}
  busy=true;button.disabled=true;cancel.hidden=true;cancellable=null;invalidate();const secret=password.value,clientName=document.getElementById('fio').value;
  try{
   const state=await fetch(`/api/assessment/${encodeURIComponent(deal)}/credentials`),context=await state.json();if(!state.ok)throw Error('Не удалось проверить сделку.');
   const files=[];for(const item of chosen){const bytes=new Uint8Array(await item.file.arrayBuffer());let binary='';for(let at=0;at<bytes.length;at+=6144)binary+=String.fromCharCode(...bytes.subarray(at,at+6144));files.push({name:item.file.name,base64:btoa(binary)});}
   if(currentDeal()!==deal||selection()!==signature||password.value!==secret)throw Error('Сделка или ЭЦП изменились. Повторите действие.');
   const response=await fetch(`/api/assessment/${encodeURIComponent(deal)}/credentials`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),identityRevision:context.identityRevision,clientName,password:secret,ownerConfirmed:true,files})});
   const result=await response.json();if(!response.ok)throw Error('ЭЦП не подтверждена. Проверьте ключ, пароль и текущую сделку.');
   if(currentDeal()!==deal||selection()!==signature||password.value!==secret)throw Error('Выбор изменился во время загрузки. Проверьте текущую ЭЦП.');
   if(result.state==='prepared'){cancellable={deal,requestId:result.requestId};cancel.hidden=false;}
   if(result.state==='prepared')throw Error('Файлы ещё не отправлены. Устраните причину ошибки и повторите загрузку.');
   if(!result.verified)throw Error('Результат пока не подтверждён. Нажмите ещё раз для сверки без повторной отправки.');
   verifiedDeal=deal;verifiedSelection=signature;status.textContent='ЭЦП сохранена и прочитана обратно из Bitrix. Подлинность ключа и правильность пароля автоматически не проверялись.';
   refreshRequiredDocuments();statusChanged();return true;
  }catch(error){status.textContent=error.message;throw error;}finally{busy=false;button.disabled=false;await refreshCancellation();}
 };
 cancel.onclick=async()=>{
  if(busy||!cancellable||currentDeal()!==cancellable.deal)return;
  busy=true;cancel.disabled=button.disabled=true;
  try{const response=await fetch(`/api/assessment/${encodeURIComponent(cancellable.deal)}/credentials`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',requestId:cancellable.requestId})});const result=await response.json();if(!response.ok||result.state!=='cancelled')throw Error('Загрузка уже началась или изменилась. Отмена не выполнена.');cancellable=null;cancel.hidden=true;status.textContent='Неотправленная загрузка отменена. Можно повторить загрузку ЭЦП.';}
  catch(error){status.textContent=error.message;}finally{busy=false;cancel.disabled=button.disabled=false;}
 };
 button.onclick=()=>submit().catch(error=>{status.textContent=error.message;});
 return {verified,collected,submit,pendingOnly,offerExisting};
})();
