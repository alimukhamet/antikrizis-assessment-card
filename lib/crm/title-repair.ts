import {bitrixHeaders} from './http-headers';
import {RepositoryError} from '../documents/repository';

export type TitleRepairBaseline={dealId:string;iin:string;fio:string;procedure:string;categoryId:string;stageId:string;title:string};
export type TitleRepairTarget={policy:'VP_FIO_1';before:TitleRepairBaseline;desiredTitle:string};
export class TitleRepairError extends RepositoryError{constructor(code:string,public notStarted=false){super(code);}}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const normalizedFio=(value:string)=>value.replace(/\s+/gu,' ').trim();
const intakeTitle=(value:string)=>/^.+\s+-\s+\[whatcrm\]\s+line\s+#\d+\s*$/i.test(value);
function validateTarget(target:TitleRepairTarget){
 const b=target.before;
 if(target.policy!=='VP_FIO_1'||b.categoryId!=='1'||b.stageId!=='C1:NEW'||b.procedure!=='199')throw new TitleRepairError('TITLE_REPAIR_SCOPE_CHANGED');
 if(!normalizedFio(b.fio)||target.desiredTitle!=='ВП '+normalizedFio(b.fio))throw new TitleRepairError('TITLE_REPAIR_FIO_CHANGED');
 if(b.title!==target.desiredTitle&&!intakeTitle(b.title))throw new TitleRepairError('TITLE_REPAIR_TITLE_CONFLICT');
}
function sameProtected(current:TitleRepairBaseline,before:TitleRepairBaseline){
 return (['dealId','iin','fio','procedure','categoryId','stageId'] as const).every(key=>current[key]===before[key]);
}
/** One narrowly scoped TITLE update. A failed proof never permits another send. */
export function createTitleRepairAdapter(webhook:string,send:typeof fetch=fetch){
 async function call(method:string,body:unknown){
  if(!webhook)throw new TitleRepairError('BITRIX_NOT_CONFIGURED');
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:bitrixHeaders(webhook),body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new TitleRepairError('TITLE_REPAIR_CRM_UNAVAILABLE');
  const data:unknown=await response.json();if(!object(data)||data.error||data.result===undefined)throw new TitleRepairError('TITLE_REPAIR_CRM_UNAVAILABLE');return data.result;
 }
 async function read(dealId:string,iin:string):Promise<TitleRepairBaseline>{
  if(!/^[1-9]\d*$/.test(dealId)||!/^\d{12}$/.test(iin))throw new TitleRepairError('CASE_IDENTITY_CHANGED');
  const deal=await call('crm.deal.get',{id:dealId});
  if(!object(deal)||String(deal.ID)!==dealId||deal.UF_CRM_AI_IIN!==iin)throw new TitleRepairError('CASE_IDENTITY_CHANGED');
  if(typeof deal.TITLE!=='string'||typeof deal.UF_CRM_1773669702495!=='string'||!['string','number'].includes(typeof deal.UF_CRM_1773655613972)||!['string','number'].includes(typeof deal.CATEGORY_ID)||typeof deal.STAGE_ID!=='string')throw new TitleRepairError('TITLE_REPAIR_READBACK_UNVERIFIED');
  return {dealId,iin,fio:deal.UF_CRM_1773669702495,procedure:String(deal.UF_CRM_1773655613972),categoryId:String(deal.CATEGORY_ID),stageId:deal.STAGE_ID,title:deal.TITLE};
 }
 async function inspect(dealId:string,iin:string,savedFio:string){
  if(typeof savedFio!=='string'||!normalizedFio(savedFio))throw new TitleRepairError('TITLE_REPAIR_FIO_CHANGED');
  const before=await read(dealId,iin);
  if(before.fio!==savedFio)throw new TitleRepairError('TITLE_REPAIR_FIO_CHANGED');
  const target:TitleRepairTarget={policy:'VP_FIO_1',before,desiredTitle:'ВП '+normalizedFio(savedFio)};validateTarget(target);
  return {...target,noop:before.title===target.desiredTitle};
 }
 async function reconcile(target:TitleRepairTarget){
  validateTarget(target);const current=await read(target.before.dealId,target.before.iin);
  return sameProtected(current,target.before)&&current.title===target.desiredTitle;
 }
 async function repair(target:TitleRepairTarget){
  try{
   validateTarget(target);const current=await read(target.before.dealId,target.before.iin);
   if(!sameProtected(current,target.before))throw new TitleRepairError('TITLE_REPAIR_SCOPE_CHANGED');
   if(current.title===target.desiredTitle)return true;
   if(current.title!==target.before.title)throw new TitleRepairError('TITLE_REPAIR_TITLE_CONFLICT');
  }catch(error){throw new TitleRepairError(error instanceof RepositoryError?error.code:'TITLE_REPAIR_CRM_UNAVAILABLE',true);}
  try{await call('crm.deal.update',{id:target.before.dealId,fields:{TITLE:target.desiredTitle}});}catch{/* A lost response is resolved by readback, never a second update. */}
  try{return await reconcile(target);}catch{return false;}
 }
 return {inspect,repair,reconcile};
}
