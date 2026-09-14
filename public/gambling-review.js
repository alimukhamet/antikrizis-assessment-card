/* Optional review of already-read statement rows. Never infer zero from no merchant match. */
(()=>{
 const choice=document.getElementById('gamblingTransfers'),amount=document.getElementById('n8044'),tools=document.getElementById('gamblingTools'),status=document.getElementById('gamblingStatus'),matches=document.getElementById('gamblingMatches');
 function refresh(){tools.hidden=choice.value!=='yes';const conflict=amount.value!==''&&(choice.value==='no'&&Number(amount.value)!==0||choice.value==='yes'&&Number(amount.value)===0);amount.setCustomValidity(conflict?'Сумма не соответствует ответу о переводах. Уточните ответ и сумму.':'');}
 choice.addEventListener('change',()=>{refresh();if(choice.value==='no'){amount.value='0';amount.dispatchEvent(new Event('input',{bubbles:true}));}else if(choice.value==='yes'&&amount.value==='0'&&!af.sources.has(amount.id)){amount.value='';amount.dispatchEvent(new Event('input',{bubbles:true}));}});
 document.addEventListener('assessment-draft-restored',refresh);
 document.addEventListener('input',e=>{if(e.target===amount)refresh();});
 document.addEventListener('change',e=>{if(e.target===choice||e.target===amount)refresh();});
 document.getElementById('analyzeGambling').onclick=()=>{
  if(choice.value!=='yes')return;
  matches.replaceChildren();const client=HostedAssessment.getContext()?.client;
  const docs=[...af.results].filter(([,r])=>!r.blocked&&!r.error&&!r.duplicate&&r.kind==='kaspi'&&r.identity?.iin===client?.iin);
  if(!docs.length){status.textContent='Добавьте и распознайте полную выписку Kaspi за 12 месяцев для этого клиента.';return;}
  if(docs.length>1){status.textContent='Добавлено несколько выписок Kaspi. Оставьте одну нужную выписку, чтобы не посчитать переводы дважды.';return;}
  const[id,result]=docs[0],fact=result.gambling;
  if(!fact){status.textContent='По названиям получателей переводы не найдены. Это не подтверждает их отсутствие: уточните сумму у клиента.';return;}
  status.textContent='Найдены переводы на '+Number(fact.value).toLocaleString('ru-RU')+' ₸ за '+result.statement.period+'. Проверьте получателей и уточните переводы с других счетов.';
  const list=document.createElement('ul');for(const row of result.statement.gambling?.matches||[]){const li=document.createElement('li'),open=document.createElement('button');open.type='button';open.className='btn btn-ghost';open.textContent=row.date+' · '+row.amount+' ₸ · '+row.description;open.onclick=()=>afSource({fileId:id,page:row.page,quote:row.description});li.append(open);list.append(li);}matches.append(list);
  afPut(amount,fact.value,{fileId:id,page:fact.page,quote:fact.source,server:result.server,serverFactKey:'statement.gambling'});afRenderConflicts();afRefresh();document.dispatchEvent(new Event('assessment-analysis-complete'));
 };
 refresh();
})();
