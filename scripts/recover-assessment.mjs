// Explicit maintenance action, never run by scheduled monitoring. No approvals,
// new snapshots, file uploads or stage changes. Output contains metadata only.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz';
const dealId=process.env.AUDIT_DEAL_ID,requestId=process.env.RECOVER_REQUEST_ID,expectedHash=process.env.RECOVER_EXPECTED_HASH;
const report={dealId,requestId,verified:false};let cookie='';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(path,body,raw=false){
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});
 if(path==='/api/session')cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 if(raw){if(!response.ok)throw Error('EXPORT_HTTP_'+response.status);return response.text();}
 const data=await response.json();
 if(!response.ok)throw Error('HTTP_'+response.status+'_'+(/^[A-Z_]+$/.test(data.error||'')?data.error:'REQUEST_FAILED'));
 return data;
}
try{
 if(!/^\d{1,12}$/.test(dealId||'')||! /^[0-9a-f-]{36}$/i.test(requestId||'')||! /^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('EXACT_RECOVERY_TARGET_REQUIRED');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const root='/api/assessment/'+dealId,context=await request(root);
 const beforeExport=(await request(root+'/export',null,true)).trim().split('\n').map(line=>JSON.parse(line));
 const frozen=beforeExport.find(v=>v.type==='assessment-submission'&&v.request_id===requestId);
 if(!frozen||frozen.payload_hash!==expectedHash)throw Error('RECOVERY_SNAPSHOT_CHANGED');
 report.before={state:frozen.state,historyState:frozen.history_state};
 const draftBefore=hash(await request(root+'/draft'));
 const dealBefore=(await request('/api/bitrix/crm.deal.get',{id:dealId})).result;
 const filesBefore=(await request(root+'/crm-documents')).files.map(f=>f.id).sort();
 const uploadedIds=beforeExport.filter(v=>v.type==='document-upload'&&v.state==='verified').flatMap(v=>v.receipt?.files?.map(f=>f.id)||[]);
 report.attachments={present:filesBefore.length,receipted:new Set(uploadedIds).size,allReceiptedPresent:uploadedIds.every(id=>filesBefore.includes(id))};
 if(!report.attachments.allReceiptedPresent)throw Error('SAVED_ATTACHMENT_MISSING');
 const result=await request(root+'/submission',{action:'recover',requestId,expectedHash,destination:{dealId,iin:context.client.iin,identityRevision:context.identityRevision}});
 report.result={state:result.state,assessmentSaved:result.assessmentSaved,historySaved:result.historySaved,outcomeCode:result.outcomeCode,historyOutcomeCode:result.historyOutcomeCode,contractAvailable:!!result.contract?.data,intakeStatus:result.assessmentIntakeSync?.status,intakeReason:result.assessmentIntakeSync?.reason};
 const receipt=(await request(root+'/submission?requestId='+encodeURIComponent(requestId))).submission;
 const dealAfter=(await request('/api/bitrix/crm.deal.get',{id:dealId})).result;
 const filesAfter=(await request(root+'/crm-documents')).files.map(f=>f.id).sort();
 const afterExport=(await request(root+'/export',null,true)).trim().split('\n').map(line=>JSON.parse(line));
 const after=afterExport.find(v=>v.type==='assessment-submission'&&v.request_id===requestId);
 report.readback={assessmentSaved:receipt.assessmentSaved,historySaved:receipt.historySaved,cardMatches:dealAfter?.UF_CRM_AI_CARD===frozen.payload.values.card,snapshotUnchanged:after?.payload_hash===expectedHash&&hash(after?.payload)===hash(frozen.payload),authorUnchanged:after?.actor_id===frozen.actor_id,draftUnchanged:draftBefore===hash(await request(root+'/draft')),filesUnchanged:hash(filesBefore)===hash(filesAfter),stageUnchanged:dealBefore?.STAGE_ID===dealAfter?.STAGE_ID&&dealBefore?.CATEGORY_ID===dealAfter?.CATEGORY_ID,responsibleUnchanged:dealBefore?.ASSIGNED_BY_ID===dealAfter?.ASSIGNED_BY_ID};
 report.verified=Object.values(report.readback).every(v=>v===true)&&report.result.contractAvailable;
 if(!report.verified)throw Error('RECOVERY_READBACK_INCOMPLETE');
}catch(error){report.error=/^[A-Z0-9_]+$/.test(error.message)?error.message:'RECOVERY_REQUEST_FAILED';process.exitCode=1;}
await writeFile('assessment-recovery.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
