/* Local MVP: original questionnaire remains the source of business rules. */
'use strict';
const af={results:new Map(),sources:new Map(),rowKeys:new Map(),conflicts:[],busy:false,client:'',sourceUrl:null};
const $af=id=>document.getElementById(id);
const afEl=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const afName=s=>(s||'').toUpperCase().replace(/Ё/g,'Е').replace(/[^А-ЯӘІҢҒҮҰҚӨҺA-Z0-9]/g,'');
function afExcluded(item){return /\.(p12|pfx|jks|key)$/i.test(item.file.name)||/эцп|private.?key/i.test(item.file.name)||item.type==='ЭЦП файл';}
const afPanel=afEl('section',undefined,'af-workspace');afPanel.id='afWorkspace';
afPanel.innerHTML=`<h2>Заполнить из документов</h2><div class="af-actions"><label>ID сделки <input id="hostDealId" inputmode="numeric" data-optional></label><button id="hostLoadDeal" type="button" class="btn btn-main">Открыть сделку</button><a href="/" target="_top">К задачам</a></div><p id="hostDealName" class="af-note">Сначала выберите сделку. Личность клиента будет прочитана из Bitrix.</p><p class="af-disclaimer">Выберите скачанные документы клиента. Мы заполним распознанные ответы; вам останется проверить их и ответить на остальные вопросы.</p><div class="af-actions"><button class="btn btn-ghost" id="afChoose" type="button">Выбрать документы</button><button class="btn btn-main" id="afAnalyze" type="button">Распознать и заполнить</button><label class="af-small">Дата оценки <input type="date" id="afDate" data-optional></label></div><p class="af-status" id="afStatus" role="status">Цифровые PDF · до 35 МБ на файл · цифровые PDF обрабатываются на сервере</p><progress class="af-progress" id="afProgress" value="0" max="1" hidden></progress><div class="af-identity" id="afIdentity" hidden><div><label for="afClient">Для кого заполняем анкету?</label><select id="afClient" data-optional></select></div><button class="btn btn-main" id="afApply" type="button">Заполнить для этого клиента</button></div><div class="af-metrics" aria-live="polite"><span><b id="afFilled">0</b> из документов</span><span><b id="afReview">0</b> проверить</span><span><b id="afMissing">—</b> ответить</span></div><div class="af-actions"><button class="btn btn-ghost" id="afNext" type="button">Следующий пустой ответ ↓</button><button class="btn btn-ghost" id="afNextReview" type="button">Проверить заполненное ↓</button><button class="btn btn-ghost" id="afExport" type="button">Скачать заполненную анкету</button></div><details id="afQuestions"><summary>Что ещё заполнить</summary><div class="af-review-list" id="afTodo"></div></details><details id="afFiles"><summary>Результаты по документам</summary><div id="afFileResults"></div></details><div id="afConflicts"></div>`;
$af('documentStep').before(afPanel);
$af('afDate').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const dialog=afEl('dialog');dialog.id='afSourceDialog';dialog.innerHTML='<div class="af-actions"><strong id="afSourceTitle"></strong><button id="afSourceClose" type="button" class="btn btn-ghost">Закрыть</button></div><p id="afQuote"></p><div id="afPreview"></div><details><summary>Распознанный текст страницы</summary><pre id="afSourceText"></pre></details>';document.body.append(dialog);
$af('afSourceClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(af.sourceUrl)URL.revokeObjectURL(af.sourceUrl);af.sourceUrl=null;$af('afPreview').pdfDispose?.();$af('afPreview').replaceChildren();});
$af('afChoose').onclick=()=>$af('previewDocuments').click();
function afStatus(text,error=false){$af('afStatus').textContent=text;$af('afStatus').classList.toggle('error',error);}
async function afSource(src){
 const item=selectedFiles.find(x=>x.id===src.fileId),r=af.results.get(src.fileId),preview=$af('afPreview');
 preview.pdfDispose?.();preview.replaceChildren();
 const token=crypto.randomUUID();preview.dataset.request=token;
 $af('afSourceTitle').textContent=item?.file.name||'Документ';$af('afQuote').textContent=src.quote||'';
 const update=page=>{$af('afSourceText').textContent=r?.pageText?.[page-1]||'Текст страницы недоступен.';};update(src.page||1);dialog.showModal();
 const sourceUrl=r?.sourcePreview||(item?.storedDocumentId?'/api/assessment/'+HostedAssessment.getContext().client.external.dealId+'/documents/'+item.storedDocumentId+'?view=pdf':null);
 if(!sourceUrl){preview.textContent='Сначала распознайте файл, чтобы сохранить и открыть исходный PDF.';return;}
 preview.textContent='Открываем PDF…';
 try{const viewer=await import('/pdf-preview.mjs');if(!dialog.open||preview.dataset.request!==token)return;await viewer.mount(preview,{url:sourceUrl,page:src.page||1,onPage:update});}catch{preview.textContent='Не удалось открыть просмотр. Обновите страницу и повторите.';}
}
function afLogicalVisible(e){
 if(!e||!e.isConnected||e.disabled||e.closest('.hidden,[hidden],[data-legacy-answer]'))return false;
 if(!e.closest('[data-assessment-step]'))return e.getClientRects().length>0;
 // A workflow step only hides presentation. Conditional fields still follow their business rules.
 for(let node=e;node&&node!==document.body;node=node.parentElement){
  if(!node.hasAttribute('data-assessment-step')&&getComputedStyle(node).display==='none')return false;
 }
 return true;
}
function afControls(){return [...$af('questionnaireStep').querySelectorAll('input,select,textarea')].filter(e=>!e.closest('.af-source')&&afLogicalVisible(e));}
function afLabel(e){return e.closest('.field')?.querySelector('label.lbl')?.textContent.trim()||e.getAttribute('aria-label')||e.id||'Ответ';}
function afMissing(){return afControls().filter(e=>e.dataset.sourceReplaced||!e.hasAttribute('data-optional')&&!['checkbox','file','button'].includes(e.type)&&(!e.value.trim()||!e.checkValidity()));}
function afMissingGroups(){return [...$af('questionnaireStep').querySelectorAll('.holdings,.chips')].filter(g=>afLogicalVisible(g)&&!g.querySelector('input:checked'));}
function afPending(){return [...af.sources].filter(([id,s])=>s.pending&&afLogicalVisible($af(id)));}
function afRefresh(){
 const missing=afMissing(),pending=afPending();$af('afFilled').textContent=[...af.sources].filter(([id])=>$af(id)).length;$af('afReview').textContent=pending.length;$af('afMissing').textContent=missing.length+afMissingGroups().length;
 const todo=$af('afTodo');todo.replaceChildren();missing.forEach(e=>{const b=afEl('button',afLabel(e));b.type='button';b.onclick=()=>afFocus(e);todo.append(b);});
 for(const g of afMissingGroups()){const b=afEl('button',g.getAttribute('aria-label')||g.closest('.field')?.querySelector('label.lbl')?.textContent||g.querySelector('label.lbl')?.textContent||'Выберите социальный статус');b.type='button';b.onclick=()=>afFocus(g.querySelector('input'));todo.append(b);}
 $af('afNext').disabled=!(missing.length+afMissingGroups().length);$af('afNextReview').disabled=!pending.length;
 window.AssessmentWorkflow?.refresh();
}
function afFocus(e){if(!e)return;if(window.AssessmentWorkflow?.reveal(e)===false)return;document.querySelectorAll('.af-field-focus').forEach(x=>x.classList.remove('af-field-focus'));const field=e.closest('.field')||e;field.classList.add('af-field-focus');field.scrollIntoView({behavior:'smooth',block:'center'});e.focus({preventScroll:true});}
$af('afNext').onclick=()=>{const list=afMissing();if(list.length)afFocus(list[0]);else if(afMissingGroups().length)afFocus(afMissingGroups()[0].querySelector('input'));};$af('afNextReview').onclick=()=>{const list=afPending();if(list.length)afFocus($af(list[0][0]));};
function afBadge(e,src){
 const field=e.closest('.field')||e.parentElement;field.querySelectorAll(':scope > .af-source').forEach(x=>{if(x.dataset.for===e.id)x.remove();});
 const box=afEl('div',undefined,'af-source'+(src.pending?' pending':''));box.dataset.for=e.id;
 const hint=(src.stale?'Перепроверить':src.pending?'Проверить':src.edited?'Исправлено':'Подтверждено')+' · стр. '+(src.page||1);
 const label=afEl('span',hint);label.title=(selectedFiles.find(x=>x.id===src.fileId)?.file.name||'Документ')+(src.date?' · '+src.date:'');box.append(label);
 const open=afEl('button','Источник');open.type='button';open.onclick=()=>afSource(src);box.append(open);
 if(src.pending&&src.edited){const label=afEl('label','Причина исправления');const reason=afEl('textarea');reason.id=e.id+'-review-reason';label.htmlFor=reason.id;reason.setAttribute('data-optional','');reason.value=src.correctionReason||'';reason.addEventListener('input',()=>src.correctionReason=reason.value);box.append(label,reason);}
 if(src.stale&&!selectedFiles.some(item=>item.id===src.fileId)){
  label.textContent='Источник заменён. Сверьте ответ с новым документом.';
  const clear=afEl('button','Очистить ответ');clear.type='button';clear.onclick=()=>{if(e.type==='checkbox')e.checked=false;else e.value='';af.sources.delete(e.id);delete e.dataset.sourceReplaced;e.setCustomValidity('');box.remove();e.dispatchEvent(new Event('change',{bubbles:true}));afRefresh();};box.append(clear);
 }else if(src.pending&&src.server?.draftOnly){box.append(afEl("span","Черновик из ГКБ · ИИН ещё не подтверждён в Bitrix"));}else if(src.pending){const yes=afEl('button',src.edited?'Сохранить исправление':'Верно');yes.type='button';yes.onclick=async()=>{yes.disabled=true;try{await HostedAssessment.review(e,src);delete e.dataset.sourceReplaced;e.setCustomValidity('');field.querySelectorAll('[data-replacement-notice]').forEach(node=>node.remove());src.pending=false;src.stale=false;afBadge(e,src);afRefresh();}catch(error){afStatus(error.message,true);yes.disabled=false;}};box.append(yes);}
 field.append(box);
}
function afDispatchChange(e){const previous=af.applying;af.applying=true;try{e.dispatchEvent(new Event('change',{bubbles:true}));}finally{af.applying=previous;}}
function afPut(e,value,src){
 if(!e||value===null||value===undefined)return false;
 value=String(value);
 if(af.restoringEvidence){
  // Reopening a draft restores evidence badges, not deleted answers or older document values.
  if(e.type==='checkbox'?!e.checked:e.value!==value)return false;
 }else if(e.type==='checkbox'){
  if(!e.checked){e.checked=true;afDispatchChange(e);}
 }else{
  if(e.value && e.value!==value){
   const key=e.id+'|'+value+'|'+src.fileId;
   if(!af.conflicts.some(x=>x.key===key))af.conflicts.push({key,id:e.id,value,src});return false;
  }
  if(e.value===value&&af.sources.has(e.id)&&!af.sources.get(e.id).stale&&!src.priorReview)return false;
  if(e.tagName==='SELECT'&&![...e.options].some(o=>o.value===value)){
   if(e.hasAttribute('data-compact-count'))setCount(e,Number(value));else if(value==='Кредитная карта')e.add(new Option(value,value));else return false;
  }
  e.value=value;afDispatchChange(e);
 }
 delete e.dataset.sourceReplaced;e.setCustomValidity('');
 const source={...src,pending:!src.priorReview,value:String(src.originalValue??value),reviewId:src.priorReview?.id,edited:src.priorReview?.disposition==='corrected',correctionReason:src.priorReview?.reason||''};af.sources.set(e.id,source);afBadge(e,source);return true;
}
// Same identity rule as lib/documents/loan-identity.ts, covered by a parity test.
const afCreditorKey=value=>String(value).normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/\s+/g,'');
function afLoanRowKey(key){const parts=key.split('|');if(parts[0]==='creditors'&&parts.length===4){parts[2]=afCreditorKey(parts[2]);parts[3]=parts[3].trim();}return parts.join('|');}
function afRow(group,key,loan=null){
 const g=$af(group);if(!g)return null;
 const canonical=afLoanRowKey(group+'|'+key),aliases=new Set([canonical,...(loan?.aliases||[]).map(alias=>afLoanRowKey(group+'|'+af.client+'|'+alias))]);
 const candidateIds=new Set([...af.rowKeys].filter(([k,id])=>aliases.has(afLoanRowKey(k))&&$af(id)).map(([,id])=>id));
 if(!candidateIds.size&&loan&&!af.restoringEvidence){
  // Older/manual rows may not have a source key. Reuse only one exact lender +
  // contract match; never match by lender alone or overwrite a different loan.
  const matches=[...g.querySelector(':scope > .repeat-rows').children].filter(row=>{
   const controls=[...row.querySelectorAll('input,select')],get=key=>controls.find(e=>e.id.replace(/_r\d+$/,'')===key)?.value;
   return get('n8038')&&get('loanContractId')&&aliases.has(afLoanRowKey(group+'|'+af.client+'|'+get('n8038')+'|'+get('loanContractId')));
  });
  if(matches.length===1){if(!matches[0].id)matches[0].id='af-row-'+(++nextRow);candidateIds.add(matches[0].id);}
 }
 const candidates=[...g.querySelector(':scope > .repeat-rows').children].filter(row=>candidateIds.has(row.id));
 if(af.restoringEvidence)return candidates.length===1?candidates[0]:null;
 if(candidates.length){
  const target=candidates[0];
  // Collapse an earlier auto-created alias only when every value is still present in this source.
  // Manual additions/corrections keep their separate row for employee review.
  for(const other of candidates.slice(1)){
   const controls=[...other.querySelectorAll('input,select,textarea')].filter(e=>!e.closest('.af-source'));
   const entirelySourced=loan&&controls.every(e=>{const field=e.id.replace(/_r\d+$/,'');return field==='loanClaimIncluded'?e.checked:e.type==='checkbox'?!e.checked:!e.value||String(loan.fields[field])===e.value||(field==='n8038'&&loan.fields[field]&&afCreditorKey(loan.fields[field])===afCreditorKey(e.value));});
   if(entirelySourced){for(const e of controls)af.sources.delete(e.id);for(const [k,id]of af.rowKeys)if(id===other.id)af.rowKeys.delete(k);other.remove();renumber(g);}
  }
  for(const [k,id]of af.rowKeys)if(id===target.id&&k!==canonical)af.rowKeys.delete(k);af.rowKeys.set(canonical,target.id);return target;
 }
 const empty=[...g.querySelector(':scope > .repeat-rows').children].find(r=>![...r.querySelectorAll('input,select,textarea')].some(e=>e.id.replace(/_r\d+$/,'')==='loanClaimIncluded'?!e.checked:e.type==='checkbox'?e.checked:Boolean(e.value)));
 const row=empty||add(g);if(!row.id)row.id='af-row-'+(++nextRow);af.rowKeys.set(canonical,row.id);return row;
}
function afRowFields(row,fields,src){if(!row)return;for(const [key,value]of Object.entries(fields)){const e=[...row.querySelectorAll('input,select,textarea')].find(e=>e.id===key||e.id.startsWith(key+'_r'));if(key==='n8038'&&e?.value&&e.value!==String(value)&&afCreditorKey(e.value)===afCreditorKey(value))continue;afPut(e,value,{...src,serverFactKey:src.fieldKeys?.[key],...src.fieldReview?.[key]});}}
function afLoanParticipantsNotice(row,loan,fileId){
 if(!row)return;
 const notice=loan.relatedPartiesNotice;if(!notice&&!loan.fields.loanParticipants)return;
 row.querySelector('.af-related-notice')?.remove();if(!notice)return;
 const input=[...row.querySelectorAll('textarea')].find(e=>e.id.replace(/_r\d+$/,'')==='loanParticipants');if(!input)return;
 const box=afEl('div',undefined,'af-source af-related-notice');box.dataset.for=input.id;
 box.append(afEl('span','В ГКБ не указано — уточните у клиента'));
 const open=afEl('button','Источник');open.type='button';open.onclick=()=>afSource({fileId,page:notice.page,quote:notice.source});box.append(open);input.closest('.field').append(box);
}
function afHolding(kind,src){const e=document.querySelector('[data-owner="client"][data-holding="'+kind+'"]');if(!e.id)e.id='af-holding-'+kind;
 if(af.restoringEvidence&&!e.checked)return false;
 const contradictory=document.querySelector('[data-owner="client"][data-holding]:checked[value="none"], [data-owner="client"][data-holding]:checked[value="unknown"]');
 if(contradictory){afStatus('Документы показывают имущество, но в анкете выбрано «нет / не знаю». Уточните ответ и повторите заполнение.',true);return false;}
 return afPut(e,'1',src)||e.checked;
}
function afRenderConflicts(){
 const root=$af('afConflicts');root.replaceChildren();
 for(const c of af.conflicts){
  const e=$af(c.id);if(!e)continue;
  const box=afEl('div',undefined,'af-conflict'),row=e.closest('#creditors .repeat-item');
  if(row){const creditor=[...row.querySelectorAll('input')].find(n=>n.id.replace(/_r\d+$/,'')==='n8038')?.value;box.append(afEl('strong','Кредит '+([...row.parentElement.children].indexOf(row)+1)+(creditor?' · '+creditor:'')));}
  const money=/^n804[01](?:_r\d+)?$/.test(e.id)||e.id==='kaspiAnnual';
  const display=value=>money&&Number.isFinite(Number(value))?Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₸':String(value);
  box.append(afEl('div',afLabel(e)+' · в анкете: '+display(e.value)+(c.src.priorReview?' · в сохранённой проверке: ':' · в документе: ')+display(c.value)));
  const jump=afEl('button','К вопросу');jump.type='button';jump.className='btn btn-ghost';jump.dataset.conflictTarget=e.id;jump.onclick=()=>afFocus(e);
 const b=afEl('button','Источник');b.type='button';b.className='btn btn-ghost';b.onclick=()=>afSource(c.src);
  const take=afEl('button','Взять из документа');take.type='button';take.className='btn btn-main';take.onclick=()=>{e.value='';af.sources.delete(e.id);afPut(e,c.value,c.src);af.conflicts=af.conflicts.filter(x=>x.id!==c.id);afRenderConflicts();afRefresh();};
  const keep=afEl('button','Оставить мой ответ');keep.type='button';keep.className='btn btn-ghost';keep.onclick=()=>{const source={...c.src,value:String(c.src.originalValue??c.value),pending:true,edited:true};af.sources.set(e.id,source);afBadge(e,source);af.conflicts=af.conflicts.filter(x=>x!==c);afRenderConflicts();afRefresh();};
  box.append(jump,b,take,keep);root.append(box);
 }
}
function afClientChoices(){
 const ids=new Map();for(const [id,r]of af.results){if(!selectedFiles.some(x=>x.id===id)||!r.identity?.iin||r.duplicate)continue;const old=ids.get(r.identity.iin);ids.set(r.identity.iin,r.identity.fio||old||'Клиент');}
 const select=$af('afClient');select.replaceChildren(new Option('Выберите клиента',''));for(const [iin,name]of ids)select.add(new Option(name+' · ИИН '+iin,iin));
 const existing=$af('iin').value.trim();if(ids.has(existing))select.value=existing;else if(ids.size===1)select.value=[...ids.keys()][0];else select.value='';
 const draftMode=!HostedAssessment.getContext()?.client.iin&&[...af.results.values()].some(r=>r.draftOnly);
 $af('afApply').style.display=draftMode?'inline-block':'none';select.disabled=!draftMode;
 $af('afApply').textContent='Подтвердить клиента и заполнить';
 $af('afIdentity').hidden=!ids.size;$af('afIdentity').style.display=ids.size?'flex':'none';return select.value;
}
function afApply(){
 const client=$af('afClient').value;if(!client){afStatus('В документах несколько людей или ИИН не распознан. Выберите клиента; при отсутствии ИИН заполните вручную.',true);return;}
 if(af.client&&af.client!==client){afStatus('В этой анкете уже использованы документы другого клиента. Скачайте или сохраните текущую анкету; начните новую отдельно.',true);return;}
 const existing=$af('iin').value.trim();if(existing&&existing!==client){afStatus('ИИН в анкете не совпадает с выбранным клиентом. Изменения не внесены.',true);return;}
 const docs=[...af.results].filter(([id,r])=>selectedFiles.some(x=>x.id===id)&&(!r.blocked||r.draftOnly)&&!r.duplicate&&!r.error&&!r.excluded&&r.identity?.iin===client);
 if(!docs.length){afStatus('Нет подходящих документов для выбранного клиента. Проверьте результаты чтения.',true);return;}
 const best=docs.find(([,r])=>r.kind==='gkbFull')||docs.find(([,r])=>r.identity?.fio);const name=best?.[1].identity.fio||$af('fio').value;
 if(docs.some(([,r])=>r.draftOnly)&&!af.restoringEvidence){
  const ctx=HostedAssessment.getContext(),identityKey=ctx.client.external.dealId+'|'+ctx.identityRevision+'|'+client;
  if(af.draftIdentity!==identityKey){
   if(!confirm('Заполнить черновик этой сделки?\n\nСделка № '+ctx.client.external.dealId+': '+ctx.client.title+'\nКлиент в отчёте: '+name+'\nИИН: '+client+'\n\nПодтвердите, что отчёт принадлежит клиенту этой сделки. ИИН в Bitrix не будет изменён.')){afStatus('Ничего не заполнено. Подтвердите клиента над результатами документов.');return;}
   af.draftIdentity=identityKey;
  }
 }
 af.client=client;
 for(const [id,r]of docs){const item=selectedFiles.find(x=>x.id===id);if(item&&!item.person)item.person='Клиент';
  for(const f of r.fields){if(f.key==='fio'&&best&&id!==best[0])continue;afPut($af(f.key),f.value,{...f,fileId:id,date:r.date});}
  for(const loan of r.loans){const row=afRow('creditors',client+'|'+loan.key,loan);afRowFields(row,loan.fields,{...loan,fileId:id});afLoanParticipantsNotice(row,loan,id);}
  if(r.properties.length&&afHolding('real',{fileId:id,page:r.properties[0].page,quote:'Зарегистрированная недвижимость'})){
   for(const prop of r.properties){const row=afRow('clientreal',client+'|'+prop.key);afRowFields(row,prop.fields,{...prop,fileId:id,date:r.date});}
  }
 }
 // Family/vehicle documents without an IIN require an exact full-name match in their contents.
 const kids=new Map();let marriage=null;
 for(const [id,r]of af.results){if(!selectedFiles.some(x=>x.id===id)||r.blocked||r.duplicate||r.error||!name)continue;const item=selectedFiles.find(x=>x.id===id);
  if(r.car?.ownerName&&afName(r.car.ownerName)===afName(name)){
   if(item&&!item.person)item.person='Клиент';if(afHolding('car',{fileId:id,...r.car})){const row=afRow('clientcars',client+'|'+r.car.value);afRowFields(row,{n8007:r.car.value},{fileId:id,...r.car});renumber($af('clientcars'));}
  }
  if(r.familyText&&afName(r.familyText).includes(afName(name))){
   if(r.kind==='marriage'){marriage={fileId:id,page:1,quote:'В документе о браке совпало полное имя. Подтвердите актуальное семейное положение.'};if(item&&!item.person)item.person='Клиент';}
   if(r.kind==='birth'){const iins=[...r.familyText.matchAll(/(?<!\d)\d{12}(?!\d)/g)].map(x=>x[0]).filter(x=>x!==client);if(new Set(iins).size===1)kids.set(iins[0],{id,r});if(item&&!item.person)item.person='Ребёнок';}
  }
 }
 if(marriage)afPut($af('marital'),'В браке',marriage);
 if(kids.size){const first=[...kids.values()][0];afPut($af('childrenTotal'),kids.size,{fileId:first.id,page:1,quote:'Найдены документы '+kids.size+' разных детей с совпадением ФИО родителя. Подтвердите, что других детей нет.'});}
 renderDocuments();afRenderResults();afRenderConflicts();kaspi();visibilityRules();afRefresh();afStatus('Распознанные ответы перенесены. Проверьте отмеченные поля и заполните оставшиеся. Ваши ответы не перезаписывались.');
}
$af('afApply').onclick=afApply;
// Keep employee-facing reasons consistent in the package summary and the original-file row.
function afDocumentAttention(item){
 const r=af.results.get(item.id);if(!r||afExcluded(item))return null;
 if(r.identity?.iin&&HostedAssessment.getContext()?.client.iin&&r.identity.iin!==HostedAssessment.getContext().client.iin&&item.person==='Клиент')return {kind:'error',message:'Другой владелец'+(r.identity.fio?': '+r.identity.fio:'')+'. Замените файл или укажите, чей он.'};
 if(r.error)return {kind:'error',message:r.error};
 if(r.documentReview?.type===item.type)return null;
 const findings=r.findings||[];
 const powerReason=['POWER_DATES_UNVERIFIED','POWER_DATE_NOT_ACCEPTABLE','POWER_SCOPE_REVIEW_REQUIRED','REPRESENTATIVE_NOT_APPROVED','REPRESENTATIVE_IDENTITY_UNVERIFIED'].find(code=>findings.includes(code));
 if(powerReason)return {kind:'manual',message:HostedAssessment.error(powerReason)};
 const reason=['ENPF_PERIOD_NOT_ACCEPTABLE','ENPF_PERIOD_UNVERIFIED','SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED','GKB_TOO_OLD','GKB_DATE_NOT_ACCEPTABLE','FUTURE_DOCUMENT_DATE','STATEMENT_PERIOD_NOT_ACCEPTABLE','STATEMENT_RECONCILIATION_REQUIRED'].find(code=>findings.includes(code));
 if(reason)return {kind:'error',message:HostedAssessment.error(reason)};
 if(!HostedAssessment.getContext()?.client.iin)return null; // The missing deal identity is shown once, with its next action.
 if(r.blocked)return {kind:'manual',message:item.type==='Доверенность'?'Сверьте владельца, срок и полномочия по оригиналу.':findings.includes('DOCUMENT_TYPE_UNVERIFIED')?'Не удалось определить тип. Откройте файл и укажите тип документа.':findings.includes('OCR_OR_PAGE_REVIEW_REQUIRED')?'Часть страниц не прочитана. Проверьте их по оригиналу.':'Сверьте владельца и срок по оригиналу.'};
 return null;
}
function afAnalysisProgress(done,total){
 af.progress={done,total};$af('afProgress').value=done;$af('afProgress').max=Math.max(1,total);window.AssessmentWorkflow?.refresh();
}
function afRenderResults(){
 const root=$af('afFileResults');root.replaceChildren();
 for(const item of selectedFiles){const r=af.results.get(item.id)||(item.storedDocumentId?{sourceOnly:true}:null);if(!r)continue;
  const shortType={'ГКБ — краткий отчёт':'ГКБ краткий','ГКБ — полный отчёт':'ГКБ полный','Справка ЕНПФ':'ЕНПФ','Выписка Kaspi Gold':'Kaspi','Удостоверение личности':'Удостоверение','Ф6 об отсутствии имущества':'Ф6','Справка по выплатам пенсии и пособий':'Пенсии и пособия'};
  const displayType=item.type&&item.type!=='Другой документ'?shortType[item.type]||item.type:r.type&&r.kind!=='other'?shortType[r.type]||r.type:item.file.name;
  const box=afEl('details',undefined,'af-file'),summary=afEl('summary'),name=afEl('strong',afExcluded(item)?'Ключ ЭЦП':displayType);summary.title=item.file.name;box.dataset.fileId=String(item.id);
  const wrongOwner=Boolean(r.identity?.iin&&HostedAssessment.getContext()?.client.iin&&r.identity.iin!==HostedAssessment.getContext().client.iin&&item.person==='Клиент');
  const state=r.sourceOnly?'Сохранён':r.error?'Не прочитан':wrongOwner?'Другой клиент':r.documentReview?.type===item.type?'Проверено сотрудником':r.draftOnly?'Прочитан · для черновика':r.blocked?'Сверить вручную':r.excluded?'Отдельно':r.duplicate?'Повтор':'Прочитан';
  summary.append(name,afEl('span',state,'af-file-state'+(r.error||wrongOwner?' needs-review':'')));box.append(summary);
  box.append(afEl('p',afExcluded(item)?'Ключ ЭЦП':item.file.name,'af-original-name'));box.append(afEl('p',(r.pages||0)+' стр.'+(item.person?' · '+item.person:''),'hint'));
  const attention=afDocumentAttention(item);if(attention)box.append(afEl('p',attention.message,'af-document-attention'+(attention.kind==='error'?' error':'')));
  if(r.error&&item.storedDocumentId){const retry=afEl('button','Повторить чтение','btn btn-ghost');retry.type='button';retry.onclick=()=>afAnalyze({onlyPending:true});box.append(retry);}
  if(r.statement){const st=r.statement;box.append(afEl('p','Период: '+st.period+' · операций: '+st.transactions+' · поступления: '+Number(st.credits).toLocaleString('ru-RU')+' ₸. '+(st.reconciled?'Операции сверены.':'Нужна сверка операций.'),'hint'));}
  if(r.coverage?.from&&r.coverage?.to)box.append(afEl('p','Период: '+r.coverage.from+' — '+r.coverage.to,'hint'));
  if(wrongOwner){const owner=afEl('button','Указать владельца','btn btn-ghost');owner.type='button';owner.onclick=()=>{document.querySelector('.wf-document-tools').open=true;document.querySelector('.wf-file-assignments').open=true;$af('doc-'+item.id+'-person')?.focus();};box.append(owner);}
  if(item.storedDocumentId&&item.person==='Клиент'&&attention?.kind==='manual'&&!wrongOwner){const inspect=afEl('button','Проверить документ','btn btn-ghost');inspect.type='button';inspect.onclick=()=>window.DocumentReview?.open(item.storedDocumentId);box.append(inspect);}
  const notes=afEl('ul');(r.notes||[]).filter(t=>!t.startsWith('Подлинность документа')&&!t.startsWith('Использован ранее')).forEach(t=>notes.append(afEl('li',t)));
  if(notes.children.length){const info=afEl('details',undefined,'af-document-notes');info.append(afEl('summary','Подробности чтения'),notes);box.append(info);}
  if(r.sourcePreview||item.storedDocumentId){const b=afEl('button','Открыть документ');b.type='button';b.className='btn btn-ghost';b.onclick=()=>afSource({fileId:item.id,page:1});box.append(b);}
  if(!afExcluded(item)&&window.DocumentReplacement)box.append(DocumentReplacement.button(item));
  root.append(box);
 }
}

async function afAnalyze(preferences={}){
 if(af.busy)return;if(!HostedAssessment.ready()){afStatus('Сначала откройте сделку.',true);return;}if(!preferences.restoreOnly&&window.AssessmentWorkflow&&!AssessmentWorkflow.prepareUpload())return;if(!selectedFiles.length){afStatus('Сначала выберите документы клиента.',true);$af('previewDocuments').click();return;}
 if(!$af('afDate').value){afStatus('Укажите дату оценки.',true);return;}
 const afLocked=[...$af('documentStep').querySelectorAll('input,select,button')].map(e=>[e,e.disabled]);afLocked.forEach(([e])=>e.disabled=true);$af('documentStep').classList.add('af-busy');
 af.busy=true;$af('afAnalyze').disabled=true;$af('afChoose').disabled=true;$af('afProgress').hidden=false;
 const files=selectedFiles.filter(item=>item.type!=='Подписанный договор'&&!(preferences.restoreOnly&&item.type==='Доверенность'&&new URLSearchParams(location.search).get('mode')!=='handoff')).filter(item=>preferences.onlyPending?Boolean(af.results.get(item.id)?.error)||!item.storedDocumentId&&!af.results.get(item.id)?.server:!preferences.onlyNew||!item.storedDocumentId&&!af.results.get(item.id)?.server),hashes=new Map(),pending=new Map();let done=0,fail=0;
 const read=async item=>{
  if(!preferences.restoreOnly)return HostedAssessment.analyzeFile(item,preferences);
  const index=files.indexOf(item);
  // Only saved-cache reads run concurrently. Uploads and explicit recognition remain sequential.
  for(const next of files.slice(index,index+3))if(!pending.has(next.id)&&!afExcluded(next))pending.set(next.id,HostedAssessment.analyzeFile(next,preferences).then(payload=>({payload}),error=>({error})));
  const result=await pending.get(item.id);if(result.error)throw result.error;return result.payload;
 };
 afAnalysisProgress(0,files.length);
 try{
  for(const item of files){
   // Signed contracts remain evidence, but must never autofill an intake questionnaire.
   if(item.type==='Подписанный договор')continue;
   afStatus('Читаем '+(++done)+' из '+files.length+': '+(afExcluded(item)?'ключ ЭЦП — пропущен':item.file.name));afAnalysisProgress(done-1,files.length);
   if(afExcluded(item)){item.type='ЭЦП файл';if(!item.person)item.person='Клиент';af.results.set(item.id,{excluded:true,type:'ЭЦП файл',notes:['Не передавался на распознавание.'],pages:0});continue;}
   try{
    let r;
    {
     const payload=await read(item);r=HostedAssessment.adapt(payload);r.assessmentDate=payload.assessmentDay;
    }
    if(r.hash&&hashes.has(r.hash)){r.duplicate=true;r.notes=[...(r.notes||[]).filter(t=>!t.startsWith('Повтор файла:')),'Повтор файла: '+hashes.get(r.hash)+'. Повторно не учитывается.'];}else if(r.hash)hashes.set(r.hash,item.file.name);
    for(const [fieldId,source]of af.sources)if(source.server?.documentId===r.server?.documentId&&source.server?.extractionId!==r.server?.extractionId){source.stale=true;source.pending=true;if($af(fieldId))afBadge($af(fieldId),source);}
    af.results.set(item.id,r);if(!preferences.restoreOnly){if(!item.person&&r.identity?.iin===HostedAssessment.getContext().client.iin)item.person='Клиент';if(r.type&&r.kind!=='other')item.type=r.type;}
   }catch(e){fail++;af.results.set(item.id,{error:e.message,notes:['Файл не заполнен автоматически. Проверьте вручную.']});}
   afRenderResults();afAnalysisProgress(done,files.length);
  }
  $af('afProgress').value=files.length;afClientChoices();
  if($af('afClient').value&&[...af.results.values()].some(r=>(!r.blocked||r.draftOnly)&&!r.error)){af.restoringEvidence=Boolean(preferences.restoreOnly);try{afApply();}finally{af.restoringEvidence=false;}}else afStatus('Распознавание завершено. Нераспознанные ответы заполните вручную.');
  if(fail)afStatus('Не удалось обработать файлов: '+fail+'. Остальные результаты сохранены. Проверьте результаты по документам.',true);
  $af('afFiles').open=true;renderDocuments();afRefresh();
 }finally{afLocked.forEach(([e,disabled])=>e.disabled=disabled);$af('documentStep').classList.remove('af-busy');af.busy=false;af.progress=null;$af('afAnalyze').disabled=false;$af('afChoose').disabled=false;afRefresh();document.dispatchEvent(new CustomEvent('assessment-analysis-complete',{detail:{showPackageSummary:!preferences.restoreOnly}}));}
}
$af('afAnalyze').onclick=afAnalyze;
document.addEventListener('assessment-analysis-complete',afClientChoices);
let afRefreshQueued=false;
function afQueueRefresh(){if(afRefreshQueued)return;afRefreshQueued=true;queueMicrotask(()=>{afRefreshQueued=false;afRefresh();});}
document.addEventListener('input',e=>{if(af.applying)return;if(af.sources.has(e.target.id)){const src=af.sources.get(e.target.id);src.pending=true;src.edited=true;src.stale=false;afBadge(e.target,src);}afQueueRefresh();});
document.addEventListener('change',e=>{if(af.applying)return;if(af.sources.has(e.target.id)){const src=af.sources.get(e.target.id);src.pending=true;src.edited=true;src.stale=false;afBadge(e.target,src);}afQueueRefresh();});
document.addEventListener('click',e=>{if(e.target.closest('.add-row,.remove-row'))queueMicrotask(afRefresh);});
function afDownload(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=afEl('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$af('afExport').onclick=()=>{
 const missing=afMissing().length+afMissingGroups().length,pending=afPending().length,packageState=window.AssessmentWorkflow?.collection?.(),missingDocs=packageState?.missing.length??missingDocuments().length,documentIssues=packageState?.attention.length||0,lines=['КАРТОЧКА КЛИЕНТА','Дата оценки: '+$af('afDate').value,'Статус: '+(missing||pending||missingDocs||documentIssues||af.conflicts.length?'Черновик':'Ответы заполнены; требуется итоговая проверка специалиста'),`Осталось ответов: ${missing}; проверить извлечённых: ${pending}; недостающих документов: ${missingDocs}; замечаний к документам: ${documentIssues}`,''],displayValue=e=>e.value&&/₸/.test(afLabel(e))&&Number.isFinite(Number(e.value))?Number(e.value).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₸':e.value||'НЕ ЗАПОЛНЕНО';
 for(const card of $af('questionnaireStep').querySelectorAll('section.card')){lines.push(card.querySelector('.card-title')?.textContent.trim()||'');for(const e of card.querySelectorAll('input,select,textarea')){if(!afLogicalVisible(e)||e.closest('.af-source')||e.type==='file'||e.type==='password')continue;if(e.type==='checkbox'){if(e.matches('[data-loan-claim]'))lines.push('• Включить в иск: '+(e.checked?'Да':'Нет'));else if(e.checked)lines.push('• '+e.parentElement.textContent.trim());continue;}const src=af.sources.get(e.id);lines.push('• '+afLabel(e)+': '+displayValue(e)+(src?' ['+(src.pending?'ПРОВЕРИТЬ':src.edited?'Изменено вручную':'Проверено')+'; '+(selectedFiles.find(x=>x.id===src.fileId)?.file.name||'документ')+', стр. '+src.page+']':''));}lines.push('');}
 if(af.conflicts.length)lines.push('Неразрешённых расхождений: '+af.conflicts.length);
 afDownload('assessment-'+$af('afDate').value+'.txt',lines.join('\n'),'text/plain;charset=utf-8');
};
// API controls and file selectors must never become questionnaire-required fields.
visibilityRules=function(){document.querySelectorAll('input:not([type="checkbox"]),select,textarea').forEach(e=>{e.required=!e.hasAttribute('data-optional')&&!e.closest('#afWorkspace,#afSourceDialog,#selectedDocuments')&&e.type!=='file'&&afLogicalVisible(e);});};
$af('afIdentity').style.display='none';
$af('afFiles').addEventListener('toggle',()=>visibilityRules());
setTimeout(afRefresh,50);
HostedAssessment.mount();

$af('afDate').addEventListener('change',()=>{for(const [id,src] of af.sources){if(!$af(id))continue;src.pending=true;afBadge($af(id),src);}if(af.sources.size)afStatus('Дата оценки изменилась. Повторите распознавание и проверьте актуальность ответов.');afRefresh();});
const afBaseRender=renderDocuments;renderDocuments=function(){afBaseRender();for(const[id,src]of af.sources){if(!selectedFiles.some(x=>x.id===src.fileId)&&$af(id)){src.pending=true;src.stale=true;src.reviewId=null;$af(id).dataset.sourceReplaced='true';afBadge($af(id),src);}}afRefresh();};


// Reading and draft storage happen after file selection; CRM submission is a separate final action.
document.addEventListener('change',event=>{if(event.target?.type==='file'&&event.target.closest('#documentStep'))setTimeout(()=>{if(HostedAssessment.ready()&&!af.busy&&selectedFiles.some(item=>!afExcluded(item)&&!item.storedDocumentId&&!af.results.get(item.id)?.server))afAnalyze({onlyNew:true});},0);});
