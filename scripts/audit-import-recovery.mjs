// Read existing inbound receipts only: no imports, draft saves, reviews or CRM writes.
import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz',ids=[...new Set((process.env.ASSESSMENT_AUDIT_DEAL_IDS||'').split(/[ ,]+/).filter(Boolean))],report={scope:'read-only-import-recovery',cases:[],failures:[]};let cookie='';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function request(path,body){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});if(path==='/api/session')cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const data=await response.json();if(!response.ok)throw Error(data.error||'HTTP_'+response.status);return data;}
try{
 assert.ok(ids.length&&ids.length<=5&&ids.every(id=>/^[1-9]\d*$/.test(id)),'Supply up to five exact deal IDs');assert.ok(process.env.ASSESSMENT_TEST_PASSWORD,'Missing verification credential');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 for(const dealId of ids){const item={dealId,recovered:[],pending:0};report.cases.push(item);const root='/api/assessment/'+dealId;
  try{
   const context=await request(root),before=await request(root+'/draft'),files=(await request(root+'/crm-documents')).files;assert.ok(files.length<=40,'Too many files for this bounded audit');
   const selected=new Set((before.draft?.payload?.documents||[]).map(d=>d.documentId));
   for(const file of files){
    const path=root+'/crm-documents?fileId='+encodeURIComponent(file.id)+'&identityRevision='+context.identityRevision,first=await request(path);
    if(first.pending===true){item.pending++;continue;}
    assert.equal(first.crmFileId,file.id);assert.equal(first.client.external.dealId,dealId);assert.equal(first.identityRevision,context.identityRevision);assert.ok(first.documentId&&first.document.originalSha256);
    const again=await request(path);assert.equal(again.documentId,first.documentId);assert.equal(again.extractionId,first.extractionId);assert.equal(again.document.originalSha256,first.document.originalSha256);
    item.recovered.push({documentId:first.documentId,selected:selected.has(first.documentId),kind:first.document.extraction.kind,identityMatches:!!first.document.extraction.identity.iin&&first.document.extraction.identity.iin===context.client.iin,repeatStable:true});
   }
   item.draftUnchanged=digest(before)===digest(await request(root+'/draft'));if(!item.draftUnchanged)item.concurrentDraftChange=true;
  }catch(error){item.error=error.message;report.failures.push({dealId,code:error.message});}
 }
}catch(error){report.failures.push({code:error.message});}
report.summary={cases:report.cases.length,recovered:report.cases.reduce((n,c)=>n+c.recovered.length,0),unchangedDrafts:report.cases.filter(c=>c.draftUnchanged).length,concurrentDraftChanges:report.cases.filter(c=>c.concurrentDraftChange).length,failures:report.failures.length};
await writeFile('import-recovery-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary));if(report.failures.length)process.exitCode=1;
