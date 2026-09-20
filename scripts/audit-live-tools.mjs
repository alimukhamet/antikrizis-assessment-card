// Normal sign-in, existing cases and validation. Optional refresh updates only
// derived analysis for stored originals; it never saves answers or writes Bitrix.
// Never emit credentials, questionnaire values, client names, or document bytes.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {auditFailures} from './live-audit-result.mjs';
const caseIds=['10479','11749','11877','11665'];
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
