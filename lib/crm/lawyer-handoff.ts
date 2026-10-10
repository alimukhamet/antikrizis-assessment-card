import {bitrixHeaders} from './http-headers'; import {RepositoryError} from '../documents/repository';
export type HandoffDestination={categoryId:string;targetCategoryId?:string;fromStageId:string;stageId:string;stageName:string;fromStageName:string};
export type HandoffTitleSource={requestId:string;payloadHash:string;fio:string;procedure:string};
export type HandoffTitlePlan={policy:'VP_FIO_1';source:HandoffTitleSource;beforeTitle:string;desiredTitle:string};
// The same existing field drives sales/commission periods; never replace a
// preexisting handoff date or derive a new one from the contract/preparation day.
export const HANDOFF_DATE_FIELD='UF_CRM_1777554129345';
export type HandoffDatePlan={policy:'LAWYER_HANDOFF_DATE_1';beforeValue:string|null;day:string};
export function handoffDay(now:Date=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(kind:string)=>parts.find(p=>p.type===kind)!.value;return `${part('year')}-${part('month')}-${part('day')}`;
}
function dateDay(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const text=value.trim(),iso=/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(text),local=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
 const day=iso?.[1]||(local?`${local[3]}-${local[2]}-${local[1]}`:'');
 const parsed=new Date(day+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===day?day:null;
}
function dateBefore(deal:Record<string,unknown>){const value=deal[HANDOFF_DATE_FIELD];if(value==null||value===false||typeof value==='string'&&!value.trim())return null;if(typeof value!=='string'||!dateDay(value))throw new RepositoryError('HANDOFF_DATE_UNVERIFIED');return value;}
function validDatePlan(value:unknown):value is HandoffDatePlan{return isRecord(value)&&value.policy==='LAWYER_HANDOFF_DATE_1'&&typeof value.day==='string'&&dateDay(value.day)===value.day&&(value.beforeValue===null||typeof value.beforeValue==='string'&&dateDay(value.beforeValue)===value.day);}
function validateDateBeforeWrite(deal:Record<string,unknown>,plan:HandoffDatePlan|undefined,now:Date){
 if(!validDatePlan(plan))throw new RepositoryError('HANDOFF_DATE_PLAN_REQUIRED');
 if(dateBefore(deal)!==plan.beforeValue)throw new RepositoryError('HANDOFF_DATE_CHANGED');
 if(plan.beforeValue===null&&plan.day!==handoffDay(now))throw new RepositoryError('HANDOFF_DATE_PLAN_EXPIRED');
}
const normalizedFio=(value:string)=>value.replace(/\s+/gu,' ').trim();
const intakeTitle=(value:unknown)=>typeof value==='string'&&/^.+\s+-\s+\[whatcrm\]\s+line\s+#\d+\s*$/i.test(value);
function validSource(value:unknown):value is HandoffTitleSource{
 return isRecord(value)&&typeof value.requestId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.requestId)&&typeof value.payloadHash==='string'&&/^[a-f0-9]{64}$/.test(value.payloadHash)&&typeof value.fio==='string'&&Boolean(normalizedFio(value.fio))&&typeof value.procedure==='string';
}
function validTitlePlan(value:unknown):value is HandoffTitlePlan{
 return isRecord(value)&&value.policy==='VP_FIO_1'&&validSource(value.source)&&value.source.procedure==='199'&&intakeTitle(value.beforeTitle)&&value.desiredTitle==='ВП '+normalizedFio(value.source.fio)&&value.desiredTitle.length<=255;
}
function titleMatchesSource(deal:Record<string,unknown>,source:HandoffTitleSource){return deal.UF_CRM_1773669702495===source.fio&&String(deal.UF_CRM_1773655613972)===source.procedure;}
function validateTitleBeforeWrite(deal:Record<string,unknown>,plan?:HandoffTitlePlan){
 if(!plan){if(String(deal.UF_CRM_1773655613972)==='199'&&intakeTitle(deal.TITLE))throw new RepositoryError('HANDOFF_TITLE_PLAN_REQUIRED');return;}
 if(!validTitlePlan(plan))throw new RepositoryError('HANDOFF_TITLE_PLAN_REQUIRED');
 if(!titleMatchesSource(deal,plan.source))throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
 if(deal.TITLE!==plan.beforeTitle)throw new RepositoryError('HANDOFF_TITLE_CHANGED');
}
export class HandoffMoveError extends RepositoryError{constructor(code:string,public notStarted=false){super(code);}}
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
/** Names are editable labels, not the identity of a confirmed stage transition. */
export function sameHandoffDestination(value:unknown,expected:HandoffDestination){
 return isRecord(value)&&value.categoryId===expected.categoryId&&(value.targetCategoryId??value.categoryId)===(expected.targetCategoryId??expected.categoryId)&&value.fromStageId===expected.fromStageId&&value.stageId===expected.stageId;
}
/** New handoffs move directly from sales to lawyer waiting. Legacy claimed receipts remain read-only. */
export function createHandoffAdapter(webhook:string,send:typeof fetch=fetch,now:()=>Date=()=>new Date()){
 async function call(method:string,body:unknown):Promise<unknown>{
  if(!webhook)throw new RepositoryError('BITRIX_NOT_CONFIGURED',503);
  try{
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:bitrixHeaders(webhook),body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data:unknown=await response.json();
  // Keep only a bounded classification; upstream error descriptions may contain
  // private client values. An explicit error still never authorizes a replay.
  if(method==='crm.item.update'&&isRecord(data)&&data.result===undefined&&(typeof data.error==='string'||typeof data.error_description==='string'))throw new HandoffMoveError('HANDOFF_CRM_WRITE_REJECTED');
  if(!response.ok||!isRecord(data)||data.error||data.result===undefined)throw new RepositoryError('HANDOFF_CRM_UNAVAILABLE',503);return data.result;
  }catch(error){if(error instanceof HandoffMoveError)throw error;throw new RepositoryError('HANDOFF_CRM_UNAVAILABLE',503);}
 }
 async function read(dealId:string,iin:string){
  if(!/^[1-9]\d*$/.test(dealId)||!/^\d{12}$/.test(iin))throw new RepositoryError('CLIENT_IDENTITY_UNVERIFIED');
  const deal=await call('crm.deal.get',{id:dealId});
  if(!isRecord(deal)||String(deal.ID)!==dealId||deal.UF_CRM_AI_IIN!==iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');return deal;
 }
 async function discoverDeal(deal:Record<string,unknown>):Promise<HandoffDestination>{
  const categoryId=String(deal.CATEGORY_ID);
  // Never close a lawyer's case or another pipeline with a similarly named final stage.
  if(categoryId!=='13'||String(deal.STAGE_SEMANTIC_ID)==='F')throw new RepositoryError('HANDOFF_NOT_IN_SALES');
  if(String(deal.STAGE_SEMANTIC_ID)==='S'||deal.STAGE_ID==='C13:WON')throw new RepositoryError('HANDOFF_ALREADY_COMPLETED');
  const [stages,lawyerStages]=await Promise.all([
   call('crm.status.list',{filter:{ENTITY_ID:'DEAL_STAGE_13'},order:{SORT:'ASC'}}),
   call('crm.status.list',{filter:{ENTITY_ID:'DEAL_STAGE_1'},order:{SORT:'ASC'}}),
  ]);
  if(!Array.isArray(stages)||!stages.every(isRecord)||!Array.isArray(lawyerStages)||!lawyerStages.every(isRecord))throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  const matches=lawyerStages.filter(s=>s.STATUS_ID==='C1:NEW'),sources=stages.filter(s=>s.STATUS_ID===deal.STAGE_ID);
  if(matches.length!==1||sources.length!==1)throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  const target=matches[0],current=sources[0];
  if(target.ENTITY_ID!=='DEAL_STAGE_1'||typeof target.NAME!=='string'||target.NAME.trim().replace(/\s+/gu,' ').toLocaleLowerCase('ru')!=='в ожидании'||
     (target.SEMANTICS!=null&&target.SEMANTICS!=='P')||
     (isRecord(target.EXTRA)&&target.EXTRA.SEMANTICS!=null&&target.EXTRA.SEMANTICS!=='process')||
     (current.ENTITY_ID!==undefined&&current.ENTITY_ID!=='DEAL_STAGE_13')||typeof current.NAME!=='string'||!current.NAME.trim())throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  return{categoryId,targetCategoryId:'1',fromStageId:String(current.STATUS_ID),fromStageName:current.NAME,stageId:'C1:NEW',stageName:target.NAME};
 }
 async function discover(dealId:string,iin:string){return discoverDeal(await read(dealId,iin));}
 async function planDate(dealId:string,iin:string):Promise<HandoffDatePlan>{
  const deal=await read(dealId,iin);if(String(deal.CATEGORY_ID)!=='13')throw new RepositoryError('HANDOFF_NOT_IN_SALES');
  const beforeValue=dateBefore(deal);return{policy:'LAWYER_HANDOFF_DATE_1',beforeValue,day:beforeValue===null?handoffDay(now()):dateDay(beforeValue)!};
 }
 async function planTitle(dealId:string,iin:string,source:HandoffTitleSource):Promise<HandoffTitlePlan|null>{
  if(!validSource(source))throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
  const deal=await read(dealId,iin);
  if(String(deal.CATEGORY_ID)!=='13')throw new RepositoryError('HANDOFF_NOT_IN_SALES');
  if(!titleMatchesSource(deal,source))throw new RepositoryError('HANDOFF_ASSESSMENT_CHANGED');
  // Only this exact naming policy has been established from the existing lawyer cohort.
  if(source.procedure!=='199'||!intakeTitle(deal.TITLE))return null;
  const plan:HandoffTitlePlan={policy:'VP_FIO_1',source:{...source},beforeTitle:String(deal.TITLE),desiredTitle:'ВП '+normalizedFio(source.fio)};
  if(!validTitlePlan(plan))throw new RepositoryError('HANDOFF_TITLE_PLAN_REQUIRED');
  return plan;
 }
 async function validateTitle(dealId:string,iin:string,destination:HandoffDestination,plan?:HandoffTitlePlan,datePlan?:HandoffDatePlan){
  const deal=await read(dealId,iin);
  if(String(deal.CATEGORY_ID)!==destination.categoryId||deal.STAGE_ID!==destination.fromStageId)throw new RepositoryError('HANDOFF_STAGE_CHANGED');
  if(!sameHandoffDestination(destination,await discoverDeal(deal)))throw new RepositoryError('HANDOFF_DESTINATION_CHANGED');
  validateTitleBeforeWrite(deal,plan);
  validateDateBeforeWrite(deal,datePlan,now());
 }
 async function reconcile(dealId:string,iin:string,destination:HandoffDestination,since:string,plan?:HandoffTitlePlan,datePlan?:HandoffDatePlan){
  const deal=await read(dealId,iin);
  // Missing targetCategoryId denotes an immutable receipt created by the former sales-final policy.
  const targetCategoryId=destination.targetCategoryId??destination.categoryId;
  let stageVerified=String(deal.CATEGORY_ID)===targetCategoryId&&deal.STAGE_ID===destination.stageId;
  if(!stageVerified){
  // Later CRM automation may have moved onward. Match the frozen target in fresh history.
  const history=await call('crm.stagehistory.list',{entityTypeId:2,filter:{OWNER_ID:dealId,CATEGORY_ID:Number(targetCategoryId),STAGE_ID:destination.stageId,'>=CREATED_TIME':since},order:{ID:'DESC'},select:['ID','OWNER_ID','CATEGORY_ID','STAGE_ID','CREATED_TIME'],start:0});
  if(!isRecord(history)||!Array.isArray(history.items))throw new RepositoryError('HANDOFF_CRM_UNAVAILABLE',503);
  stageVerified=isRecord(history)&&Array.isArray(history.items)&&history.items.some((row:unknown)=>isRecord(row)&&typeof row.CREATED_TIME==='string'&&String(row.OWNER_ID)===dealId&&String(row.CATEGORY_ID)===targetCategoryId&&row.STAGE_ID===destination.stageId&&Number.isFinite(Date.parse(row.CREATED_TIME))&&Date.parse(row.CREATED_TIME)>=Math.floor(Date.parse(since)/1000)*1000);
  }
  // Bitrix can return the correctly applied title with outer whitespace. Keep
  // the frozen source and all title characters exact; only trim the boundary.
  if(stageVerified&&plan&&(!validTitlePlan(plan)||!titleMatchesSource(deal,plan.source)||typeof deal.TITLE!=='string'||deal.TITLE.trim()!==plan.desiredTitle))throw new HandoffMoveError('HANDOFF_TITLE_UNVERIFIED');
  // Legacy claimed receipts retain their original proof scope. A new date plan
  // must match even when later automation has already moved the deal onward.
  if(stageVerified&&datePlan&&(!validDatePlan(datePlan)||dateDay(deal[HANDOFF_DATE_FIELD])!==datePlan.day))throw new HandoffMoveError('HANDOFF_DATE_UNVERIFIED');
  if(!stageVerified)throw new HandoffMoveError(String(deal.CATEGORY_ID)===destination.categoryId&&deal.STAGE_ID===destination.fromStageId?'HANDOFF_STILL_AT_SOURCE':'HANDOFF_TARGET_NOT_IN_HISTORY');
  return true;
 }
 async function move(dealId:string,iin:string,destination:HandoffDestination,since:string,plan?:HandoffTitlePlan,datePlan?:HandoffDatePlan){
  try{const deal=await read(dealId,iin),fresh=await discoverDeal(deal);if(!sameHandoffDestination(destination,fresh))throw new RepositoryError('HANDOFF_STAGE_CHANGED');validateTitleBeforeWrite(deal,plan);validateDateBeforeWrite(deal,datePlan,now());}
  catch(error){throw new HandoffMoveError(error instanceof RepositoryError?error.code:'HANDOFF_STAGE_UNVERIFIED',true);}
  // No automatic retry of this write, including on timeout. Recovery is read-only.
  let rejected=false;
  try{await call('crm.item.update',{entityTypeId:2,id:dealId,useOriginalUfNames:'Y',fields:{categoryId:Number(destination.targetCategoryId),stageId:destination.stageId,...(plan?{title:plan.desiredTitle}:{}),...(datePlan!.beforeValue===null?{[HANDOFF_DATE_FIELD]:datePlan!.day}:{})}});}catch(error){rejected=error instanceof HandoffMoveError&&error.code==='HANDOFF_CRM_WRITE_REJECTED';}
  try{return await reconcile(dealId,iin,destination,since,plan,datePlan);}catch(error){if(rejected&&error instanceof RepositoryError&&['HANDOFF_STILL_AT_SOURCE','HANDOFF_TARGET_NOT_IN_HISTORY','HANDOFF_CRM_UNAVAILABLE'].includes(error.code))throw new HandoffMoveError('HANDOFF_CRM_WRITE_REJECTED');if(error instanceof HandoffMoveError)throw error;if(error instanceof RepositoryError&&['HANDOFF_CRM_UNAVAILABLE','CASE_IDENTITY_CHANGED'].includes(error.code))throw new HandoffMoveError(error.code);return false;}
 }
 return{discover,planDate,planTitle,validateTitle,move,reconcile};
}
