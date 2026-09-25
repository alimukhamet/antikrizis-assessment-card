// Explicit owner maintenance, never scheduled. Only the guarded title endpoint
// may write; no client names, titles, answers or credentials enter this artifact.
import {writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz';
const dealId=process.env.REPAIR_TITLE_DEAL_ID,expectedHash=process.env.REPAIR_TITLE_EXPECTED_HASH;
const report={dealId,verified:false};let cookie='';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(path,body,raw=false){
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});
 if(path==='/api/session')cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Error('HTTP_'+response.status+'_'+(/^[A-Z_]+$/.test(data.error||'')?data.error:'REQUEST_FAILED'));}
 return raw?response.text():response.json();
}
const rows=text=>text.trim().split('\n').map(line=>JSON.parse(line));
const protectedCrm=deal=>Object.fromEntries(Object.entries(deal).filter(([key])=>key.startsWith('UF_CRM_')||['ID','CATEGORY_ID','STAGE_ID','STAGE_SEMANTIC_ID','ASSIGNED_BY_ID','OPPORTUNITY','CURRENCY_ID'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
try{
 if(!/^[1-9]\d{0,11}$/.test(dealId||'')||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('EXACT_TITLE_REPAIR_TARGET_REQUIRED');
 if(!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('TITLE_REPAIR_CREDENTIAL_UNAVAILABLE');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const root='/api/assessment/'+dealId;
 const beforeExport=rows(await request(root+'/export',null,true));
 const frozen=beforeExport.find(row=>row.type==='assessment-submission'&&row.payload_hash===expectedHash);
 if(!frozen||frozen.state!=='verified'||frozen.history_state!=='verified')throw Error('TITLE_REPAIR_SUBMISSION_CHANGED');
 const draftBefore=hash(await request(root+'/draft'));
 const dealBefore=(await request('/api/bitrix/crm.deal.get',{id:dealId})).result;
 const filesBefore=(await request(root+'/crm-documents')).files.map(f=>f.id).sort();
 const inspection=(await request(root+'/title-repair',{action:'inspect',expectedSubmissionHash:expectedHash})).repair;
 if(!inspection||!['PROPOSED','NOOP','PREPARED','WRITING','UNCERTAIN','VERIFIED','CANCELLED'].includes(inspection.status))throw Error('TITLE_REPAIR_RESPONSE_INVALID');
 report.beforeStatus=inspection.status;
 if(inspection.status==='CANCELLED')throw Error('TITLE_REPAIR_CANCELLED');
 let receipt=inspection;
 if(!['NOOP','VERIFIED'].includes(inspection.status)){
  if(!/^[a-f0-9]{64}$/.test(inspection.proposalHash||''))throw Error('TITLE_REPAIR_RESPONSE_INVALID');
  report.requestId=inspection.requestId||randomUUID();
  receipt=(await request(root+'/title-repair',{
   action:['WRITING','UNCERTAIN'].includes(inspection.status)?'reconcile':'repair',
   requestId:report.requestId,expectedProposalHash:inspection.proposalHash,
   expectedSubmissionHash:expectedHash,
  })).repair;
 }
 report.status=receipt?.status;
 if(!['NOOP','VERIFIED'].includes(receipt?.status))throw Error('TITLE_REPAIR_NOT_VERIFIED');
 const dealAfter=(await request('/api/bitrix/crm.deal.get',{id:dealId})).result;
 const filesAfter=(await request(root+'/crm-documents')).files.map(f=>f.id).sort();
 const after=rows(await request(root+'/export',null,true)).find(row=>row.type==='assessment-submission'&&row.request_id===frozen.request_id);
 report.checks={
  titleMatches:typeof receipt.desiredTitle==='string'&&dealAfter.TITLE===receipt.desiredTitle,
  protectedFieldsUnchanged:hash(protectedCrm(dealBefore))===hash(protectedCrm(dealAfter)),
  draftUnchanged:draftBefore===hash(await request(root+'/draft')),
  filesUnchanged:hash(filesBefore)===hash(filesAfter),
  snapshotUnchanged:after?.payload_hash===expectedHash&&hash(after?.payload)===hash(frozen.payload),
  originalReceiptsUnchanged:['actor_id','authentication','state','history_state','history_comment_id','created_at','updated_at'].every(key=>after?.[key]===frozen[key]),
 };
 report.verified=Object.values(report.checks).every(v=>v===true);
 if(!report.verified)throw Error('TITLE_REPAIR_READBACK_INCOMPLETE');
}catch(error){report.error=/^[A-Z0-9_]+$/.test(error.message)?error.message:'TITLE_REPAIR_REQUEST_FAILED';process.exitCode=1;}
await writeFile('lawyer-title-repair.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
