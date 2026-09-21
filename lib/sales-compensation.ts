import type {Actor} from './worker-session';
import {PEOPLE,type Person,type Plan} from './personal-sales';

export class CompensationError extends Error {
  constructor(public code:string,public status=400){super(code);}
}
export type PaymentInput={kind:'payment';requestId:string;person:Person;month:string;amount:number;paidAt:string;note:string};
export type PlanInput={kind:'plan';requestId:string;person:Person;start:string;end:string;metric:'count'|'volume';target:number;baseRate:number;targetRate:number};
export type PaymentRow={id:string;person:Person;month:string;amount:number;paidAt:string;note:string;createdAt:string};
export type PlanRow={id:string;person:Person;start:string;end:string;metric:'count'|'volume';target:number;baseRate:number;targetRate:number;createdAt:string};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const day=(value:unknown)=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'));
const person=(value:unknown):value is Person=>typeof value==='string'&&Object.hasOwn(PEOPLE,value);
const rate=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100&&Math.round(value*100)===value*100;
export function validateCompensation(raw:Record<string,unknown>,today:string):PaymentInput|PlanInput{
  if(!uuid(raw.requestId)||!person(raw.person))throw new CompensationError('INVALID_COMPENSATION');
  if(raw.kind==='payment'){
    if(typeof raw.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month)||raw.month<'2026-06'||raw.month>today.slice(0,7)||
      typeof raw.amount!=='number'||!Number.isSafeInteger(raw.amount)||raw.amount<0||raw.amount>100000000||!day(raw.paidAt)||raw.paidAt>today||
      typeof raw.note!=='string'||raw.note.length>200)throw new CompensationError('INVALID_PAYMENT');
    return {kind:'payment',requestId:raw.requestId as string,person:raw.person,month:raw.month,amount:raw.amount,paidAt:raw.paidAt as string,note:raw.note.trim()};
  }
  if(raw.kind==='plan'){
    if(!day(raw.start)||!day(raw.end)||raw.start<=today||raw.end<raw.start||String(raw.start).slice(0,7)!==String(raw.end).slice(0,7)||
      !['count','volume'].includes(String(raw.metric))||typeof raw.target!=='number'||!Number.isSafeInteger(raw.target)||raw.target<1||raw.target>1000000000||
      !rate(raw.baseRate)||!rate(raw.targetRate))throw new CompensationError('INVALID_PLAN');
    return {kind:'plan',requestId:raw.requestId as string,person:raw.person,start:raw.start as string,end:raw.end as string,metric:raw.metric as PlanInput['metric'],target:raw.target,baseRate:raw.baseRate as number,targetRate:raw.targetRate as number};
  }
  throw new CompensationError('INVALID_COMPENSATION');
}
export function storedPlan(row:PlanRow):Plan{
  return {id:row.id,start:row.start,end:row.end,metric:row.metric,target:row.target,tiers:[[0,row.baseRate],[row.target,row.targetRate]]};
}
export class CompensationRepository{
  constructor(private db:D1Database){}
  async payments(person:Person){
    const rows=await this.db.prepare(`SELECT id,person,month,amount_tenge AS amount,paid_at AS paidAt,note,created_at AS createdAt FROM sales_payments WHERE person=? ORDER BY paid_at DESC,rowid DESC`).bind(person).all<PaymentRow>();
    return rows.results;
  }
  async plans(person:Person){
    const rows=await this.db.prepare(`SELECT id,person,start_date AS start,end_date AS end,metric,target,base_rate AS baseRate,target_rate AS targetRate,created_at AS createdAt FROM sales_plans WHERE person=? ORDER BY start_date`).bind(person).all<PlanRow>();
    return rows.results;
  }
  async create(input:PaymentInput|PlanInput,actor:Actor,now=new Date().toISOString()){
    if(actor.worker!=='ali')throw new CompensationError('ROP_REQUIRED',403);
    const table=input.kind==='payment'?'sales_payments':'sales_plans';
    const existing=await this.db.prepare(`SELECT id FROM ${table} WHERE actor_id=? AND request_id=?`).bind(actor.id,input.requestId).first<{id:string}>();
    if(existing)return existing;
    const id=crypto.randomUUID();
    if(input.kind==='payment'){
      await this.db.prepare(`INSERT INTO sales_payments (id,request_id,person,month,amount_tenge,paid_at,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(actor_id,request_id) DO NOTHING`)
        .bind(id,input.requestId,input.person,input.month,input.amount,input.paidAt,input.note,actor.id,now).run();
    }else{
      const historicEnd='2026-09-30';
      if(input.start<=historicEnd)throw new CompensationError('PLAN_OVERLAPS_EXISTING',409);
      const result=await this.db.prepare(`INSERT INTO sales_plans (id,request_id,person,start_date,end_date,metric,target,base_rate,target_rate,actor_id,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM sales_plans WHERE person=? AND start_date<=? AND end_date>=?)
        ON CONFLICT(actor_id,request_id) DO NOTHING`).bind(id,input.requestId,input.person,input.start,input.end,input.metric,input.target,input.baseRate,input.targetRate,actor.id,now,input.person,input.end,input.start).run();
      if(!result.meta.changes){
        const retry=await this.db.prepare('SELECT id FROM sales_plans WHERE actor_id=? AND request_id=?').bind(actor.id,input.requestId).first<{id:string}>();
        if(retry)return retry;
        throw new CompensationError('PLAN_OVERLAPS_EXISTING',409);
      }
    }
    return await this.db.prepare(`SELECT id FROM ${table} WHERE actor_id=? AND request_id=?`).bind(actor.id,input.requestId).first<{id:string}>()??{id};
  }
}
export async function compensationRepository(){
  const {env}=await import('cloudflare:workers');
  const db=(env as typeof env&{DB?:D1Database}).DB;
  if(!db)throw new CompensationError('COMPENSATION_STORAGE_UNAVAILABLE',503);
  return new CompensationRepository(db);
}
