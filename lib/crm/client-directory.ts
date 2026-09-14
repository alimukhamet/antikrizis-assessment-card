import {readFileField,DocumentUploadError} from './document-upload';
export type RecentClient={dealId:string;title:string;updatedAt:string;fileCount:number};
async function call(webhook:string,method:'crm.deal.list'|'crm.item.get',body:unknown,send:typeof fetch){
 if(!webhook)throw new DocumentUploadError('BITRIX_NOT_CONFIGURED');
 const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new DocumentUploadError('DEAL_READ_FAILED');
 const data=await response.json() as {result?:unknown;error?:string};
 if(data.error||!data.result)throw new DocumentUploadError('DEAL_READ_FAILED');return data.result;
}
/** Search only on request; unrelated modified deals are not a work queue. */
export async function searchClients(webhook:string,query:string,send:typeof fetch=fetch):Promise<RecentClient[]>{
 const text=query.trim();if(text.length<2||text.length>80)return [];
 const filter=/^[1-9]\d*$/.test(text)?{ID:text}:{'%TITLE':text};
 const result=await call(webhook,'crm.deal.list',{order:{DATE_MODIFY:'DESC'},filter,select:['ID','TITLE','DATE_MODIFY','UF_CRM_ANK_PRIMARY_DOCS']},send);
 if(!Array.isArray(result))throw new DocumentUploadError('DEAL_READ_FAILED');
 return result.slice(0,50).flatMap(item=>{
  if(!item||! /^[1-9]\d*$/.test(String(item.ID)))return [];
  const count=readFileField(item).refs.length;
  return [{dealId:String(item.ID),title:String(item.TITLE||''),updatedAt:String(item.DATE_MODIFY||''),fileCount:count}];
 });
}
/** No signed URLs or credential fields leave the server. */
export async function dealDocumentReferences(webhook:string,dealId:string,expectedIin:string,send:typeof fetch=fetch){
 if(!/^[1-9]\d*$/.test(dealId)||!/^\d{12}$/.test(expectedIin))throw new DocumentUploadError('DEAL_IDENTITY_UNVERIFIED');
 const result=await call(webhook,'crm.item.get',{entityTypeId:2,id:dealId},send) as {item?:Record<string,unknown>};
 const item=result.item;
 if(!item||String(item.id??item.ID)!==dealId)throw new DocumentUploadError('DEAL_NOT_FOUND');
 if((item.ufCrmAiIin??item.UF_CRM_AI_IIN)!==expectedIin)throw new DocumentUploadError('CASE_IDENTITY_CHANGED');
 return readFileField(item).refs;
}
