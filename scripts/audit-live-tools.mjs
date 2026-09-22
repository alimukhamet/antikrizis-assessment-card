const previewGkb=process.env.PREVIEW_NATIVE_ANALYSIS==='1'?await import('../.audit-gkb-preview.mjs'):null;
const previewNative=process.env.PREVIEW_NATIVE_ANALYSIS==='1'?(await import('../.audit-native-preview.mjs')).extractNative:null;
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
       item.documentDiagnostics=[];const creditReports=[],storedReports=[],reviewBindings=new Map();const before=createHash('sha256').update(JSON.stringify(d)).digest('hex');
       for(const doc of p.documents){
        const result={documentId:doc.documentId,type:doc.type};item.documentDiagnostics.push(result);
        try{
         const a=await request(root+'/documents/'+encodeURIComponent(doc.documentId)+'/analyze',{cacheOnly:true}),text=a.document?.pages?.[0]?.text||'';
         Object.assign(result,{kind:a.document?.extraction?.kind,recognitionVersion:a.document?.extraction?.version,savedReviews:a.reviews?.length,pages:a.document?.totalPages,issuedAt:a.reviewContext?.issuedAt,expiresAt:a.reviewContext?.expiresAt,allHistory:a.reviewContext?.allHistory,periodLabel:/Барлық\s+кезең\s*\/\s*Весь\s+период/i.test(text),periodBeforeLabel:/Весь\s+период\s*Период:/i.test(text),periodAfterLabel:/Период:\s*Барлық\s+кезең\s*\/\s*Весь\s+период/i.test(text),documentReview:a.documentReview,findings:a.findings});
         if(previewNative&&a.document?.pages){
          const preview=previewNative(a.document.pages),st=preview.bankStatement;
          result.parserPreview={kind:preview.kind,issuedAt:preview.issuedAt,expiresAt:preview.expiresAt,identityMatches:!!preview.identity.iin&&preview.identity.iin===assessment.client.iin,findings:preview.findings,...(st?{statement:{from:st.from,to:st.to,rowsReadable:st.rowsReadable,reconciled:st.reconciled,topUpsVerified:st.topUpsVerified,transactions:st.transactions,reconciliation:st.reconciliation}}:{})};
          if(st){
           const starts=new Map();let topUps=0n;
           for(const page of a.document.pages)for(const row of page.text.matchAll(/^\d{2}\.\d{2}\.(?:\d{4}|\d{2})\s+([+−-])\s*([\d \u00a0]+[,.]\d{2})\s*₸([^\n]*)/gm)){
            const label=row[3].trim().split(/\s+/)[0];starts.set(label,(starts.get(label)||0)+1);
            if(/^Толықтыру(?:\s|$)/u.test(row[3].trim()))topUps+=BigInt(row[2].replace(/[\s,.]/g,''))*(row[1]==='+'?1n:-1n);
           }
           const summaries=a.document.pages.flatMap(p=>[...p.text.matchAll(/(?:^|\n)Толықтыру[ \t]+([+−-])\s*([\d \u00a0]+[,.]\d{2})\s*₸/gu)]);
           result.parserPreview.kazakhLabels={operationTokens:[...starts],summaryCount:summaries.length,topUpsMatch:summaries.length===1&&topUps===BigInt(summaries[0][2].replace(/[\s,.]/g,''))};
          }

         }
         // Recheck existing employee reviews without approving or changing anything.
         const direct={'identity.iin':'iin','identity.name':'fio','statement.topUps':'kaspiAnnual','employment.payersCount':'count-clientjobs','benefits.count':'clientBenefitsCount','statement.gambling':'n8044'};
         const loanKeys={creditor:'n8038',contractIdentifier:'loanContractId',loanStatus:'loanStatus',startedAtMonth:'n8038Start',monthlyPayment:'n8041',overdueDays:'n8042',debtOutstanding:'n8040',creditType:'n8039',purpose:'n8043',relatedParties:'loanParticipants'};
         const creditorKey=v=>String(v).normalize('NFKC').toLocaleLowerCase('ru-RU').trim().replace(/^акционерное\s+общество(?=\s|[«"“])/u,'ао').replace(/[«»“”„]/g,'"').replace(/\s+/g,'');
         for(const review of a.reviews||[]){
          const loan=/^credits\.(\d+)\.([A-Za-z]+)$/.exec(review.fact_key);let key=direct[review.fact_key],group,row,answer;
          if(loan){
           key=loanKeys[loan[2]];if(!key)continue;const credit=a.document.extraction.credits[Number(loan[1])];if(!credit)continue;
           const lender=creditorKey(credit.facts.find(f=>f.key==='creditor')?.value||''),numbers=[credit.contractNumber,credit.contractCode].filter(Boolean),rows=p.groups.find(g=>g.id==='creditors');
           row=rows?.rowKeys.findIndex(k=>{const parts=k.split('|');return parts[1]===assessment.client.iin&&creditorKey(parts[2])===lender&&numbers.includes(parts[3]?.trim());});
           if(row===undefined||row<0)continue;group='creditors';answer=rows.rows[row].find(v=>v.key===key);
          }else{if(!key)continue;answer=p.answers.find(v=>v.key===key);}
          let value;try{value=JSON.parse(review.value_json);}catch{continue;}
          if(answer?.value!==value)continue;
          reviewBindings.set(JSON.stringify([group,row,key]),{key,...(group?{group,row}:{}),documentId:doc.documentId,extractionId:a.extractionId,factKey:review.fact_key,reviewId:review.id});
         }
         if(a.document?.extraction?.kind?.startsWith('gkb_')){creditReports.push(a.document.extraction);storedReports.push({document:{id:doc.documentId},extraction:{id:a.extractionId},result:{read:{pages:a.document.pages},extraction:a.document.extraction}});}
        }catch(error){result.error=error.code||'REQUEST_FAILED';}
       }
       // Compare in memory: never export borrower identifiers, contract numbers or balances.
       const compact=v=>(v||'').normalize('NFKC').toLocaleLowerCase('ru').replace(/\s+/g,''),facts=c=>Object.fromEntries(c.facts.map(f=>[f.key,f.value]));
       item.creditDiagnostics=creditReports.map(r=>({kind:r.kind,list:r.creditList,count:r.credits.length,rows:r.credits.map(c=>({page:c.page,creditor:facts(c).creditor,keys:c.facts.map(f=>f.key),truncated:/\.\.|…/.test(c.contractNumber),comparisonDebtPresent:!!c.comparisonDebt}))}));
       const short=creditReports.find(r=>r.kind==='gkb_short'),full=creditReports.find(r=>r.kind==='gkb_full');
       if(short&&full)item.creditMatchDiagnostics=short.credits.map((s,shortIndex)=>({shortIndex,candidates:full.credits.map((f,fullIndex)=>{const sf=facts(s),ff=facts(f),parts=s.contractNumber.split(/\.{2,}|…/),numbers=[f.contractNumber,f.contractCode].filter(Boolean);return {fullIndex,creditorEqual:compact(sf.creditor)===compact(ff.creditor),literalCreditorEqual:sf.creditor===ff.creditor,numberEqual:numbers.includes(s.contractNumber),prefixMatches:numbers.some(n=>n.startsWith(parts[0])&&(parts.length===1||n.endsWith(parts[1]))),visibleNumberLength:parts.join('').length,debtEqual:Number(sf.debtOutstanding)===Number(ff.debtOutstanding),comparisonDebtEqual:!!f.comparisonDebt&&Number(sf.debtOutstanding)===Number(f.comparisonDebt.value),overdueEqual:Number(sf.overdueDays)===Number(ff.overdueDays)};})}));
       if(previewGkb){
        const shortStored=storedReports.find(r=>r.result.extraction.kind==='gkb_short'),fullStored=storedReports.find(r=>r.result.extraction.kind==='gkb_full');
        if(shortStored&&fullStored){
         const inspection=await previewGkb.inspectGkbBalanceReview({currentReviews:async()=>[]},{id:assessment.caseId,client_iin:assessment.client.iin,identity_revision:assessment.identityRevision},shortStored,fullStored,assessment.assessmentDay);
         item.balanceReviewPreview={eligible:!!inspection,missingBalances:inspection?.plan.balances.length,activeLoans:inspection?.plan.activeLoans,questionnaireAmountsMatch:inspection?previewGkb.gkbBalanceRows(p,inspection).every(r=>r.matches):null};
         try{const live=await request(root+'/gkb-reviews',{action:'inspect',shortDocumentId:shortStored.document.id,fullDocumentId:fullStored.document.id,identityRevision:assessment.identityRevision});item.balanceReviewLive={eligible:!!live.inspection,missingBalances:live.inspection?.plan.balances.length,activeLoans:live.inspection?.plan.activeLoans,confirmed:!!live.inspection?.review};}catch(error){item.balanceReviewLive={error:error.code||'ROUTE_NOT_RELEASED'};}
        }
       }
       if(reviewBindings.size){const checked=await request(root+'/check',{payload:p,bindings:[...reviewBindings.values()]});item.savedReviewCheck={bindings:reviewBindings.size,issues:checked.evidence?.issues,readyToSubmit:checked.readyToSubmit};}
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
      item.loanCoverage=check.documents?.loanCoverage?{expected:check.documents.loanCoverage.expected,present:check.documents.loanCoverage.present,missing:check.documents.loanCoverage.missing,duplicates:check.documents.loanCoverage.duplicates,complete:check.documents.loanCoverage.complete}:null;
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
