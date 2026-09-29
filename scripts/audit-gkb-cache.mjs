// Owner-triggered analysis refresh. This never saves drafts, reviews or CRM data.
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz',ids=[...new Set((process.env.ASSESSMENT_AUDIT_DEAL_IDS||'').split(/[ ,]+/).filter(Boolean))],refresh=process.env.ASSESSMENT_REFRESH_GKB==='true',report={scope:'saved-gkb-analysis',refresh,cases:[],failures:[]};let cookie='';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(path,body){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});if(path==='/api/session')cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const data=await response.json();if(!response.ok)throw Error(data.error||'HTTP_'+response.status);return data;}
try{
 assert.ok(ids.length&&ids.length<=50&&ids.every(id=>/^[1-9]\d*$/.test(id)),'Supply up to 50 exact deal IDs');assert.ok(process.env.ASSESSMENT_TEST_PASSWORD,'Missing verification credential');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 for(const dealId of ids){const item={dealId,documents:[]};report.cases.push(item);const root='/api/assessment/'+dealId;
  try{
   const context=await request(root),before=await request(root+'/draft');
   const docs=[...new Set((before.draft?.payload?.documents||[]).filter(doc=>/^ГКБ — (?:полный|краткий) отчёт$/.test(doc.type)).map(doc=>doc.documentId))];
   for(let n=0;n<docs.length;n+=8){const documentIds=docs.slice(n,n+8),body={documentIds,identityRevision:context.identityRevision},started=Date.now(),batch=await request(root+'/documents/analyze',body);let refreshed=0;
    for(const entry of batch.results){
     let analysis=entry.analysis;if(entry.error){if(entry.error!=='CACHE_REPROCESS_REQUIRED'||!refresh)throw Error(entry.error);analysis=await request(root+'/documents/'+encodeURIComponent(entry.documentId)+'/analyze',{cacheOnly:false});refreshed++;}
     assert.equal(analysis.documentId,entry.documentId);assert.equal(analysis.identityRevision,context.identityRevision);
     item.documents.push({documentId:entry.documentId,extractionId:analysis.extractionId,originalSha256:analysis.document.originalSha256,kind:analysis.document.extraction.kind,version:analysis.document.extraction.version,loans:analysis.document.extraction.credits.length,complete:analysis.document.extraction.creditList?.complete,findings:analysis.findings,refreshed:Boolean(entry.error)});
    }
    const repeatStart=Date.now(),repeat=await request(root+'/documents/analyze',body);item.batches||=[];item.batches.push({documents:documentIds.length,firstMs:repeatStart-started,repeatMs:Date.now()-repeatStart,refreshed});
    for(const row of repeat.results){assert.ok(row.analysis?.cacheHit,'Repeated read must reuse analysis');const previous=item.documents.find(doc=>doc.documentId===row.documentId);assert.equal(row.analysis.extractionId,previous.extractionId);assert.equal(row.analysis.document.originalSha256,previous.originalSha256);}
   }
   item.draftUnchanged=digest(before)===digest(await request(root+'/draft'));
   // Staff may save while this read-only draft check runs. Record that honestly.
   if(!item.draftUnchanged)item.concurrentDraftChange=true;
  }catch(error){item.error=error.message;report.failures.push({dealId,code:error.message});}
  console.log(JSON.stringify({dealId,documents:item.documents.length,draftUnchanged:item.draftUnchanged,error:item.error}));
 }
}catch(error){report.failures.push({code:error.message});}
report.summary={cases:report.cases.length,documents:report.cases.reduce((n,c)=>n+c.documents.length,0),refreshed:report.cases.flatMap(c=>c.documents).filter(d=>d.refreshed).length,unchangedDrafts:report.cases.filter(c=>c.draftUnchanged).length,concurrentDraftChanges:report.cases.filter(c=>c.concurrentDraftChange).length,failures:report.failures.length};
await writeFile('gkb-cache-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));if(report.failures.length)process.exitCode=1;
