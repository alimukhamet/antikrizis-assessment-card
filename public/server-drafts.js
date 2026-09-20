window.ServerDrafts=(()=>{
 let revision=0,request=null,loading=false,epoch=0,baselineLoaded=false,baselineSnapshot=null,casePath=null,recoverySnapshot=null,saveTask=null,timer=null,missingFiles=[];
 let loadState={phase:'idle',error:null};
 function loadStatus(phase,error=null){loadState={phase,error};document.dispatchEvent(new Event('assessment-draft-load-state'));}
 const $=id=>document.getElementById(id);
 function controlKey(e){if(e.closest('.af-source'))return null;if(e.closest('.exact-count'))return 'exact:'+e.closest('.exact-count').previousElementSibling.id;if(e.type==='checkbox'){if(e.dataset.holding)return `holding:${e.dataset.owner}:${e.dataset.holding}`;if(e.dataset.unknown)return `unknown:${e.dataset.unknown}`;if(e.dataset.legacyUnknown)return `unknown:${e.dataset.legacyUnknown}`;if(e.name)return `choice:${e.name}:${e.value}`;}return e.id.replace(/_r\d+$/,'');}
 function controls(root){return [...root.querySelectorAll('input,select,textarea')].filter(e=>!e.closest('.af-source')&&!['file','password'].includes(e.type));}
 function capture(){
  const root=$('questionnaireStep'),answer=e=>({key:controlKey(e),value:e.value,checked:Boolean(e.checked),...(e.dataset.sourceReplaced?{sourceReplaced:true}:{})});
  const values=controls(root).filter(e=>!e.closest('.repeat-item')).map(answer).filter(a=>a.key);
  const groups=[...root.querySelectorAll('.repeat')].map(g=>({id:g.id,rows:[...g.querySelector(':scope > .repeat-rows').children].map(row=>controls(row).map(answer).filter(a=>a.key)),rowKeys:[...g.querySelector(':scope > .repeat-rows').children].map(row=>[...af.rowKeys].find(([,id])=>id===row.id)?.[0]||null)}));
  // A confirmed replacement key supersedes old transient key names, never missing PDFs.
  const documents=[],pendingFiles=missingFiles.filter(name=>!selectedFiles.some(item=>item.file.name===name)&&!(window.CredentialUpload?.collected?.()&&/\.(p12|pfx|key)$/i.test(name)));
  for(const item of selectedFiles){if(item.type==='ЭЦП файл'&&!window.CredentialUpload?.verified())pendingFiles.push(item.file.name);if(afExcluded(item))continue;const source=af.results.get(item.id)?.server;if((source&&source.dealId===HostedAssessment.getContext().client.external.dealId)||(!source&&item.storedDocumentId))documents.push({documentId:source?.documentId||item.storedDocumentId,type:item.type,person:item.person});else pendingFiles.push(item.file.name);}
  return {schemaVersion:1,answers:values,groups,docContext:{social:$('needsSocialDoc').value,salary:$('needsSalaryDoc').value==='1'?'1':$('needsSalaryDoc').value?'0':'',salaryBank:$('needsSalaryDoc').value==='1'?'other':$('needsSalaryDoc').value},documents,pendingFiles};
 }
 const base=()=>'/api/assessment/'+HostedAssessment.getContext().client.external.dealId;
 const message=code=>({DRAFT_CHANGED:'Черновик изменён другим сотрудником. Загрузите последнюю версию перед сохранением.',CASE_IDENTITY_CHANGED:'ИИН сделки изменился. Откройте сделку заново.',WRONG_CLIENT:'ИИН анкеты не совпадает со сделкой.',IDEMPOTENCY_KEY_REUSED:'Запрос уже использован для другой версии. Перезагрузите черновик.',SIGN_IN_REQUIRED:'Войдите на сайт заново.'}[code]||'Не удалось сохранить или загрузить черновик. Ваши ответы остаются на экране.');
 const api=(path,options)=>HostedAssessment.requestJson(path,options,{message});
 function isDirty(){return baselineSnapshot!==null&&JSON.stringify(capture())!==baselineSnapshot;}
 function hasTransientFiles(){return selectedFiles.some(item=>afExcluded(item)?!window.CredentialUpload?.verified():!item.storedDocumentId&&!af.results.get(item.id)?.server)||Boolean($('previewEdsPassword').value);}
 function changed(){
  clearTimeout(timer);if(loading||!HostedAssessment.ready()||!baselineLoaded)return;
  if(isDirty()){showDraftStatus('Есть несохранённые изменения…');timer=setTimeout(()=>{if(af.busy){changed();return;}save({automatic:true});},1500);}
 }
 // A restored pending filename has no stored original to delete. Discarding
 // that selection is explicit, versioned with the draft, and never edits Bitrix.
 function forgetPendingFile(name){
  if(typeof name!=='string'||!baselineLoaded||loading||af.busy||!HostedAssessment.ready()||window.FileSelectionControls?.locked()||!missingFiles.includes(name))return false;
  missingFiles=missingFiles.filter(value=>value!==name);changed();return true;
 }
 async function inspect(){
  if(!HostedAssessment.ready()||loading)return;
  const sequence=++epoch,b=base(),initialSnapshot=JSON.stringify(capture());
  if(casePath!==b){casePath=b;baselineLoaded=false;revision=0;baselineSnapshot=initialSnapshot;}
  loadStatus('loading');showDraftStatus('Открываем черновик клиента…');
  try{
   const r=await api(b+'/draft');if(sequence!==epoch||b!==base())return;
   if(!r.draft){if(!baselineLoaded){revision=0;baselineLoaded=true;}loadStatus('ready');showDraftStatus('Ответы будут сохраняться автоматически.');changed();return;}
   $('loadDraft').classList.remove('hidden');
   if(!baselineLoaded&&JSON.stringify(capture())===initialSnapshot){await restore({draft:r.draft,automatic:true});return;}
   if(!baselineLoaded){const text='Есть сохранённый черновик. Откройте его перед продолжением — ваши новые ответы можно скачать.';loadStatus('error',text);showDraftStatus(text);}else loadStatus('ready');
  }catch(e){if(sequence!==epoch||b!==base())return;loadStatus('error',e.message);showDraftStatus(e.message);}
 }
 async function save(options={}){
  clearTimeout(timer);
  if(saveTask){if(!await saveTask)return false;if(!isDirty())return true;return save(options);}
  if(loading||af.busy||!HostedAssessment.ready()){showDraftStatus('Дождитесь загрузки клиента и документов.');return false;}
  if(!baselineLoaded){showDraftStatus('Откройте сохранённый черновик перед продолжением.');return false;}
  if(options.automatic&&!isDirty())return true;
  const savedContext=HostedAssessment.getContext(),path=base(),payload=capture(),body={payload,expectedRevision:revision,identityRevision:HostedAssessment.getContext().identityRevision},signature=JSON.stringify(body);
  if(request?.signature!==signature)request={signature,requestId:crypto.randomUUID()};body.requestId=request.requestId;
  $('saveDraft').disabled=true;showDraftStatus('Сохраняем черновик…');
  saveTask=(async()=>{
   try{
    const result=await api(path+'/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(savedContext!==HostedAssessment.getContext())return false;
    revision=result.revision;request=null;baselineSnapshot=JSON.stringify(payload);
    if(result.latestRevision!==result.revision)throw Object.assign(Error(message('DRAFT_CHANGED')),{code:'DRAFT_CHANGED'});
    $('loadDraft').classList.add('hidden');
    showDraftStatus('Черновик сохранён · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+(payload.pendingFiles.length?' · выбрать заново: '+payload.pendingFiles.length:''));
    document.dispatchEvent(new Event('assessment-draft-saved'));return true;
   }catch(e){if(savedContext!==HostedAssessment.getContext())return false;if(['DRAFT_CHANGED','CASE_IDENTITY_CHANGED'].includes(e.code)){baselineLoaded=false;$('loadDraft').classList.remove('hidden');}showDraftStatus(e.message);return false;}
   finally{if(savedContext===HostedAssessment.getContext())$('saveDraft').disabled=false;}
  })();
  const result=await saveTask;saveTask=null;if(result&&isDirty())changed();return result;
 }
 function assign(e,a){if(!e)return;if(a.sourceReplaced)e.dataset.sourceReplaced='true';if(['unknown','Не знаю'].includes(a.value)&&e.type!=='checkbox'){e.value='';return;}if(e.tagName==='SELECT'&&a.value&&!Array.from(e.options).some(o=>o.value===a.value)){if(e.hasAttribute('data-compact-count')&&/^\d+$/.test(a.value))setCount(e,Number(a.value));else return;}if(e.type==='checkbox')e.checked=a.checked;else e.value=a.value;delete e.dataset.clientConfirmedValue;}
 async function confirmRestore(){
  if(baselineSnapshot===null||JSON.stringify(capture())===baselineSnapshot)return true;
  return new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.className='draft-restore-dialog';const text=document.createElement('p');text.textContent='Загрузка заменит ваши несохранённые ответы. Можно сначала скачать их копию или отменить загрузку.';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отмена';cancel.className='btn btn-ghost';const apply=document.createElement('button');apply.type='button';apply.textContent='Скачать копию и загрузить';apply.className='btn btn-main';apply.dataset.draftReplace='true';const finish=value=>{dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>finish(false);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});apply.onclick=()=>{recoverySnapshot=capture();const url=URL.createObjectURL(new Blob([JSON.stringify(recoverySnapshot,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='unsaved-assessment-'+HostedAssessment.getContext().client.external.dealId+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);finish(true);};dialog.append(text,cancel,apply);document.body.append(dialog);dialog.showModal();});
 }
 async function restore(options={}){if(loading||!HostedAssessment.ready())return;clearTimeout(timer);if(saveTask)await saveTask;loading=true;$('loadDraft').disabled=true;try{if(!options.automatic&&!await confirmRestore())return;const path=base(),before=JSON.stringify(capture()),response=options.draft?{draft:options.draft}:await api(path+'/draft');if(path!==base()||!response.draft)return;if(JSON.stringify(capture())!==before)throw Error('Ответы изменились во время загрузки. Они сохранены на экране; повторите открытие черновика.');const draft=response.draft,p=draft.payload,recovered=draft.recovery?.mode==='documents-only'&&draft.recovery.identityRevision===HostedAssessment.getContext().identityRevision;if(draft.identityRevision!==HostedAssessment.getContext().identityRevision&&!recovered)throw Error('ИИН сделки изменился. Сохранённые ответы относятся к прежним данным клиента; они не заменены.');missingFiles=[...new Set(p.pendingFiles)];
  const iin=p.answers.find(a=>a.key==='iin')?.value;if(HostedAssessment.getContext().client.iin&&iin&&iin!==HostedAssessment.getContext().client.iin)throw Error('Черновик относится к другому ИИН. Ответы не загружены.');
  if(p.schemaVersion!==1)throw Error('Версия черновика не поддерживается.');
  const root=$('questionnaireStep');af.sources.clear();af.results.clear();af.rowKeys.clear();af.conflicts=[];af.client=HostedAssessment.getContext().client.iin||'';root.querySelectorAll('.af-source').forEach(e=>e.remove());
  // Only trusted templates build rows. No HTML from storage is inserted into the page.
  root.querySelectorAll('.exact-count').forEach(e=>e.remove());
  controls(root).forEach(e=>{delete e.dataset.clientConfirmedValue;delete e.dataset.sourceReplaced;e.setCustomValidity('');e.disabled=false;if(e.type==='checkbox')e.checked=false;else e.value='';});
  for(const g of root.querySelectorAll('.repeat')){const group=p.groups.find(group=>group.id===g.id),rows=group?.rows||[];g.querySelector(':scope > .repeat-rows').replaceChildren();for(let i=0;i<rows.length;i++){const row=add(g);const key=group.rowKeys?.[i];if(key){row.id='restored-row-'+(++nextRow);af.rowKeys.set(key,row.id);}}}
  const top=controls(root).filter(e=>!e.closest('.repeat-item'));for(const a of p.answers)assign(top.find(e=>controlKey(e)===a.key),a);
  window.RequiredAnswers?.restore();
  af.applying=true;try{for(const e of top){if(e.matches('.job-count,[data-car-count]')&&e.value!=='more')continue;e.dispatchEvent(new Event('change',{bubbles:true}));}}finally{af.applying=false;}
  for(const a of p.answers.filter(a=>a.key.startsWith('exact:')))assign(controls(root).find(e=>controlKey(e)===a.key),a);
  for(const group of p.groups){const g=document.getElementById(group.id);if(!g)continue;const rows=g.querySelector(':scope > .repeat-rows');for(let i=0;i<group.rows.length;i++){if(!rows.children[i])add(g);const cs=controls(rows.children[i]);for(const a of group.rows[i])assign(cs.find(e=>controlKey(e)===a.key),a);}}
  window.RequiredAnswers?.restore();
  const all=controls(root);af.applying=true;try{all.filter(e=>e.closest('.repeat-item')).forEach(e=>e.dispatchEvent(new Event('change',{bubbles:true})));}finally{af.applying=false;}
  $('needsSocialDoc').value=p.docContext.social;$('needsSalaryDoc').value=p.docContext.salaryBank==='other'?'1':p.docContext.salaryBank??(p.docContext.salary==='1'?'1':'');
  syncBenefitAnswer();
  selectedFiles=[];fileSequence=0;
  const failed=[];for(const doc of p.documents){if(!doc.originalName)failed.push(doc.documentId);selectedFiles.push({id:++fileSequence,file:{name:doc.originalName||'Сохранённый документ — '+doc.type,size:0,type:'application/pdf'},type:doc.type,person:doc.person||'Клиент',storedDocumentId:doc.documentId});}
  revision=draft.revision;request=null;baselineLoaded=true;$('loadDraft').classList.add('hidden');renderDocuments();afRenderResults();afRenderConflicts();afClientChoices();children();spouse();kaspi();visibilityRules();afRefresh();document.dispatchEvent(new Event('assessment-draft-restored'));
  baselineSnapshot=JSON.stringify(capture());
  if(recovered&&HostedAssessment.getContext().client.iin)$('iin').value=HostedAssessment.getContext().client.iin;
  loadStatus('documents');
  // Handoff owns its two PDFs and credentials. Unrelated intake analysis must
  // neither delay this screen nor repopulate the saved questionnaire.
  if(selectedFiles.length&&new URLSearchParams(location.search).get('mode')!=='handoff')await afAnalyze({cacheOnly:true,restoreOnly:true});
  showDraftStatus('Черновик загружен · версия '+revision+' · в облаке: '+selectedFiles.length+'.'+(recovered?' Документы восстановлены после обновления ИИН.':'')+(failed.length?' Не удалось получить: '+failed.length+'.':'')+(p.pendingFiles.length?' Выбрать заново: '+p.pendingFiles.length+'.':''));
 }catch(e){loadStatus('error',e.message);showDraftStatus(e.message);}finally{loading=false;$('loadDraft').disabled=false;if(loadState.phase!=='error')loadStatus('ready');changed();}}
 function mount(){
  $('saveDraft').onclick=()=>save();$('loadDraft').onclick=()=>restore();$('saveDraft').disabled=false;
  document.addEventListener('assessment-case-opened',inspect);
  for(const event of ['input','change'])document.addEventListener(event,e=>{if(e.target.closest?.('#questionnaireStep,#documentStep')&&!af.applying)queueMicrotask(changed);});
  document.addEventListener('click',e=>{if(e.target.closest?.('.add-row,.remove-row'))queueMicrotask(changed);});
  document.addEventListener('assessment-analysis-complete',changed);
  const previousRender=renderDocuments;renderDocuments=function(){previousRender();queueMicrotask(changed);};
  window.addEventListener('beforeunload',event=>{if(isDirty()||hasTransientFiles()||af.busy){event.preventDefault();event.returnValue='';}});
  if(HostedAssessment.ready())inspect();
 }
 function reviewBindings(){return [...af.sources].flatMap(([id,source])=>{
  const control=$(id);if(!control||!source.server||!source.serverFactKey)return [];
  const row=control.closest('.repeat-item'),group=row?.closest('.repeat');
  return [{key:controlKey(control),...(group?{group:group.id,row:[...group.querySelector(':scope > .repeat-rows').children].indexOf(row)}:{}),documentId:source.server.documentId,extractionId:source.server.extractionId,factKey:source.serverFactKey,reviewId:source.pending||source.stale?null:source.reviewId||null}];
 });}
 return{mount,capture,reviewBindings,save,restore,inspect,forgetPendingFile,loadState:()=>loadState,pendingFiles:()=>missingFiles.filter(name=>!selectedFiles.some(item=>item.file.name===name)&&!(window.CredentialUpload?.collected?.()&&/\.(p12|pfx|key)$/i.test(name))),recovery:()=>recoverySnapshot,isDirty,hasTransientFiles,changed,isBusy:()=>loading||Boolean(saveTask),canSwitch:()=>baselineLoaded&&!loading};
})();
ServerDrafts.mount();
