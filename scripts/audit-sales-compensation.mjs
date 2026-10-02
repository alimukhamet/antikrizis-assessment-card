// Read-only diagnostics. This repository is public: only an encrypted report
// leaves the runner. No client titles, payroll values or sessions enter its log.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createPublicKey,publicEncrypt,randomBytes,createCipheriv} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz';
const publicKey=createPublicKey({key:Buffer.from(process.env.SALES_AUDIT_PUBLIC_KEY||'','base64'),format:'der',type:'spki'});
assert.ok(process.env.ASSESSMENT_TEST_PASSWORD,'Missing verification credential');
let cookie='';
async function request(path,body){
 const response=await fetch(origin+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(120000),headers:{cookie,origin,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal(response.status,200,'Sales audit request failed');
 if(path==='/api/session')cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 return response.json();
}
await request('/api/session',{worker:'ali',password:process.env.ASSESSMENT_TEST_PASSWORD});
const report={readAt:new Date().toISOString(),people:[]};
for(const person of ['darkhan','ramazan','nurdaulet']){
 const stored=await request('/api/sales-compensation?person='+person);
 const item={person,plans:stored.plans,months:[]};
 for(const month of ['2026-09','2026-10']){
  const data=await request('/api/personal-sales?person='+person+'&month='+month);
  item.months.push({month,monthly:data.monthly,earned:data.earned,paid:data.paid,owed:data.owed,periods:data.periods.map(({id,start,end,target,metric,tiers,leaderBonus,bonus,rate,count,volume,missing,commission,earned,leaderAward})=>({id,start,end,target,metric,tiers,leaderBonus,bonus,rate,count,volume,missing,commission,earned,leaderAward})),earningsMonths:data.earningsMonths.map(({id,baseSalary,contractBonus,leaderBonus,commission,earned})=>({id,baseSalary,contractBonus,leaderBonus,commission,earned}))});
 }
 report.people.push(item);
}
const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
const ciphertext=Buffer.concat([cipher.update(JSON.stringify(report)),cipher.final()]);
await writeFile('sales-compensation-audit.enc.json',JSON.stringify({encryptedKey:publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')})+'\n');
console.log('Read-only sales audit completed; the report is encrypted for its requester.');
