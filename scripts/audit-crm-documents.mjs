// Bounded inbound document audit through the existing server-side Bitrix webhook.
// No CRM writes, draft saves, manual approvals, signatures or credential parsing.
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz',report={origin,scope:'inbound-document-analysis',cases:[],failures:[]};
let cookie='';
async function request(path,body){
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(90_000)});
 if(path==='/api/session'&&body)cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const data=await response.json();if(!response.ok)throw Object.assign(Error(String(data.error||'HTTP_'+response.status)),{code:data.error,status:response.status});return data;
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
try{
 if(!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('Missing test password');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 if(!(await request('/api/session')).ok)throw Error('Authentication not verified');
 const directory=await request('/api/assessment/clients');if(directory.draftsUnavailable)throw Error('Saved case list unavailable');
 // Prefer cases outside the earlier four-case audit, then fill the bounded sample.
 const earlier=new Set(['10479','11749','11877','11665']);
 const selected=directory.drafts.filter(c=>c.fileCount>0).sort((a,b)=>Number(earlier.has(a.dealId))-Number(earlier.has(b.dealId))).slice(0,6);
 if(!selected.length)throw Error('No saved cases with documents available');
 for(const selectedCase of selected){
  const item={dealId:selectedCase.dealId,documents:[]};report.cases.push(item);const root='/api/assessment/'+item.dealId;
  try{
   const context=await request(root),before=await request(root+'/draft');
   if(!context.client?.iin){item.skipped='DEAL_IDENTITY_UNVERIFIED';continue;}
   const refs=(await request(root+'/crm-documents')).files;
   item.availableFiles=refs.length;
   for(const ref of refs.slice(0,4)){
    const result={fileId:ref.id};item.documents.push(result);
    try{
     const analysis=await request(root+'/crm-documents',{fileId:ref.id,identityRevision:context.identityRevision});
     const document=analysis.document,extraction=document?.extraction;
     Object.assign(result,{state:'read',pages:document?.totalPages,kind:extraction?.kind,credits:extraction?.credits?.length,identityMatches:!!extraction?.identity?.iin&&extraction.identity.iin===context.client.iin,identityRevisionMatches:analysis.identityRevision===context.identityRevision,findings:analysis.findings,cacheHit:analysis.cacheHit,persisted:analysis.persisted});
     if(!(result.pages>0)||!result.identityRevisionMatches||!result.persisted)report.failures.push({dealId:item.dealId,fileId:ref.id,code:'ANALYSIS_RESPONSE_INCOMPLETE'});
    }catch(error){result.state=['CREDENTIAL_NOT_ANALYSED','NOT_A_SUPPORTED_PDF'].includes(error.code)?'excluded':'failed';result.code=error.code||'REQUEST_FAILED';if(result.state==='failed')report.failures.push({dealId:item.dealId,fileId:ref.id,code:result.code});}
   }
   item.draftUnchanged=digest(before)===digest(await request(root+'/draft'));
   if(!item.draftUnchanged)report.failures.push({dealId:item.dealId,code:'DRAFT_CHANGED_DURING_AUDIT'});
   console.log(JSON.stringify({dealId:item.dealId,inspected:item.documents.length,draftUnchanged:item.draftUnchanged}));
  }catch(error){item.error=error.code||error.message;report.failures.push({dealId:item.dealId,code:item.error});}
 }
}catch(error){report.failures.push({code:error.code||error.message});}
report.summary={cases:report.cases.length,read:report.cases.flatMap(c=>c.documents).filter(d=>d.state==='read').length,excluded:report.cases.flatMap(c=>c.documents).filter(d=>d.state==='excluded').length,pages:report.cases.flatMap(c=>c.documents).reduce((n,d)=>n+(d.pages||0),0),failures:report.failures.length};
await writeFile('crm-document-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));if(report.failures.length)process.exitCode=1;
