'use client';
import {useSyncExternalStore} from 'react';
const subscribe=(notify:()=>void)=>{window.addEventListener('popstate',notify);return()=>window.removeEventListener('popstate',notify);};
export function ReviewFrame({initialDealId,mode='contract',editProfile=false}:{initialDealId:string;mode?:'contract'|'handoff'|'profile';editProfile?:boolean}){
 const candidate=useSyncExternalStore(subscribe,()=>new URLSearchParams(window.location.search).get('dealId')||'',()=>initialDealId);
 const id=/^[1-9]\d*$/.test(candidate)?candidate:'';
 const query=new URLSearchParams();if(id)query.set('dealId',id);if(mode!=='contract')query.set('mode',mode);
 if(mode==='profile'&&editProfile)query.set('edit','1');
 return <iframe className="tool-frame" src={'/questionnaire.html'+(query.size?'?'+query:'')} title={mode==='handoff'?'Передача клиента юристам':mode==='profile'?'Профиль клиента':'Договор и карточка клиента'}/>;
}
