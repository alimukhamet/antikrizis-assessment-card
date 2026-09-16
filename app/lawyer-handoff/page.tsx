import {ReviewFrame} from '../assessment-review/ReviewFrame';
import {SessionBar} from '../SessionBar';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSessionCookie,verifySession} from '../../lib/worker-session';
export default async function LawyerHandoffPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,id=typeof params.dealId==='string'&&/^[1-9]\d*$/.test(params.dealId)?params.dealId:'';
 const h=await headers(),actor=await verifySession(readSessionCookie(h.get('cookie')),process.env.SITE_SESSION_TOKEN??'');
 if(!actor)redirect('/login?returnTo='+encodeURIComponent('/lawyer-handoff'+(id?'?dealId='+id:'')));
 return <main className="tool-shell"><SessionBar name={actor.displayName} showToolsLink/><ReviewFrame initialDealId={id} mode="handoff"/></main>;
}
