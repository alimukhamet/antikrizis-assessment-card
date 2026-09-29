/** Real built routes, four synthetic staff sessions, isolated D1. No external writes. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Miniflare} from 'miniflare';
import {session,TEST_SECRET} from './session-helper.mjs';

test('profile team: authenticated presence, tab-safe release, expiry and unique completed clients',async t=>{
 const paths=(await readdir('dist/server',{recursive:true})).filter(p=>/\.m?js$/.test(p)).sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
 const modules=await Promise.all(paths.map(async path=>({type:'ESModule',path,contents:await readFile(join('dist/server',path),'utf8')})));
 const mf=new Miniflare({modules,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'profile-activity'},r2Buckets:{FILES:'profile-files'},
  bindings:{SITE_SESSION_TOKEN:TEST_SECRET},outboundService:()=>{throw Error('Activity must not call Bitrix');}});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())
  for(const statement of (await readFile(join('drizzle',name),'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();
 for(let i=1;i<=4;i++)await db.prepare("INSERT INTO assessment_cases(id,external_system,external_id,client_iin,identity_revision,title,created_at,updated_at) VALUES(?,'bitrix',?,'000000000010',1,'SYNTHETIC',?,?)").bind('case-'+i,'90000'+i,'2026-09-29T00:00:00Z','2026-09-29T00:00:00Z').run();
 const save=async(id,caseId,worker,state,at)=>db.prepare("INSERT INTO assessment_profile_saves(id,case_id,request_id,identity_revision,actor_id,authentication,payload_json,payload_hash,state,created_at,updated_at) VALUES(?,?,?,1,?,'shared-password-worker-selection','{\"preserve\":true}','unchanged-hash',?,?,?)").bind(id,caseId,id,'worker:'+worker,state,at,at).run();
 await save('one','case-1','ramazan','verified','2026-09-29T01:00:00Z');
 await save('repeat','case-1','ramazan','verified','2026-09-29T02:00:00Z');
 await save('prior','case-2','azhar','verified','2026-09-29T01:00:00Z');
 await save('reopened','case-2','azhar','reopened','2026-09-29T02:00:00Z');
 await save('uncertain','case-3','nurdaulet','uncertain','2026-09-29T02:00:00Z');
 await save('four','case-4','darkhan','verified','2026-09-29T02:00:00Z');
 const before=(await db.prepare('SELECT * FROM assessment_profile_saves ORDER BY id').all()).results;
 const workers=['ramazan','nurdaulet','darkhan','azhar'],cookies={};
 for(const worker of workers)cookies[worker]=session.SESSION_COOKIE+'='+await session.issueSession(worker,TEST_SECRET);
 const request=(worker,body,extra={})=>mf.dispatchFetch('https://synthetic.invalid/api/profile-activity',{method:body?'POST':'GET',headers:{...(worker?{cookie:cookies[worker]}:{}),...(body?{origin:'https://synthetic.invalid','content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request(null)).status,401);
 assert.equal((await request('ramazan',{action:'heartbeat',tabId:randomUUID(),dealId:'900001'},{origin:'https://other.invalid'})).status,403);
 assert.equal((await request('ramazan',{action:'heartbeat',tabId:'bad',dealId:'900001'})).status,400);
 const tabs=workers.map(()=>randomUUID());
 for(let i=0;i<4;i++)assert.equal((await request(workers[i],{action:'heartbeat',tabId:tabs[i],dealId:'90000'+(i+1),actor_id:'worker:ali'})).status,200);
 const extraTab=randomUUID();await request('ramazan',{action:'heartbeat',tabId:extraTab,dealId:'900001'});
 await request('ramazan',{action:'heartbeat',tabId:tabs[0],dealId:'900001'});
 let response=await request('ramazan'),activity=await response.json();
 assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal(activity.currentWorker,'ramazan');assert.equal(activity.active.length,4);
 assert.equal(activity.workers.find(w=>w.workerId==='ramazan').inProgress,1,'two tabs count as one profile');
 assert.deepEqual(activity.completed.map(s=>s.dealId),['900001','900004']);
 assert.equal(activity.workers.find(w=>w.workerId==='ramazan').done,1,'repeat saves count once');
 assert.equal(activity.workers.find(w=>w.workerId==='azhar').done,0,'reopened latest save does not fall back to old completion');
 await request('darkhan',{action:'release',tabId:tabs[0],dealId:'900001'});
 await request('darkhan',{action:'heartbeat',tabId:tabs[0],dealId:'900001'});
 assert.equal((await db.prepare('SELECT actor_id FROM assessment_profile_presence WHERE id=?').bind(tabs[0]).first()).actor_id,'worker:ramazan');
 await request('ramazan',{action:'release',tabId:tabs[0],dealId:'900001'});
 activity=await (await request('ramazan')).json();assert.ok(activity.active.some(s=>s.workerId==='ramazan'),'closing one tab preserves another');
 await request('ramazan',{action:'release',tabId:extraTab,dealId:'900001'});
 await db.prepare("UPDATE assessment_profile_presence SET expires_at='2000-01-01T00:00:00Z' WHERE actor_id='worker:nurdaulet'").run();
 activity=await (await request('ramazan')).json();assert.equal(activity.active.length,2);assert.equal(activity.workers.find(w=>w.workerId==='nurdaulet').inProgress,0);
 assert.deepEqual((await db.prepare('SELECT * FROM assessment_profile_saves ORDER BY id').all()).results,before,'presence leaves all saved answers and receipts intact');
 await save('correction','case-2','azhar','verified','2026-09-29T03:00:00Z');
 await save('latest-author','case-1','darkhan','verified','2026-09-29T03:00:00Z');
 activity=await (await request('azhar')).json();
 assert.equal(activity.completed.length,3);assert.equal(activity.workers.find(w=>w.workerId==='azhar').done,1);
 assert.equal(activity.workers.find(w=>w.workerId==='ramazan').done,0);assert.equal(activity.workers.find(w=>w.workerId==='darkhan').done,2);
});
