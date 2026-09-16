/** Bitrix's documented integration headers. Never put webhook secrets in Referer. */
export function bitrixHeaders(webhook:string,kind:'json'|'file'='json'){
 const portal=new URL(webhook);
 if(portal.protocol!=='https:'||portal.username||portal.password)throw Error('INVALID_BITRIX_CONFIGURATION');
 return {'user-agent':'AntikrizisAssessment/1.0',accept:kind==='file'?'*/*':'application/json',
  ...(kind==='json'?{'content-type':'application/json'}:{'accept-language':'ru-RU,ru;q=0.9,en;q=0.8',referer:portal.origin+'/'})};
}
