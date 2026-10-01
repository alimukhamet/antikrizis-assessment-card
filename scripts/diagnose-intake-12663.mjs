import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz',root='/api/assessment/12663',requestId='faf6a86b-1536-4a99-ad0b-0d9d511987e9';let cookie='';
const report={dealId:'12663',requestId,noNewSubmission:true,timings:[]},hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function request(path,body){const start=Date.now();const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(90000)});if(path==='/api/session')cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');const value=await response.json();report.timings.push({path:path.split('?')[0],status:response.status,ms:Date.now()-start});if(!response.ok)throw Error(/^[A-Z_]+$/.test(value.error)?value.error:'REQUEST_FAILED');return value;}
try{
 await request('/api/session',{worker:'ramazan',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const before=await request(root+'/draft'),old=(await request(root+'/submission?requestId='+requestId)).submission;
 if(old?.requestId!==requestId||old.state!=='verified'||!old.historySaved)throw Error('EXISTING_VERIFIED_SUBMISSION_REQUIRED');
 const result=await request(root+'/submission',{action:'sync-intake',requestId});
 report.sync=result.assessmentIntakeSync;report.state=result.state;report.historySaved=result.historySaved;
 const after=await request(root+'/draft'),saved=(await request(root+'/submission?requestId='+requestId)).submission;
 report.draftUnchanged=hash(before)===hash(after);report.submissionUnchanged=hash(old)===hash(saved);
}catch(e){report.error=/^[A-Z_]+$/.test(e.message)?e.message:'DIAGNOSTIC_FAILED';process.exitCode=1;}
writeFileSync('intake-diagnostic.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
