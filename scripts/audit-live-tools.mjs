import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/questionnaire/draft.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {validateDraft}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const origin='https://assessment.anti-krizis.kz',id='10461',documentId='aab40e74-d77c-4aed-a55c-e5992535c5ea';
const requestId='98cf1c7a-82bd-4da0-9e4b-a872b7d9c621',expectedHash='e5d91441e9ebc6394965f15fdaafb4f97585aa72215229fdf94f173df8f4a290';
let cookie='',proposed;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const requireValue=v=>{if(!v)throw Error('GUARD_FAILED');};
const report={dealId:id,documentId,requestId,checkedAt:new Date().toISOString(),ok:false,writeAttempted:false};
async function request(path,body){
 const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'sec-fetch-site':'same-origin','content-type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});
 if(path==='/api/session')cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 if(!r.ok)throw Error('READ_OR_WRITE_FAILED');
 return r.json();
}
const root='/api/assessment/'+id;
async function verify(){
 const after=(await request(root+'/draft')).draft;
 requireValue(after?.revision===2&&after.identityRevision===1&&hash(validateDraft(after.payload))===hash(proposed));
 Object.assign(report,{ok:true,revision:after.revision,exactProposedPayloadReadBack:true,restoredType:'Справка по выплатам пенсии и пособий',answersGroupsContextAndExistingDocumentsPreserved:true,approvalAdded:false,finalSubmissionMade:false});
}
try{
 requireValue(!!process.env.ASSESSMENT_TEST_PASSWORD);
 report.step='authenticate';
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 report.step='read_current_draft';
 const assessment=await request(root),before=(await request(root+'/draft')).draft;
 report.step='pin_revision';
 requireValue(before?.revision===1&&before.identityRevision===1&&assessment.identityRevision===1);
 report.step='validate_saved_payload';
 const payload=validateDraft(before.payload);
 report.step='pin_payload_hash';
 requireValue(hash({payload,expectedRevision:0,identityRevision:1,actorId:'worker:darkhan'})===expectedHash);
 requireValue(payload.documents.length===7&&!payload.documents.some(d=>d.documentId===documentId));
 report.step='read_stored_analysis';
 const analysis=await request(root+'/documents/'+documentId+'/analyze',{cacheOnly:true});
 report.step='pin_document_identity';
 requireValue(analysis.documentId===documentId&&analysis.identityRevision===1&&analysis.document?.extraction?.kind==='benefits'&&!!analysis.document.extraction.identity.iin&&analysis.document.extraction.identity.iin===assessment.client.iin);
 const added={documentId,type:'Справка по выплатам пенсии и пособий',person:'Клиент'};
 report.step='validate_proposed_selection';
 proposed=validateDraft({...payload,documents:[...payload.documents,added]});
 requireValue(hash({...proposed,documents:proposed.documents.slice(0,-1)})===hash(payload));
 // One guarded draft append only. Lost responses are reconciled by reads;
 // never repeat the write or change reviews, facts or CRM state.
 report.step='append_selection';
 report.writeAttempted=true;
 await request(root+'/draft',{payload:proposed,identityRevision:1,expectedRevision:1,requestId});
 await verify();
}catch(error){
 report.errorCode=/^[A-Z_]{1,80}$/.test(error?.code||'')?error.code:'GUARD_OR_READ_FAILED';
 if(report.writeAttempted){try{await verify();report.reconciledAfterLostResponse=true;}catch{report.failure='WRITE_OUTCOME_UNVERIFIED';process.exitCode=1;}}
 else{report.failure='GUARD_OR_READ_FAILED';process.exitCode=1;}
}
await writeFile('live-tools-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
