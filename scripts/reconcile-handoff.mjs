// Explicit owner readback of one existing handoff. Never sends files or stages.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz';
const dealId=process.env.AUDIT_DEAL_ID,requestId=process.env.RECONCILE_HANDOFF_REQUEST_ID,expectedHash=process.env.RECONCILE_HANDOFF_EXPECTED_HASH;
const report={dealId,requestId,verified:false};let cookie='';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(path,body){
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(90000)});
 if(path==='/api/session')cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const data=await response.json();
 if(!response.ok)throw Error('HTTP_'+response.status+'_'+(/^[A-Z_]+$/.test(data.error||'')?data.error:'REQUEST_FAILED'));
 return data;
}
const protectedCrm=deal=>Object.fromEntries(Object.entries(deal).filter(([key])=>key.startsWith('UF_CRM_')||['ID','TITLE','CATEGORY_ID','STAGE_ID','STAGE_SEMANTIC_ID','ASSIGNED_BY_ID','OPPORTUNITY','CURRENCY_ID'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
try{
 if(!/^[1-9]\d{0,11}$/.test(dealId||'')||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId||'')||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('EXACT_HANDOFF_RECEIPT_REQUIRED');
 if(!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('CREDENTIAL_UNAVAILABLE');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const root='/api/assessment/'+dealId,context=await request(root),before=(await request(root+'/handoff')).handoff;
 if(!before||before.requestId!==requestId||!['writing','uncertain','verified'].includes(before.state))throw Error('HANDOFF_RECEIPT_CHANGED');
 const draft=hash(await request(root+'/draft')),submission=hash(await request(root+'/submission?scope=case')),uploads=hash(await request(root+'/uploads'));
 const crm=hash(protectedCrm((await request('/api/bitrix/crm.deal.get',{id:dealId})).result));
 report.beforeState=before.state;
 const receipt=(await request(root+'/handoff',{action:'reconcile',requestId,expectedHash,destination:{dealId,iin:context.client.iin,identityRevision:context.identityRevision}})).handoff;
 const after=(await request(root+'/handoff')).handoff;
 report.afterState=after?.state;report.outcomeCode=after?.outcomeCode;
 report.checks={
  receiptVerified:receipt?.requestId===requestId&&receipt?.state==='verified'&&after?.requestId===requestId&&after?.state==='verified',
  crmUnchanged:crm===hash(protectedCrm((await request('/api/bitrix/crm.deal.get',{id:dealId})).result)),
  draftUnchanged:draft===hash(await request(root+'/draft')),
  submissionUnchanged:submission===hash(await request(root+'/submission?scope=case')),
  uploadsUnchanged:uploads===hash(await request(root+'/uploads')),
 };
 report.verified=Object.values(report.checks).every(value=>value===true);
 if(!report.verified)throw Error('HANDOFF_READBACK_INCOMPLETE');
}catch(error){report.error=/^[A-Z0-9_]+$/.test(error.message)?error.message:'HANDOFF_RECONCILIATION_FAILED';process.exitCode=1;}
await writeFile('handoff-reconciliation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
