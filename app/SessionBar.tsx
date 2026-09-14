'use client';
import {useState} from 'react';
export function SessionBar({name}:{name:string}){const[error,setError]=useState(''),[busy,setBusy]=useState(false);async function logout(){setBusy(true);try{const r=await fetch('/api/session',{method:'DELETE'});if(!r.ok)throw Error();window.location.assign('/login');}catch{setError('Не удалось выйти. Повторите.');setBusy(false);}}return <div className="session-bar"><span>{name}</span>{error?<span role="alert">{error}</span>:null}<button type="button" disabled={busy} onClick={logout}>{busy?'Выходим…':'Выйти'}</button></div>;}
