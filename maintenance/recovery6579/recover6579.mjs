// Prepared maintenance entry point. Production execution is owner controlled.
import {readFile,writeFile} from 'node:fs/promises';
import {SOURCE,runRecovery,requireCondition,byteHash} from './recover6579-core.mjs';
const origin='https://assessment.anti-krizis.kz',root='/api/assessment/6579';
const report={apply:process.env.RECOVERY_APPLY==='true',verified:false,allowedWrites:['exact-original-upload','append-draft-document-selection']};
let cookie='';
async function response(path,init={}){
 const r=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(180000),...init,headers:{cookie,origin,...init.headers}});
 requireCondition(r.ok,'HTTP_'+r.status);return r;
}
const json=async(path,body)=>(await response(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})).json();
try{
 requireCondition(process.env.GITHUB_EVENT_NAME==='workflow_dispatch'&&process.env.GITHUB_REF_TYPE==='branch'&&process.env.GITHUB_REF_NAME&&process.env.GITHUB_REF_NAME!==process.env.RECOVERY_DEFAULT_BRANCH&&process.env.GITHUB_REF_NAME!=='main','TEMPORARY_BRANCH_REQUIRED');
 requireCondition(process.env.GITHUB_SHA===process.env.RECOVERY_EXPECTED_COMMIT,'CHECKOUT_COMMIT_CHANGED');
 requireCondition(Boolean(process.env.ASSESSMENT_TEST_PASSWORD),'CREDENTIAL_REQUIRED');
 // Import the canonical validator and parser from a build made at this commit.
 const {validateDraft,readPdf,extractNative}=await import('./.recovery-tools.mjs');
 const bytes=new Uint8Array(await readFile(process.env.RECOVERY_ORIGINAL_FILE||'recovery6579-original.bin'));
 requireCondition(bytes.byteLength===SOURCE.byteSize&&byteHash(bytes)===SOURCE.sha256,'SOURCE_BYTES_CHANGED');
 const read=await readPdf(bytes),extraction=extractNative(read.pages);
 const login=await response('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD})});
 cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');requireCondition(Boolean(cookie),'SESSION_COOKIE_REQUIRED');
 const api={context:()=>json(root),draft:async()=>(await json(root+'/draft')).draft,activity:()=>json('/api/profile-activity'),submission:()=>json(root+'/submission?scope=case'),
  upload:async data=>(await response(root+'/documents',{method:'POST',headers:{'content-type':'application/octet-stream','content-length':String(data.byteLength),'x-document-name':encodeURIComponent(SOURCE.name)},body:data})).json(),
  original:async id=>new Uint8Array(await(await response(root+'/documents/'+encodeURIComponent(id))).arrayBuffer()),saveDraft:body=>json(root+'/draft',body)};
 await runRecovery({api,bytes,read,extraction,validateDraft,guard:JSON.parse(process.env.RECOVERY_GUARD_JSON||'null'),requestId:process.env.RECOVERY_REQUEST_ID||'',commit:process.env.GITHUB_SHA||'',apply:report.apply,planPin:process.env.RECOVERY_PLAN_HASH||'',report});
}catch(error){report.error=/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'RECOVERY_STOPPED';if(report.uploadAttempted&&!report.verified)report.reconciliationRequired=true;process.exitCode=1;}
finally{await writeFile('recovery6579-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({verified:report.verified,previewOnly:report.previewOnly,planHash:report.planHash,error:report.error,reconciliationRequired:report.reconciliationRequired}));}
