// Read-only production check. Never create fake presence or modify real profiles.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const origin='https://assessment.anti-krizis.kz',report={origin,passed:false};
const request=(path,init={})=>fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000),...init});
try{
 assert.equal((await request('/api/profile-activity')).status,401);
 assert.ok(process.env.ASSESSMENT_TEST_PASSWORD,'Missing verification credential');
 const login=await request('/api/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({worker:'ramazan',password:process.env.ASSESSMENT_TEST_PASSWORD})});
 assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.ok(cookie);
 const response=await request('/api/profile-activity',{headers:{cookie}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const activity=await response.json();assert.equal(activity.currentWorker,'ramazan');assert.ok(Array.isArray(activity.active));assert.ok(Array.isArray(activity.completed));assert.ok(Array.isArray(activity.workers));
 assert.equal(new Set(activity.completed.map(s=>s.dealId)).size,activity.completed.length);
 assert.equal(new Set(activity.active.map(s=>s.dealId+':'+s.workerId)).size,activity.active.length);
 for(const worker of activity.workers){assert.equal(worker.done,activity.completed.filter(s=>s.workerId===worker.workerId).length);assert.equal(worker.inProgress,activity.active.filter(s=>s.workerId===worker.workerId).length);}
 const page=await request('/profile-backfill',{headers:{cookie}});assert.equal(page.status,200);const html=await page.text();assert.match(html,/В работе/);assert.match(html,/Не заполнены/);
 Object.assign(report,{anonymousBlocked:true,authenticated:true,completed:activity.completed.length,activeProfiles:new Set(activity.active.map(s=>s.dealId)).size,workers:activity.workers,passed:true});
 console.log('Profile team verified: authenticated activity, unique client counts and live queue controls. No profile writes.');
}finally{await writeFile('live-profile-audit.json',JSON.stringify(report,null,2)+'\n');}
