/* Profile-only presence. No client answers or documents are changed here. */
window.ProfilePresence=(()=>{
 if(new URLSearchParams(location.search).get('mode')!=='profile')return null;
 const tabId=crypto.randomUUID(),IDLE_MS=10*60*1000;
 let dealId='',lastActive=Date.now(),stopped=false,pending=false;
 const banner=document.createElement('div');banner.id='profilePresence';banner.setAttribute('role','status');
 banner.style.cssText='padding:10px 16px;margin:10px 0;border:1px solid #c9d9ec;border-radius:10px;background:#eef4fc;color:#244d78;font:14px/1.5 system-ui';
 banner.hidden=true;
 async function send(action,id=dealId,keepalive=false){
  return fetch('/api/profile-activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,dealId:id,tabId}),cache:'no-store',keepalive});
 }
 async function release(id=dealId){if(id)try{await send('release',id,true);}catch{/* Expiry removes a disconnected tab. */}}
 async function heartbeat(){
  if(!dealId||stopped||pending)return;
  if(Date.now()-lastActive>IDLE_MS){await release();banner.hidden=true;return;}
  pending=true;const id=dealId;
  try{
   const response=await send('heartbeat',id);if(!response.ok)throw Error('ACTIVITY_UNAVAILABLE');
   const activity=await response.json();if(id!==dealId||stopped)return;
   const others=activity.active.filter(s=>s.dealId===id&&s.workerId!==activity.currentWorker);
   banner.replaceChildren();banner.hidden=false;
   banner.append(document.createTextNode(others.length?'Этот профиль также открыт у: '+others.map(s=>s.workerName).join(', ')+'. Выберите свободный профиль, чтобы не заполнять его вдвоём. ':'В работе у вас. Остальные сотрудники видят ваш статус. '));
   const link=document.createElement('a');link.href='/profile-backfill';link.target='_top';link.textContent='К списку профилей';banner.append(link);
  }catch{if(id===dealId&&!stopped){banner.textContent='Не удалось обновить статус «В работе». Проверьте список перед совместным заполнением.';banner.hidden=false;}}
  finally{pending=false;}
 }
 function start(id){
  if(!/^[1-9]\d*$/.test(id))return;
  // A verified profile save pauses this tab's presence. Reopening the same
  // profile for corrections must claim it again without changing the deal.
  if(id===dealId&&!stopped){lastActive=Date.now();if(banner.hidden)void heartbeat();return;}
  if(dealId&&id!==dealId)void release(dealId);
  dealId=id;stopped=false;lastActive=Date.now();
  const step=document.getElementById('documentStep');
  (step?.parentElement||document.body).insertBefore(banner,step||null);
  void heartbeat();
 }
 function resume(id=dealId){start(id);}
 function active(){const idle=Date.now()-lastActive>IDLE_MS;lastActive=Date.now();if(idle)void heartbeat();}
 for(const event of ['pointerdown','keydown','input'])document.addEventListener(event,active,{passive:true});
 window.addEventListener('focus',()=>{active();void heartbeat();});
 window.addEventListener('pageshow',()=>{active();void heartbeat();});
 window.addEventListener('pagehide',()=>void release());
 document.addEventListener('profile-backfill-saved',()=>{stopped=true;banner.hidden=true;void release();});
 document.addEventListener('profile-backfill-editing',()=>{if(dealId)resume(dealId);});
 setInterval(()=>void heartbeat(),30000);
 // ProfileBackfill starts presence only after the case and saved draft load.
 // A URL alone may name a missing/inaccessible case and must not occupy it.
 return {start,resume,release};
})();
