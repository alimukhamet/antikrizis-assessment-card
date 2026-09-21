import {compareGkb,creditorKey} from './gkb-comparison.mjs';
const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
const amount=value=>value===null?'сумма требует сверки':Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₸';
const captions={matched:'Кредиты сверены',mismatch:'ГКБ: расхождение',unavailable:'ГКБ: не сверены'};
function current(){
 const context=HostedAssessment.getContext();
 const reports=selectedFiles.filter(item=>item.person==='Клиент').map(item=>({fileId:item.id,...af.results.get(item.id)})).filter(r=>r.server?.dealId===context?.client.external.dealId);
 return compareGkb(reports,{iin:context?.client.iin,day:context?.assessmentDay});
}
const dialog=make('dialog',null,'gkb-dialog');dialog.id='gkbComparisonDialog';dialog.setAttribute('aria-labelledby','gkbComparisonTitle');document.body.append(dialog);
const button=(label,handler)=>{const b=make('button',label,'btn btn-ghost');b.type='button';b.onclick=handler;return b;};
function openSource(source){dialog.close();afSource(source);}
function loanField(row){
 const normalize=s=>s.split('|').map((part,i)=>i===0?creditorKey(part):part.trim()).join('|');
 const aliases=new Set(row.aliases.map(normalize)),iin=HostedAssessment.getContext()?.client.iin;
 const matches=new Set([...af.rowKeys].filter(([key])=>key.startsWith('creditors|'+iin+'|')&&aliases.has(normalize(key.split('|').slice(2).join('|')))).map(([,id])=>id));
 if(matches.size!==1)return null;
 return [...(document.getElementById([...matches][0])?.querySelectorAll('input')||[])].find(e=>e.id.replace(/_r\d+$/,'')==='n8040')||null;
}
function renderRow(row){
 const box=make('article',null,'gkb-row '+row.status),head=make('div',null,'gkb-row-head');head.append(make('strong',row.name),make('span','№ '+row.number));box.append(head);
 if(row.reason)box.append(make('p',row.reason));
 const sources=make('div',null,'gkb-sources');
 for(const [key,title] of [['short','Краткий'],['full','Полный']]){
  const source=row[key];if(!source){sources.append(make('span',title+': договор не сопоставлен'));continue;}
  const block=make('div'),link=button(title+' · '+amount(source.value),()=>openSource(source));block.append(link);
  if(source.calculated){const calculation=make('details');calculation.append(make('summary','Расчёт по составным суммам'),make('p',source.quote));block.append(calculation);}
  if(source.days!==null){const label='Просрочка: '+source.days+' дн.';block.append(source.daysPage!==source.page?button(label,()=>openSource({...source,page:source.daysPage,quote:'Количество дней просрочки'})):make('span',label));}
  sources.append(block);
 }
 box.append(sources);const field=loanField(row);if(field)box.append(button('К вопросу',()=>{dialog.close();afFocus(field);}));return box;
}
function open(){
 const result=current(),head=make('div',null,'gkb-dialog-head'),title=make('h2','Сверка краткого и полного ГКБ');title.id='gkbComparisonTitle';head.append(title,button('Закрыть',()=>dialog.close()));dialog.replaceChildren(head);
 dialog.append(make('p',result.status==='matched'?'Кредиты сопоставлены. Сокращённые номера не мешают продолжить.':result.status==='mismatch'?'Найдены различия между отчётами.':'Нужно проверить отмеченные кредиты.','gkb-verdict '+result.status));
 if(result.reason)dialog.append(make('p',result.reason));
 if(result.rows.length){
  const totals=make('div',null,'gkb-totals');totals.append(make('span','Краткий: '+amount(result.shortTotal)),make('span','Полный: '+amount(result.fullTotal)));dialog.append(totals);
  for(const row of result.rows.filter(r=>r.status!=='matched'))dialog.append(renderRow(row));
  const matched=result.rows.filter(r=>r.status==='matched');if(matched.length){const fold=make('details');fold.append(make('summary','Совпадают · '+matched.length));for(const row of matched)fold.append(renderRow(row));dialog.append(fold);}
 }else for(const report of result.reports)dialog.append(button(report.kind==='gkbShort'?'Открыть краткий ГКБ':'Открыть полный ГКБ',()=>openSource({fileId:report.fileId,page:1})));
 dialog.showModal();
}
window.GkbComparison={open,resolved(fileId){const result=current();return result.status==='matched'&&result.reports.some(r=>r.fileId===fileId&&r.kind==='gkbShort');},statusButton(){const status=current().status,b=button(captions[status],event=>{event.preventDefault();event.stopPropagation();open();});b.className='wf-gkb-status '+status;b.setAttribute('aria-haspopup','dialog');b.title='Сверить исходные отчёты по каждому договору';return b;}};
window.AssessmentWorkflow?.refresh();
