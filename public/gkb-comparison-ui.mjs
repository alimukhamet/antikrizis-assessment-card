import {compareGkb,creditorKey} from './gkb-comparison.mjs';
const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
const amount=value=>value===null?'сумма требует сверки':Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₸';
const captions={matched:'Кредиты сверены',reviewed:'Суммы подтверждены',mismatch:'ГКБ: расхождение',unavailable:'ГКБ: не сверены'};
let inspectionKey='',inspection=null,inspectionError='',inspectionPending=null,attempt=null,busy=false;
function pair(){
 const context=HostedAssessment.getContext(),reports=selectedFiles.filter(item=>item.person==='Клиент').map(item=>af.results.get(item.id)).filter(r=>r?.server?.dealId===context?.client.external.dealId);
 const short=reports.filter(r=>r.kind==='gkbShort'),full=reports.filter(r=>r.kind==='gkbFull');
 if(short.length!==1||full.length!==1||!short[0].server.documentId||!full[0].server.documentId)return null;
 const input={shortDocumentId:short[0].server.documentId,fullDocumentId:full[0].server.documentId,identityRevision:context.identityRevision};
 return {dealId:context.client.external.dealId,input,key:JSON.stringify([context.client.external.dealId,context.assessmentDay,input,short[0].server.extractionId,full[0].server.extractionId])};
}
const errorMessage=code=>({GKB_REVIEW_CHANGED:'Отчёты или их проверка изменились. Откройте сверку заново.',GKB_ANSWERS_NOT_SAVED:'Суммы не подтверждены в сохранённой анкете. Сохраните черновик и повторите.',CASE_IDENTITY_CHANGED:'Клиент сделки изменился. Откройте сделку заново.',REVIEW_CHANGED:'Подтверждение уже изменилось. Откройте сверку заново.'})[code]||'Не удалось сохранить сверку. Повторите действие; повтор не создаст вторую запись.';
const request=(p,body)=>HostedAssessment.requestJson(`/api/assessment/${encodeURIComponent(p.dealId)}/gkb-reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p.input,...body})},{message:errorMessage});
function refresh(){if(typeof afRenderResults==='function')afRenderResults();window.AssessmentWorkflow?.refresh();if(dialog.open)render();}
function inspect(force=false){
 const p=pair();if(!p)return Promise.resolve(null);
 if(p.key===inspectionKey&&(!force||inspectionPending))return inspectionPending||Promise.resolve(inspection);
 inspectionKey=p.key;inspection=null;inspectionError='';
 inspectionPending=request(p,{action:'inspect'}).then(data=>{if(pair()?.key===p.key&&inspectionKey===p.key)inspection=data.inspection;return data.inspection;}).catch(error=>{if(pair()?.key===p.key)inspectionError=error.message;return null;}).finally(()=>{if(inspectionKey===p.key){inspectionPending=null;refresh();}});
 return inspectionPending;
}
function reviewedAmountsMatch(){return inspection?.plan.balances.every(b=>{const field=loanField({aliases:b.aliases.map(id=>b.creditor+'|'+id)},true);return field&&sameAmount(field.value,b.amount);});}
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
function openSource(source){dialog.close();afSource(source);}
function loanField(row,strict=false){
 const normalize=s=>s.split('|').map((part,i)=>i===0?creditorKey(part):part.trim()).join('|');
 const aliases=new Set(row.aliases.map(normalize)),iin=HostedAssessment.getContext()?.client.iin;
 const matches=new Set([...af.rowKeys].filter(([key])=>key.startsWith('creditors|'+iin+'|')&&aliases.has(normalize(key.split('|').slice(2).join('|')))).map(([,id])=>id));
 const rows=[...document.querySelectorAll('#creditors > .repeat-rows > .repeat-item')].filter(node=>{const inputs=[...node.querySelectorAll('input')],value=key=>inputs.find(e=>e.id.replace(/_r\d+$/,'')===key)?.value||'';return aliases.has(normalize(value('n8038')+'|'+value('loanContractId')));});
 const target=rows.length===1?rows[0]:rows.length||strict?null:matches.size===1?document.getElementById([...matches][0]):null;
 return [...(target?.querySelectorAll('input')||[])].find(e=>e.id.replace(/_r\d+$/,'')==='n8040')||null;
}
function renderRow(row,result){
 const choice=result?.inspection?.plan.balances.find(b=>creditorKey(b.creditor)===creditorKey(row.name)&&b.aliases.some(id=>[row.full?.contractNumber,row.full?.contractCode].includes(id)));
 const box=make('article',null,'gkb-row '+row.status),head=make('div',null,'gkb-row-head');head.append(make('strong',row.name),make('span','№ '+row.number));box.append(head);
 if(choice)box.append(make('p',result.confirmed?'Сумма из краткого ГКБ подтверждена и сохранена.':'В полном ГКБ остаток не указан. Можно использовать сумму из краткого ГКБ после проверки договора.'));
 else if(row.reason)box.append(make('p',row.reason));
 const sources=make('div',null,'gkb-sources');
 for(const [key,title] of [['short','Краткий'],['full','Полный']]){
  const source=row[key];if(!source){sources.append(make('span',title+': договор не сопоставлен'));continue;}
  const block=make('div'),link=button(title+' · '+(choice&&key==='full'?'сумма не указана':amount(source.value)),()=>openSource(source));block.append(link);
  block.append(make('span','Страница '+source.page));
  if(source.calculated){const calculation=make('details');calculation.append(make('summary','Расчёт по составным суммам'),make('p',source.quote));block.append(calculation);}
  if(source.days!==null){const label='Просрочка: '+source.days+' дн.';block.append(source.daysPage!==source.page?button(label,()=>openSource({...source,page:source.daysPage,quote:'Количество дней просрочки'})):make('span',label));}
  sources.append(block);
 }
 box.append(sources);const field=loanField(row);if(field)box.append(button('К вопросу',()=>{dialog.close();afFocus(field);}));return box;
}
function render(){
 const result=current(),head=make('div',null,'gkb-dialog-head'),title=make('h2','Сверка краткого и полного ГКБ');title.id='gkbComparisonTitle';head.append(title,button('Закрыть',()=>dialog.close()));dialog.replaceChildren(head);
 dialog.append(make('p',result.confirmed?'Сверка сохранена. Суммы взяты из краткого ГКБ.':result.inspection?'Договоры сопоставлены. Подтвердите источник недостающих сумм.':result.status==='matched'?'Кредиты сопоставлены. Сокращённые номера не мешают продолжить.':result.status==='mismatch'?'Найдены различия между отчётами.':'Нужно проверить отмеченные кредиты.','gkb-verdict '+result.status));
 if(result.inspection)dialog.append(make('p','Активных кредитов в полном ГКБ: '+result.inspection.plan.activeLoans+'. Все они должны остаться в анкете.'));
 else if(result.reason)dialog.append(make('p',result.reason));
 if(result.rows.length){
  const totals=make('div',null,'gkb-totals');totals.append(make('span','Краткий: '+amount(result.shortTotal)),make('span','Полный: '+amount(result.fullTotal)));dialog.append(totals);
  for(const row of result.rows.filter(r=>r.status!=='matched'))dialog.append(renderRow(row,result));
  const matched=result.rows.filter(r=>r.status==='matched');if(matched.length){const fold=make('details');fold.append(make('summary','Совпадают · '+matched.length));for(const row of matched)fold.append(renderRow(row,result));dialog.append(fold);}
 }else for(const report of result.reports)dialog.append(button(report.kind==='gkbShort'?'Открыть краткий ГКБ':'Открыть полный ГКБ',()=>openSource({fileId:report.fileId,page:1})));
 const actions=make('div',null,'gkb-review-actions'),status=make('p',inspectionError|| (inspectionPending?'Проверяем возможность сохранить сверку…':''));status.setAttribute('role','status');status.dataset.gkbReviewStatus='';
 if(result.inspection){
  if(result.confirmed){actions.append(make('p','Подтверждено сотрудником · '+new Date(result.inspection.review.reviewedAt).toLocaleDateString('ru-RU')),button('Отменить подтверждение',()=>saveReview('withdraw')));}
  else {const label=make('label'),agree=make('input');agree.type='checkbox';agree.dataset.gkbAgree='';label.append(agree,document.createTextNode(' Я сверил кредиторов и номера договоров по обоим отчётам'));const save=button('Внести и подтвердить суммы из краткого ГКБ',()=>saveReview('confirm'));save.className='btn btn-main';save.disabled=true;agree.onchange=()=>save.disabled=busy||!agree.checked;actions.append(label,make('p','Суммы выше будут сохранены в соответствующих кредитах анкеты. Остальные ответы останутся прежними.'),save);}
 }else if(inspectionError)actions.append(button('Повторить проверку',()=>inspect(true)));
 actions.append(status);dialog.append(actions);if(busy)dialog.querySelectorAll('button,input').forEach(node=>node.disabled=true);
}
async function saveReview(action){
 if(busy)return;const p=pair(),snapshot=inspection;
 if(!p||inspectionKey!==p.key||!snapshot)return;
 if(action==='confirm'&&!dialog.querySelector('[data-gkb-agree]')?.checked)return;
 const signature=JSON.stringify([p.key,snapshot.planKey,action,snapshot.review?.reviewId]);if(attempt?.signature!==signature)attempt={signature,requestId:crypto.randomUUID()};
 busy=true;dialog.querySelectorAll('button,input').forEach(node=>node.disabled=true);const status=dialog.querySelector('[data-gkb-review-status]');status.textContent='Сохраняем сверку…';
 try{
  if(action==='confirm'){
   const changes=snapshot.plan.balances.map(b=>({balance:b,field:loanField({aliases:b.aliases.map(id=>b.creditor+'|'+id)},true)}));
   if(changes.some(c=>!c.field)||new Set(changes.map(c=>c.field)).size!==changes.length)throw Error('Сначала добавьте недостающие кредиты в анкету. Договоры нельзя выбирать по одному названию кредитора.');
   for(const {field,balance}of changes){field.value=balance.amount;af.sources.delete(field.id);delete field.dataset.sourceReplaced;field.setCustomValidity('');field.closest('.field')?.querySelectorAll('.af-source').forEach(node=>{if(node.dataset.for===field.id)node.remove();});af.conflicts=af.conflicts.filter(c=>c.id!==field.id);afDispatchChange(field);}
   afRefresh();ServerDrafts.changed();if(!await ServerDrafts.save({automatic:true}))throw Error('Не удалось сохранить суммы в анкете. Повторите сохранение; сверка пока не подтверждена.');
   if(pair()?.key!==p.key||changes.some(c=>!c.field.isConnected||!sameAmount(c.field.value,c.balance.amount)))throw Error('Ответы или клиент изменились. Откройте сверку заново.');
  }
  await request(p,{action,planKey:snapshot.planKey,requestId:attempt.requestId,...(action==='withdraw'?{reviewId:snapshot.review.reviewId}:{})});
  if(pair()?.key!==p.key)return;
  attempt=null;busy=false;await inspect(true);await window.AssessmentCheck?.documents();refresh();
 }catch(error){if(pair()?.key===p.key){inspectionError=error.message;busy=false;render();}}finally{busy=false;}
}
function open(){inspect(Boolean(inspectionError));render();dialog.showModal();}
document.addEventListener('assessment-case-opened',()=>{inspectionKey='';inspection=null;inspectionError='';inspectionPending=null;attempt=null;dialog.close();});
window.GkbComparison={open,resolved(fileId){inspect();const result=current();return ['matched','reviewed'].includes(result.status)&&result.reports.some(r=>r.fileId===fileId&&r.kind==='gkbShort');},statusButton(){inspect();const status=current().status,b=button(captions[status],event=>{event.preventDefault();event.stopPropagation();open();});b.className='wf-gkb-status '+status;b.setAttribute('aria-haspopup','dialog');b.title='Сверить исходные отчёты по каждому договору';return b;}};
window.AssessmentWorkflow?.refresh();
