import {bitrixHeaders} from './http-headers'; import {RepositoryError} from '../documents/repository';
export type HandoffDestination={categoryId:string;fromStageId:string;stageId:string;stageName:string;fromStageName:string};
export type HandoffTitleSource={requestId:string;payloadHash:string;fio:string;procedure:string};
export type HandoffTitlePlan={policy:'VP_FIO_1';source:HandoffTitleSource;beforeTitle:string;desiredTitle:string};
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
 return isRecord(value)&&value.categoryId===expected.categoryId&&value.fromStageId===expected.fromStageId&&value.stageId===expected.stageId;
}
/** The sales robot owns the next pipeline. Only a frozen, source-backed VP intake title may accompany STAGE_ID. */
export function createHandoffAdapter(webhook:string,send:typeof fetch=fetch){
 async function call(method:string,body:unknown):Promise<unknown>{
  if(!webhook)throw new RepositoryError('BITRIX_NOT_CONFIGURED',503);
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:bitrixHeaders(webhook),body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new RepositoryError('HANDOFF_CRM_UNAVAILABLE',503);
  const data:unknown=await response.json();if(!isRecord(data)||data.error||data.result===undefined)throw new RepositoryError('HANDOFF_CRM_UNAVAILABLE',503);return data.result;
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
  const stages=await call('crm.status.list',{filter:{ENTITY_ID:'DEAL_STAGE_'+categoryId},order:{SORT:'ASC'}});
  if(!Array.isArray(stages)||!stages.every(isRecord))throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  // The deployed portal calls C13:WON «Сделка успешна». Renaming that label
  // must not disable handoff. Keep the exact category and stage ID pinned.
  const matches=stages.filter(s=>s.STATUS_ID==='C13:WON');
  if(matches.length!==1)throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  const target=matches[0];
  if((target.ENTITY_ID!==undefined&&target.ENTITY_ID!=='DEAL_STAGE_13')||
     (target.SEMANTICS!=null&&target.SEMANTICS!=='S')||
     (isRecord(target.EXTRA)&&target.EXTRA.SEMANTICS!=null&&target.EXTRA.SEMANTICS!=='success'))throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  const current=stages.find(s=>s.STATUS_ID===deal.STAGE_ID);if(!current||typeof current.STATUS_ID!=='string'||typeof matches[0].STATUS_ID!=='string'||typeof current.NAME!=='string'||typeof matches[0].NAME!=='string'||!matches[0].NAME.trim()||!current.NAME.trim())throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  if(current.STATUS_ID===matches[0].STATUS_ID)throw new RepositoryError('HANDOFF_ALREADY_COMPLETED');
  return{categoryId,fromStageId:current.STATUS_ID,fromStageName:String(current.NAME),stageId:matches[0].STATUS_ID,stageName:String(matches[0].NAME)};
 }
 async function discover(dealId:string,iin:string){return discoverDeal(await read(dealId,iin));}
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
 async function validateTitle(dealId:string,iin:string,destination:HandoffDestination,plan?:HandoffTitlePlan){
  const deal=await read(dealId,iin);
  if(String(deal.CATEGORY_ID)!==destination.categoryId||deal.STAGE_ID!==destination.fromStageId)throw new RepositoryError('HANDOFF_STAGE_CHANGED');
  validateTitleBeforeWrite(deal,plan);
 }
 async function reconcile(dealId:string,iin:string,destination:HandoffDestination,since:string,plan?:HandoffTitlePlan){
  const deal=await read(dealId,iin);
  let stageVerified=String(deal.CATEGORY_ID)===destination.categoryId&&deal.STAGE_ID===destination.stageId;
  if(!stageVerified){
  // The robot may already have moved the deal onward. History proves our sales-stage transition.
  const history=await call('crm.stagehistory.list',{entityTypeId:2,filter:{OWNER_ID:dealId,CATEGORY_ID:Number(destination.categoryId),STAGE_ID:destination.stageId,'>=CREATED_TIME':since},order:{ID:'DESC'},select:['ID','OWNER_ID','CATEGORY_ID','STAGE_ID','CREATED_TIME'],start:0});
  stageVerified=isRecord(history)&&Array.isArray(history.items)&&history.items.some((row:unknown)=>isRecord(row)&&typeof row.CREATED_TIME==='string'&&String(row.OWNER_ID)===dealId&&String(row.CATEGORY_ID)===destination.categoryId&&row.STAGE_ID===destination.stageId&&Number.isFinite(Date.parse(row.CREATED_TIME))&&Date.parse(row.CREATED_TIME)>=Math.floor(Date.parse(since)/1000)*1000);
  }
  if(stageVerified&&plan&&(!validTitlePlan(plan)||!titleMatchesSource(deal,plan.source)||deal.TITLE!==plan.desiredTitle))throw new HandoffMoveError('HANDOFF_TITLE_UNVERIFIED');
  return stageVerified;
 }
 async function move(dealId:string,iin:string,destination:HandoffDestination,since:string,plan?:HandoffTitlePlan){
  try{const deal=await read(dealId,iin),fresh=await discoverDeal(deal);if(!sameHandoffDestination(destination,fresh))throw new RepositoryError('HANDOFF_STAGE_CHANGED');validateTitleBeforeWrite(deal,plan);}
  catch(error){throw new HandoffMoveError(error instanceof RepositoryError?error.code:'HANDOFF_STAGE_UNVERIFIED',true);}
  // No automatic retry of this write, including on timeout. Recovery is read-only.
  try{await call('crm.deal.update',{id:dealId,fields:{STAGE_ID:destination.stageId,...(plan?{TITLE:plan.desiredTitle}:{})}});}catch{/* Reconcile below. */}
  try{return await reconcile(dealId,iin,destination,since,plan);}catch(error){if(error instanceof HandoffMoveError)throw error;return false;}
 }
 return{discover,planTitle,validateTitle,move,reconcile};
}
