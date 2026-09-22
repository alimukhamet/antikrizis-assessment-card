/* A manager chooses the surviving questionnaire row; no financial fact is approved here. */
window.LoanDuplicates=(()=>{
 let current=null;const notices=new Set();
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const controls=row=>[...row.querySelectorAll('input,select,textarea')].filter(e=>e.id&&!e.closest('.af-source'));
 const key=e=>e.id.replace(/_r\d+$/,'');
 const values=row=>Object.fromEntries(controls(row).map(e=>[key(e),e.type==='checkbox'?(e.checked?'Да':'Нет'):e.value]));
 const busy=()=>af.busy||ServerDrafts.isBusy?.()||document.getElementById('checkQuestions')?.disabled;
 const fields=[['loanContractId','№ договора'],['n8040','Долг, ₸'],['n8041','Платёж в месяц, ₸'],['n8038Start','Дата кредита'],['n8039','Тип кредита'],['loanStatus','Статус'],['n8042','Дней просрочки'],['loanClaimIncluded','Включить в иск'],['loanParticipants','Другие участники'],['n8043','Цель кредита'],['creditPurposeOther','Пояснение']];
 const display=(key,value)=>value&&['n8040','n8041'].includes(key)&&Number.isFinite(Number(value))?Number(value).toLocaleString('ru-RU',{maximumFractionDigits:2}):value||'Не указано';
 function close(){if(current){current.close();current.remove();current=null;}}
 function refresh(group){renumber(group);afRefresh();window.AssessmentWorkflow?.refresh();}
 function stash(row){const ids=new Set(controls(row).map(e=>e.id));return {row,next:row.nextSibling,keys:[...af.rowKeys].filter(([,id])=>id===row.id),sources:[...af.sources].filter(([id])=>ids.has(id)),conflicts:af.conflicts.filter(c=>ids.has(c.id))};}
 function detach(entry){entry.row.remove();for(const [key]of entry.keys)af.rowKeys.delete(key);for(const [id]of entry.sources)af.sources.delete(id);af.conflicts=af.conflicts.filter(c=>!entry.conflicts.includes(c));}
 function restore(entries,container){for(const entry of [...entries].reverse()){container.insertBefore(entry.row,entry.next?.parentNode===container?entry.next:null);for(const [key,id]of entry.keys)af.rowKeys.set(key,id);for(const [id,source]of entry.sources)af.sources.set(id,source);for(const conflict of entry.conflicts)if(!af.conflicts.some(c=>c.key===conflict.key))af.conflicts.push(conflict);}}
 async function recheck(){document.getElementById('creditors').dispatchEvent(new Event('change',{bubbles:true}));await afAnalyze({cacheOnly:true,restoreOnly:true});await window.AssessmentCheck?.run();}
 function undoNotice(entries,container,group,context){
  const note=make('div',undefined,'loan-duplicate-undo'),text=make('span','Повтор убран из анкеты. '),undo=make('button','Вернуть','btn btn-ghost');undo.type='button';note.setAttribute('role','status');note.append(text,undo);group.before(note);notices.add(note);
  undo.onclick=async()=>{
   if(HostedAssessment.getContext()!==context||entries.some(e=>e.row.isConnected)){note.remove();notices.delete(note);return;}
   if(busy()){text.textContent='Дождитесь окончания проверки. ';return;}
   undo.disabled=true;restore(entries,container);refresh(group);
   const saved=await ServerDrafts.save();if(HostedAssessment.getContext()!==context)return;
   if(!saved){text.textContent='Записи возвращены на экран. Сохранение не подтверждено — проверьте статус черновика.';undo.remove();return;}
   note.remove();notices.delete(note);await recheck();
  };
 }
 function open(loan){
  const group=document.getElementById('creditors'),container=group?.querySelector(':scope > .repeat-rows');
  if(!container||!HostedAssessment.ready()||af.busy)return false;
  const indices=[...new Set(loan.duplicateRows||loan.rows||[])],rows=indices.map(i=>container.children[i]);
  if(rows.length<2||rows.some(row=>!row))return false;
  const context=HostedAssessment.getContext(),snapshot=JSON.stringify(ServerDrafts.capture()),data=rows.map(values);
  close();const dialog=make('dialog',undefined,'loan-duplicate-dialog');current=dialog;dialog.setAttribute('aria-labelledby','loanDuplicateTitle');
  const title=make('h2','Кредит повторяется');title.id='loanDuplicateTitle';
  const intro=make('p',loan.creditor+' · № '+loan.contractNumber),hint=make('p','Сравните данные и оставьте одну запись.','hint');
  const source=make('a','Открыть полный ГКБ · стр. '+loan.page);source.href='/document-viewer.html?dealId='+encodeURIComponent(context.client.external.dealId)+'&documentId='+encodeURIComponent(loan.documentId)+'&page='+loan.page;source.target='_blank';source.rel='noopener';
  const grid=make('div',undefined,'loan-duplicate-grid'),status=make('p');status.setAttribute('role','status');
  const buttons=[];let working=false;
  dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();else close();});
  function edit(row){close();const input=controls(row).find(e=>key(e)==='loanContractId');window.AssessmentWorkflow?.reveal(input);input?.focus();}
  async function keep(row){
   if(working||busy())return;
   if(HostedAssessment.getContext()!==context||JSON.stringify(ServerDrafts.capture())!==snapshot){status.textContent='Ответы изменились. Закройте окно и проверьте анкету ещё раз.';return;}
   working=true;for(const b of buttons)b.disabled=true;status.textContent='Сохраняем одну запись…';
   const removed=rows.filter(other=>other!==row).map(stash);removed.forEach(detach);refresh(group);
   try{
    const saved=await ServerDrafts.save();if(HostedAssessment.getContext()!==context){close();return;}
    if(!saved){restore(removed,container);refresh(group);status.textContent='Сохранение не подтверждено. Обе записи оставлены на экране; проверьте статус черновика.';return;}
    close();undoNotice(removed,container,group,context);await recheck();
   }catch(error){if(HostedAssessment.getContext()===context){const target=dialog.isConnected?status:document.getElementById('checkStatus');if(target)target.textContent=error.message||'Не удалось проверить изменения. Проверьте статус черновика.';}}
   finally{working=false;for(const b of buttons)b.disabled=false;}
  }
  for(let i=0;i<rows.length;i++){
   const row=rows[i],card=make('article',undefined,'loan-duplicate-card');card.append(make('h3','Запись '+(indices[i]+1)));
   const list=make('dl');
   for(const [key,label]of fields){const differs=new Set(data.map(v=>v[key]||'')).size>1;if(!differs&&!['loanContractId','n8040','n8041'].includes(key))continue;const line=make('div',undefined,differs?'loan-duplicate-difference':'');line.append(make('dt',label),make('dd',display(key,data[i][key])));list.append(line);}
   card.append(list);
   const identified=(loan.aliases||[loan.contractNumber]).includes((data[i].loanContractId||'').trim());
   if(!identified)card.append(make('p','Номер отличается от ГКБ.','hint'));
   const choose=make('button',identified?'Оставить эту запись':'Исправить номер','btn '+(identified?'btn-main':'btn-ghost'));choose.type='button';choose.dataset.keepLoan=String(indices[i]);choose.onclick=()=>identified?keep(row):edit(row);buttons.push(choose);card.append(choose);grid.append(card);
  }
  const cancel=make('button','Закрыть','btn btn-ghost');cancel.type='button';cancel.onclick=close;buttons.push(cancel);
  dialog.append(title,intro,hint,source,grid,status,cancel);document.body.append(dialog);dialog.showModal();return true;
 }
 document.addEventListener('assessment-case-opened',()=>{close();for(const note of notices)note.remove();notices.clear();});
 return {open};
})();
