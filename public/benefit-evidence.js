/* Show the existing certificate beside client benefits; reading never edits answers. */
window.BenefitEvidence=(()=>{
 const TYPE='Справка по выплатам пенсии и пособий';
 const money=value=>{const text=String(value??'').replace(/\s/g,'').replace(',','.');return /^\d+(?:\.\d{1,2})?$/.test(text)&&Number.isSafeInteger(Math.round(Number(text)*100))?Number(text):null;};
 const format=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value))+' ₸';
 const normal=text=>text.toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
 function category(description){
  const text=normal(description);
  if(/многодетн|көп балалы/.test(text))return 'Выплата многодетной семье';
  if(/инвалидност|мүгедектік/.test(text))return 'Выплата по инвалидности';
  if(/потер[еи] кормильца|асыраушысынан айырыл/.test(text))return 'Выплата по потере кормильца';
  if(/потер[еи] работы|жұмысынан айырыл/.test(text))return 'Выплата по потере работы';
  if(/адресн.{0,16}социальн.{0,16}помощ|атаулы әлеуметтік көмек/.test(text))return 'Адресная социальная помощь';
  if(/пенси[яиюй]|пенсионн|зейнетақы/.test(text))return 'Пенсия';
  // Broad child-benefit descriptions can refer to different payments: leave them for inspection.
  return null;
 }
 function parseActive(pageText){
  const text=pageText.join('\n'),start=/(?:Әрекеттегі төлемдер\s*\/\s*)?Действующие выплаты\s*:/i.exec(text);
  if(!start)return null;
  const from=start.index+start[0].length,end=/(?:Төленген төлемдер\s*\/\s*)?Выплаченные выплаты\s*:/i.exec(text.slice(from));
  if(!end)return null;
  const active=text.slice(from,from+end.index),pattern=/^\s*(\d+)\s*\n([\s\S]+?)\n([\d][\d \u00a0]*(?:[.,]\d{1,2})?)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})(?=\s*(?:\n\s*\d+\s*\n|$))/gm;
  const rows=[...active.matchAll(pattern)],starts=[...active.matchAll(/^\s*\d+\s*$/gm)];
  const dateValid=value=>{const iso=value.slice(6)+'-'+value.slice(3,5)+'-'+value.slice(0,2),date=new Date(iso+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso;};
  if(!rows.length||rows.length!==starts.length||rows.some((row,i)=>Number(row[1])!==i+1||money(row[3])===null||!dateValid(row[4])||!dateValid(row[5])))return null;
  return rows.map(row=>{const offset=from+row.index;let at=0,page=1;for(let i=0;i<pageText.length;i++){if(offset<at+pageText[i].length+1){page=i+1;break;}at+=pageText[i].length+1;}return {description:row[2].replace(/\s+/g,' ').trim(),type:category(row[2]),amount:money(row[3]),page};});
 }
 function inspect(row){
  const context=window.HostedAssessment?.getContext(),deal=context?.client.external.dealId,iin=context?.client.iin;
  const type=row.querySelector('[data-benefit-type]')?.value||'',amount=row.querySelector('input[id^="clientBenefitAmount_r"]');
  const files=selectedFiles.filter(item=>item.type===TYPE&&item.person==='Клиент').map(item=>({item,result:af.results.get(item.id)}));
  // A different person, deal or unprocessed selection must never supply an amount.
  const stored=files.filter(({item,result})=>(item.storedDocumentId||result?.server?.documentId)&&(!result?.server||result.server.dealId===deal)&&(!result?.identity?.iin||result.identity.iin===iin));
  const sources=stored.filter(({result})=>result&&!result.error&&!result.pending&&result.server?.dealId===deal&&(result.identity?.iin===iin&&iin||result.documentReview?.type===TYPE)&&(result.type===TYPE||result.documentReview?.type===TYPE));
  const matches=sources.flatMap(source=>{const active=parseActive(source.result.pageText||[]);const matches=active?.filter(item=>item.type===type)||[];return matches.length===1?[{...source,benefit:matches[0]}]:[];});
  const unique=matches.length===sources.length&&matches.length>0&&new Set(matches.map(source=>source.benefit.amount)).size===1;
  const source=unique?matches[0]:null,current=money(amount?.value);
  return {amount,stored,sources,source,mismatch:!!source&&current!==null&&current!==source.benefit.amount};
 }
 function refresh(){
  const group=document.getElementById('clientbenefits');if(!group)return;
  for(const row of group.querySelectorAll(':scope > .repeat-rows > .repeat-item')){
   let box=row.querySelector(':scope > .benefit-evidence');
   if(!box){box=document.createElement('div');box.className='benefit-evidence';box.setAttribute('role','status');box.setAttribute('aria-live','polite');row.append(box);}
   const state=inspect(row),signature=JSON.stringify({ids:state.stored.map(s=>s.item.id),reviews:state.sources.map(s=>s.result.documentReview?.reviewId||''),source:state.source?.benefit,current:state.amount?.value});
   if(box.dataset.signature===signature)continue;box.dataset.signature=signature;box.replaceChildren();box.classList.toggle('needs-attention',!state.stored.length||state.mismatch);
   const label=document.createElement('span');
   label.textContent=!state.stored.length?'Нужна справка о пенсии и пособиях':state.source?(state.mismatch?'Сумма отличается. ':'')+'В справке: '+format(state.source.benefit.amount)+' · стр. '+state.source.benefit.page:state.sources.length?'Справка добавлена · сверьте выплату и сумму':'Справка добавлена · нужна проверка';
   box.append(label);
   const button=(text,fn)=>{const node=document.createElement('button');node.type='button';node.className='btn btn-ghost';node.textContent=text;node.onclick=fn;box.append(node);return node;};
   if(!state.stored.length){
    button('Добавить справку',()=>{window.AssessmentWorkflow?.show('documents',{focus:false});document.querySelector('[data-required-picker="'+TYPE+'"]')?.click();});
   }else{
    for(const source of state.source?[state.source]:state.stored)button(state.stored.length>1&&!state.source?'Открыть: '+source.item.file.name:'Открыть справку',()=>afSource({fileId:source.item.id,page:source.benefit?.page||1}));
    if(state.source&&(state.mismatch||!state.amount?.value))button('Взять '+format(state.source.benefit.amount),()=>{
     // Recheck after replacements, deal switches and delayed clicks.
     const latest=inspect(row);if(!row.isConnected||!latest.source||latest.source.item!==state.source.item||latest.source.benefit.amount!==state.source.benefit.amount)return refresh();
     latest.amount.value=String(latest.source.benefit.amount);latest.amount.dispatchEvent(new Event('input',{bubbles:true}));latest.amount.dispatchEvent(new Event('change',{bubbles:true}));refresh();
    });
   }
  }
 }
 return {parseActive,refresh};
})();
