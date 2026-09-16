/* Each client has its own URL and server draft. Switching loads a fresh page. */
window.ClientWorkspace=(()=>{
 const $=id=>document.getElementById(id);
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 const button=(text,fn)=>{const node=el('button',text,'btn btn-ghost');node.type='button';node.onclick=fn;return node;};
 let directory=null,switching=false;
 const url=id=>(new URLSearchParams(location.search).get('mode')==='handoff'?'/lawyer-handoff':'/assessment-review')+'?dealId='+encodeURIComponent(id);
 const json=(path,options)=>HostedAssessment.requestJson(path,options);
 function close(){if(directory){directory.close();directory.remove();directory=null;}}
 async function switchTo(id){
  const current=HostedAssessment.getContext()?.client.external.dealId;
  if(!/^[1-9]\d*$/.test(id)||id===current){close();return;}
  if(switching)return;switching=true;
  try{
   if(current){
    $('hostDealId').value=current;
    if(af.busy||!ServerDrafts.canSwitch()){afStatus('Дождитесь загрузки черновика и документов перед сменой клиента.',true);return;}
    if(ServerDrafts.isDirty()||ServerDrafts.isBusy()){
     if(!await ServerDrafts.save({automatic:true})||ServerDrafts.isDirty()){afStatus('Переход остановлен: последние изменения ещё не сохранены.',true);return;}
    }
    if(ServerDrafts.hasTransientFiles()){
     close();const dialog=el('dialog',null,'client-dialog');dialog.setAttribute('aria-label','Файлы текущего клиента');
     dialog.append(el('h2','Сохраните доступ к выбранным файлам'),el('p','Ответы сохранены. Некоторые выбранные файлы или ключ ЭЦП доступны только в этой вкладке. Другого клиента можно открыть рядом, сохранив текущую работу.'));
     const stay=button('Остаться',()=>{dialog.close();dialog.remove();});
     const next=el('a','Открыть клиента в новой вкладке','btn btn-main');next.href=url(id);next.target='_blank';next.rel='noopener';next.onclick=()=>{dialog.close();dialog.remove();};
     dialog.append(stay,next);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return;
    }
   }
   close();(window.parent||window).location.assign(url(id));
  }finally{switching=false;}
 }
 async function open(){
  if(directory){directory.focus();return;}
  const dialog=el('dialog',null,'client-dialog');directory=dialog;dialog.setAttribute('aria-labelledby','clientDirectoryTitle');
  const heading=el('h2','Выбрать клиента');heading.id='clientDirectoryTitle';
  const exit=button('Закрыть',close),search=el('input');search.type='search';search.placeholder='Имя клиента или номер сделки';search.setAttribute('aria-label','Найти клиента');
  const status=el('p','Загружаем черновики…','hint'),list=el('div',null,'client-directory-list');status.setAttribute('role','status');search.maxLength=80;
  const archiveLabel=el('label',null,'client-archive-toggle'),archive=el('input');archive.type='checkbox';archiveLabel.append(archive,document.createTextNode(' Показать клиентов с договором'));archive.onchange=render;dialog.append(heading,exit,search,archiveLabel,status,list);dialog.addEventListener('close',()=>{dialog.remove();if(directory===dialog)directory=null;},{once:true});document.body.append(dialog);dialog.showModal();
  archive.checked=new URLSearchParams(location.search).get('mode')==='handoff';
  let data={drafts:[],recent:[]},timer,request=0,controller;
  function render(){
    list.replaceChildren();const query=search.value.trim().toLocaleLowerCase('ru-RU'),seen=new Set(),hiddenContracts=new Set();let total=0;
    for(const [title,items,draft]of [['Сохранённые черновики',data.drafts,true],['Клиенты в Bitrix',query.length>=2?data.recent:[],false]]){
     const rows=items.filter(item=>!seen.has(item.dealId)&&(!query||(item.title+' '+item.dealId).toLocaleLowerCase('ru-RU').includes(query)));
     for(const item of rows)if(item.hasContract&&!archive.checked)hiddenContracts.add(item.dealId);
     const visible=rows.filter(item=>archive.checked||!item.hasContract);if(!visible.length)continue;list.append(el('h3',title));
     for(const item of visible){
      seen.add(item.dealId);total++;const row=button('',()=>switchTo(item.dealId));row.className='client-directory-row';
      const copy=el('span'),name=el('strong',item.title||'Сделка № '+item.dealId),meta=el('span','№ '+item.dealId+(draft?' · Сохранено '+new Date(item.updatedAt).toLocaleDateString('ru-RU'):'')+' · Файлов: '+item.fileCount+(item.hasContract?' · Договор уже оформлен':''),'hint');copy.append(name,meta);
      const current=HostedAssessment.getContext()?.client.external.dealId===item.dealId;row.disabled=current;row.append(copy,el('span',current?'Открыт':draft?'Продолжить →':'Открыть →'));list.append(row);
     }
    }
    if(!total)list.append(el('p',hiddenContracts.size?'У найденных клиентов уже оформлен договор. Включите показ клиентов с договором, чтобы открыть сохранённую работу.':query?'Совпадений нет.':'Пока нет незавершённых черновиков.','hint'));
    if(/^[1-9]\d*$/.test(query)&&!seen.has(query)&&!hiddenContracts.has(query))list.append(button('Открыть сделку № '+query,()=>switchTo(query)));
  }
  async function load(query){
   controller?.abort();controller=new AbortController();const id=++request;status.textContent=query?'Ищем клиента…':'Загружаем черновики…';
   try{
    const result=await json('/api/assessment/clients'+(query?'?q='+encodeURIComponent(query):''),{signal:controller.signal});
    if(directory!==dialog||id!==request)return;data={...data,...result};render();
    status.textContent=[result.draftsUnavailable?'Не удалось загрузить черновики.':'',result.recentUnavailable?'Не удалось найти клиента в Bitrix.':'',query?'':'Для другого клиента введите имя или номер сделки.'].filter(Boolean).join(' ');
   }catch{if(directory===dialog&&id===request){status.textContent='Не удалось загрузить список. Введите номер сделки, чтобы открыть клиента.';render();}}
  }
  search.oninput=()=>{clearTimeout(timer);controller?.abort();request++;data.recent=[];render();const query=search.value.trim();if(query.length>=2){status.textContent='Ищем клиента…';timer=setTimeout(()=>load(query),250);}else status.textContent='Для другого клиента введите имя или номер сделки.';};
  dialog.addEventListener('close',()=>{clearTimeout(timer);controller?.abort();request++;},{once:true});
  await load('');
 }
 async function importDocuments(){
  if(af.busy||!HostedAssessment.ready()||!ServerDrafts.canSwitch()){afStatus('Сначала дождитесь загрузки черновика клиента.',true);return;}
  if(window.AssessmentWorkflow&&!AssessmentWorkflow.prepareUpload())return;
  const context=HostedAssessment.getContext(),base='/api/assessment/'+context.client.external.dealId+'/crm-documents',notice=$('crmImportStatus');
  const locked=[...$('documentStep').querySelectorAll('input,select,button')].map(node=>[node,node.disabled]);locked.forEach(([node])=>node.disabled=true);af.busy=true;af.transferFailures=[];$('documentStep').classList.add('af-busy');
  afRefresh();
  let imported=0,reused=0,keysSkipped=0;const failures=[],seen=new Set();
  try{
   const {files}=await json(base);afAnalysisProgress(0,files.length);if(!files.length){notice.textContent='В сделке пока нет загруженных документов.';return;}
   for(let i=0;i<files.length;i++){
    afAnalysisProgress(i,files.length);notice.textContent='Берём документы из сделки: '+(i+1)+' из '+files.length+'…';
    try{
     const payload=await json(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId:files[i].id,identityRevision:context.identityRevision})});
     if(seen.has(payload.documentId))continue;seen.add(payload.documentId);
     const result=HostedAssessment.adapt(payload);result.assessmentDate=payload.assessmentDay;
     let item=selectedFiles.find(item=>(item.storedDocumentId||af.results.get(item.id)?.server?.documentId)===payload.documentId);
     if(item)reused++;else{item={id:++fileSequence,file:{name:payload.originalName,size:0,type:'application/pdf'},type:result.type||'',person:'Клиент',storedDocumentId:payload.documentId};selectedFiles.push(item);imported++;}
     item.storedDocumentId=payload.documentId;if(result.type&&result.kind!=='other')item.type=result.type;
     af.results.set(item.id,result);
    }catch(error){if(error.code==='CREDENTIAL_NOT_ANALYSED'){keysSkipped++;window.CredentialUpload?.offerExisting(files[i].id);}else failures.push('Файл № '+files[i].id+': '+error.message);}finally{afAnalysisProgress(i+1,files.length);}
   }
   afRenderResults();afClientChoices();if($('afClient').value)afApply();renderDocuments();afRefresh();
   notice.textContent='Добавлено PDF: '+imported+(reused?' · Уже в черновике: '+reused:'')+(failures.length?' · Не удалось прочитать: '+failures.length:'')+(keysSkipped?' · ЭЦП найдена в сделке':'')+'.';
   $('crmImportErrors')?.remove();
   if(failures.length){const details=el('details');details.id='crmImportErrors';details.append(el('summary','Какие файлы не добавлены'));for(const message of failures)details.append(el('p',message,'hint'));notice.after(details);}
  }catch(error){notice.textContent=error.message;failures.push(error.message);}
  finally{af.transferFailures=failures;af.progress=null;$('documentStep').classList.remove('af-busy');af.busy=false;locked.forEach(([node,disabled])=>node.disabled=disabled);afRefresh();document.dispatchEvent(new CustomEvent('assessment-analysis-complete',{detail:{showPackageSummary:true}}));if(imported||reused)await ServerDrafts.save({automatic:true});}
 }
 const clients=button(HostedAssessment.ready()?'Другой клиент':'Выбрать',open);clients.id='openClients';clients.setAttribute('aria-label',HostedAssessment.ready()?'Сменить клиента':'Выбрать клиента');document.querySelector('.wf-client-copy').after(clients);
 const picker=document.querySelector('.wf-case-picker');picker.querySelector('summary').textContent='По номеру сделки';
 document.addEventListener('assessment-case-opened',()=>{picker.querySelector('summary').textContent='По номеру сделки';clients.textContent='Другой клиент';clients.setAttribute('aria-label','Сменить клиента');});
 const importer=button('Взять из Bitrix',importDocuments);importer.id='importCrmDocuments';(document.querySelector('.wf-tools-content')||document.querySelector('.wf-upload-actions')).prepend(importer);
 const notice=el('p',null,'hint');notice.id='crmImportStatus';notice.setAttribute('role','status');document.querySelector('.wf-upload-box').append(notice);
 window.AssessmentWorkflow?.refresh();
 return{open,switchTo,importDocuments};
})();
