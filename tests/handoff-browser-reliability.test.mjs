import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const stage={categoryId:'13',fromStageId:'C13:FINAL_INVOICE',fromStageName:'Договор',stageId:'C13:WON',stageName:'Сделка успешна'};
const saved={requestId:'12345678-1234-1234-1234-123456789012',state:'uncertain',destination:stage};
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
async function setup(t,handler){
 const dom=new JSDOM('<main class="wrap"><div class="wf-credential"><div class="field"><input id="previewEdsPassword"></div></div><div id="require-power"><input type="file" data-required-picker="Доверенность"></div></main>',{url:'https://synthetic.invalid/?mode=handoff',runScripts:'outside-only'}),w=dom.window,d=w.document;
 t.after(()=>w.close());const calls=[],analysed=[];
 let current={identityRevision:1,client:{title:'SYNTHETIC',iin:'000000000010',external:{dealId:'900001'}}};
 const make=(tag,text,cls)=>{const n=d.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 w.ClientContextUI={mode:'handoff',make,context:()=>current,ready:()=>Boolean(current),sync:()=>{},confirm:async()=>({dealId:current.client.external.dealId,iin:current.client.iin,identityRevision:current.identityRevision})};
 w.selectedFiles=[];w.fileSequence=0;w.af={busy:false,results:new Map()};w.renderDocuments=()=>{};
 w.afSource=()=>{};w.afAnalyze=()=>{throw Error('Intake autofill must not run from Tool 02');};
 w.ServerDrafts={capture:()=>({answers:[{key:'fio',value:'KEEP',checked:false}],documents:[]}),save:async()=>true};
 w.CredentialUpload={collected:()=>true,verified:()=>true,submit:async()=>true};
 w.DocumentReview={open:async()=>{},render:()=>{}};
 // Exercise the actual shared timeout/session/JSON helper, not a timeout stub.
 w.eval(fs.readFileSync('public/hosted-assessment.js','utf8'));
 w.HostedAssessment.analyzeFile=async item=>{analysed.push(item.id);item.storedDocumentId='power';return{documentId:'power'};};
 w.HostedAssessment.adapt=()=>({server:{documentId:'power'}});
 const realTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms>=30000?35:ms,...args);
 w.fetch=async(path,options={})=>{calls.push({path,method:options.method||'GET',body:options.body});return handler?handler(path,options):response({handoff:null,destination:stage,stageError:null,delivery:{ready:true}});};
 w.eval(fs.readFileSync('public/operations.js','utf8'));w.eval(fs.readFileSync('public/lawyer-handoff.js','utf8'));
 await tick();
 return {w,d,calls,analysed,open(id){current={...current,client:{...current.client,external:{dealId:id}}};d.dispatchEvent(new w.Event('assessment-case-opened'));},context:()=>current};
}
test('handoff status timeout releases retry controls and never triggers a write',async t=>{
 const s=await setup(t,()=>new Promise(()=>{}));await new Promise(r=>setTimeout(r,55));
 assert.equal(s.d.getElementById('handoffRefresh').disabled,false);
 assert.equal(s.d.getElementById('handoffSend').disabled,true);
 assert.match(s.d.getElementById('handoffReason').textContent,/Ответ не получен/);
 assert.equal(s.calls.filter(c=>c.method==='POST').length,0);
});
test('handoff status rejects malformed responses and exposes session recovery without writes',async t=>{
 for(const result of [()=>response({}),()=>response({handoff:{state:'verified'},destination:null}),()=>response({error:'SIGN_IN_REQUIRED'},401)]){
  const s=await setup(t,result);assert.equal(s.d.getElementById('handoffSend').disabled,true);assert.equal(s.calls.filter(c=>c.method==='POST').length,0);
  if(s.d.getElementById('assessmentSessionNotice'))assert.ok(s.d.querySelector('#assessmentSessionNotice a[target="_blank"]'));
 }
});
test('handoff client change clears the old pending transfer even when the new read fails',async t=>{
 const s=await setup(t,path=>path.includes('900001')?response({handoff:saved,destination:null,stageError:null,delivery:{ready:true}}):Promise.reject(Error('B read failed')));
 assert.equal(s.d.getElementById('handoffSend').textContent,'Проверить результат');
 s.open('900002');await tick();
 assert.equal(s.d.getElementById('handoffSend').disabled,true);
 assert.notEqual(s.d.getElementById('handoffSend').textContent,'Проверить результат');
 assert.equal(s.d.getElementById('handoffStage').textContent,'');
 assert.equal(s.calls.filter(c=>c.method==='POST').length,0);
});
test('late failure from an old client does not overwrite the current handoff state',async t=>{
 let rejectOld;const s=await setup(t,path=>path.includes('900001')?new Promise((_,reject)=>{rejectOld=reject;}):response({handoff:null,destination:stage,stageError:null,delivery:{ready:true}}));
 s.open('900002');await tick();rejectOld(Error('STALE OLD CLIENT'));await tick();
 assert.doesNotMatch(s.d.getElementById('handoffReason').textContent,/STALE/);
 assert.match(s.d.getElementById('handoffStage').textContent,/Сделка успешна/);
 assert.equal(s.d.getElementById('handoffRefresh').disabled,false);
});
test('handoff power check reads only that document, not the intake questionnaire',async t=>{
 const s=await setup(t,(path)=>path.endsWith('/handoff-check')?response({identityRevision:1,documents:{packageReady:true,issues:[],manuallyReviewed:[]}}):response({handoff:null,destination:stage,stageError:null,delivery:{ready:true}}));
 s.w.selectedFiles=[{id:1,type:'Доверенность',person:'Клиент',file:{name:'power.pdf'}},{id:2,type:'ГКБ — полный отчёт',person:'Клиент',file:{name:'unrelated.pdf'}}];
 s.d.dispatchEvent(new s.w.Event('assessment-files-selected'));await tick();await s.d.getElementById('handoffPowerCheck').onclick();
 assert.deepEqual(s.analysed,[1]);assert.equal(s.d.getElementById('handoffPowerState').textContent,'Проверена');
 const check=JSON.parse(s.calls.find(c=>c.path.endsWith('/handoff-check')).body);
 assert.deepEqual(check.payload.documents,[{documentId:'power',type:'Доверенность',person:'Клиент'}]);assert.deepEqual(check.payload.answers,[]);
 assert.equal(s.w.ServerDrafts.capture().answers[0].value,'KEEP');
});
test('lost handoff response is checked read-only before retry uses the existing operation',async t=>{
 let state=null,sent=0;const s=await setup(t,(path,options)=>{
  if(options.method==='POST'){sent++;if(sent===1){state=saved;return new Promise(()=>{});}assert.equal(JSON.parse(options.body).action,'resume');state={...saved,state:'verified'};return response({handoff:state});}
  return response({handoff:state,destination:state?null:stage,stageError:null,delivery:{ready:true}});
 });
 // A restored uncertain operation skips keys and uploads entirely.
 state=saved;await s.d.getElementById('handoffRefresh').onclick();
 s.w.CredentialUpload.submit=()=>{throw Error('Must not replay keys');};
 await s.d.getElementById('handoffSend').onclick();assert.equal(sent,1);
 assert.equal(s.d.getElementById('handoffSend').disabled,false);
 await s.d.getElementById('handoffSend').onclick();assert.equal(sent,2);
 const writes=s.calls.filter(c=>c.method==='POST').map(c=>JSON.parse(c.body));
 assert.ok(writes.every(c=>c.action==='resume'&&c.requestId===saved.requestId));
 assert.equal(s.d.getElementById('handoffSend').disabled,true);
});
test('handoff guidance is collapsed; three cards and explicit signature agreement remain',async t=>{
 const s=await setup(t);
 assert.equal(s.d.querySelectorAll('.ux-handoff-card').length,3);
 assert.equal(s.d.querySelector('.ux-handoff-help').open,false);
 assert.equal(s.d.getElementById('handoffSignedConfirmed').checked,false);
 assert.match(s.d.querySelector('.ux-confirm').textContent,/Клиент, подпись и QR/);
 assert.ok(s.d.getElementById('handoffRefresh'));
});
test('a historical stage receipt does not claim complete delivery when the assessment is missing',async t=>{
 const s=await setup(t,()=>response({handoff:{...saved,state:'verified'},destination:null,stageError:null,delivery:{ready:false,code:'HANDOFF_ASSESSMENT_REQUIRED'}}));
 assert.equal(s.d.getElementById('handoffSend').disabled,true);
 assert.match(s.d.getElementById('handoffReason').textContent,/данные переданы не полностью/);
 assert.match(s.d.getElementById('handoffDelivery').textContent,/Анкета не сохранена/);
 assert.equal(s.d.getElementById('handoffAssessmentLink').hidden,false);
 assert.equal(s.calls.filter(c=>c.method==='POST').length,0);
});
test('new and prepared transfers cannot bypass missing delivery; uncertain recovery stays read-only',async t=>{
 for(const state of [null,'prepared','uncertain']){
  const s=await setup(t,()=>response({handoff:state?{...saved,state}:null,destination:state?null:stage,stageError:null,delivery:{ready:false,code:'HANDOFF_ORIGINALS_REQUIRED'}}));
  assert.equal(s.d.getElementById('handoffSend').disabled,state!=='uncertain');
  assert.equal(s.d.getElementById('handoffAssessmentLink').hidden,false);
  assert.equal(s.calls.filter(c=>c.method==='POST').length,0);
 }
});

test('a prepared handoff cancels cleanly and restores inputs without a stage write',async t=>{
 let state={...saved,state:'prepared'};const s=await setup(t,(path,options)=>{
  if(options.method==='POST'){assert.equal(JSON.parse(options.body).action,'cancel');const row={...state,state:'cancelled'};state=null;return response({handoff:row});}
  return response({handoff:state,destination:state?null:stage,stageError:null,delivery:{ready:true}});
 });
 await s.d.getElementById('handoffCancel').onclick();
 assert.match(s.d.getElementById('handoffReason').textContent,/Подготовка отменена/);
 assert.equal(s.d.getElementById('handoffCancel').hidden,true);
 assert.equal(s.d.getElementById('handoffSignedFile').disabled,false);
 assert.equal(s.calls.filter(c=>c.method==='POST').length,1);
});

test('restored signed PDF is read and identity checked before any handoff side effect',async t=>{
 const order=[];const s=await setup(t,(path,options)=>{
  if(path.endsWith('/handoff-check'))return response({identityRevision:1,documents:{packageReady:true,issues:[],manuallyReviewed:[]}});
  if(options.method==='POST'){order.push('send');return response({handoff:{...saved,state:'verified'}});}
  return response({handoff:null,destination:stage,stageError:null,delivery:{ready:true}});
 });
 s.w.selectedFiles=[{id:1,type:'Доверенность',person:'Клиент',file:{name:'power.pdf'},storedDocumentId:'power'},{id:2,type:'Подписанный договор',person:'Клиент',file:{name:'signed.pdf'},storedDocumentId:'signed'}];
 let wrong=false;s.w.HostedAssessment.analyzeFile=async item=>{order.push('read-'+item.storedDocumentId);return {...s.context(),documentId:item.storedDocumentId,document:{totalPages:2,extraction:{identity:{iin:wrong?'different-client':s.context().client.iin}}}};};
 s.w.HostedAssessment.adapt=a=>({server:{documentId:a.documentId}});s.w.CredentialUpload.submit=async()=>{order.push('credentials');};
 await s.d.getElementById('handoffPowerCheck').onclick();const agree=s.d.getElementById('handoffSignedConfirmed');agree.checked=true;await agree.onchange();assert.equal(s.d.getElementById('handoffSend').disabled,false);
 wrong=true;await s.d.getElementById('handoffSend').onclick();assert.equal(order.includes('credentials'),false);assert.equal(order.includes('send'),false);assert.match(s.d.getElementById('handoffReason').textContent,/другой клиент/);
 wrong=false;await s.d.getElementById('handoffSend').onclick();assert.deepEqual(order.slice(-3),['read-signed','credentials','send']);assert.equal(s.w.ServerDrafts.capture().answers[0].value,'KEEP');
});
