// Read-only production check. Never create fake presence or modify real profiles.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
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
 assert.match(html,/Сначала старые даты ЗВИ/);
 const queueResponse=await request('/api/profile-queue',{headers:{cookie}});assert.equal(queueResponse.status,200);
 const queue=(await queueResponse.json()).items;assert.ok(Array.isArray(queue));
 const ordered=queue.map(item=>{const date=Date.parse(item.zviDate);return {done:Boolean(item.profileSavedAt),time:Number.isFinite(date)?date:Infinity,id:Number(item.dealId)};});
 for(let i=1;i<ordered.length;i++){
  const previous=ordered[i-1],current=ordered[i];
  assert.ok(Number(previous.done)<=Number(current.done),'Unfinished profiles must come first');
  if(previous.done===current.done){
   assert.ok(previous.time<=current.time,'ZVI dates must be oldest first, missing dates last');
   if(previous.time===current.time)assert.ok(previous.id<=current.id,'Equal dates use ascending deal ID');
  }
 }
 report.queue={order:'oldest-zvi-first',total:queue.length,dated:ordered.filter(item=>Number.isFinite(item.time)).length,verified:true};
 // Validate in memory on an existing audit case. Never call save, draft POST,
 // presence POST or the profile GET (which may reconcile a history receipt).
 const root='/api/assessment/11665';
 const json=async(path,body)=>{const r=await request(path,{headers:{cookie,origin,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});assert.equal(r.status,200,path);return r.json();};
 const before=(await json(root+'/draft')).draft;
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 // The audit case can legitimately have no draft. Exercise only these rules
 // with an incomplete in-memory payload; do not copy or create client answers.
 const draft={schemaVersion:1,answers:[],groups:[],docContext:{social:'',salary:''},documents:[],pendingFiles:[]};
 const set=(key,value)=>{let a=draft.answers.find(a=>a.key===key);if(!a){a={key,value:'',checked:false};draft.answers.push(a);}a.value=value;};
 set('hardshipReason','Снижение дохода');
 const detail='Тестовая проверка длины объяснения без сохранения клиентских данных. '.slice(0,58)+'..';assert.equal(detail.length,60);assert.equal(detail.trim().length,60);
 for(const [name,text,expected] of [['short',detail.slice(0,59),true],['whitespace',detail.slice(0,59)+' \n   ',true],['unknown','Не знаю. '.repeat(10),true],['minimum',detail,false]]){
  for(const key of ['debtPurposeOther','n12008'])set(key,text);
  const check=await json(root+'/profile',{action:'check',requestId:randomUUID(),draft});
  assert.equal(check.ready,false,'The incomplete audit payload must never become a complete client profile');
  for(const key of ['debtPurposeOther','n12008'])assert.equal(check.issues.some(i=>i.key===key&&i.code==='EXPLANATION_REQUIRED'),expected,name+':'+key);
 }
 const after=(await json(root+'/draft')).draft;
 assert.equal(digest(before),digest(after),'Audit draft changed; investigate concurrent edits');
 report.explanations={minimum:60,shortBlocked:true,whitespacePaddingBlocked:true,unknownBlocked:true,minimumAccepted:true,draftUnchanged:true};
 Object.assign(report,{anonymousBlocked:true,authenticated:true,completed:activity.completed.length,activeProfiles:new Set(activity.active.map(s=>s.dealId)).size,workers:activity.workers,passed:true});
 console.log('Profile verified: team activity, unique counts, live controls and 60-character explanations. Audit draft unchanged; no profile writes.');
}finally{await writeFile('live-profile-audit.json',JSON.stringify(report,null,2)+'\n');}
