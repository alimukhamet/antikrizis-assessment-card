import { validIin } from '../documents/extract-native';
export type ClientContext = { internalClientId: string | null; external: { system: 'bitrix'; dealId: string }; title: string; iin: string | null; retrievedAt: string };
const pendingContexts=new Map<string,Promise<ClientContext>>();
/** All Bitrix field IDs are confined to this adapter. */
export async function readClientContext(dealId: string, webhook: string, send: typeof fetch = fetch): Promise<ClientContext> {
  if (!/^[1-9]\d*$/.test(dealId)) throw new Error('INVALID_DEAL_ID');
  if (!webhook) throw new Error('BITRIX_NOT_CONFIGURED');
  // Share only requests that are currently in flight, never a stale identity cache.
  // Fresh reads after completion (including final submissions) still reach Bitrix.
  if(send!==fetch)return fetchClientContext(dealId,webhook,send);
  const key=webhook+'|'+dealId,existing=pendingContexts.get(key);if(existing)return existing;
  const task=fetchClientContext(dealId,webhook,send);pendingContexts.set(key,task);
  try{return await task;}finally{if(pendingContexts.get(key)===task)pendingContexts.delete(key);}
}
async function fetchClientContext(dealId:string,webhook:string,send:typeof fetch):Promise<ClientContext>{
  type Body={ result?: { ID?: string; TITLE?: string; UF_CRM_AI_IIN?: unknown }; error?: string };
  let body:Body|undefined;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await send(webhook.replace(/\/?$/, '/')+'crm.deal.get.json',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:Number(dealId)}),signal:AbortSignal.timeout(8000),cache:'no-store',
      });
      if(!response.ok){if(response.status!==429&&response.status<500)throw new Error('DEAL_NOT_FOUND');throw new Error('BITRIX_TEMPORARILY_UNAVAILABLE');}
      body=await response.json() as Body;break;
    }catch(error){if(error instanceof Error&&error.message==='DEAL_NOT_FOUND')throw error;if(attempt===1)throw new Error('BITRIX_TEMPORARILY_UNAVAILABLE');}
  }
  if(!body)throw new Error('BITRIX_TEMPORARILY_UNAVAILABLE');
  if (body.error || String(body.result?.ID) !== dealId) throw new Error('DEAL_NOT_FOUND');
  const raw = body.result?.UF_CRM_AI_IIN, iin = typeof raw==='string' ? raw.trim() : null;
  return { internalClientId:null, external:{system:'bitrix',dealId}, title:String(body.result?.TITLE||''), iin:validIin(iin) ? iin : null, retrievedAt:new Date().toISOString() };
}
