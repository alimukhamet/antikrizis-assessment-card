import {RepositoryError} from '../documents/repository';
export type HandoffDestination={categoryId:string;fromStageId:string;stageId:string;stageName:string;fromStageName:string};
export class HandoffMoveError extends RepositoryError{constructor(code:string,public notStarted=false){super(code);}}
const normalize=(value:unknown)=>String(value??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
/** The existing sales robot owns the next pipeline. This adapter changes STAGE_ID only. */
export function createHandoffAdapter(webhook:string,send:typeof fetch=fetch){
 async function call(method:string,body:unknown):Promise<any>{
  if(!webhook)throw new RepositoryError('BITRIX_NOT_CONFIGURED',503);
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new RepositoryError('HANDOFF_CRM_UNAVAILABLE',503);
  const data=await response.json() as {error?:string;result?:unknown};if(data.error||data.result===undefined)throw new RepositoryError('HANDOFF_CRM_UNAVAILABLE',503);return data.result;
 }
 async function read(dealId:string,iin:string){
  if(!/^[1-9]\d*$/.test(dealId)||!/^\d{12}$/.test(iin))throw new RepositoryError('CLIENT_IDENTITY_UNVERIFIED');
  const deal=await call('crm.deal.get',{id:dealId});
  if(String(deal.ID)!==dealId||deal.UF_CRM_AI_IIN!==iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');return deal;
 }
 async function discover(dealId:string,iin:string):Promise<HandoffDestination>{
  const deal=await read(dealId,iin),categoryId=String(deal.CATEGORY_ID);
  // Never close a lawyer's case or another pipeline with a similarly named final stage.
  if(categoryId!=='13'||String(deal.STAGE_SEMANTIC_ID)==='F')throw new RepositoryError('HANDOFF_NOT_IN_SALES');
  const stages=await call('crm.status.list',{filter:{ENTITY_ID:'DEAL_STAGE_'+categoryId},order:{SORT:'ASC'}});
  if(!Array.isArray(stages))throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  const matches=stages.filter(s=>s.STATUS_ID==='C13:WON'&&normalize(s.NAME)==='сделка завершена');
  if(matches.length!==1)throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  const current=stages.find(s=>s.STATUS_ID===deal.STAGE_ID);if(!current)throw new RepositoryError('HANDOFF_STAGE_UNVERIFIED');
  if(current.STATUS_ID===matches[0].STATUS_ID)throw new RepositoryError('HANDOFF_ALREADY_COMPLETED');
  return{categoryId,fromStageId:current.STATUS_ID,fromStageName:String(current.NAME),stageId:matches[0].STATUS_ID,stageName:String(matches[0].NAME)};
 }
 async function reconcile(dealId:string,iin:string,destination:HandoffDestination,since:string){
  const deal=await read(dealId,iin);
  if(String(deal.CATEGORY_ID)===destination.categoryId&&deal.STAGE_ID===destination.stageId)return true;
  // The robot may already have moved the deal onward. History proves our sales-stage transition.
  const history=await call('crm.stagehistory.list',{entityTypeId:2,filter:{OWNER_ID:dealId,CATEGORY_ID:Number(destination.categoryId),STAGE_ID:destination.stageId,'>=CREATED_TIME':since},order:{ID:'DESC'},select:['ID','OWNER_ID','CATEGORY_ID','STAGE_ID','CREATED_TIME'],start:0});
  return Array.isArray(history?.items)&&history.items.some((row:any)=>String(row.OWNER_ID)===dealId&&String(row.CATEGORY_ID)===destination.categoryId&&row.STAGE_ID===destination.stageId&&Number.isFinite(Date.parse(row.CREATED_TIME))&&Date.parse(row.CREATED_TIME)>=Math.floor(Date.parse(since)/1000)*1000);
 }
 async function move(dealId:string,iin:string,destination:HandoffDestination,since:string){
  try{const fresh=await discover(dealId,iin);if(JSON.stringify(fresh)!==JSON.stringify(destination))throw new RepositoryError('HANDOFF_STAGE_CHANGED');}
  catch(error){throw new HandoffMoveError(error instanceof RepositoryError?error.code:'HANDOFF_STAGE_UNVERIFIED',true);}
  // No automatic retry of this write, including on timeout. Recovery is read-only.
  try{await call('crm.deal.update',{id:dealId,fields:{STAGE_ID:destination.stageId}});}catch{/* Reconcile below. */}
  try{return await reconcile(dealId,iin,destination,since);}catch{return false;}
 }
 return{discover,move,reconcile};
}
