import {bitrixHeaders} from './http-headers';

const HANDOFF_DATE_FIELD='UF_CRM_1777554129345';
const PAYMENT_TYPE_FIELD='UF_CRM_1781335943568';
const CASE_OUTCOME_FIELD='UF_CRM_1781518191377';
const INVOICE_PAYMENT_TYPE_FIELD='ufCrm_SMART_INVOICE_1772428866812';
const INVOICE_TRANSACTION_DATE_FIELD='ufCrm_SMART_INVOICE_1773231423587';
const PAID_INVOICE_STAGES=new Set(['DT31_3:N','DT31_3:P']);
const RAMAZAN_ID='2093';
// Owner-confirmed June payroll cutover: only these specific first-payment invoices belong to June.
const RAMAZAN_JUNE_FIRST_PAYMENTS=new Map([
  ['4913',{invoiceId:'1805',date:'2026-06-01'}],
  ['3517',{invoiceId:'2067',date:'2026-06-22'}],
]);

export type CompensationDeal={
  id:string;
  title:string;
  handoffDate:string;
  commissionDate:string;
  contractValue:number|null;
  paymentType:string;
  stageId:string;
  outcomeId:string;
  firstPayment:number|null;
};

type BitrixEnvelope<T>={result?:T;error?:string;error_description?:string;next?:number};

async function call<T>(webhook:string,method:string,body:unknown,send:typeof fetch):Promise<BitrixEnvelope<T>>{
  if(!webhook)throw new Error('BITRIX_WEBHOOK is not configured');
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{
    method:'POST',headers:bitrixHeaders(webhook),body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000),
  });
  const payload=await response.json() as BitrixEnvelope<T>;
  if(!response.ok||payload.error)throw new Error(payload.error_description||payload.error||`Bitrix HTTP ${response.status}`);
  return payload;
}

function money(value:unknown){
  const parsed=Number(String(value??'').replace(/\s/g,'').replace(',','.'));
  return Number.isFinite(parsed)&&parsed>0?parsed:null;
}

type FirstPayment={amount:number|null;date:string};

async function firstPayment(webhook:string,dealId:string,send:typeof fetch,invoiceId?:string):Promise<FirstPayment>{
  let start=0;
  const payments:Array<{id:string;amount:number;date:string}>=[];
  for(let page=0;page<20;page+=1){
    const payload=await call<{items?:Array<Record<string,unknown>>}>(webhook,'crm.item.list',{
      entityTypeId:31,
      filter:{parentId2:Number(dealId)},
      select:['id','stageId','opportunity','parentId2',INVOICE_PAYMENT_TYPE_FIELD,INVOICE_TRANSACTION_DATE_FIELD],
      order:{id:'ASC'},
      start,
    },send);
    const items=payload.result?.items;
    if(!Array.isArray(items))throw new Error('Invalid Bitrix invoice list');
    for(const item of items){
      if(String(item.parentId2??'')!==dealId||String(item[INVOICE_PAYMENT_TYPE_FIELD]??'')!=='195'||!PAID_INVOICE_STAGES.has(String(item.stageId??'')))continue;
      if(invoiceId&&String(item.id??'')!==invoiceId)continue;
      const amount=money(item.opportunity);if(amount===null)throw new Error('First payment amount is missing');
      payments.push({id:String(item.id??''),amount,date:String(item[INVOICE_TRANSACTION_DATE_FIELD]??'').slice(0,10)});
    }
    if(typeof payload.next!=='number')break;
    start=payload.next;
  }
  const dated=payments.filter(item=>/^\d{4}-\d{2}-\d{2}$/.test(item.date)).sort((a,b)=>a.date.localeCompare(b.date)||Number(a.id)-Number(b.id));
  if(!dated.length)return {amount:null,date:''};
  const date=dated[0].date;
  return {amount:dated.filter(item=>item.date===date).reduce((sum,item)=>sum+item.amount,0),date};
}

async function dealRows(webhook:string,filterBase:Record<string,string>,send:typeof fetch){
  const rows:Array<Record<string,unknown>>=[];
  let lastId=0;
  for(let page=0;page<100;page+=1){
    const filter={...filterBase};
    if(lastId)filter['>ID']=String(lastId);
    const payload=await call<Array<Record<string,unknown>>>(webhook,'crm.deal.list',{
      order:{ID:'ASC'},filter,
      select:['ID','TITLE','ASSIGNED_BY_ID','OPPORTUNITY','STAGE_ID',HANDOFF_DATE_FIELD,PAYMENT_TYPE_FIELD,CASE_OUTCOME_FIELD],
      start:-1,
    },send);
    if(!Array.isArray(payload.result))throw new Error('Invalid Bitrix deal list');
    for(const row of payload.result){
      const id=Number(row.ID);
      if(!Number.isSafeInteger(id)||id<=lastId)throw new Error('Bitrix returned an invalid pagination cursor');
      lastId=id;rows.push(row);
    }
    if(payload.result.length<50)break;
  }
  return rows;
}

export async function loadCompensationDeals(webhook:string,managerId:string,from:string,to:string,send:typeof fetch=fetch):Promise<CompensationDeal[]>{
  const [periodRows,firstPaymentRows]=await Promise.all([
    dealRows(webhook,{[`>=${HANDOFF_DATE_FIELD}`]:from,[`<=${HANDOFF_DATE_FIELD}`]:to,ASSIGNED_BY_ID:managerId},send),
    dealRows(webhook,{ASSIGNED_BY_ID:managerId,[PAYMENT_TYPE_FIELD]:'263'},send),
  ]);
  const rows=new Map([...periodRows,...firstPaymentRows].map(row=>[String(row.ID),row]));
  const deals=await Promise.all([...rows.values()].map(async row=>{
    const id=String(row.ID),paymentType=String(row[PAYMENT_TYPE_FIELD]??'');
    const juneOverride=managerId===RAMAZAN_ID?RAMAZAN_JUNE_FIRST_PAYMENTS.get(id):undefined;
    const payment=paymentType==='263'?await firstPayment(webhook,id,send,juneOverride?.invoiceId):{amount:null,date:''};
    const invoiceDate=juneOverride?.date??(managerId===RAMAZAN_ID&&payment.date.startsWith('2026-06')?'2026-05-31':payment.date);
    return {
      id,title:String(row.TITLE??'').trim()||`Сделка #${id}`,handoffDate:String(row[HANDOFF_DATE_FIELD]??'').slice(0,10),commissionDate:paymentType==='263'?invoiceDate:String(row[HANDOFF_DATE_FIELD]??'').slice(0,10),
      contractValue:money(row.OPPORTUNITY),paymentType,stageId:String(row.STAGE_ID??''),outcomeId:String(row[CASE_OUTCOME_FIELD]??''),firstPayment:payment.amount,
    } satisfies CompensationDeal;
  }));
  return deals.filter(deal=>(deal.handoffDate>=from&&deal.handoffDate<=to)||(deal.commissionDate>=from&&deal.commissionDate<=to));
}
