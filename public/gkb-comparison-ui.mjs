import {compareGkb,creditorKey} from './gkb-comparison.mjs';
const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
const amount=value=>value===null?'сумма требует сверки':Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₸';
const captions={matched:'Кредиты сверены',reviewed:'Суммы подтверждены',mismatch:'ГКБ: расхождение',unavailable:'ГКБ: не сверены'};
let inspectionKey='',inspection=null,inspectionError='',inspectionPending=null,attempt=null,busy=false,activeLoan=null;
const rowDrafts=new Map();
function pair(){
 const context=HostedAssessment.getContext(),reports=selectedFiles.filter(item=>item.person==='Клиент').map(item=>af.results.get(item.id)).filter(r=>r?.server?.dealId===context?.client.external.dealId);
 const short=reports.filter(r=>r.kind==='gkbShort'),full=reports.filter(r=>r.kind==='gkbFull');
 if(short.length!==1||full.length!==1||!short[0].server.documentId||!full[0].server.documentId)return null;
 const input={shortDocumentId:short[0].server.documentId,fullDocumentId:full[0].server.documentId,identityRevision:context.identityRevision};
 return {dealId:context.client.external.dealId,input,key:JSON.stringify([context.client.external.dealId,context.assessmentDay,input,short[0].server.extractionId,full[0].server.extractionId])};
}
const errorMessage=code=>({GKB_CORRECTION_REQUIRED:'Укажите правильную сумму и основание исправления.',GKB_REVIEW_CHANGED:'Отчёты или их проверка изменились. Откройте сверку заново.',GKB_ANSWERS_NOT_SAVED:'Суммы не подтверждены в сохранённой анкете. Сохраните черновик и повторите.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился. Откройте сделку заново.',REVIEW_CHANGED:'Подтверждение уже изменилось. Откройте сверку заново.'})[code]||'Не удалось сохранить сверку. Повторите действие; повтор не создаст вторую запись.';
const request=(p,body)=>HostedAssessment.requestJson(`/api/assessment/${encodeURIComponent(p.dealId)}/gkb-reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p.input,...body})},{message:errorMessage});
function refresh(){if(typeof afRenderResults==='function')afRenderResults();window.AssessmentWorkflow?.refresh();if(dialog.open)render();}
function inspect(force=false){
 const p=pair();if(!p)return Promise.resolve(null);
 if(p.key===inspectionKey&&(!force||inspectionPending))return inspectionPending||Promise.resolve(inspection);
 inspectionKey=p.key;inspection=null;inspectionError='';
 inspectionPending=request(p,{action:'inspect'}).then(data=>{if(pair()?.key===p.key&&inspectionKey===p.key){inspection=data.inspection;reconcileAttempt();}return data.inspection;}).catch(error=>{if(pair()?.key===p.key)inspectionError=error.message;return null;}).finally(()=>{if(inspectionKey===p.key){inspectionPending=null;refresh();}});
 return inspectionPending;
}
function reviewedAmountsMatch(){return inspection?.plan.balances.every(b=>rowConfirmed(b));}
function sameAmount(a,b){const normalize=v=>/^\d+(?:\.\d{1,2})?$/.test(v||'')?BigInt(v.split('.')[0])*100n+BigInt((v.split('.')[1]||'').padEnd(2,'0')):null;return normalize(a)!==null&&normalize(a)===normalize(b);}
function current(){
 const context=HostedAssessment.getContext();
 const reports=selectedFiles.filter(item=>item.person==='Клиент').map(item=>({fileId:item.id,...af.results.get(item.id)})).filter(r=>r.server?.dealId===context?.client.external.dealId);
 const result=compareGkb(reports,{iin:context?.client.iin,day:context?.assessmentDay});
 if(inspectionKey===pair()?.key&&inspection){result.inspection=inspection;result.confirmed=!!inspection.review&&reviewedAmountsMatch();if(result.confirmed)result.status='reviewed';}
 return result;
}
const dialog=make('dialog',null,'gkb-dialog');dialog.id='gkbComparisonDialog';dialog.setAttribute('aria-labelledby','gkbComparisonTitle');document.body.append(dialog);
const button=(label,handler)=>{const b=make('button',label,'btn btn-ghost');b.type='button';b.onclick=handler;return b;};
function openSource(source){afSource({...source,returnLabel:'← К сверке'});}
function loanField(row,strict=false){
 const normalize=s=>s.split('|').map((part,i)=>i===0?creditorKey(part):part.trim()).join('|');
 const aliases=new Set(row.aliases.map(normalize)),iin=HostedAssessment.getContext()?.client.iin;
 const matches=new Set([...af.rowKeys].filter(([key])=>key.startsWith('creditors|'+iin+'|')&&aliases.has(normalize(key.split('|').slice(2).join('|')))).map(([,id])=>id));
 const rows=[...document.querySelectorAll('#creditors > .repeat-rows > .repeat-item')].filter(node=>{const inputs=[...node.querySelectorAll('input')],value=key=>inputs.find(e=>e.id.replace(/_r\d+$/,'')===key)?.value||'';return aliases.has(normalize(value('n8038')+'|'+value('loanContractId')));});
 const target=rows.length===1?rows[0]:rows.length||strict?null:matches.size===1?document.getElementById([...matches][0]):null;
 return [...(target?.querySelectorAll('input')||[])].find(e=>e.id.replace(/_r\d+$/,'')==='n8040')||null;
}
const editorKey=b=>inspection.planKey+':'+b.fullIndex;
const decisionFor=b=>inspection.decisions?.find(d=>d.fullIndex===b.fullIndex);
const normalized=value=>String(value||'').replace(/[\s\u00a0]/g,'').replace(',','.');
function rowConfirmed(b){const d=decisionFor(b),field=loanField({aliases:b.aliases.map(id=>b.creditor+'|'+id)},true);return !!d&&['confirm','correct'].includes(d.decision)&&!!field&&sameAmount(field.value,d.amount);}
function editor(b){const key=editorKey(b);if(!rowDrafts.has(key)){const d=decisionFor(b);rowDrafts.set(key,{decision:'',amount:d?.amount||b.amount,reason:d?.decision==='correct'?d.reason:''});}return rowDrafts.get(key);}
function validEditor(d){return ['confirm','reject'].includes(d.decision)||d.decision==='correct'&&/^\d{1,14}(?:\.\d{1,2})?$/.test(normalized(d.amount))&&Number(normalized(d.amount))<=Number.MAX_SAFE_INTEGER/100&&d.reason.trim().length>=4;}
function reconcileAttempt(){
 if(!attempt||!inspection||attempt.planKey!==inspection.planKey)return;
 const b=inspection.plan.balances.find(b=>b.fullIndex===attempt.fullIndex);if(!b)return;
 const draft=rowDrafts.get(editorKey(b)),saved=decisionFor(b);
 if(draft&&saved&&draft.decision===saved.decision&&((draft.decision==='reject')||(rowConfirmed(b)&&(draft.decision!=='correct'||sameAmount(normalized(draft.amount),saved.amount)&&draft.reason.trim()===saved.reason)))){rowDrafts.delete(editorKey(b));attempt=null;}
}
function editRow(b){const draft=editor(b);draft.decision='correct';activeLoan=b.fullIndex;render();dialog.querySelector(`[data-gkb-loan="${b.fullIndex}"] [data-gkb-amount]`)?.focus();}
function renderEditor(b){
 const box=make('div',null,'gkb-loan-editor'),saved=decisionFor(b),key=editorKey(b),draft=rowDrafts.get(key);box.dataset.gkbLoan=String(b.fullIndex);
 if(draft?.decision==='correct'){
  const save=button('Сохранить сумму',()=>saveRow(b,'confirm'));save.className='btn btn-main';save.disabled=!validEditor(draft);save.dataset.gkbSave='';
  const fields=make('div',null,'gkb-edit-fields');
  const amountLabel=make('label','Сумма долга, ₸'),input=make('input');input.type='text';input.inputMode='decimal';input.value=draft.amount;input.dataset.gkbAmount='';input.setAttribute('aria-label','Сумма долга, ₸');input.oninput=()=>{draft.amount=input.value;save.disabled=!validEditor(draft);};amountLabel.append(input);
  const reasonLabel=make('label','Источник или причина'),reason=make('textarea');reason.rows=2;reason.maxLength=600;reason.value=draft.reason;reason.placeholder='Документ и страница';reason.dataset.gkbReason='';reason.setAttribute('aria-label','Источник или причина');reason.oninput=()=>{draft.reason=reason.value;save.disabled=!validEditor(draft);};reasonLabel.append(reason);fields.append(amountLabel,reasonLabel);box.append(fields,save,button('Отмена',()=>{rowDrafts.delete(key);render();}));return box;
 }
 if(saved?.decision==='reject')box.append(make('p','Уточните кредитора и номер договора. Кредит остаётся в анкете.','gkb-unresolved'));
 const confirm=button('Подтвердить сумму',()=>{editor(b).decision='confirm';saveRow(b,'confirm');});confirm.className='btn btn-main';confirm.dataset.gkbSave='';box.append(confirm,button('Изменить',()=>editRow(b)));
 const other=make('details',null,'gkb-row-options');other.append(make('summary','Договор не совпадает?'),button('Отметить несовпадение',()=>{editor(b).decision='reject';saveRow(b,'confirm');}));box.append(other);return box;
}
function renderRow(row,result){
 const choice=result?.inspection?.plan.balances.find(b=>creditorKey(b.creditor)===creditorKey(row.name)&&b.aliases.some(id=>[row.full?.contractNumber,row.full?.contractCode].includes(id)));
 const box=make('article',null,'gkb-row '+row.status),head=make('div',null,'gkb-row-head');head.append(make('strong',row.name),make('span','№ '+(choice?.contractNumber||row.number)));box.append(head);
 if(choice){
  box.dataset.gkbRow=String(choice.fullIndex);
  const saved=decisionFor(choice),editing=rowDrafts.get(editorKey(choice))?.decision==='correct';
  if(rowConfirmed(choice)&&!editing){
   box.classList.add('gkb-row-compact');const line=make('div',null,'gkb-saved-line');line.append(make('span','✓ '+amount(saved.amount)+(saved.decision==='correct'?' · исправлено':' · подтверждено')));
   const more=make('details');more.append(make('summary','Изменить'),button('Изменить сумму',()=>editRow(choice)),button('Отменить подтверждение',()=>{activeLoan=choice.fullIndex;saveRow(choice,'withdraw');}));if(saved.reason)more.append(make('p',saved.reason));line.append(more);box.append(line);return box;
  }
  if(activeLoan!==choice.fullIndex&&!editing){box.classList.add('gkb-row-compact');const line=make('div',null,'gkb-saved-line');line.append(make('span',saved?.decision==='reject'?'Нужно уточнить договор':'Ожидает проверки'),button('Открыть',()=>{activeLoan=choice.fullIndex;render();}));box.append(line);return box;}
  box.classList.add('gkb-row-active');
  if(!editing){box.append(make('span','Сумма из краткого ГКБ','gkb-amount-label'),make('div',amount(choice.amount),'gkb-main-amount'));}
 }else if(row.reason)box.append(make('p',row.reason));
 const sources=make('div',null,'gkb-sources');
 for(const [key,title] of [['short','Краткий'],['full','Полный']]){
  const source=row[key];if(!source){sources.append(make('span',title+': договор не сопоставлен'));continue;}
  const block=make('div'),link=button(title+' · '+(choice&&key==='full'?'сумма не указана':amount(source.value)),()=>openSource(source));block.append(link,make('span','Страница '+source.page));
  if(source.calculated){const calculation=make('details');calculation.append(make('summary','Расчёт по составным суммам'),make('p',source.quote));block.append(calculation);}
  if(!choice&&source.days!==null){const label='Просрочка: '+source.days+' дн.';block.append(source.daysPage!==source.page?button(label,()=>openSource({...source,page:source.daysPage,quote:'Количество дней просрочки'})):make('span',label));}
  sources.append(block);
 }
 if(choice){const details=make('details',null,'gkb-source-details');details.append(make('summary','Сравнить источники'),sources);box.append(details,renderEditor(choice));}else{box.append(sources);const field=loanField(row);if(field)box.append(button('К вопросу',()=>{dialog.close();afFocus(field);}));}return box;
}
function render(){
 const result=current(),editing=result.inspection?.plan.balances.some(b=>rowDrafts.get(editorKey(b))?.decision==='correct'),head=make('div',null,'gkb-dialog-head'),title=make('h2',result.inspection?'Суммы кредитов':'Сверка кредитов');title.id='gkbComparisonTitle';head.append(title,button('Закрыть',()=>dialog.close()));dialog.replaceChildren(head);
 if(result.inspection&&!result.inspection.plan.balances.some(b=>b.fullIndex===activeLoan&&!rowConfirmed(b)))activeLoan=result.inspection.plan.balances.find(b=>!rowConfirmed(b))?.fullIndex??null;
 dialog.append(make('p',result.confirmed?(editing?'Изменения не сохранены.':'Все суммы подтверждены.'):result.inspection?'Подтвердите сумму или укажите правильную.':result.status==='matched'?'Кредиты сопоставлены. Сокращённые номера не мешают продолжить.':result.status==='mismatch'?'Найдены различия между отчётами.':'Нужно проверить отмеченные кредиты.','gkb-verdict '+result.status));
 if(result.inspection)dialog.append(make('p','В анкете '+result.inspection.plan.activeLoans+' активных кредитов.'));
 else if(result.reason)dialog.append(make('p',result.reason));
 if(result.rows.length){
  if(!result.inspection){const totals=make('div',null,'gkb-totals');totals.append(make('span','Краткий: '+amount(result.shortTotal)),make('span','Полный: '+amount(result.fullTotal)));dialog.append(totals);}
  for(const row of result.rows.filter(r=>r.status!=='matched'))dialog.append(renderRow(row,result));
  const matched=result.rows.filter(r=>r.status==='matched');if(matched.length){const fold=make('details');fold.append(make('summary','Совпадают · '+matched.length));for(const row of matched)fold.append(renderRow(row,result));dialog.append(fold);}
 }else for(const report of result.reports)dialog.append(button(report.kind==='gkbShort'?'Открыть краткий ГКБ':'Открыть полный ГКБ',()=>openSource({fileId:report.fileId,page:1})));
 const actions=make('div',null,'gkb-review-actions'),status=make('p',inspectionError||(inspectionPending?'Загружаем сохранённые решения…':''));status.setAttribute('role','status');status.dataset.gkbReviewStatus='';
 if(result.inspection){const count=result.inspection.plan.balances.filter(b=>rowConfirmed(b)).length;actions.append(make('strong','Сохранено '+count+' из '+result.inspection.plan.balances.length),make('span',' · в полном ГКБ суммы не указаны'));}
 if(inspectionError)actions.append(button('Обновить сверку',()=>inspect(true)));
 actions.append(status);dialog.append(actions);if(busy)dialog.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=true);
}
async function saveRow(balance,action){
 if(busy)return;const p=pair(),snapshot=inspection;
 if(!p||inspectionKey!==p.key||!snapshot)return;
 const draft=action==='withdraw'?null:editor(balance);if(draft&&!validEditor(draft))return;
 const chosenAmount=draft?.decision==='correct'?normalized(draft.amount):balance.amount;
 const body={action,planKey:snapshot.planKey,fullIndex:balance.fullIndex,expectedReviewId:snapshot.rowHeads?.find(h=>h.fullIndex===balance.fullIndex)?.reviewId||null,...(draft?{decision:draft.decision,...(draft.decision==='correct'?{amount:chosenAmount,reason:draft.reason.trim()}:{})}:{})};
 const signature=JSON.stringify([p.key,body]);if(attempt?.signature!==signature)attempt={signature,requestId:crypto.randomUUID(),fullIndex:balance.fullIndex,planKey:snapshot.planKey};
 busy=true;dialog.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=true);dialog.querySelector('[data-gkb-review-status]').textContent='Сохраняем решение по кредиту…';
 try{
  let field=null;
  if(draft&&['confirm','correct'].includes(draft.decision)){
   field=loanField({aliases:balance.aliases.map(id=>balance.creditor+'|'+id)},true);
   if(!field)throw Error('Не найден один точный договор в анкете. Проверьте кредитора и полный номер; другой кредит не будет изменён.');
   field.value=chosenAmount;af.sources.delete(field.id);delete field.dataset.sourceReplaced;field.setCustomValidity('');field.closest('.field')?.querySelectorAll('.af-source').forEach(node=>{if(node.dataset.for===field.id)node.remove();});af.conflicts=af.conflicts.filter(c=>c.id!==field.id);afDispatchChange(field);afRefresh();
  }
  ServerDrafts.changed();if(!await ServerDrafts.save({automatic:true}))throw Error('Не удалось сохранить анкету. Повторите сохранение; решение пока не подтверждено.');
  if(pair()?.key!==p.key||field&&(!field.isConnected||!sameAmount(field.value,chosenAmount)))throw Error('Ответы или клиент изменились. Откройте сверку заново.');
  await request(p,{...body,requestId:attempt.requestId});
  if(pair()?.key!==p.key)return;
  rowDrafts.delete(snapshot.planKey+':'+balance.fullIndex);attempt=null;busy=false;await inspect(true);activeLoan=inspection?.plan.balances.find(b=>!rowConfirmed(b))?.fullIndex??null;await window.AssessmentCheck?.documents();refresh();if(activeLoan!==null)dialog.querySelector(`[data-gkb-row="${activeLoan}"]`)?.scrollIntoView?.({block:'nearest'});
 }catch(error){if(pair()?.key===p.key){inspectionError=error.message;busy=false;render();}}finally{busy=false;}
}
function open(){inspect(Boolean(inspectionError));render();dialog.showModal();}
document.addEventListener('assessment-case-opened',()=>{inspectionKey='';inspection=null;inspectionError='';inspectionPending=null;attempt=null;rowDrafts.clear();activeLoan=null;dialog.close();});
window.GkbComparison={open,task(){inspect();const result=current();if(!result.inspection)return null;const pending=result.inspection.plan.balances.filter(b=>!rowConfirmed(b)).length;return {pending,activeLoans:result.inspection.plan.activeLoans,label:pending===1?'Проверьте сумму по 1 кредиту':'Проверьте суммы по '+pending+' кредитам'};},resolved(fileId){inspect();const result=current();return ['matched','reviewed'].includes(result.status)&&result.reports.some(r=>r.fileId===fileId&&r.kind==='gkbShort');},statusButton(){inspect();const status=current().status,b=button(captions[status],event=>{event.preventDefault();event.stopPropagation();open();});b.className='wf-gkb-status '+status;b.setAttribute('aria-haspopup','dialog');b.title='Сверить исходные отчёты по каждому договору';return b;}};
window.AssessmentWorkflow?.refresh();
