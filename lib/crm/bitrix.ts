import { validIin } from '../documents/extract-native';
export type ClientContext = { internalClientId: string | null; external: { system: 'bitrix'; dealId: string }; title: string; iin: string | null; retrievedAt: string };
/** All Bitrix field IDs are confined to this adapter. */
export async function readClientContext(dealId: string, webhook: string, send: typeof fetch = fetch): Promise<ClientContext> {
  if (!/^[1-9]\d*$/.test(dealId)) throw new Error('INVALID_DEAL_ID');
  if (!webhook) throw new Error('BITRIX_NOT_CONFIGURED');
  const response = await send(webhook.replace(/\/?$/, '/') + 'crm.deal.get.json', {
    method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({id:Number(dealId)}), signal: AbortSignal.timeout(20000), cache:'no-store',
  });
  if (!response.ok) throw new Error('BITRIX_READ_FAILED');
  const body = await response.json() as { result?: { ID?: string; TITLE?: string; UF_CRM_AI_IIN?: unknown }; error?: string };
  if (body.error || String(body.result?.ID) !== dealId) throw new Error('DEAL_NOT_FOUND');
  const raw = body.result?.UF_CRM_AI_IIN, iin = typeof raw==='string' ? raw.trim() : null;
  return { internalClientId:null, external:{system:'bitrix',dealId}, title:String(body.result?.TITLE||''), iin:validIin(iin) ? iin : null, retrievedAt:new Date().toISOString() };
}
