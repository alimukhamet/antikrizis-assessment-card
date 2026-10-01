// Owner-triggered queue inspection and exact, additive draft fill. No profile,
// review, contract, history, stage or CRM publication is performed.
import {randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import {validateDraft} from '../.profile-fill-validation.mjs';
import {planProfileSourceFill,digest,storedPayload} from './profile-source-fill.mjs';
const origin='https://assessment.anti-krizis.kz',apply=process.env.PROFILE_FILL_APPLY==='true';
const ids=(process.env.PROFILE_FILL_IDS||'').split(',').filter(Boolean),pins=JSON.parse(process.env.PROFILE_FILL_PINS||'{}'),guards=JSON.parse(process.env.PROFILE_FILL_GUARDS||'{}');
const report={apply,checkedAt:new Date().toISOString(),cases:[],failures:[],noProfileWrite:true,noReviewWrite:true,noCrmWrite:true};let cookie='';
const errorCode=e=>/^[A-Z][A-Z0-9_]{1,80}$/.test(e.code||'')?e.code:'PROFILE_FILL_STOPPED';
async function request(path,body){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(90000)});if(path==='/api/session')cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const data=await r.json();if(!r.ok)throw Object.assign(new Error('HTTP_'+r.status),{code:data.error||'HTTP_'+r.status});return data;}
function checkGuard(guard,context,draft){
 if(!guard||guard.caseId!==context.caseId||guard.identityRevision!==context.identityRevision||guard.revision!==draft.revision||guard.beforeHash!==digest(storedPayload(draft.payload)))throw Object.assign(new Error(),{code:'GUARD_CHANGED'});
 if(Date.now()-Date.parse(guard.checkedAt)<0||Date.now()-Date.parse(guard.checkedAt)>600000)throw Object.assign(new Error(),{code:'GUARD_EXPIRED'});
 if(!Number.isFinite(Date.parse(guard.checkedAt))||!Array.isArray(guard.pendingWrites)||guard.pendingWrites.length||guard.completed!==false||guard.pendingHistory!==false||guard.originalsChanged!==false||!Array.isArray(guard.history?.protectedFields)||typeof guard.history.allowNewLoans!=='boolean')throw Object.assign(new Error(),{code:'GUARD_BLOCKED'});
}
try{
 assert.ok(process.env.ASSESSMENT_TEST_PASSWORD);assert.ok(!apply||ids.length>0&&ids.length<=8);
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const queue=(await request('/api/profile-queue')).items;report.queue=queue.map(x=>({dealId:x.dealId,completed:Boolean(x.profileSavedAt)}));
 const targets=ids.length?queue.filter(x=>ids.includes(x.dealId)):queue;
 if(ids.some(id=>!targets.some(x=>x.dealId===id)))throw Object.assign(new Error(),{code:'CASE_NOT_IN_CURRENT_QUEUE'});
 let index=0;await Promise.all(Array.from({length:apply?1:3},async()=>{while(index<targets.length){
  const item=targets[index++],out={dealId:item.dealId,completed:Boolean(item.profileSavedAt)};report.cases.push(out);
  try{
   const root='/api/assessment/'+item.dealId,context=await request(root),draft=(await request(root+'/draft')).draft;
   out.identityKnown=Boolean(context.client?.iin);out.revision=draft?.revision??null;
   if(!draft){const crm=await request(root+'/crm-documents');out.notFilled='NO_SAVED_DRAFT';out.availableCrmDocuments=crm.documents?.length??null;continue;}
   out.documents=draft.payload.documents.length;out.pendingFiles=draft.payload.pendingFiles.length;
   if(draft.recovery){out.notFilled='IDENTITY_RECOVERY_REQUIRED';continue;}
   if(apply&&item.profileSavedAt){out.notFilled='COMPLETED_PROFILE_PRESERVED';continue;}
   const docs=draft.payload.documents.filter(d=>d.documentId&&d.person==='Клиент'&&!/ЭЦП|парол|Подписанный договор/iu.test(d.type));
   const analyses=[];out.documentFindings=[];
   for(let i=0;i<docs.length;i+=8){const rows=(await request(root+'/documents/analyze',{identityRevision:context.identityRevision,documentIds:[...new Set(docs.slice(i,i+8).map(d=>d.documentId))]})).results;
    for(const r of rows){let a=r.analysis;if(r.error==='CACHE_REPROCESS_REQUIRED')a=await request(root+'/documents/'+encodeURIComponent(r.documentId)+'/analyze',{cacheOnly:false});else if(r.error){out.documentFindings.push({documentId:r.documentId,error:r.error});continue;}
     analyses.push(a);out.documentFindings.push({documentId:a.documentId,kind:a.document.extraction.kind,eligible:a.eligibleForAutofill,loans:a.document.extraction.credits.length,findings:a.findings,ocrPages:a.document.pages.filter(p=>p.needsOcr).length});
    }
   }
   const guard=guards[item.dealId];if(guard)checkGuard(guard,context,draft);if(apply&&!guard)throw Object.assign(new Error(),{code:'FRESH_HISTORY_GUARD_REQUIRED'});
   const history=guard?guard.history:{protectedFields:[],allowNewLoans:true};
   const plan=planProfileSourceFill(draft,context,analyses,validateDraft,history);
   Object.assign(out,{historyChecked:Boolean(guard),beforeHash:plan.beforeHash,afterHash:plan.afterHash,planHash:plan.planHash,newLoans:plan.newLoans,changes:plan.changes.map(({value,...change})=>({...change,valueHash:digest(value)})),skipped:plan.skipped,migrated:plan.migrated});
   const readiness=await request(root+'/profile',{action:'check',requestId:randomUUID(),draft:plan.payload});
   out.readyAfterFill=readiness.ready;out.remainingIssues=(readiness.issues||[]).map(({code,key,group,row})=>({code,key,group,row}));
   const latest=(await request(root+'/draft')).draft;if(latest.revision!==draft.revision||digest(storedPayload(latest.payload))!==plan.beforeHash)throw Object.assign(new Error(),{code:'DRAFT_CHANGED'});
   if(!plan.changes.length){out.unchanged=true;continue;}if(!apply){out.previewOnly=true;continue;}
   const pin=pins[item.dealId];if(!pin||pin.planHash!==plan.planHash||!/^\w{8}-(?:\w{4}-){3}\w{12}$/.test(pin.requestId))throw Object.assign(new Error(),{code:'EXACT_PLAN_PIN_REQUIRED'});
   const activity=await request('/api/profile-activity');if(activity.active.some(x=>x.dealId===item.dealId)||activity.completed.some(x=>x.dealId===item.dealId))throw Object.assign(new Error(),{code:'PROFILE_ACTIVE_OR_COMPLETED'});
   const current=await request(root),last=(await request(root+'/draft')).draft;checkGuard(guard,current,last);
   if(current.client.iin!==context.client.iin)throw Object.assign(new Error(),{code:'CASE_IDENTITY_CHANGED'});
   out.requestId=pin.requestId;out.writeAttempted=true;
   const saved=await request(root+'/draft',{payload:plan.payload,expectedRevision:draft.revision,identityRevision:context.identityRevision,requestId:pin.requestId});
   const after=(await request(root+'/draft')).draft;if(after.revision!==saved.revision||after.revision!==draft.revision+1||digest(storedPayload(after.payload))!==plan.afterHash)throw Object.assign(new Error(),{code:'SAVED_DRAFT_MISMATCH'});
   Object.assign(out,{verified:true,afterRevision:after.revision,filledFields:plan.changes.length});
  }catch(e){out.error=errorCode(e);if(out.writeAttempted&&!out.verified)out.reconciliationRequired=true;report.failures.push({dealId:item.dealId,code:out.error});}finally{console.log(JSON.stringify({dealId:item.dealId,checked:report.cases.length,total:targets.length,proposed:out.changes?.length||0,error:out.error||null}));}
 }}));
}catch(e){report.failures.push({code:errorCode(e)});}
report.cases.sort((a,b)=>Number(a.dealId)-Number(b.dealId));
report.summary={queue:report.queue?.length,cases:report.cases.length,withDraft:report.cases.filter(x=>x.revision).length,withoutDraft:report.cases.filter(x=>x.notFilled==='NO_SAVED_DRAFT').length,proposedFields:report.cases.reduce((n,c)=>n+(c.changes?.length||0),0),proposedNewLoans:report.cases.reduce((n,c)=>n+(c.newLoans||0),0),changedCases:report.cases.filter(x=>x.verified).length,filledFields:report.cases.reduce((n,c)=>n+(c.filledFields||0),0),failures:report.failures.length};
await writeFile('profile-source-fill-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));if(report.failures.length)process.exitCode=1;
