// Server-only bridge to the canonical Finance register. SELECT only: never
// migrate, refresh clients, mutate receipts, or combine these rows with CRM money.
export type RegisterPaymentEvidence={amount:number|null;date:string;status:'received'|'not_registered'|'review_required';source:'payment_register';entryId:number|null};
type Deal={id:string;serviceType:string};
type Entry={id:number;client_id:number;kind:string;amount_minor:number;currency:string;event_date:string|null;service_type_id:number|null};
const SERVICES:Record<string,number>={'199':187,'201':189,'203':191,'205':193};
export async function loadRegisterFirstPayments(deals:Deal[],database?:D1Database):Promise<Map<string,RegisterPaymentEvidence>>{
 const result=new Map<string,RegisterPaymentEvidence>();
 if(!deals.length)return result;
 const expected=new Map(deals.map(deal=>[deal.id,SERVICES[deal.serviceType]]));
 if(expected.size!==deals.length||deals.length>5000||deals.some(deal=>!/^\d+$/.test(deal.id)||!Number.isSafeInteger(Number(deal.id))||Number(deal.id)<=0))throw new Error('Invalid salary payment scope');
 const db=database??((await import('cloudflare:workers')).env as {FINANCE_DB?:D1Database}).FINANCE_DB;
 if(!db)throw new Error('Реестр оплат недоступен. Расчёт зарплаты не обновлён.');
 const active=await db.prepare("SELECT value FROM register_state WHERE key='active'").first<{value:string}>();
 if(active?.value!=='1')throw new Error('Реестр оплат не активен. Расчёт зарплаты не обновлён.');
 for(const deal of deals)result.set(deal.id,{amount:null,date:'',status:'not_registered',source:'payment_register',entryId:null});
 const seen=new Set<number>();
 for(let start=0;start<deals.length;start+=250){
  const ids=deals.slice(start,start+250).map(deal=>Number(deal.id));
  const rows=await db.prepare(`SELECT e.id,e.client_id,e.kind,e.amount_minor,e.currency,e.event_date,e.service_type_id
   FROM register_entries e WHERE e.client_id IN (SELECT value FROM json_each(?))
   AND e.kind='receipt' AND NOT EXISTS (SELECT 1 FROM register_voids v WHERE v.entry_id=e.id)
   ORDER BY CASE WHEN e.event_date IS NULL THEN 1 ELSE 0 END,e.event_date,e.id`).bind(JSON.stringify(ids)).all<Entry>();
  if(!rows.success||!Array.isArray(rows.results))throw new Error('Реестр оплат вернул неполные данные.');
  for(const row of rows.results){
   if(!Number.isSafeInteger(row.id)||row.id<=0||seen.has(row.id)||!ids.includes(row.client_id)||row.kind!=='receipt')throw new Error('Реестр оплат вернул противоречивые данные.');
   seen.add(row.id);
   if(row.service_type_id===215)continue; // Analysis is a separate service.
   const id=String(row.client_id),current=result.get(id)!;
   if(row.currency!=='KZT'||!Number.isSafeInteger(row.amount_minor)||row.amount_minor<=0||!expected.get(id)||row.service_type_id!==expected.get(id)){
    if(current.status!=='received')current.status='review_required';
    continue;
   }
   if(current.status==='received')continue;
   result.set(id,{amount:row.amount_minor/100,date:row.event_date??'',status:'received',source:'payment_register',entryId:row.id});
  }
 }
 return result;
}
