import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz',id='10461',documentId='aab40e74-d77c-4aed-a55c-e5992535c5ea';
let cookie='';
async function read(path,body){
 const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});
 if(path==='/api/session')cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 if(!r.ok)throw Error('READ_FAILED');
 return r.json();
}
const report={dealId:id,documentId,checkedAt:new Date().toISOString(),ok:false};
try{
 if(!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('AUTH_MISSING');
 await read('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const root='/api/assessment/'+id,assessment=await read(root),before=await read(root+'/draft');
 const a=await read(root+'/documents/'+documentId+'/analyze',{cacheOnly:true});
 const extraction=a.document?.extraction;
 Object.assign(report,{kind:extraction?.kind,recognitionVersion:extraction?.version,pages:a.document?.totalPages,identityMatches:!!extraction?.identity?.iin&&extraction.identity.iin===assessment.client.iin,storedDocumentMatches:a.documentId===documentId,identityRevisionMatches:a.identityRevision===assessment.identityRevision,findings:extraction?.findings,selected:before.draft?.payload?.documents?.some(d=>d.documentId===documentId),revision:before.draft?.revision,issuedAt:a.reviewContext?.issuedAt,allHistory:a.reviewContext?.allHistory});
 const after=await read(root+'/draft');
 report.draftUnchanged=createHash('sha256').update(JSON.stringify(before)).digest('hex')===createHash('sha256').update(JSON.stringify(after)).digest('hex');
 report.ok=true;
}catch{report.failure='READ_FAILED';process.exitCode=1;}
await writeFile('live-tools-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
