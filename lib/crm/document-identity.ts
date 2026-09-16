import {RepositoryError} from '../documents/repository';
import {validIin} from '../documents/extract-native';
import {readClientContext} from './bitrix';

/** The document is the source. CRM receives only a previously empty IIN field. */
export function createDocumentIdentityAdapter(webhook:string,send:typeof fetch=fetch){
 async function call(method:string,body:unknown){
  if(!webhook)throw new RepositoryError('BITRIX_NOT_CONFIGURED',503);
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),cache:'no-store'});
  const data=await response.json() as {result?:unknown;error?:string};
  if(!response.ok||data.error||data.result===undefined)throw new RepositoryError('BITRIX_TEMPORARILY_UNAVAILABLE',503);
  return data.result;
 }
 async function save(dealId:string,iin:string){
  if(!/^[1-9]\d*$/.test(dealId)||!validIin(iin))throw new RepositoryError('CLIENT_IDENTITY_UNVERIFIED');
  const before=await call('crm.deal.get',{id:dealId}) as Record<string,unknown>;
  if(!before||String(before.ID)!==dealId)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  const raw=before.UF_CRM_AI_IIN;
  const current=typeof raw==='string'?raw.trim():raw==null||raw===false?'':String(raw);
  // Invalid/non-empty CRM values are conflicts too, never permission to overwrite.
  if(current&&current!==iin)throw new RepositoryError('IDENTITY_CONFLICT');
  if(!current){
   // Bitrix has no compare-and-set: check immediately before this narrow write,
   // then read back. The durable case claim serializes competing portal requests.
   try{await call('crm.deal.update',{id:dealId,fields:{UF_CRM_AI_IIN:iin}});}catch{/* A lost response may still have applied; do not resend. */}
  }
  let after;
  try{after=await readClientContext(dealId,webhook,(input,init)=>send(input,init));}
  catch{throw new RepositoryError('IDENTITY_SAVE_UNCERTAIN',503);}
  if(after.iin!==iin)throw new RepositoryError('IDENTITY_SAVE_UNCERTAIN',409);
  return after;
 }
 return{save};
}
