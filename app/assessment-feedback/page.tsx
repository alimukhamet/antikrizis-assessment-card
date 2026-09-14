import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readSessionCookie,verifySession} from '../../lib/worker-session';
import {SessionBar} from '../SessionBar';
import {FeedbackInbox} from './FeedbackInbox';
export const dynamic='force-dynamic';
export default async function FeedbackPage(){
 const h=await headers(),actor=await verifySession(readSessionCookie(h.get('cookie')),process.env.SITE_SESSION_TOKEN??'');
 if(!actor)redirect('/login?returnTo=%2Fassessment-feedback');
 return <main className="personal-page"><SessionBar name={actor.displayName}/><FeedbackInbox allWorkers={actor.worker==='ali'}/></main>;
}
