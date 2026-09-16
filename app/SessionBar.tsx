'use client';
import {useState} from 'react';
import Link from 'next/link';
export function SessionBar({name,showToolsLink=false}:{name:string;showToolsLink?:boolean}){
 const[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function logout(){
  if(busy)return;
  setError('');setBusy(true);
  try{
   const r=await fetch('/api/session',{method:'DELETE',signal:AbortSignal.timeout(15000),cache:'no-store'});
   if(!r.ok)throw Error();
   // Full navigation drops all in-memory data belonging to the previous employee.
   // eslint-disable-next-line @next/next/no-location-assign-relative-destination
   window.location.assign('/login');
  }catch{setError('Не удалось выйти. Повторите.');setBusy(false);}
 }
 return <div className="session-bar">
  {showToolsLink?<Link className="session-tools-link" href="/">← Инструменты</Link>:null}
  <span>{name}</span>
  {error?<span role="alert">{error}</span>:null}
  <button type="button" disabled={busy} onClick={logout}>{busy?'Выходим…':'Выйти'}</button>
 </div>;
}
