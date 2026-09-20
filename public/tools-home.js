// Current tools launcher: sales readback only; no legacy form or CRM writes.
(()=>{
const $=id=>document.getElementById(id);
const salesToday=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Almaty",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const salesSelection={managerId:"7609",paymentType:"all",period:"current_month",from:`${salesToday.slice(0,7)}-01`,to:salesToday};
let salesMetricsRequest=0,salesMetricsController=null;
const salesResultCache=new Map();
const SALES_NAMES={"7609":"Дархан","2093":"Рамазан","4351":"Нурдаулет"};
$("salesDateFrom").value=salesSelection.from;
$("salesDateTo").value=salesSelection.to;

function syncSalesDateLimits(changed=""){
  const from=$("salesDateFrom"),to=$("salesDateTo");
  if(changed==="from"&&from.value&&to.value&&from.value>to.value) to.value=from.value;
  if(changed==="to"&&from.value&&to.value&&to.value<from.value) from.value=to.value;
  from.max=to.value||salesToday;
  to.min=from.value||"";
  to.max=salesToday;
}
syncSalesDateLimits();
$("salesDateFrom").addEventListener("change",()=>syncSalesDateLimits("from"));
$("salesDateTo").addEventListener("change",()=>syncSalesDateLimits("to"));

function formatSalesMoney(value){
  return `${Math.round(Number(value)||0).toLocaleString("ru-RU")} ₸`;
}

function setSalesFilter(group,value){
  document.querySelectorAll(`[data-sales-${group}]`).forEach(button=>{
    const active=button.dataset[`sales${group[0].toUpperCase()+group.slice(1)}`]===value;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
}


function salesQuery(managerId=salesSelection.managerId,paymentType=salesSelection.paymentType){
  const query=new URLSearchParams({managerId,paymentType,period:salesSelection.period});
  if(salesSelection.period==="custom"){query.set("from",salesSelection.from);query.set("to",salesSelection.to);}
  return query;
}
function salesShift(date,days){const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function salesPreviousQuery(query){
  const end=query.get("to")||salesToday;let start=query.get("from")||salesToday;
  if(query.get("period")==="current_month")start=salesToday.slice(0,7)+"-01";
  if(query.get("period")==="current_week"){const weekday=new Date(salesToday+"T00:00:00Z").getUTCDay()||7;start=salesShift(salesToday,1-weekday);}
  const days=Math.round((new Date(end)-new Date(start))/86400000)+1;
  return new URLSearchParams({managerId:"7609",paymentType:query.get("paymentType"),period:"custom",from:salesShift(start,-days),to:salesShift(start,-1)});
}
function salesTeam(data,type){
  const rows=(data.relatedMetrics||[]).filter(x=>x.paymentType===type&&Object.hasOwn(SALES_NAMES,x.managerId));
  if(rows.length!==3||new Set(rows.map(x=>x.managerId)).size!==3)throw new Error("Не удалось получить результаты всей команды. Повторите загрузку.");
  if(rows.some(x=>![x.contractTotal,x.contractAverage,x.handoffs,x.missingContractValues].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0)))throw new Error("Некорректные результаты продаж.");
  return rows.sort((a,b)=>b.contractTotal-a.contractTotal||a.managerId.localeCompare(b.managerId));
}
function clearSalesBoard(){ $("rows").innerHTML=""; }
function renderSalesTeam(data,type,previous=null){
  const rows=salesTeam(data,type),before=previous?salesTeam(previous,type):null;
  $("rows").innerHTML=rows.map(x=>{
    const rank=rows.findIndex(y=>y.contractTotal===x.contractTotal)+1;
    const prior=before?before.find(y=>y.managerId===x.managerId):null;
    const movement=prior?before.findIndex(y=>y.contractTotal===prior.contractTotal)+1-rank:null;
    const arrow=movement===null?"":`<span class="rank-move ${movement>0?'up':movement<0?'down':'same'}" title="Изменение места относительно предыдущего равного периода" aria-label="${movement>0?'Поднялся на '+movement:movement<0?'Опустился на '+(-movement):'Место не изменилось'}">${movement>0?'↑':movement<0?'↓':'−'}${movement?Math.abs(movement):''}</span>`;
    const gap=x.contractTotal===0?'Нет суммы договоров':rank===1?'Лидер':formatSalesMoney(rows[rank-2].contractTotal-x.contractTotal)+' до '+(rank-1)+' места';
    return `<details class="person"><summary><span class="position" aria-label="Место ${rank}">${rank===1&&x.contractTotal>0?'<svg class="leader-crown" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 6 4 4 5-7 5 7 4-4-2 12H5L3 6Z"/><path d="M6 21h12"/></svg>':rank}</span><span class="person-name">${SALES_NAMES[x.managerId]}${arrow}</span><span class="person-count">${x.handoffs}</span><span class="person-average">${x.contractsWithValue?formatSalesMoney(x.contractAverage):'—'}</span><span class="person-value">${formatSalesMoney(x.contractTotal)}<span class="person-gap">${gap}</span></span></summary><div class="person-detail">${x.missingContractValues?'Без суммы договора: '+x.missingContractValues+'. Среднее рассчитано только по договорам с суммой.':'Все переданные сделки имеют сумму договора.'}</div></details>`;
  }).join("");
  const missing=rows.reduce((s,x)=>s+x.missingContractValues,0);
  const stamp=new Date(data.lastSyncAt);
  $("salesSummaryStatus").textContent=(Number.isNaN(stamp.getTime())?'':`Обновлено ${stamp.toLocaleString("ru-RU",{timeZone:"Asia/Almaty"})}. `)+(missing?`Без суммы: ${missing}. `:'');
}
async function fetchSales(query,signal,force=false){
  const key=salesToday+":"+query;const cached=salesResultCache.get(key);
  if(!force&&cached&&Date.now()-cached.at<60000)return cached.data;
  const requestQuery=new URLSearchParams(query);if(force)requestQuery.set("fresh",String(Date.now()));
  const response=await fetch(`/api/sales-metrics?${requestQuery}`,{headers:{accept:"application/json"},signal});const data=await response.json();
  if(!response.ok||data.error)throw new Error(data.error||"Результаты временно недоступны.");
  salesTeam(data,query.get("paymentType"));
  // One response contains all managers and payment types from the same snapshot.
  for(const type of ['all','261','263','423']){const q=new URLSearchParams(query);q.set('paymentType',type);salesResultCache.set(salesToday+":"+q,{data,at:Date.now()});}
  return data;
}
async function loadSalesMetrics(force=false){
  const id=++salesMetricsRequest;if(salesMetricsController)salesMetricsController.abort();
  const controller=new AbortController();salesMetricsController=controller;
  const query=salesQuery(),type=query.get('paymentType');clearSalesBoard();$("rows").setAttribute('aria-busy','true');$("salesSummaryStatus").classList.remove('error');$("salesSummaryStatus").textContent='Загружаем результаты…';
  let timer=setTimeout(()=>controller.abort(),35000);
  try{
    const data=await fetchSales(query,controller.signal,force);if(id!==salesMetricsRequest)return;
    renderSalesTeam(data,type);$("rows").setAttribute('aria-busy','false');clearTimeout(timer);
    $("salesSummaryStatus").textContent+=' Сравниваем с предыдущим периодом…';
    timer=setTimeout(()=>controller.abort(),35000);
    try{const previousQuery=salesPreviousQuery(query);const previous=await fetchSales(previousQuery,controller.signal,force);if(id!==salesMetricsRequest)return;renderSalesTeam(data,type,previous);$("salesSummaryStatus").textContent+=` Стрелки: сравнение с ${previousQuery.get('from')} — ${previousQuery.get('to')} (равный период).`;}
    catch{if(id!==salesMetricsRequest)return;renderSalesTeam(data,type);$("salesSummaryStatus").textContent+=' Сравнение недоступно; стрелки скрыты.';}
  }catch(error){if(id!==salesMetricsRequest)return;clearSalesBoard();$("salesSummaryStatus").classList.add('error');$("salesSummaryStatus").textContent=controller.signal.aborted?'Bitrix отвечает слишком долго. Выберите период ещё раз, чтобы повторить.':error.message;}
  finally{clearTimeout(timer);if(id===salesMetricsRequest)$("rows").setAttribute('aria-busy','false');}
}
document.querySelectorAll("[data-sales-payment]").forEach(button=>button.addEventListener("click",()=>{
  salesSelection.paymentType=button.dataset.salesPayment;
  setSalesFilter("payment",salesSelection.paymentType);
  loadSalesMetrics();
}));
document.querySelectorAll("[data-sales-period]").forEach(button=>button.addEventListener("click",()=>{
  salesSelection.period=button.dataset.salesPeriod;
  setSalesFilter("period",salesSelection.period);
  $("salesDateRange").hidden=salesSelection.period!=="custom";
  if(salesSelection.period==="custom"){
    ++salesMetricsRequest;
    if(salesMetricsController) salesMetricsController.abort();
    $("rows").setAttribute("aria-busy","false");
    clearSalesBoard();
    $("salesSummaryStatus").textContent="Выберите даты и нажмите «Показать».";
    $("salesDateFrom").focus();
    return;
  }
  loadSalesMetrics();
}));
$("salesDateRange").addEventListener("submit",event=>{
  event.preventDefault();
  const from=$("salesDateFrom").value,to=$("salesDateTo").value;
  const status=$("salesSummaryStatus");
  status.classList.remove("error");
  if(!from||!to){
    status.textContent="Укажите обе даты.";
    status.classList.add("error");
    return;
  }
  if(from>to){
    status.textContent="Дата начала не может быть позже даты окончания.";
    status.classList.add("error");
    return;
  }
  salesSelection.from=from;
  salesSelection.to=to;
  loadSalesMetrics();
});
loadSalesMetrics();
$("signOut").onclick=async()=>{const response=await fetch('/api/session',{method:'DELETE'});if(response.ok)window.top.location.href='/login';};


})();
