// Read-only release verification. Never create test plans or payments in production.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://assessment.anti-krizis.kz';
const report={origin,scope:'read-only; no plans or payments created',passed:false};
let cookie='';
const request=(path,options={})=>fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000),...options,headers:{cookie,...options.headers}});
const login=async worker=>{
 const response=await request('/api/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({worker,password:process.env.ASSESSMENT_TEST_PASSWORD})});
 assert.equal(response.status,200);cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);await response.arrayBuffer();
};
try{
 assert.ok(process.env.ASSESSMENT_TEST_PASSWORD,'Missing verification credential');
 const anonymous=await request('/api/sales-compensation');assert.equal(anonymous.status,401);await anonymous.arrayBuffer();
 const manifest=JSON.parse(await readFile('dist/client/.vite/manifest.json','utf8'));
 const asset=manifest['app/PersonalSales.tsx'].file,expected=await readFile('dist/client/'+asset);
 const published=await request('/'+asset);assert.equal(published.status,200);
 const actual=Buffer.from(await published.arrayBuffer());assert.deepEqual(actual,expected);
 report.assetSha256=createHash('sha256').update(actual).digest('hex');report.asset=asset;
 await login('ali');
 const page=await request('/my-results');assert.equal(page.status,200);const markup=await page.text();assert.ok(markup.includes(asset),'Results page references the verified plan form');
 report.people=[];
 for(const person of ['darkhan','ramazan','nurdaulet']){
  const response=await request('/api/sales-compensation?person='+person);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);
  const data=await response.json();assert.equal(data.person,person);assert.equal(data.canEdit,true);assert.ok(data.plans.every(plan=>plan.person===person));assert.ok(data.payments.every(payment=>payment.person===person));
  report.people.push({person,plans:data.plans.length,personScoped:true});
 }
 await login('ramazan');
 const own=await request('/api/sales-compensation');assert.equal(own.status,200);const ownData=await own.json();assert.equal(ownData.person,'ramazan');assert.equal(ownData.canEdit,false);
 const other=await request('/api/sales-compensation?person=darkhan');assert.equal(other.status,403);await other.arrayBuffer();
 report.passed=true;
 console.log('Sales plans verified: current form asset, owner reads, individual scope and employee access restrictions. No financial records written.');
}finally{await writeFile('live-sales-plans-audit.json',JSON.stringify(report,null,2)+'\n');}
