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
 // Compare the closed competition with the existing independent sales totals.
 // Financial values and the winning employee must never enter public CI logs.
 const metricResponse=await request('/api/sales-metrics?managerId=7609&paymentType=all&period=custom&from=2026-09-01&to=2026-09-30&fresh=1');assert.equal(metricResponse.status,200);
 const metrics=(await metricResponse.json()).relatedMetrics.filter(row=>row.paymentType==='all');
 const managers={darkhan:'7609',ramazan:'2093',nurdaulet:'4351'};
 assert.ok(metrics.length===3&&Object.values(managers).every(id=>metrics.some(row=>row.managerId===id)),'Complete sales ranking required');
 const maximum=Math.max(...metrics.map(row=>Math.round(row.contractTotal*100))),leaders=metrics.filter(row=>Math.round(row.contractTotal*100)===maximum);
 const settled=metrics.every(row=>row.missingContractValues===0)&&maximum>0&&leaders.length===1;
 for(const [person,manager] of Object.entries(managers)){
  const response=await request('/api/personal-sales?person='+person+'&month=2026-09');assert.equal(response.status,200);
  const data=await response.json(),month=data.earningsMonths.find(row=>row.id==='2026-09'),award=data.leaderAwards.find(row=>row.id==='september-2026');
  const period=data.periods.find(row=>row.id==='september');
  assert.ok(period&&period.target===10000000&&period.start==='2026-09-01'&&period.end==='2026-09-30','September must use the owner-corrected target');
  assert.ok(JSON.stringify(period.tiers)===JSON.stringify([[0,person==='darkhan'?2:1.6],[10000000,2.3]]),'September rates must retain their existing values at the corrected threshold');
  const expectedRate=period.missing>0?null:period.volume>=10000000?2.3:person==='darkhan'?2:1.6;
  assert.ok(period.rate===expectedRate,'September rate must use the corrected threshold');
  const expected=settled?(leaders[0].managerId===manager?100000:0):null;
  assert.ok(month&&award&&month.leaderBonus===expected&&award.amount===expected,'Closed first-place bonus must match verified ranking');
  const earned=month.commission===null||expected===null?null:month.baseSalary+month.contractBonus+month.commission+expected;
  assert.ok(month.earned===earned,'Monthly earnings must include the bonus exactly once');
 }
 // Verify every payroll month through the same read-only endpoint used by the employee UI.
 // Retain only pass/fail metadata; no client identities, amounts or payroll details in artifacts.
 let verifiedFirstPaymentLines=0,verifiedPaidFirstPaymentLines=0;
 for(const person of Object.keys(managers)){
  const ledgerResponse=await request('/api/sales-compensation?person='+person);assert.equal(ledgerResponse.status,200);
  const ledger=await ledgerResponse.json();
  const response=await request('/api/personal-sales?person='+person);assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/private, no-store/);
  const data=await response.json();assert.ok(data.person===person,'Payroll scope must match');
  assert.ok(JSON.stringify(data.payments)===JSON.stringify(ledger.payments),'Recorded payouts must match the existing ledger');
  for(const month of data.earningsMonths){
   const ids=new Set();
   for(const line of month.commissionDeals){
    assert.ok(!ids.has(line.id),'A deal must appear only once per payroll month');ids.add(line.id);
    if(!['После определения','50/50'].includes(line.paymentType))continue;
    assert.ok(Object.hasOwn(line,'firstPayment')&&Object.hasOwn(line,'contractValue'),'First-payment calculation evidence is required');
    const eligible=line.firstPayment!==null&&line.firstPayment>0;
    assert.ok(line.paymentEvidence?.source==='payment_register','Canonical register evidence is required');
    const review=line.paymentEvidence.status==='review_required';
    const expected=line.contractValue===null||review?null:eligible?Math.round(line.contractValue*6/100):0;
    assert.ok(line.amount===expected,'Confirmed first payment must earn 6% of the full contract');
    if(line.contractValue!==null)assert.ok(line.formula===(eligible?`${line.contractValue} × 6%`:review?'Оплату нужно сверить — расчёт не подтверждён':'0 · Нет зарегистрированной оплаты по договору'),'Displayed formula must match eligibility');
    assert.ok(line.date.startsWith(month.id),'Existing salary-month allocation must be preserved');
    verifiedFirstPaymentLines++;
    if(eligible&&line.contractValue!==null)verifiedPaidFirstPaymentLines++;
   }
  }
 }
 assert.ok(verifiedFirstPaymentLines>0,'Live verification requires qualifying payment-type records');
 assert.ok(verifiedPaidFirstPaymentLines>0,'Live verification requires a confirmed paid first-payment contract');
 report.firstPaymentContractCommissionVerified=true;
 report.recordedPayoutsMatchLedger=true;
 report.closedCompetitionVerified=true;
 report.septemberTargetVerified=true;
 await login('ramazan');
 const own=await request('/api/sales-compensation');assert.equal(own.status,200);const ownData=await own.json();assert.equal(ownData.person,'ramazan');assert.equal(ownData.canEdit,false);
 const other=await request('/api/sales-compensation?person=darkhan');assert.equal(other.status,403);await other.arrayBuffer();
 report.passed=true;
 console.log('Sales plans verified: current form asset, owner reads, individual scope and employee access restrictions. No financial records written.');
}finally{await writeFile('live-sales-plans-audit.json',JSON.stringify(report,null,2)+'\n');}
