import { RepositoryError } from '../documents/repository';
import { WORKERS, type Actor } from '../worker-session';
import { ProfileSaveRepository } from './profile-save-repository';

export const PROFILE_PRESENCE_MS = 120_000;
export type ProfileActivity = {
 currentWorker: string;
 active: Array<{dealId:string;workerId:string;workerName:string;expiresAt:string}>;
 completed: Array<{dealId:string;workerId:string;workerName:string;savedAt:string}>;
 workers: Array<{workerId:string;workerName:string;done:number;inProgress:number}>;
};
const name = (id:string) => (WORKERS as Record<string,string>)[id] || id;

export class ProfileActivityRepository {
 constructor(private db:D1Database) {}

 async read(currentWorker:string, now=new Date().toISOString()):Promise<ProfileActivity> {
  const [presence,completed]=await Promise.all([
   this.db.prepare(`SELECT deal_id,actor_id,MAX(expires_at) AS expires_at FROM assessment_profile_presence
    WHERE expires_at>? GROUP BY deal_id,actor_id ORDER BY deal_id,actor_id`).bind(now)
    .all<{deal_id:string;actor_id:string;expires_at:string}>(),
   new ProfileSaveRepository(this.db).completedByDeal(WORKERS),
  ]);
  const active=presence.results.map(row=>({dealId:row.deal_id,workerId:row.actor_id.replace(/^worker:/,''),workerName:name(row.actor_id.replace(/^worker:/,'')),expiresAt:row.expires_at}));
  const workerIds=new Set([...Object.keys(WORKERS),...completed.map(s=>s.workerId),...active.map(s=>s.workerId)]);
  const workers=[...workerIds].map(workerId=>({workerId,workerName:name(workerId),done:completed.filter(s=>s.workerId===workerId).length,inProgress:active.filter(s=>s.workerId===workerId).length}));
  return {currentWorker,active,completed,workers};
 }

 async update(actor:Actor,body:Record<string,unknown>,now=Date.now()) {
  const {tabId,dealId,action}=body;
  if(typeof tabId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(tabId)
   ||typeof dealId!=='string'||!/^[1-9]\d{0,11}$/.test(dealId)||!['heartbeat','release'].includes(String(action)))
   throw new RepositoryError('INVALID_PROFILE_ACTIVITY',400);
  if(action==='release') {
   await this.db.prepare('DELETE FROM assessment_profile_presence WHERE id=? AND deal_id=? AND actor_id=?').bind(tabId,dealId,actor.id).run();
  } else {
   const at=new Date(now).toISOString(),expires=new Date(now+PROFILE_PRESENCE_MS).toISOString();
   await this.db.batch([
    this.db.prepare('DELETE FROM assessment_profile_presence WHERE expires_at<=?').bind(at),
    this.db.prepare(`INSERT INTO assessment_profile_presence(id,deal_id,actor_id,updated_at,expires_at) VALUES(?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,expires_at=excluded.expires_at
     WHERE assessment_profile_presence.actor_id=excluded.actor_id AND assessment_profile_presence.deal_id=excluded.deal_id`)
     .bind(tabId,dealId,actor.id,at,expires),
   ]);
  }
 }
}
