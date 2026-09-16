import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';

const release=JSON.parse(fs.readFileSync('lib/assessment-release.json','utf8'));
function load(path,deps={},extra={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name];},crypto:webcrypto,TextEncoder,Date,...extra});return exports;}
const feedback=load('lib/tool-feedback.ts',{'./assessment-release.json':release});
const actor=worker=>({worker,id:'worker:'+worker,displayName:worker,authentication:'shared-password-worker-selection'});
const input=(extra={})=>feedback.validateFeedback({requestId:webcrypto.randomUUID(),message:'Synthetic report: the total is missing.',dealId:'11665',step:'answers',fieldId:'n8040_r2',fieldLabel:'Текущая сумма задолженности',clientVersion:release.version,...extra});
function setup(){
 const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync('drizzle').filter(p=>p.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(query){return {bind(...args){const s=sql.prepare(query);return {async run(){s.run(...args);},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};}};}};}};
 return {sql,db,repo:new feedback.FeedbackRepository(db)};
}
test('report persistence and retries survive repository recreation; request key reuse cannot change history',async()=>{
 const {sql,db,repo}=setup(),body=input(),a=actor('ramazan');
 const first=await repo.create(body,a),second=await new feedback.FeedbackRepository(db).create(body,a);
 assert.equal(first.id,second.id);assert.equal(sql.prepare('SELECT count(*) n FROM assessment_tool_feedback').get().n,1);
 await assert.rejects(()=>repo.create({...body,message:'Changed message'},a),/FEEDBACK_REQUEST_REUSED/);
 const row=(await repo.page(actor('ali')))[0];assert.equal(row.actor_id,a.id);assert.equal(row.server_version,release.version);assert.equal(row.message,body.message);assert.equal(row.schema_version,1);
 assert.ok(!('payload_json' in row));sql.close();
});
test('worker sees only own reports, owner sees all; pagination does not duplicate or mix new arrivals',async()=>{
 const {repo,sql}=setup();await repo.create(input(),actor('ramazan'));await repo.create(input(),actor('darkhan'));
 assert.equal((await repo.page(actor('ramazan'))).length,1);assert.equal((await repo.page(actor('ali'))).length,2);
 const first=await repo.page(actor('ali'),undefined,1);await repo.create(input(),actor('ali'));
 const next=await repo.page(actor('ali'),first[0].sequence,1);assert.ok(next[0].sequence<first[0].sequence);assert.equal(next[0].actor_id,'worker:ramazan');sql.close();
});
test('concurrent reports respect durable rate limit; identical retries still succeed at limit',async()=>{
 const {repo,db,sql}=setup(),body=input(),a=actor('ramazan'),now='2026-09-14T00:00:00.000Z';
 const first=await repo.create(body,a,now);
 const attempts=await Promise.allSettled(Array.from({length:40},()=>repo.create(input(),a,now)));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,29);
 assert.equal((await new feedback.FeedbackRepository(db).create(body,a,now)).id,first.id);
 await repo.create(input(),a,'2026-09-14T01:00:01.000Z');sql.close();
});
test('validation bounds report content and strips automatic credential context',()=>{
 for(const bad of [{message:'   '},{message:'a'.repeat(3001)},{dealId:'11665/credentials'},{fieldId:'x onload=alert(1)'},{requestId:'bad'},{step:'secret'},{clientVersion:'<script>'}])assert.throws(()=>input(bad),/INVALID_FEEDBACK/);
 const safe=input({fieldId:'previewEdsPassword',fieldLabel:'secret'});assert.equal(safe.fieldId,null);assert.equal(safe.fieldLabel,null);
 assert.equal(input({dealId:null,fieldId:null,fieldLabel:null}).dealId,null);
});
test('feedback API rejects anonymous/origin failures before storage and scopes exports to the session actor',async()=>{
 const {repo,sql}=setup();let user=null,originAllowed=true,calls=0;
 const route=load('app/api/tool-feedback/route.ts',{
  '../staff-access':{requireStaffRequest:async()=>!user?Response.json({error:'SIGN_IN_REQUIRED'},{status:401}):!originAllowed?Response.json({error:'INVALID_REQUEST_ORIGIN'},{status:403}):null},
  '../../../lib/worker-session':{readSessionCookie:()=>'',verifySession:async()=>user},
  '../../../lib/documents/request-context':{boundedJson:r=>r.json()},
  '../../../lib/tool-feedback':{...feedback,feedbackRepository:async()=>{calls++;return repo;}}
 },{Request,Response,URL,ReadableStream,process:{env:{}}});
 const request=()=>new Request('https://example.test/api/tool-feedback',{method:'POST',body:JSON.stringify(input()),headers:{'content-type':'application/json'}});
 assert.equal((await route.POST(request())).status,401);user=actor('ramazan');originAllowed=false;
 assert.equal((await route.POST(request())).status,403);assert.equal(calls,0);originAllowed=true;
 assert.equal((await route.POST(request())).status,201);
 await repo.create(input({message:'Only Ali sees this other worker report.'}),actor('darkhan'));
 const exported=await route.GET(new Request('https://example.test/api/tool-feedback?format=ndjson&worker=ali'));
 const lines=(await exported.text()).trim().split('\n').map(JSON.parse);assert.equal(lines.at(-1).reports,1);assert.equal(lines[1].actor_id,'worker:ramazan');assert.equal(lines[0].schemaVersion,1);
 assert.equal((await route.GET(new Request('https://example.test/api/tool-feedback?before=-1'))).status,400);sql.close();
});
function ui(t){
 const dom=new JSDOM(`<body data-assessment-workflow="answers" data-assessment-version="${release.version}"><section id="questionnaireStep" data-assessment-step="answers"><div class="field"><label class="lbl">Текущая сумма *</label><input id="n8040_r2" value="private-answer"></div><input type="password" id="previewEdsPassword" value="private-credential"></section><div class="wf-bottom-caption">2 из 3</div></body>`,{url:'https://synthetic.test',runScripts:'outside-only'});
 const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HostedAssessment={ready:()=>true,getContext:()=>({client:{external:{dealId:'11665'}}})};
 const calls=[];let fail=true;w.fetch=async(path,options)=>{calls.push(JSON.parse(options.body));if(fail)throw Error('Failed to fetch');return {ok:true,json:async()=>({ok:true,id:'synthetic-report'})};};
 vm.runInContext(fs.readFileSync('public/tool-feedback.js','utf8'),dom.getInternalVMContext());t.after(()=>dom.window.close());
 return {w,d:w.document,calls,succeed(){fail=false;}};
}
test('report UI preserves failed message and idempotency, and never sends input values or credentials',async t=>{
 const s=ui(t);s.d.getElementById('n8040_r2').focus();s.d.getElementById('reportMistake').click();
 const textarea=s.d.getElementById('feedbackMessage');textarea.value='The calculated total did not appear.';
 const send=()=>s.d.querySelector('#feedbackDialog form').dispatchEvent(new s.w.Event('submit',{bubbles:true,cancelable:true}));
 send();await new Promise(r=>setTimeout(r,0));assert.equal(textarea.value,'The calculated total did not appear.');
 s.succeed();send();await new Promise(r=>setTimeout(r,0));assert.equal(s.calls.length,2);assert.equal(s.calls[0].requestId,s.calls[1].requestId);
 assert.equal(s.calls[0].dealId,'11665');assert.equal(s.calls[0].fieldId,'n8040_r2');assert.ok(!JSON.stringify(s.calls).includes('private-'));assert.match(s.d.getElementById('feedbackStatus').textContent,/сохранено/);
});
test('three operational entries preserve the analyzer and report version matches its saved record version',()=>{
 assert.equal(fs.existsSync('public/assessment-card.html'),false,'Static assets must not shadow the canonical protected tool');
 for(const path of ['templates/assessment-card.html']){
  const dom=new JSDOM(fs.readFileSync(path,'utf8')),cards=dom.window.document.querySelectorAll('.task-grid>.task-card');assert.equal(cards.length,3);
  assert.equal(cards[0].getAttribute('href'),'/assessment-review');assert.equal(cards[1].getAttribute('href'),'/lawyer-handoff');assert.match(cards[2].href,/gkb-credit-analyzer-kz/);assert.equal(cards[0].target,'_top');assert.equal(cards[1].target,'_top');dom.window.close();
 }
 const dom=new JSDOM(fs.readFileSync('public/questionnaire.html','utf8'));assert.equal(dom.window.document.body.dataset.assessmentVersion,release.version);assert.ok(dom.window.document.querySelector('script[src="/tool-feedback.js"]'));dom.window.close();
});
