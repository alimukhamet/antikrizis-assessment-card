'use client';
import {useEffect,useState} from 'react';

type Item={dealId:string;title:string;stageName:string;zviDate:string;procedure:string;hasIin:boolean;hasLegacyCard:boolean;profileSavedAt:string};
type Filter='todo'|'done'|'all';
type FieldState={fields:{fieldName:string;label:string;exists:boolean}[];canCreate:boolean;error?:string};

const date=(value:string)=>{const t=Date.parse(value);return Number.isFinite(t)?new Date(t).toLocaleDateString('ru-RU'):'—';};
const open=(id:string)=>`/profile-backfill?dealId=${encodeURIComponent(id)}`;

export function ProfileQueue(){
 const[items,setItems]=useState<Item[]|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState<Filter>('todo'),[query,setQuery]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/profile-queue',{cache:'no-store',signal:controller.signal})
   .then(async r=>{const body=await r.json() as {items:Item[];error?:string};if(!r.ok)throw Error(body.error||'PROFILE_QUEUE_UNAVAILABLE');setItems(body.items);setError('');})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message==='SIGN_IN_REQUIRED'?'Войдите заново.':'Не удалось загрузить сделки из Bitrix. Повторите.');});
  return()=>controller.abort();
 },[reload]);
 const[fields,setFields]=useState<FieldState|null>(null),[creating,setCreating]=useState(false);
 useEffect(()=>{fetch('/api/profile-fields',{cache:'no-store'}).then(r=>r.json() as Promise<FieldState>).then(setFields).catch(()=>setFields(null));},[]);
 async function createFields(){
  setCreating(true);
  try{const r=await fetch('/api/profile-fields',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});setFields(await r.json() as FieldState);}
  catch{setFields(f=>f?{...f,error:'BITRIX_REQUEST_FAILED'}:f);}finally{setCreating(false);}
 }
 const missingFields=fields?.fields?.filter(f=>!f.exists)??[];
 const done=items?.filter(i=>i.profileSavedAt).length??0,total=items?.length??0;
 const next=items?.find(i=>!i.profileSavedAt);
 const q=query.trim().toLocaleLowerCase('ru-RU');
 const visible=(items||[]).filter(i=>(filter==='all'||(filter==='done')===Boolean(i.profileSavedAt))&&(!q||(i.title+' '+i.dealId).toLocaleLowerCase('ru-RU').includes(q)));
 return <section className="profile-queue" aria-labelledby="profileQueueTitle">
  <header className="profile-queue-head">
   <div>
    <h1 id="profileQueueTitle">Дозаполнить профили клиентов</h1>
    <p>Сделки на стадиях «ЗВИ» и «В ожидании». Заполните профиль так, как это сделали бы продажи: документы из сделки подтянутся автоматически, вам останется проверить ответы и заполнить пропуски.</p>
   </div>
   {next?<a className="profile-queue-next" href={open(next.dealId)}>Начать: {next.title||'Сделка № '+next.dealId} →</a>:null}
  </header>
  {missingFields.length||fields?.error?<div className="profile-queue-error" role="alert">
   <p>{fields?.error==='BITRIX_ADMIN_RIGHTS_REQUIRED'?'Вебхуку Bitrix не хватает прав администратора для создания полей.':fields?.error?'Не удалось проверить поля профиля в Bitrix.':'В Bitrix нет полей профиля: '+missingFields.map(f=>f.label).join(', ')+'. Пока их нет, профиль нельзя сохранить.'}</p>
   {fields?.canCreate&&missingFields.length?<button type="button" disabled={creating} onClick={createFields}>{creating?'Создаём…':'Создать поля в Bitrix'}</button>:missingFields.length?<p>Попросите администратора открыть эту страницу и создать поля.</p>:null}
  </div>:null}
  {items?<div className="profile-queue-progress" role="status">
   <strong>{done} из {total}</strong><span>профилей заполнено</span>
   <progress value={done} max={Math.max(total,1)}/>
  </div>:null}
  <div className="profile-queue-tools">
   <div role="group" aria-label="Фильтр">
    {([['todo','Не заполнены'],['done','Заполнены'],['all','Все']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}
   </div>
   <input type="search" placeholder="Имя клиента или номер сделки" aria-label="Найти сделку" value={query} onChange={e=>setQuery(e.target.value)} maxLength={80}/>
  </div>
  {error?<p className="profile-queue-error" role="alert">{error} <button type="button" onClick={()=>setReload(n=>n+1)}>Повторить</button></p>:null}
  {!items&&!error?<p role="status">Загружаем сделки из Bitrix…</p>:null}
  {items&&!visible.length?<p className="profile-queue-empty">{filter==='todo'?'Все профили в этом списке заполнены.':'Совпадений нет.'}</p>:null}
  <ol className="profile-queue-list">
   {visible.map(item=><li key={item.dealId}>
    <a href={open(item.dealId)}>
     <span className="profile-queue-name"><strong>{item.title||'Сделка № '+item.dealId}</strong><small>№ {item.dealId} · {item.stageName} · ЗВИ: {date(item.zviDate)}{item.procedure?' · '+item.procedure:''}</small></span>
     <span className={'profile-queue-state'+(item.profileSavedAt?' is-done':!item.hasIin?' is-warning':'')}>{item.profileSavedAt?'Заполнен '+date(item.profileSavedAt.split(' · ')[0]):!item.hasIin?'ИИН подтвердить по ГКБ':item.hasLegacyCard?'Есть старая карточка':'Не заполнен'}</span>
    </a>
   </li>)}
  </ol>
 </section>;
}
