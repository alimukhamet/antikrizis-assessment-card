'use client';
import {useState,useEffect} from 'react';
import Link from 'next/link';
import type {FeedbackRow} from '../../lib/tool-feedback';
import {AutomaticIncidents} from './AutomaticIncidents';
const stages={documents:'Документы',answers:'Ответы',contract:'Договор'};
async function readReports(before:string|null=null){
 const r=await fetch('/api/tool-feedback'+(before?'?before='+encodeURIComponent(before):''),{cache:'no-store'});
 if(!r.ok)throw Error();
 const data=await r.json() as {items:FeedbackRow[];nextCursor:string|null};
 if(!Array.isArray(data.items))throw Error();
 return data;
}
export function FeedbackInbox({allWorkers}:{allWorkers:boolean}){
 const [rows,setRows]=useState<FeedbackRow[]>([]),[cursor,setCursor]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(before:string|null=null){
  setBusy(true);setError('');
  try{const data=await readReports(before);setRows(old=>before?[...old,...data.items]:data.items);setCursor(data.nextCursor);setLoaded(true);}
  catch{setError('Не удалось загрузить сообщения. Повторите.');}finally{setBusy(false);}
 }
 useEffect(()=>{let active=true;readReports().then(data=>{if(active){setRows(data.items);setCursor(data.nextCursor);setLoaded(true);}}).catch(()=>{if(active)setError('Не удалось загрузить сообщения. Повторите.');});return()=>{active=false;};},[]);
 return <div className="ps-wrap feedback-inbox">
  <Link href="/" className="ps-back">← Инструменты</Link>
  <header className="ps-header"><div><h1>Сообщения об ошибках</h1><p>{allWorkers?'От сотрудников':'Ваши сообщения'}</p></div><a href="/api/tool-feedback?format=ndjson" download>Выгрузить</a></header>
  {allWorkers?<AutomaticIncidents/>:null}
  {error?<div role="alert" className="ps-empty"><p>{error}</p><button disabled={busy} onClick={()=>load(loaded?cursor:null)}>Повторить</button></div>:null}
  {!loaded&&!error?<p role="status">Загрузка…</p>:null}
  {loaded&&!rows.length?<div className="ps-empty">Пока нет сообщений.</div>:null}
  {rows.map(row=><article className="ps-current feedback-item" key={row.id}>
   <div className="ps-row-top"><strong>{row.actor_name}</strong><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString('ru-RU',{timeZone:'Asia/Almaty',dateStyle:'short',timeStyle:'short'})}</time></div>
   <p className="ps-sub">{row.deal_id?<><a href={'/assessment-review?dealId='+encodeURIComponent(row.deal_id)}>Сделка {row.deal_id}</a> · </>:null}{stages[row.step]}{row.field_label?' · '+row.field_label:''}</p>
   <p className="feedback-message">{row.message}</p>
   <details className="ps-details"><summary>Данные сообщения</summary><p>№ {row.id}<br/>Версия: {row.client_version}{row.server_version!==row.client_version?' / '+row.server_version:''}{row.field_id?<><br/>Вопрос: {row.field_id}</>:null}</p></details>
  </article>)}
  {cursor?<button className="feedback-more" disabled={busy} onClick={()=>load(cursor)}>{busy?'Загрузка…':'Показать ещё'}</button>:null}
 </div>;
}
