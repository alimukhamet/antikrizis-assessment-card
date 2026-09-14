/* Replacement keeps the old original and draft version; only the active selection changes. */
window.DocumentReplacement=(()=>{
 const current=()=>HostedAssessment.getContext();
 async function replace(item,file){
  if(af.busy||!HostedAssessment.ready()||!selectedFiles.includes(item))return false;
  if(afExcluded({file,type:item.type})){afStatus('Для ЭЦП используйте замену в разделе ЭЦП.',true);return false;}
  const context=current(),dealId=context.client.external.dealId;
  if(!await ServerDrafts.save({automatic:true}))return false;
  if(current()!==context||!selectedFiles.includes(item)||af.busy)return false;
  const locked=[...document.getElementById('documentStep').querySelectorAll('input,select,button')].map(e=>[e,e.disabled]);
  af.busy=true;locked.forEach(([e])=>e.disabled=true);afStatus('Читаем новый файл. Прежний документ остаётся в черновике…');
  let replaced=false;
  try{
   const candidate={id:fileSequence=Math.max(fileSequence,...selectedFiles.map(f=>f.id))+1,file,type:item.type,person:item.person};
   const payload=await HostedAssessment.analyzeFile(candidate),result=HostedAssessment.adapt(payload);
   if(current()!==context||result.server?.dealId!==dealId||!selectedFiles.includes(item))throw Error('Клиент изменился. Прежний документ сохранён.');
   if(item.person==='Клиент'&&result.identity?.iin&&context.client.iin&&result.identity.iin!==context.client.iin)throw Error('В новом документе другой ИИН. Прежний файл оставлен.');
   if(!result.server?.documentId||result.error)throw Error('Новый файл не прочитан. Прежний файл оставлен.');
   if(result.kind!=='other'&&result.type)candidate.type=result.type;
   for(const [id,source]of af.sources)if(source.fileId===item.id){source.stale=true;source.pending=true;source.reviewId=null;const control=document.getElementById(id);if(control)control.dataset.sourceReplaced='true';}
   af.conflicts=af.conflicts.filter(conflict=>conflict.src.fileId!==item.id);
   selectedFiles.splice(selectedFiles.indexOf(item),1,candidate);af.results.set(candidate.id,result);replaced=true;
   afClientChoices();afApply();renderDocuments();
   afStatus('Документ заменён. Ответы сохранены; отмеченные поля нужно сверить с новым файлом.');
  }catch(error){afStatus(error.message||'Замена не удалась. Прежний файл оставлен.',true);}
  finally{af.busy=false;locked.forEach(([e,disabled])=>e.disabled=disabled);afRenderResults();refreshMarkers();afRefresh();document.dispatchEvent(new Event('assessment-analysis-complete'));if(replaced)await ServerDrafts.save({automatic:true});}
  return replaced;
 }
 function button(item){const node=document.createElement('button');node.type='button';node.className='btn btn-ghost af-replace-document';node.textContent='Заменить';node.setAttribute('aria-label','Заменить '+item.file.name);node.disabled=af.busy;node.onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='application/pdf,.pdf';input.onchange=()=>{if(input.files[0])replace(item,input.files[0]);};input.click();};return node;}
 function refreshMarkers(){
  for(const control of document.querySelectorAll('#questionnaireStep [data-source-replaced]')){
   control.setCustomValidity('Источник заменён. Сверьте ответ с новым документом.');
   if(af.sources.has(control.id))continue;
   const field=control.closest('.field');if(!field||field.querySelector('[data-replacement-notice]'))continue;
   const note=document.createElement('div');note.className='af-source pending';note.dataset.replacementNotice='';
   const text=document.createElement('span');text.textContent='Источник заменён. Проверьте и введите ответ заново.';
   const clear=document.createElement('button');clear.type='button';clear.textContent='Очистить ответ';clear.onclick=()=>{if(control.type==='checkbox')control.checked=false;else control.value='';control.dispatchEvent(new Event('input',{bubbles:true}));};note.append(text,clear);field.append(note);
  }
 }
 // Typing a new answer acknowledges the retired source; autofill clears it only with fresh evidence.
 for(const name of ['input','change'])document.addEventListener(name,event=>{const control=event.target;if(!af.applying&&control.hasAttribute?.('data-source-replaced')){delete control.dataset.sourceReplaced;control.setCustomValidity('');const source=af.sources.get(control.id);if(source&&!selectedFiles.some(item=>item.id===source.fileId))af.sources.delete(control.id);control.closest('.field')?.querySelectorAll('[data-replacement-notice],.af-source[data-for="'+control.id+'"]').forEach(e=>e.remove());}});
 document.addEventListener('assessment-draft-restored',refreshMarkers);
 return{replace,button,refreshMarkers};
})();
