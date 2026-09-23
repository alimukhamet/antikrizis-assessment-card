// Owner-requested incident recovery. Existing employee answers remain a draft;
// no source reviews, final submissions, contract generations or stage moves.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz',dealId=process.env.RECOVERY_DEAL_ID;
const report={dealId,verified:false,finalAssessment:false};let cookie='';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function request(path,body,raw=false){
 const response=await fetch(origin+path,{method:body?'POST':'GET',redirect:'error',headers:{cookie,origin,'content-type':'application/json','sec-fetch-site':'same-origin'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
 if(path==='/api/session')cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 if(!response.ok){let code;try{code=(await response.json()).error;}catch{}throw Error(/^[A-Z_]+$/.test(code||'')?code:'RECOVERY_HTTP_'+response.status);}
 return raw?response.text():response.json();
}
try{
 if(!['11727','12221'].includes(dealId)||!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('EXACT_RECOVERY_TARGET_REQUIRED');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const root='/api/assessment/'+dealId;
 if(process.env.RECOVERY_PROBE_ONLY==='true'){report.probe=await request(root+'/draft-recovery',{action:'probe-transport'});await writeFile('draft-delivery-recovery.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(0);}
 const draftBefore=await request(root+'/draft'),sourceBefore=(await request(root+'/export',null,true)).trim().split('\n').map(v=>JSON.parse(v));
 const unchangedRows=v=>v.filter(r=>['document','extraction','questionnaire-draft','review','assessment-submission'].includes(r.type));
 const before=(await request('/api/bitrix/crm.deal.get',{id:dealId})).result;
 const fileIds=(await request(root+'/crm-documents')).files.map(f=>f.id).sort();
 const inspection=await request(root+'/draft-recovery',{action:'inspect'});report.inspection=inspection;
 if(!/^[a-f0-9]{64}$/.test(inspection.planHash||''))throw Error('RECOVERY_PROPOSAL_UNVERIFIED');
 let result;
 try{result=await request(root+'/draft-recovery',{action:'recover',expectedHash:inspection.planHash});}
 catch{result=await request(root+'/draft-recovery',{action:'reconcile',expectedHash:inspection.planHash});}
 report.result=result;
 if(result.state!=='verified')throw Error('RECOVERY_NOT_YET_VERIFIED');
 const after=(await request('/api/bitrix/crm.deal.get',{id:dealId})).result;
 const filesAfter=(await request(root+'/crm-documents')).files.map(f=>f.id).sort();
 const sourceAfter=(await request(root+'/export',null,true)).trim().split('\n').map(v=>JSON.parse(v));
 const answers=Object.fromEntries(draftBefore.draft.payload.answers.map(a=>[a.key,a.value]));
 const unchanged=['CATEGORY_ID','STAGE_ID','ASSIGNED_BY_ID','CONTACT_ID','COMPANY_ID','OPPORTUNITY','CURRENCY_ID','UF_CRM_AI_DEBT','UF_CRM_AI_MONTHS','UF_CRM_AI_PAYDAY','UF_CRM_AI_GRAFTEXT'];
 report.readback={draftUnchanged:hash(draftBefore)===hash(await request(root+'/draft')),sourceRecordsUnchanged:hash(unchangedRows(sourceBefore))===hash(unchangedRows(sourceAfter)),protectedFieldsUnchanged:unchanged.every(k=>hash(before[k]??null)===hash(after[k]??null)),priorFilesPreserved:fileIds.every(id=>filesAfter.includes(id)),expectedFileCount:filesAfter.length===10,cardMarkedDraft:after.UF_CRM_AI_CARD?.startsWith('ВОССТАНОВЛЕННЫЙ ЧЕРНОВИК — ПРОВЕРКА НЕ ЗАВЕРШЕНА')===true,nameMatches:after.UF_CRM_1773669702495===answers.fio.trim(),titleMatches:after.TITLE==='ВП '+answers.fio.trim().replace(/\s+/gu,' '),submissionStillAbsent:(await request(root+'/submission?scope=case')).submission===null};
 report.fileCount=filesAfter.length;report.verified=Object.values(report.readback).every(v=>v===true);
 if(!report.verified)throw Error('RECOVERY_READBACK_FAILED');
}catch(error){report.error=/^[A-Z0-9_]+$/.test(error.message)?error.message:'RECOVERY_REQUEST_FAILED';process.exitCode=1;}
await writeFile('draft-delivery-recovery.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
