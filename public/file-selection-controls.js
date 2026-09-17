/* Edits the active selection only. Never deletes stored originals or CRM attachments. */
window.FileSelectionControls=(()=>{
 const $=id=>document.getElementById(id),make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 let submissionBusy=false;
 const locked=()=>Boolean(af.busy||window.CredentialUpload?.isBusy?.()||submissionBusy||!HostedAssessment.ready()||
  (window.ServerDrafts?.canSwitch&&!ServerDrafts.canSwitch())||
  (window.ClientContextUI?.mode==='handoff'&&!window.HandoffFiles?.canEdit()));
 function selectionChanged(type){
  if(type==='ЭЦП файл')window.CredentialUpload?.selectionChanged();
  window.HandoffFiles?.selectionChanged(type);
 }
 function notify(){
  renderDocuments();afRenderResults();afRenderConflicts();afClientChoices();
  window.DocumentReplacement?.refreshMarkers();afRefresh();
  // Existing validators, saved-contract guards and autosave receive the same edit event.
  $('selectedDocuments').dispatchEvent(new Event('change',{bubbles:true}));
  document.dispatchEvent(new Event('assessment-files-selected'));
 }
 function remove(item){
  if(locked()||!selectedFiles.includes(item))return false;
  selectedFiles=selectedFiles.filter(entry=>entry!==item);
  af.results.delete(item.id);af.conflicts=af.conflicts.filter(entry=>entry.src.fileId!==item.id);
  // The original render wrapper marks answers sourced from the removed file as stale.
  selectionChanged(item.type);notify();
  afStatus('Файл убран из выбора. Уже сохранённые документы не удалены.');
  return true;
 }
 function button(item){
  const e=make('button','Убрать','btn btn-ghost file-selection-remove');e.type='button';
  e.setAttribute('aria-label','Убрать '+item.file.name);e.title='Убрать из выбора, не удаляя сохранённый оригинал';e.disabled=locked();e.onclick=()=>remove(item);return e;
 }
 function replaceKey(item){
  if(locked())return;const context=HostedAssessment.getContext(),input=make('input');input.type='file';input.accept='.p12,.pfx,.key';
  input.onchange=()=>{
   const file=input.files[0];if(!file||locked()||HostedAssessment.getContext()!==context||!selectedFiles.includes(item))return;
   if(!/\.(p12|pfx|key)$/i.test(file.name)||!file.size||file.size>2*1024*1024){afStatus('Выберите ключ ЭЦП до 2 МБ.',true);return;}
   const next={id:++fileSequence,file,type:item.type,person:item.person};selectedFiles.splice(selectedFiles.indexOf(item),1,next);af.results.delete(item.id);selectionChanged(item.type);notify();
  };input.click();
 }
 const groups=[...document.querySelectorAll('#uxHandoff [data-required-document]')].map(host=>{
  const list=make('div',null,'file-selection-list');host.after(list);return{host,list,signature:null};
 });
 const signedRemove=make('button','Убрать PDF','btn btn-ghost file-selection-remove');signedRemove.type='button';signedRemove.id='handoffSignedRemove';
 $('handoffSignedOpen')?.after(signedRemove);
 signedRemove.onclick=()=>{const item=selectedFiles.find(e=>e.type==='Подписанный договор'&&e.person==='Клиент');if(item)remove(item);};
 function refresh(){
  const disabled=locked();
  for(const group of groups){
   const entries=selectedFiles.filter(e=>e.type===group.host.dataset.requiredDocument&&e.person==='Клиент');
   const signature=JSON.stringify(entries.map(e=>[e.id,e.file.name,e.storedDocumentId]));
   if(signature!==group.signature){
    group.signature=signature;group.list.replaceChildren();
    for(const item of entries){
     const row=make('div',null,'file-selection-row'),name=make('span',item.file.name,'file-selection-name'),actions=make('div',null,'file-selection-actions');
     const replace=item.type==='ЭЦП файл'?make('button','Заменить','btn btn-ghost'):window.DocumentReplacement?.button(item);
     if(replace){replace.type='button';replace.setAttribute('aria-label','Заменить '+item.file.name);if(item.type==='ЭЦП файл')replace.onclick=()=>replaceKey(item);actions.append(replace);}
     actions.append(button(item));row.append(name,actions);group.list.append(row);
    }
   }
   group.list.hidden=!entries.length;group.list.querySelectorAll('button').forEach(e=>e.disabled=disabled);
  }
  const signed=selectedFiles.find(e=>e.type==='Подписанный договор'&&e.person==='Клиент');signedRemove.hidden=!signed;signedRemove.disabled=disabled;
  if(signed)signedRemove.setAttribute('aria-label','Убрать '+signed.file.name);
  const picker=$('handoffSignedFile');if(picker?.parentElement?.firstChild?.nodeType===3)picker.parentElement.firstChild.textContent=signed?'Заменить PDF':'Выбрать PDF';
  for(const e of document.querySelectorAll('#afFileResults .file-selection-remove,#afFileResults .af-replace-document'))e.disabled=disabled;
  const rows=$('selectedDocuments').querySelectorAll('.document-row');
  rows.forEach((row,i)=>{const item=selectedFiles[i],e=row.querySelector('.document-remove');if(item&&e){e.disabled=disabled;e.onclick=()=>remove(item);}});
 }
 const previous=renderDocuments;renderDocuments=function(){previous();refresh();};
 document.addEventListener('assessment-submission-progress',e=>{submissionBusy=Boolean(e.detail?.busy);refresh();});
 document.addEventListener('change',e=>{if(e.target.dataset?.requiredPicker==='ЭЦП файл')selectionChanged('ЭЦП файл');});
 for(const event of ['assessment-analysis-complete','assessment-case-opened','assessment-draft-load-state','assessment-files-selected','assessment-credentials-changed','assessment-client-readiness-changed','change'])document.addEventListener(event,()=>queueMicrotask(refresh));
 queueMicrotask(()=>{afRenderResults();refresh();});
 return{locked,remove,button,selectionChanged,refresh};
})();
