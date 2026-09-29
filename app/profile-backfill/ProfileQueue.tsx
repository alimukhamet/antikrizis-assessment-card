'use client';
import {useEffect,useState} from 'react';
import type {ProfileActivity} from '../../lib/questionnaire/profile-activity';

type Item={dealId:string;title:string;stageName:string;zviDate:string;procedure:string;hasIin:boolean;hasLegacyCard:boolean;profileSavedAt:string};
type Filter='todo'|'active'|'done'|'all';

const date=(value:string)=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleDateString('ru-RU'):'—';};
const open=(id:string)=>`/profile-backfill?dealId=${encodeURIComponent(id)}`;

export function ProfileQueue(){
 const[items,setItems]=useState<Item[]|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState<Filter>('todo'),[query,setQuery]=useState(''),[reload,setReload]=useState(0);
 const[activity,setActivity]=useState<ProfileActivity|null>(null),[activityReady,setActivityReady]=useState(false),[activityError,setActivityError]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/profile-queue',{cache:'no-store',signal:controller.signal})
   .then(async r=>{const body=await r.json() as {items:Item[];error?:string};if(!r.ok)throw Error(body.error||'PROFILE_QUEUE_UNAVAILABLE');setItems(body.items);setError('');})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message==='SIGN_IN_REQUIRED'?'Войдите заново.':'Не удалось загрузить сделки из Bitrix. Повторите.');});
  return()=>controller.abort();
 },[reload]);
 useEffect(()=>{
  const controller=new AbortController();let pending=false;
  const refresh=async()=>{
   if(pending||document.visibilityState==='hidden')return;pending=true;
   try{
    const response=await fetch('/api/profile-activity',{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('ACTIVITY_UNAVAILABLE');
    const body=await response.json() as ProfileActivity;
    if(!controller.signal.aborted){setActivity(body);setActivityReady(true);setActivityError(false);}
   }catch{if(!controller.signal.aborted){setActivityReady(false);setActivityError(true);}}
   finally{pending=false;}
  };
  void refresh();const timer=setInterval(()=>void refresh(),15000);
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[reload]);
 const completed=new Map(activity?.completed.map(s=>[s.dealId,`${s.savedAt} · ${s.workerName}`]));
 const rows=(items||[]).map(item=>({...item,profileSavedAt:activity?completed.get(item.dealId)||'':item.profileSavedAt}));
 const activeFor=(id:string)=>activityReady?activity?.active.filter(s=>s.dealId===id)||[]:[];
 const done=rows.filter(i=>i.profileSavedAt).length,total=rows.length;
 const next=activityReady?rows.find(i=>!i.profileSavedAt&&!activeFor(i.dealId).length):null;
 const q=query.trim().toLocaleLowerCase('ru-RU');
 const visible=rows.filter(i=>(filter==='all'||(filter==='active'?activeFor(i.dealId).length>0:(filter==='done')===Boolean(i.profileSavedAt)))&&(!q||(i.title+' '+i.dealId).toLocaleLowerCase('ru-RU').includes(q)));
 return <section className="profile-queue" aria-labelledby="profileQueueTitle">
  <header className="profile-queue-head">
   <div>
    <h1 id="profileQueueTitle">Дозаполнить профили клиентов</h1>
    <p>Сделки на стадиях «ЗВИ» и «В ожидании». Заполните профиль так, как это сделали бы продажи: документы из сделки подтянутся автоматически, вам останется проверить ответы и заполнить пропуски.</p>
   </div>
   {next?<a className="profile-queue-next" href={open(next.dealId)}>Начать: {next.title||'Сделка № '+next.dealId} →</a>:null}
  </header>
  {items?<div className="profile-queue-progress" role="status">
   <strong>{done} из {total}</strong><span>профилей заполнено</span>
   <progress value={done} max={Math.max(total,1)}/>
  </div>:null}
  {activity?<section className="profile-team" aria-label="Статистика сотрудников">
   <h2>Заполнено по сотрудникам</h2>
   <div className="profile-team-grid">{activity.workers.map(worker=><div key={worker.workerId} className="profile-team-worker">
    <span>{worker.workerName}</span><strong>{worker.done}</strong>
    {activityReady&&worker.inProgress>0?<small>В работе: {worker.inProgress}</small>:null}
   </div>)}</div>
   <p>Один клиент — один заполненный профиль. Возвращённые на исправление не учитываются.</p>
  </section>:null}
  {activityError?<p className="profile-queue-error" role="status">Не удалось обновить, кто сейчас работает. <button type="button" onClick={()=>setReload(n=>n+1)}>Обновить</button></p>:!activityReady?<p role="status">Проверяем, кто сейчас работает…</p>:null}
  <div className="profile-queue-tools">
   <div role="group" aria-label="Фильтр">
    {([['todo','Не заполнены'],['active','В работе'],['done','Заполнены'],['all','Все']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}
   </div>
   <input type="search" placeholder="Имя клиента или номер сделки" aria-label="Найти сделку" value={query} onChange={e=>setQuery(e.target.value)} maxLength={80}/>
  </div>
  {error?<p className="profile-queue-error" role="alert">{error} <button type="button" onClick={()=>setReload(n=>n+1)}>Повторить</button></p>:null}
  {!items&&!error?<p role="status">Загружаем сделки из Bitrix…</p>:null}
  {items&&!visible.length?<p className="profile-queue-empty">{filter==='todo'?'Все профили в этом списке заполнены.':'Совпадений нет.'}</p>:null}
  <ol className="profile-queue-list">
   {visible.map(item=>{const active=activeFor(item.dealId),other=active.some(s=>s.workerId!==activity?.currentWorker);return <li key={item.dealId}>
    <a href={other?undefined:open(item.dealId)} aria-disabled={other||undefined} title={other?'Профиль уже заполняет другой сотрудник':undefined}>
     <span className="profile-queue-name"><strong>{item.title||'Сделка № '+item.dealId}</strong><small>№ {item.dealId} · {item.stageName} · ЗВИ: {date(item.zviDate)}{item.procedure?' · '+item.procedure:''}</small></span>
     <span className={'profile-queue-state'+(active.length?' is-active':item.profileSavedAt?' is-done':!item.hasIin?' is-warning':'')}>{active.length?'В работе: '+active.map(s=>s.workerName).join(', '):item.profileSavedAt?'Заполнен '+date(item.profileSavedAt.split(' · ')[0]):!item.hasIin?'ИИН подтвердить по ГКБ':item.hasLegacyCard?'Есть старая карточка':'Не заполнен'}</span>
    </a>
   </li>;})}
  </ol>
 </section>;
}
