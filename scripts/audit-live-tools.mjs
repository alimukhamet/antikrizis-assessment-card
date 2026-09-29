// Temporary exact-case, read-only incident diagnosis. Never exports client values.
import {writeFile} from 'node:fs/promises';
const origin='https://assessment.anti-krizis.kz',id='9935';
if(process.env.AUDIT_DEAL_ID!==id)throw Error('Exact incident deal required');
let cookie='';
async function request(path,body){
 const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'sec-fetch-site':'same-origin',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(60000)});
 if(path==='/api/session')cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 if(!response.ok)throw Error('Read failed '+response.status);
 return response;
}
const report={dealId:id,readOnly:true,checkedAt:new Date().toISOString()};
try{
 if(!process.env.ASSESSMENT_TEST_PASSWORD)throw Error('Authentication unavailable');
 await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
 const saved=(await (await request('/api/assessment/'+id+'/submission?scope=case')).json()).submission;
 const response=await request('/api/assessment/'+id+'/export');
 let buffer='',bytes=0,submission=null,complete=false;
 for await(const chunk of response.body.pipeThrough(new TextDecoderStream())){
  bytes+=chunk.length;if(bytes>40000000)throw Error('Export exceeds diagnostic bound');buffer+=chunk;
  let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;const row=JSON.parse(line);if(row.type==='assessment-submission'&&row.request_id===saved.requestId)submission=row;if(row.type==='complete')complete=true;}
 }
 if(!complete||!submission||submission.state!=='verified'||submission.history_state!=='verified')throw Error('Immutable verified submission unavailable');
 const values=submission.payload.values,deal=(await (await request('/api/bitrix/crm.deal.get',{id})).json()).result;
 if(String(deal.ID)!==id||deal.UF_CRM_AI_IIN!==values.iin)throw Error('Identity mismatch');
 const norm=v=>String(v??'').replace(/\r\n/g,'\n'),current=norm(deal.UF_CRM_1782453129677),expected=norm(values.comment);
 const money=v=>{const s=String(v??'').trim();if(!/^\d+(?:\.\d+)?$/.test(s))return null;const [w,f='']=s.split('.');return BigInt(w)*100n+BigInt((f+'00').slice(0,2));};
 const actualDebt=money(deal.UF_CRM_AI_DEBT),expectedDebt=money(values.debt);
 report.submissionRequestId=saved.requestId;report.handoffRequestId='0ca4f8fe-2154-45da-8f0b-c3d48d69efa6';
 report.cardMatches=norm(deal.UF_CRM_AI_CARD)===norm(values.card);
 report.debt={exact:actualDebt!==null&&actualDebt===expectedDebt,wholeTengeRoundingOnly:actualDebt!==null&&expectedDebt!==null&&actualDebt===((expectedDebt+50n)/100n)*100n,currentIsInteger:actualDebt!==null&&actualDebt%100n===0n};
 report.comment={expectedEmpty:expected==='',currentEmpty:current==='',expectedLength:expected.length,currentLength:current.length,exact:current===expected,trimOnly:current.trim()===expected.trim(),whitespaceOnly:current.replace(/\s+/gu,' ').trim()===expected.replace(/\s+/gu,' ').trim(),unicodeOnly:current.normalize('NFKC')===expected.normalize('NFKC'),htmlOnly:current.replace(/<[^>]*>/g,'').trim()===expected.trim(),currentContainsExpected:!!expected&&current.includes(expected),expectedContainsCurrent:!!current&&expected.includes(current)};
 report.crmModifiedAt=deal.DATE_MODIFY;report.currentStage=deal.STAGE_ID;
 report.handoff=(await (await request('/api/assessment/'+id+'/handoff')).json()).handoff;
 report.ok=true;
}catch{report.ok=false;report.error='READ_ONLY_DIAGNOSTIC_FAILED';process.exitCode=1;}
await writeFile('live-tools-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
