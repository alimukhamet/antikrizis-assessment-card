// Normal sign-in, existing cases and validation. Optional refresh updates only
// derived analysis for stored originals; it never saves answers or writes Bitrix.
// Never emit credentials, questionnaire values, client names, or document bytes.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {auditFailures} from './live-audit-result.mjs';
const caseIds=['10479','11749','11877','11665'];
const diagnosticId=process.env.AUDIT_DEAL_ID||'';
if(diagnosticId&&!/^\d{1,12}$/.test(diagnosticId))throw Error('Invalid audit deal ID');
if(diagnosticId&&!caseIds.includes(diagnosticId))caseIds.push(diagnosticId);
const origin='https://assessment.anti-krizis.kz';
let cookie='';
const report={origin,authenticated:false,cases:[]};
async function request(path,body){
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60_000)});
 const data=await response.json();
 if(path==='/api/session'&&body)cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 if(!response.ok)throw Object.assign(Error(path+' HTTP '+response.status+' '+String(data.error||'UNKNOWN').slice(0,120)),{code:data.error});
 return data;
}
try{
 if(!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('Missing test password');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 report.authenticated=(await request('/api/session')).ok===true;
 report.status=await request('/api/status');
 const launcher=await fetch(origin+'/assessment-card.html',{headers:{cookie},redirect:'error',signal:AbortSignal.timeout(30_000)});
 const launcherHtml=await launcher.text();
 report.launcher={status:launcher.status,currentTools:['assessment','handoff'].every(tool=>launcherHtml.includes('data-main-action="'+tool+'"')),legacyFormsAbsent:!/(?:id="(?:contractBtn|docsBtn|dealLookup)"|data-open-view=)/.test(launcherHtml)};
 if(launcher.status!==200||!report.launcher.currentTools||!report.launcher.legacyFormsAbsent)throw Error('Current-only launcher verification failed');
 report.retiredMethods=[];
 for(const method of ['crm.deal.update','crm.timeline.comment.add','crm.item.update']){
  const response=await fetch(origin+'/api/bitrix/'+method,{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(30_000)}),data=await response.json();
  report.retiredMethods.push({method,status:response.status,code:data.error});
  if(response.status!==410||data.error!=='OLD_TOOL_RETIRED')throw Error('Legacy write method remains available: '+method);
 }

 for(const id of caseIds){
  const root='/api/assessment/'+id,item={dealId:id};report.cases.push(item);
  const assessment=await request(root);
  item.identityRevision=assessment.identityRevision;item.hasIin=Boolean(assessment.client?.iin);
  for(const route of ['draft','submission','uploads','credentials','handoff','crm-documents']){
   try{
    const data=await request(root+'/'+route);
    if(route==='draft'){
     const d=data.draft,p=d?.payload;
     item.draft={present:!!d,revision:d?.revision,identityRevision:d?.identityRevision,answers:p?.answers?.length,groups:p?.groups?.length,documents:p?.documents?.map(v=>({type:v.type,person:v.person})),pendingFiles:p?.pendingFiles?.length};
     if(p){
      if(id===diagnosticId){
       item.documentDiagnostics=[];const before=createHash('sha256').update(JSON.stringify(d)).digest('hex');
       for(const doc of p.documents){
        const result={documentId:doc.documentId,type:doc.type};item.documentDiagnostics.push(result);
        try{
         const a=await request(root+'/documents/'+encodeURIComponent(doc.documentId)+'/analyze',{cacheOnly:true}),text=a.document?.pages?.[0]?.text||'';
         Object.assign(result,{kind:a.document?.extraction?.kind,pages:a.document?.totalPages,issuedAt:a.reviewContext?.issuedAt,expiresAt:a.reviewContext?.expiresAt,allHistory:a.reviewContext?.allHistory,periodLabel:/Барлық\s+кезең\s*\/\s*Весь\s+период/i.test(text),periodBeforeLabel:/Весь\s+период\s*Период:/i.test(text),periodAfterLabel:/Период:\s*Барлық\s+кезең\s*\/\s*Весь\s+период/i.test(text),documentReview:a.documentReview,findings:a.findings});
        }catch(error){result.error=error.code||'REQUEST_FAILED';}
       }
       item.reviewDrafts=p.documentReviewDrafts?.map(v=>({documentId:v.documentId,type:v.type,issuedAt:v.values?.issuedAt,expiresAt:v.values?.expiresAt}))||[];
       item.diagnosticDraftUnchanged=before===createHash('sha256').update(JSON.stringify((await request(root+'/draft')).draft)).digest('hex');
      }
      if(process.env.REFRESH_SAVED_ANALYSIS==='true'&&id==='11749'){
       const before=createHash('sha256').update(JSON.stringify(d)).digest('hex');item.analysisRefresh=[];
       for(const doc of p.documents){
        const result={type:doc.type};item.analysisRefresh.push(result);
        try{
         let analysis;
         try{analysis=await request(root+'/documents/'+encodeURIComponent(doc.documentId)+'/analyze',{cacheOnly:true});result.state='current';}
         catch(error){if(error.code!=='CACHE_REPROCESS_REQUIRED')throw error;analysis=await request(root+'/documents/'+encodeURIComponent(doc.documentId)+'/analyze',{cacheOnly:false});result.state='refreshed';}
         result.sameDocument=analysis.documentId===doc.documentId;result.sameIdentity=analysis.identityRevision===assessment.identityRevision;result.pages=analysis.document?.totalPages;
        }catch(error){result.error=error.message;}
       }
       const after=(await request(root+'/draft')).draft;
       item.draftUnchanged=before===createHash('sha256').update(JSON.stringify(after)).digest('hex');
       if(!item.draftUnchanged)throw Error('Draft changed during analysis refresh; investigate concurrent changes.');
      }
      const check=await request(root+'/check',{payload:p,bindings:[]});
      item.check={readyToSubmit:check.readyToSubmit,answersComplete:check.answersComplete,remainingGates:check.remainingGates,missing:check.missing,issues:check.issues,documentIssues:check.documents?.issues?.map(v=>({code:v.code,message:v.message})),evidenceIssues:check.evidence?.issues};
     }
    }else if(route==='submission'){
     const s=data.submission;item.submission=s?{state:s.state,outcomeCode:s.outcomeCode,historyState:s.historyState,historyOutcomeCode:s.historyOutcomeCode}:null;
     if(s?.assessmentSaved&&s?.historySaved){const contract=await request(root+'/submission',{action:'contract',requestId:s.requestId});item.savedContract={available:!!contract.contract?.data,rendererVersion:contract.contract?.rendererVersion};}
    }else if(route==='handoff'){item.handoff={state:data.handoff?.state||null,stageError:data.stageError,destination:data.destination};}
    else if(route==='crm-documents'){item.crmDocuments={count:data.files?.length,types:data.files?.map(v=>({field:v.field,kind:v.kind}))};}
    else item[route]={unsent:!!data.unsent,verified:data.credentials?.verified,files:data.credentials?.files?.length,keys:Object.keys(data)};
   }catch(error){item[route+'Error']=error.message;}
  }
 }
}catch(error){report.error=error.message;process.exitCode=1;}
report.failures=auditFailures(report,caseIds);
report.ok=report.failures.length===0;
if(!report.ok)process.exitCode=1;
await writeFile('live-tools-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
