import {bitrixHeaders} from './http-headers'; export class AssessmentHistoryError extends Error{constructor(public code:string,public notStarted=false){super(code);}}
/** Uses only deal comments; never updates stages, invoices, files or assessment fields. */
export function createAssessmentHistoryAdapter(webhook:string,send:typeof fetch=fetch,operationSignal?:AbortSignal){
 async function call(method:string,body:unknown){
  if(!webhook)throw new AssessmentHistoryError('BITRIX_NOT_CONFIGURED');
  operationSignal?.throwIfAborted();
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:bitrixHeaders(webhook),body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:operationSignal?AbortSignal.any([operationSignal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if(!response.ok||!response.body)throw new AssessmentHistoryError('HISTORY_REQUEST_FAILED');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw new AssessmentHistoryError('HISTORY_RESPONSE_TOO_LARGE');}text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();const json=JSON.parse(text) as {result?:unknown;error?:string;next?:unknown};
  if(json.error||json.result===undefined)throw new AssessmentHistoryError('HISTORY_REQUEST_FAILED');return json;
 }
 const normalize=(s:string)=>s.replace(/\r\n/g,'\n');
 function comment(submissionId:string,lawyerCard:string){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(submissionId)||!lawyerCard||lawyerCard.length>200000)throw new AssessmentHistoryError('INVALID_HISTORY_SNAPSHOT');
  const marker=`Assessment reference: ${submissionId}`;
  return {marker,text:`${lawyerCard}\n\n${marker}`};
 }
 async function identity(dealId:string,iin:string){
  if(!/^[1-9]\d*$/.test(dealId)||!/^\d{12}$/.test(iin))throw new AssessmentHistoryError('INVALID_HISTORY_TARGET');
  const deal=(await call('crm.deal.get',{id:dealId})).result as Record<string,unknown>;
  if(!deal||String(deal.ID)!==dealId||deal.UF_CRM_AI_IIN!==iin)throw new AssessmentHistoryError('CASE_IDENTITY_CHANGED');
 }
 async function find(dealId:string,submissionId:string,lawyerCard:string){
  const expected=comment(submissionId,lawyerCard),found:Array<{id:string;text:string}>=[];let start=0;
  for(let page=0;page<20;page++){
   const json=await call('crm.timeline.comment.list',{filter:{ENTITY_ID:Number(dealId),ENTITY_TYPE:'deal'},select:['ID','ENTITY_ID','ENTITY_TYPE','COMMENT'],order:{ID:'ASC'},start});
   if(!Array.isArray(json.result))throw new AssessmentHistoryError('HISTORY_RESPONSE_UNVERIFIED');
   for(const row of json.result){
    if(!row||typeof row!=='object'||String(row.ENTITY_ID)!==dealId||row.ENTITY_TYPE!=='deal'||typeof row.COMMENT!=='string'||!/^[1-9]\d*$/.test(String(row.ID)))throw new AssessmentHistoryError('HISTORY_RESPONSE_UNVERIFIED');
    if(row.COMMENT.includes(expected.marker))found.push({id:String(row.ID),text:row.COMMENT});
   }
   if(json.next===undefined||json.next===null){
    if(found.length>1)throw new AssessmentHistoryError('HISTORY_DUPLICATE_REFERENCE');
    if(!found.length)return null;
    if(normalize(found[0].text)!==normalize(expected.text))throw new AssessmentHistoryError('HISTORY_CONTENT_MISMATCH');
    return {commentId:found[0].id,verified:true as const};
   }
   if(!Number.isInteger(json.next)||Number(json.next)<=start)throw new AssessmentHistoryError('HISTORY_PAGINATION_UNVERIFIED');start=Number(json.next);
  }
  throw new AssessmentHistoryError('HISTORY_SCAN_INCOMPLETE');
 }
 async function reconcile(dealId:string,iin:string,submissionId:string,lawyerCard:string){await identity(dealId,iin);return find(dealId,submissionId,lawyerCard);}
 async function append(dealId:string,iin:string,submissionId:string,lawyerCard:string){
  // A failed identity/comment lookup has not appended anything. Keep that distinct
  // from a lost add response; only the latter must remain read-only on retry.
  const {prior,expected}=await (async()=>{
   await identity(dealId,iin);
   return {prior:await find(dealId,submissionId,lawyerCard),expected:comment(submissionId,lawyerCard)};
  })().catch(error=>{
   throw new AssessmentHistoryError(error instanceof AssessmentHistoryError?error.code:'HISTORY_PREFLIGHT_FAILED',true);
  });
  if(prior)return prior;
  // Caller claims a durable once-only intent. A lost response is followed only by reads.
  if(operationSignal?.aborted)throw new AssessmentHistoryError('HISTORY_PREFLIGHT_FAILED',true);
  try{await call('crm.timeline.comment.add',{fields:{ENTITY_ID:Number(dealId),ENTITY_TYPE:'deal',COMMENT:expected.text}});}catch{/* Reconcile even when the add response was lost. */}
  const saved=await find(dealId,submissionId,lawyerCard);if(!saved)throw new AssessmentHistoryError('HISTORY_OUTCOME_UNCERTAIN');return saved;
 }
 return {append,reconcile};
}
