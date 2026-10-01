// Read-only checks of every current profile-queue entry plus supplied saved cases.
// Reports contain field IDs/counts/codes only; never client answers or source text.
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {storedPayload,digest} from './profile-source-fill.mjs';
const origin='https://assessment.anti-krizis.kz';
const ids=(process.env.AUDIT_CASE_IDS||'').split(',').filter(Boolean);
if(ids.some(id=>!/^\d{1,12}$/.test(id))||ids.length>500)throw Error('INVALID_AUDIT_COHORT');
const report={checkedAt:new Date().toISOString(),noAnswerWrites:true,noCrmWrites:true,cases:[]};
let cookie='';
const code=e=>/^[A-Z][A-Z0-9_]{1,80}$/.test(e?.code||'')?e.code:'AUDIT_REQUEST_FAILED';
async function request(path,body){
 const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});
 if(path==='/api/session')cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const data=await r.json();if(!r.ok)throw Object.assign(Error('REQUEST_FAILED'),{code:data.error||'HTTP_FAILURE',status:r.status,...(path.startsWith('/api/bitrix/')?{upstreamReason:({'Not found':'NOT_FOUND','Access denied':'ACCESS_DENIED','ID is not defined or invalid':'INVALID_ID'})[data.error_description]}:{})});return data;
}
const issue=i=>({code:i.code,...(i.key?{key:i.key}:{}),...(i.group?{group:i.group}:{}),...(Number.isInteger(i.row)?{row:i.row}:{})});
try{
 if(!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('NO_AUTH');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const queue=process.env.AUDIT_INCLUDE_QUEUE==='false'?[]:(await request('/api/profile-queue')).items;
 report.queueCount=queue.length;
 const targets=[...new Set([...ids,...queue.map(x=>x.dealId)])];let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<targets.length){
  const dealId=targets[next++],out={dealId,inProfileQueue:queue.some(x=>x.dealId===dealId),profileCompleted:!!queue.find(x=>x.dealId===dealId)?.profileSavedAt};report.cases.push(out);
  const root='/api/assessment/'+dealId;
  try{
   const context=await request(root);out.identityKnown=!!context.client?.iin;
   const draft=(await request(root+'/draft')).draft;
   out.draftRevision=draft?.revision??null;
   if(!draft){const docs=await request(root+'/crm-documents');out.crmDocuments=docs.files?.length??null;continue;}
   const p=storedPayload(draft.payload),hash=digest(p);out.documents=p.documents.length;out.pendingFiles=p.pendingFiles.length;
   if(context.client?.iin&&!draft.recovery){
    const check=await request(root+'/profile',{action:'check',requestId:randomUUID(),draft:p});
    out.profileReady=check.ready;out.profileIssues=(check.issues||[]).map(issue);
   }
   const check=await request(root+'/check',{payload:draft.payload,bindings:[]});
   out.contractAnswersComplete=check.answersComplete;out.contractIssues=(check.issues||[]).map(issue);
   out.documentIssues=(check.documents?.issues||[]).map(issue);const coverage=check.documents?.loanCoverage;out.loanCoverage=coverage?{expected:coverage.expected,present:coverage.present,missing:coverage.missing,duplicates:coverage.duplicates,complete:coverage.complete}:null;
   // No derived-analysis refresh, source review or confirmation is performed.
   const docIds=[...new Set(p.documents.map(d=>d.documentId).filter(Boolean))];out.analysis=[];
   for(let i=0;i<docIds.length;i+=8){const batch=await request(root+'/documents/analyze',{identityRevision:context.identityRevision,documentIds:docIds.slice(i,i+8)});
    for(const r of batch.results){const a=r.analysis,e=a?.document?.extraction;out.analysis.push({documentId:r.documentId,...(r.error?{error:r.error}:{}),kind:e?.kind,eligible:a?.eligibleForAutofill,pages:a?.document?.totalPages,loans:e?.credits?.length,completeCreditList:e?.creditList?.complete,findings:a?.findings});}
   }
   const latest=(await request(root+'/draft')).draft;out.draftUnchanged=!!latest&&latest.revision===draft.revision&&digest(storedPayload(latest.payload))===hash;
  }catch(e){out.error=code(e);out.status=e.status;
   // Distinguish inaccessible/missing CRM records from failures inside our app.
   try{const crm=await request('/api/bitrix/crm.deal.get',{id:dealId});out.crmProbe={found:String(crm.result?.ID)===dealId,error:crm.error&&/^[A-Z_]+$/.test(crm.error)?crm.error:undefined};}
   catch(cause){out.crmProbe={error:code(cause),status:cause.status,reason:cause.upstreamReason};}
  }finally{writeFileSync('workflow-cohort-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({dealId,checked:report.cases.length,total:targets.length,error:out.error||null,profileIssues:out.profileIssues?.length??null}));}
 }}));
 report.cases.sort((a,b)=>Number(a.dealId)-Number(b.dealId));
 report.summary={total:targets.length,checked:report.cases.length,withDraft:report.cases.filter(c=>c.draftRevision).length,profileReady:report.cases.filter(c=>c.profileReady).length,errors:report.cases.filter(c=>c.error).length,changedDuringAudit:report.cases.filter(c=>c.draftUnchanged===false).length};
}catch(e){report.error=code(e);process.exitCode=1;}
writeFileSync('workflow-cohort-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary||{error:report.error}));
