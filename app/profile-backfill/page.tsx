import {ReviewFrame} from '../assessment-review/ReviewFrame';
import {SessionBar} from '../SessionBar';
import {ProfileQueue} from './ProfileQueue';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSessionCookie,verifySession} from '../../lib/worker-session';
/** One-time backfill: the documentologist completes the client profile for ЗВИ / В ожидании deals. */
export default async function ProfileBackfillPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const params=await searchParams,id=typeof params.dealId==='string'&&/^[1-9]\d*$/.test(params.dealId)?params.dealId:'';
 const h=await headers(),actor=await verifySession(readSessionCookie(h.get('cookie')),process.env.SITE_SESSION_TOKEN??'');
 if(!actor)redirect('/login?returnTo='+encodeURIComponent('/profile-backfill'+(id?'?dealId='+id:'')));
 return <main className="tool-shell"><SessionBar name={actor.displayName} showToolsLink/>{id?<ReviewFrame initialDealId={id} mode="profile"/>:<ProfileQueue/>}</main>;
}
