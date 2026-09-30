/* Laptop OCR is assistance, never a replacement for native evidence or an employee review. */
window.ProfileOcr=(()=>{
 if(new URLSearchParams(location.search).get('mode')!=='profile')return null;
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const panel=make('section',null,'af-workspace profile-ocr');panel.id='profileOcr';panel.hidden=true;
 const heading=make('h3','Чтение сканов на этом компьютере'),note=make('p','Можно продолжать заполнять профиль. Прочитанные страницы сохраняются для всех сотрудников.','hint');
 const status=make('p');status.setAttribute('role','status');
 const toggle=make('button','Пауза','btn btn-ghost');toggle.type='button';
 const list=make('div');panel.append(heading,note,status,toggle,list);document.getElementById('afPanel')?.append(panel);
 if(!panel.isConnected)document.getElementById('documentStep')?.append(panel);
 let paused=false,busy=false,rerun=false,generation=0,timer=null,controller=null,activeLease=null,runtime=null,context=null;
 const records=new Map();
 const current=()=>window.HostedAssessment?.getContext();
 const candidates=()=>typeof selectedFiles==='undefined'?[]:selectedFiles.filter(item=>item.storedDocumentId&&item.person==='Клиент'&&af.results.get(item.id)?.ocrPages?.length&&!afExcluded(item));
 const active=(ctx,epoch,item)=>current()===ctx&&generation===epoch&&selectedFiles.includes(item)&&item.storedDocumentId&&item.person==='Клиент';
 const path=(ctx,item)=>'/api/assessment/'+encodeURIComponent(ctx.client.external.dealId)+'/documents/'+encodeURIComponent(item.storedDocumentId)+'/ocr';
 const message=code=>({OCR_LEASE_BUSY:'Этот документ уже читает другой сотрудник.',OCR_LEASE_LOST:'Чтение передано другой вкладке. Сохранённые страницы доступны.',OCR_ENGINE_CHANGED:'Обновилось чтение сканов. Сохраните ответы и обновите страницу.',CASE_IDENTITY_CHANGED:'Клиент изменился. Откройте профиль заново.',SIGN_IN_REQUIRED:'Войдите заново, чтобы продолжить чтение.',OCR_PAGE_IMMUTABLE:'Для страницы уже сохранён другой результат. Откройте сохранённый текст.',OCR_PAGE_ALREADY_COMPLETED:'Страница уже сохранена. Откройте сохранённый текст.',OCR_DOCUMENT_CHANGED:'Файл изменился. Откройте документ заново.',OCR_RESULT_CONFLICT:'Для страницы уже сохранён другой результат. Откройте сохранённый текст.',OCR_PAGE_NOT_ELIGIBLE:'Эта страница уже прочитана из PDF.'}[code]||'Не удалось продолжить чтение. Ответы и прочитанные страницы сохранены.');
 const api=(url,body,signal)=>HostedAssessment.requestJson(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal}:{cache:'no-store',signal},{message,timeoutMs:25000});
 const identity=(ctx,data)=>({identityRevision:ctx.identityRevision,originalSha256:data.originalSha256,engineVersion:data.engineVersion});
 function pinned(ctx,item,value,expected){
  if(current()!==ctx||value.documentId!==item.storedDocumentId||value.identityRevision!==ctx.identityRevision||expected&&(value.originalSha256!==expected.originalSha256||value.engineVersion!==expected.engineVersion||value.pdfSha256!==expected.pdfSha256))throw Object.assign(Error(message('CASE_IDENTITY_CHANGED')),{code:'CASE_IDENTITY_CHANGED'});
  return value;
 }
 const fieldMap={'identity.name':['fio','ФИО'],'benefits.count':['clientBenefitsCount','Количество выплат'],'employment.payersCount':['count-clientjobs','Количество мест работы'],'statement.topUps':['kaspiAnnual','Поступления Kaspi']};
 const loanMap={creditor:['n8038','Кредитор'],contractIdentifier:['loanContractId','Номер договора'],startedAtMonth:['n8038Start','Начало кредита'],monthlyPayment:['n8041','Платёж в месяц'],overdueDays:['n8042','Дней просрочки'],debtOutstanding:['n8040','Задолженность'],creditType:['n8039','Тип кредита']};
 function targetFor(fact,credit){
  if(!credit)return document.getElementById(fieldMap[fact.key]?.[0]);
  const rows=[...document.querySelectorAll('#creditors .repeat-rows > .repeat-item')],numbers=[credit.contractNumber,credit.contractCode].filter(Boolean);
  const matches=rows.filter(row=>[...row.querySelectorAll('input')].some(n=>n.id.replace(/_r\d+$/,'')==='loanContractId'&&numbers.includes(n.value.trim())));
  return matches.length===1?[...matches[0].querySelectorAll('input,select')].find(n=>n.id.replace(/_r\d+$/,'')===loanMap[fact.key]?.[0]):null;
 }
 function source(item,page){void afSource({fileId:item.id,page});}
 function drawSuggestions(root,item,data,ctx,epoch){
  const suggestion=data.suggestions?.extraction||data.suggestions;if(!suggestion)return;
  if(suggestion.identity?.iin&&ctx.client.iin&&suggestion.identity.iin!==ctx.client.iin){root.append(make('p','Распознанный ИИН не совпал с клиентом. Сверьте владельца по оригиналу.','hint'));return;}
  const dates={issuedAt:suggestion.issuedAt,expiresAt:suggestion.expiresAt,from:suggestion.coverage?.from||suggestion.bankStatement?.from,to:suggestion.coverage?.to||suggestion.bankStatement?.to};
  const labels={issuedAt:'Выдан',expiresAt:'Действует до',from:'Период с',to:'Период до'};
  const readableDates=Object.entries(dates).filter(([,value])=>/^\d{4}-\d{2}-\d{2}$/.test(value||''));
  if(readableDates.length){
   root.append(make('p',readableDates.map(([key,value])=>labels[key]+': '+value.split('-').reverse().join('.')).join(' · '),'hint'));
   if(['Удостоверение личности','Доверенность','Справка ЕНПФ','Выписка зарплатного банка','Выписка Kaspi Gold'].includes(item.type)){
    const datesButton=make('button','Подставить даты и сверить документ','btn btn-ghost');datesButton.type='button';
    datesButton.onclick=async()=>{
     if(!active(ctx,epoch,item)||!window.ServerDrafts?.canSwitch())return;
     const old=ServerDrafts.getDocumentReviewDraft(item.storedDocumentId,item.type),known=af.results.get(item.id)?.reviewContext||{},values={...old};
     for(const [key,value]of readableDates)if(!Object.hasOwn(old,key)&&!known[key])values[key]=value;
     if(ServerDrafts.setDocumentReviewDraft(item.storedDocumentId,item.type,values)!==false)await window.DocumentReview?.open(item.storedDocumentId);
    };root.append(datesButton);
   }
  }
  const facts=(suggestion.facts||[]).filter(f=>fieldMap[f.key]).map(fact=>({fact}));
  for(const credit of suggestion.credits||[])for(const fact of credit.facts||[])if(loanMap[fact.key])facts.push({fact,credit});
  if(!facts.length)return;
  const details=make('details'),summary=make('summary','Данные для профиля — сверьте с оригиналом');details.append(summary);
  for(const {fact,credit}of facts.slice(0,120)){
   const row=make('div',null,'ocr-fact'),label=(credit?loanMap:fieldMap)[fact.key][1];
   row.append(make('span',(credit?'Договор '+credit.contractNumber+' · ':'')+label+': '),make('strong',String(fact.value)));
   const show=make('button','Стр. '+fact.page,'btn btn-ghost');show.type='button';show.onclick=()=>{if(active(ctx,epoch,item))source(item,fact.page);};row.append(show);
   const input=targetFor(fact,credit);
   // Never silently replace an answer, select an owner, add loans or approve OCR.
   if(input&&!input.value&&!input.disabled&&input.type!=='hidden'){
    const put=make('button','Вставить в пустое поле','btn btn-ghost');put.type='button';
    put.onclick=()=>{if(!active(ctx,epoch,item)||!window.ServerDrafts?.canSwitch()||!input.isConnected||input.value||input.disabled||targetFor(fact,credit)!==input)return;
     if(input.tagName==='SELECT'&&![...input.options].some(o=>o.value===fact.value))return;
     input.value=String(fact.value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));put.disabled=true;put.textContent='Подставлено — проверьте';};row.append(put);
   }
   details.append(row);
  }root.append(details);
 }
 function draw(){
  const items=candidates();panel.hidden=!items.length;if(!items.length)return;
  toggle.textContent=paused?'Продолжить чтение':'Пауза';
  if(!busy)status.textContent=paused?'Пауза. Уже прочитанные страницы сохранены.':items.every(item=>records.get(item.storedDocumentId)?.pendingPages?.length===0)?'Чтение завершено. Сохранённый текст доступен всем сотрудникам.':'Сканы читаются в фоне. Ответы можно заполнять сейчас.';
  list.replaceChildren();const ctx=current(),epoch=generation;
  for(const item of items){
   const data=records.get(item.storedDocumentId),box=make('details'),title=make('summary',item.file.name);box.append(title);
   if(!data){box.append(make('p','Ожидает чтения…'));list.append(box);continue;}
   const completed=data.completedPages||[];
   box.append(make('p',data.error||'Прочитано '+completed.length+' из '+data.eligiblePages.length+' страниц'+(data.lease&&!data.lease.mine?' · читает '+(data.lease.displayName||'другой сотрудник'):''),'hint'));
   if(data.error){const retry=make('button','Повторить','btn btn-ghost');retry.type='button';retry.onclick=()=>{if(!active(ctx,epoch,item))return;records.delete(item.storedDocumentId);paused=false;schedule(0);};box.append(retry);}
   for(const saved of completed){
    const page=typeof saved==='number'?saved:saved.page,details=make('details'),caption=make('summary','Страница '+page+(saved.state==='needs_manual'?' · прочитана частично, проверьте вручную':' · сохранена'));details.append(caption);
    details.addEventListener('toggle',async()=>{
     if(!details.open||details.dataset.loaded||!active(ctx,epoch,item))return;details.dataset.loaded='loading';
     const text=make('textarea');text.readOnly=true;text.rows=8;text.setAttribute('aria-label','Распознанный текст страницы '+page);details.append(text);
     const show=make('button','Сверить с оригиналом','btn btn-ghost');show.type='button';show.onclick=()=>{if(active(ctx,epoch,item))source(item,page);};details.append(show);
     try{const response=pinned(ctx,item,await api(path(ctx,item)+'?page='+page+'&suggestions=0'),data);if(!active(ctx,epoch,item))return;const result=response.pages?.find(p=>p.page===page)||response.page;text.value=result?.text||'Текст не распознан. Проверьте страницу вручную.';details.dataset.loaded='yes';}
     catch(error){text.value=error.message;delete details.dataset.loaded;}
    });box.append(details);
   }
   drawSuggestions(box,item,data,ctx,epoch);list.append(box);
  }
 }
 function schedule(delay=350){clearTimeout(timer);timer=setTimeout(()=>{void run();},delay);}
 async function stop(){
  controller?.abort();runtime?.dispose();runtime=null;
  const lease=activeLease;activeLease=null;
  if(lease)try{await api(lease.url,{...lease.body,action:'release'});}catch{/* Expiry allows a safe takeover even if release loses its response. */}
 }
 async function loadPdf(ctx,item,data,signal){
  const response=await fetch('/api/assessment/'+encodeURIComponent(ctx.client.external.dealId)+'/documents/'+encodeURIComponent(item.storedDocumentId)+'?view=pdf',{credentials:'same-origin',cache:'no-store',signal});
  if(!response.ok||response.redirected)throw Error('Не удалось открыть скан. Проверьте вход.');
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>35*1024*1024)throw Error('Скан превышает 35 МБ.');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==data.pdfSha256)throw Error('Файл изменился. Чтение остановлено.');
  const type=response.headers.get('content-type')?.split(';')[0];
  if(['image/jpeg','image/png'].includes(type))return{image:new Blob([bytes],{type}),dispose:async()=>{}};
  const pdfjs=await import('/pdf-assets/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/pdf-assets/pdf.worker.mjs';
  const loading=pdfjs.getDocument({data:bytes,cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',wasmUrl:'/pdf-assets/wasm/',isEvalSupported:false,useSystemFonts:false});
  const abort=()=>{void loading.destroy();};signal.addEventListener('abort',abort,{once:true});
  try{const pdf=await loading.promise;if(pdf.numPages!==data.totalPages)throw Error('Число страниц изменилось.');return{pdf,dispose:async()=>{signal.removeEventListener('abort',abort);await loading.destroy();}};}
  catch(error){signal.removeEventListener('abort',abort);await loading.destroy();throw error;}
 }
 async function pageImage(pdf,pageNumber,signal){
  const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1}),view=page.getViewport({scale:Math.min(2.5,2400/Math.max(base.width,base.height),Math.sqrt(4_000_000/(base.width*base.height)))});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
  const rendering=page.render({canvasContext:canvas.getContext('2d'),viewport:view}),abort=()=>rendering.cancel();signal.addEventListener('abort',abort,{once:true});
  try{await rendering.promise;return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);}
  finally{signal.removeEventListener('abort',abort);page.cleanup();canvas.width=canvas.height=0;}
 }
 async function photoImage(blob,signal){
  const bitmap=await createImageBitmap(blob);
  try{
   if(signal.aborted)throw new DOMException('Остановлено','AbortError');
   const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height),Math.sqrt(4_000_000/(bitmap.width*bitmap.height)));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(bitmap.width*scale));canvas.height=Math.max(1,Math.floor(bitmap.height*scale));
   const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const result=ctx.getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=0;return result;
  }finally{bitmap.close();}
 }
 function normalize(result,page){
  const lines=result.lines.map(line=>{const b=line.bbox||line.box;let bbox;
   if(Array.isArray(b)){const points=Array.isArray(b[0])?b:[[b[0],b[1]],[b[2],b[3]]];bbox={x0:Math.min(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),x1:Math.max(...points.map(p=>p[0])),y1:Math.max(...points.map(p=>p[1]))};}else bbox=b;
   return{text:line.text.normalize('NFKC').trim(),confidence:line.confidence,bbox};});
  return{page,text:lines.map(line=>line.text).join('\n'),lines,confidence:lines.length?lines.reduce((sum,l)=>sum+l.confidence,0)/lines.length:0,width:result.width,height:result.height};
 }
 async function processDocument(ctx,epoch,item,data){
  const localController=new AbortController();controller=localController;const signal=localController.signal,leaseToken=crypto.randomUUID(),body={...identity(ctx,data),leaseToken};let pdf,heartbeat;
  try{
   let claimed;
   try{claimed=await api(path(ctx,item),{...body,action:'claim'},signal);}
   catch(error){
    if(signal.aborted||!active(ctx,epoch,item)||!['REQUEST_TIMEOUT','SERVER_UNAVAILABLE','INVALID_SERVER_RESPONSE',undefined].includes(error.code))throw error;
    pinned(ctx,item,await api(path(ctx,item),undefined,signal),data);
    // Claim is idempotent for this actor and exact token. Retain it after a lost response.
    claimed=await api(path(ctx,item),{...body,action:'claim'},signal);
   }
   pinned(ctx,item,claimed,data);
   if(!claimed.claimed){records.set(item.storedDocumentId,claimed);if(!claimed.pendingPages.length)return;throw Object.assign(Error(message('OCR_LEASE_BUSY')),{code:'OCR_LEASE_BUSY'});}
   activeLease={url:path(ctx,item),body};
   if(!active(ctx,epoch,item)||paused||signal.aborted)return;
   records.set(item.storedDocumentId,claimed);draw();
   heartbeat=setInterval(()=>{void api(path(ctx,item),{...body,action:'renew'},signal).then(value=>pinned(ctx,item,value,data)).catch(()=>localController.abort());},40000);
   if(!runtime){status.textContent='Загружаем модуль чтения сканов. Можно заполнять профиль…';const engine=await import('/browser-ocr-assets/browser-ocr.mjs');runtime=await engine.createBrowserOcr({assetBase:'/browser-ocr-assets/',onProgress:()=>{}});}
   if(!active(ctx,epoch,item)||paused||signal.aborted)return;
   pdf=await loadPdf(ctx,item,data,signal);
   for(const page of claimed.pendingPages||data.pendingPages){
    if(!active(ctx,epoch,item)||paused||signal.aborted)break;
    status.textContent='Читаем страницу '+page+' · '+item.file.name+'. Можно продолжать профиль.';
    const image=pdf.image?await photoImage(pdf.image,signal):await pageImage(pdf.pdf,page,signal),result=await runtime.recognizePage(image,{signal});
    if(result.engineVersion!==data.engineVersion)throw Object.assign(Error(message('OCR_ENGINE_CHANGED')),{code:'OCR_ENGINE_CHANGED'});
    if(!active(ctx,epoch,item)||paused||signal.aborted)break;
    const pageResult=normalize(result,page);let saved;
    try{saved=pinned(ctx,item,await api(path(ctx,item),{...body,action:'page',page:pageResult},signal),data);}
    catch(error){
     if(signal.aborted)throw error;
     // A timeout does not mean failure. Read back the same page before doing more work.
     const readback=pinned(ctx,item,await api(path(ctx,item)+'?page='+page,undefined,signal),data),confirmed=readback.pages?.find(p=>p.page===page)||readback.page;
     if(!confirmed||confirmed.text!==pageResult.text)throw error;saved=readback;
    }
    if(!active(ctx,epoch,item))break;records.set(item.storedDocumentId,saved);draw();
   }
  }finally{clearInterval(heartbeat);await pdf?.dispose();const lease=activeLease;activeLease=null;if(lease)try{await api(lease.url,{...lease.body,action:'release'});}catch{}controller=null;}
 }
 async function run(){
  if(busy){rerun=true;return;}const ctx=current();if(!ctx||!window.ServerDrafts?.canSwitch()||typeof af==='undefined'||af.busy)return;
  if(context!==ctx){context=ctx;records.clear();generation++;}const epoch=generation;busy=true;let waiting=false;
  try{
   for(const item of candidates()){
    if(!active(ctx,epoch,item))break;
    try{
     const data=await api(path(ctx,item));if(!active(ctx,epoch,item))break;
     pinned(ctx,item,data,records.get(item.storedDocumentId));
     records.set(item.storedDocumentId,data);draw();
     if(!data.pendingPages.length)continue;
     if(paused||document.hidden)continue;
     if(data.lease&&!data.lease.mine){waiting=true;continue;}
     await processDocument(ctx,epoch,item,data);
    }catch(error){if(active(ctx,epoch,item)&&!paused&&!document.hidden){const before=records.get(item.storedDocumentId)||{eligiblePages:[],completedPages:[]};records.set(item.storedDocumentId,{...before,error:error.message});if(error.code==='OCR_LEASE_BUSY')waiting=true;}draw();}
   }
  }finally{busy=false;runtime?.dispose();runtime=null;draw();if(current()!==ctx)schedule();else if((waiting||rerun)&&!paused&&!document.hidden)schedule(rerun?0:20000);rerun=false;}
 }
 toggle.onclick=()=>{paused=!paused;if(paused)void stop();else schedule(0);draw();};
 for(const event of ['assessment-analysis-complete','assessment-draft-load-state'])document.addEventListener(event,()=>schedule());
 document.addEventListener('assessment-case-opened',()=>{generation++;context=current();records.clear();panel.hidden=true;void stop();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)void stop();else schedule();});
 window.addEventListener('pagehide',()=>{generation++;void stop();});
 return{refresh:()=>schedule(0),stop,normalize};
})();
