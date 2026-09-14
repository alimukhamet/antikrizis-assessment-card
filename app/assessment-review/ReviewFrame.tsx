'use client';
import {useSyncExternalStore} from 'react';
const subscribe=(notify:()=>void)=>{window.addEventListener('popstate',notify);return()=>window.removeEventListener('popstate',notify);};
export function ReviewFrame({initialDealId}:{initialDealId:string}){
 const candidate=useSyncExternalStore(subscribe,()=>new URLSearchParams(window.location.search).get('dealId')||'',()=>initialDealId);
 const id=/^[1-9]\d*$/.test(candidate)?candidate:'';
 return <iframe className="tool-frame" src={'/questionnaire.html'+(id?'?dealId='+id:'')} title="Оценка клиента из документов"/>;
}
