'use client';
import {useSyncExternalStore} from 'react';
const subscribe=(notify:()=>void)=>{window.addEventListener('popstate',notify);return()=>window.removeEventListener('popstate',notify);};
export function ReviewFrame({initialDealId,mode='contract'}:{initialDealId:string;mode?:'contract'|'handoff'}){
 const candidate=useSyncExternalStore(subscribe,()=>new URLSearchParams(window.location.search).get('dealId')||'',()=>initialDealId);
 const id=/^[1-9]\d*$/.test(candidate)?candidate:'';
 const query=new URLSearchParams();if(id)query.set('dealId',id);if(mode==='handoff')query.set('mode','handoff');
 return <iframe className="tool-frame" src={'/questionnaire.html'+(query.size?'?'+query:'')} title={mode==='handoff'?'Передача клиента юристам':'Договор и карточка клиента'}/>;
}
