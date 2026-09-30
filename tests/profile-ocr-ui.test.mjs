import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const script=fs.readFileSync('public/profile-ocr.js','utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,40));
async function setup(t,{pending=[],lease=null,mode='profile',failSave=false,claimRace=false,failClaim=false,changedReadback=false,interruptible=false}={}){
 const dom=new JSDOM('<section id="documentStep"><div id="afPanel"></div></section><section id="questionnaireStep"><input id="fio"><input id="clientBenefitsCount" value="2"></section>',{url:'https://synthetic.invalid/?mode='+mode,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,d=w.document,calls=[];
 const ctx={identityRevision:1,client:{iin:'000000000010',external:{dealId:'900001'}}},item={id:1,storedDocumentId:'doc',person:'Клиент',file:{name:'test.pdf'}};
 let current=ctx,recognitions=0,downloads=0,disposes=0,output=[],saved=pending.length?[]:[{page:1,text:'TEST PERSON',lines:[],confidence:.9}];
 const data=()=>({documentId:'doc',identityRevision:1,originalSha256:'hash',pdfSha256:'pdf-hash',totalPages:1,engineVersion:'test-engine',eligiblePages:[1],pendingPages:pending.filter(p=>!saved.some(s=>s.page===p)),completedPages:saved.map(p=>({page:p.page,confidence:p.confidence})),pages:saved,lease,suggestions:{extraction:{facts:[{key:'identity.name',value:'TEST PERSON',page:1},{key:'benefits.count',value:'9',page:1}],credits:[]}}});
 w.HostedAssessment={getContext:()=>current,requestJson:async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;calls.push({url,body});
  if(body?.action==='release'&&interruptible)await new Promise(resolve=>setTimeout(resolve,100));
  if(body?.action==='claim'&&claimRace)return {...data(),claimed:false,lease:{mine:false,displayName:'Colleague'}};
  if(body?.action==='claim'&&failClaim&&calls.filter(c=>c.body?.action==='claim').length===1)throw Object.assign(Error('Lost claim response'),{code:'REQUEST_TIMEOUT'});
  if(body?.action==='page'){saved.push(body.page);if(failSave)throw Object.assign(Error('Lost response'),{code:'REQUEST_TIMEOUT'});}
  if(changedReadback&&url.endsWith('?page=1'))return {...data(),identityRevision:2};
  return {...data(),...(body?.action==='claim'?{claimed:true}:{})};
 }};
 w.ServerDrafts={canSwitch:()=>true};w.af={results:new Map([[1,{ocrPages:[1]}]])};w.selectedFiles=[item];w.afExcluded=()=>false;w.afSource=source=>output.push(source);
 w.fetch=async()=>{downloads++;throw Error('unexpected download');};
 w.__runtime={createBrowserOcr:async()=>({recognizePage:async(image,{signal})=>{recognitions++;if(interruptible&&recognitions===1)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Paused'),{name:'AbortError'})),{once:true}));return{engineVersion:'test-engine',text:'TEST PERSON',width:100,height:100,lines:[{text:'TEST PERSON',confidence:.9,box:[0,0,90,20]}]};},dispose:()=>disposes++})};
 let code=script.replace("await import('/browser-ocr-assets/browser-ocr.mjs')",'window.__runtime');
 // Replace only browser graphics in the workflow test. The real worker is benchmarked separately.
 code=code.replace(/async function loadPdf\([\s\S]*?\n \}\n async function pageImage/,"async function loadPdf(){downloads++;return {pdf:{},dispose:async()=>{}};}\n async function pageImage");
 code=code.replace(/async function pageImage\([\s\S]*?\n \}\n function normalize/,"async function pageImage(){return {};}\n function normalize");
 w.downloads=0;
 // loadPdf stub must use the test-side counter through a function, not module scope.
 code=code.replace('downloads++;return {pdf:{}','window.__download();return {pdf:{}');w.__download=()=>downloads++;
 vm.runInContext(code,dom.getInternalVMContext());
 t.after(()=>{w.ProfileOcr?.stop();w.close();});
 return{w,d,calls,item,ctx,output,run:async()=>{w.ProfileOcr?.refresh();await tick();await tick();},change:()=>{current={...ctx,client:{iin:'000000000029',external:{dealId:'900002'}}};d.dispatchEvent(new w.Event('assessment-case-opened'));},counts:()=>({recognitions,downloads,disposes})};
}
test('saved OCR reopens without downloading a PDF or loading the recognition engine',async t=>{
 const s=await setup(t);await s.run();assert.deepEqual(s.counts(),{recognitions:0,downloads:0,disposes:0});
 assert.match(s.d.getElementById('profileOcr').textContent,/Чтение завершено/);
 assert.ok(s.calls.every(c=>!c.body),'cached viewing performs no writes');
 const page=s.d.querySelector('#profileOcr details details');page.open=true;await tick();
 assert.equal(s.d.querySelector('textarea').value,'TEST PERSON');
});
test('employee inserts a suggestion only into an empty field; existing answers and reviews remain untouched',async t=>{
 const s=await setup(t);await s.run();const puts=[...s.d.querySelectorAll('button')].filter(b=>b.textContent==='Вставить в пустое поле');assert.equal(puts.length,1);
 puts[0].click();assert.equal(s.d.getElementById('fio').value,'TEST PERSON');assert.equal(s.d.getElementById('clientBenefitsCount').value,'2');
 assert.ok(s.calls.every(c=>!c.body),'inserting an answer does not create evidence approvals or a profile save');
});
test('a changed answer or switched client cannot be overwritten by a stale suggestion',async t=>{
 const s=await setup(t);await s.run();const put=[...s.d.querySelectorAll('button')].find(b=>b.textContent==='Вставить в пустое поле');
 s.d.getElementById('fio').value='EMPLOYEE EDIT';put.click();assert.equal(s.d.getElementById('fio').value,'EMPLOYEE EDIT');
 s.d.getElementById('fio').value='';s.change();put.click();assert.equal(s.d.getElementById('fio').value,'');
});
test('another employee lease prevents duplicate laptop processing',async t=>{
 const s=await setup(t,{pending:[1],lease:{mine:false,displayName:'Test colleague'}});await s.run();
 assert.equal(s.counts().recognitions,0);assert.equal(s.counts().downloads,0);assert.ok(s.calls.every(c=>!c.body));assert.match(s.d.getElementById('profileOcr').textContent,/Test colleague/);
});
test('each page is saved once and a lost save response is reconciled without OCR or write repetition',async t=>{
 const s=await setup(t,{pending:[1],failSave:true});await s.run();
 assert.equal(s.counts().recognitions,1);assert.equal(s.counts().downloads,1);
 assert.deepEqual(s.calls.filter(c=>c.body).map(c=>c.body.action),['claim','page','release']);
 assert.ok(s.calls.some(c=>c.url.endsWith('?page=1')));assert.match(s.d.getElementById('profileOcr').textContent,/Чтение завершено/);
 await s.run();assert.equal(s.counts().recognitions,1);assert.equal(s.counts().downloads,1);
});
test('sales mode does not start OCR or add profile UI',async t=>{
 const s=await setup(t,{mode:''});assert.equal(s.w.ProfileOcr,null);assert.equal(s.d.getElementById('profileOcr'),null);assert.equal(s.calls.length,0);
});
test('a colleague winning the claim race never starts a second recognizer',async t=>{
 const s=await setup(t,{pending:[1],claimRace:true});await s.run();assert.equal(s.counts().recognitions,0);assert.equal(s.counts().downloads,0);
 assert.deepEqual(s.calls.filter(c=>c.body).map(c=>c.body.action),['claim']);assert.match(s.d.getElementById('profileOcr').textContent,/другой сотрудник/);
});
test('an uncertain claim retries only the same token after checking the current document',async t=>{
 const s=await setup(t,{pending:[1],failClaim:true});await s.run();const claims=s.calls.filter(c=>c.body?.action==='claim');
 assert.equal(claims.length,2);assert.equal(claims[0].body.leaseToken,claims[1].body.leaseToken);assert.equal(s.counts().recognitions,1);
 assert.equal(s.calls.filter(c=>c.body?.action==='page').length,1);
});
test('a lost save response cannot accept a result from a changed client identity',async t=>{
 const s=await setup(t,{pending:[1],failSave:true,changedReadback:true});await s.run();
 assert.match(s.d.getElementById('profileOcr').textContent,/Клиент изменился/);assert.doesNotMatch(s.d.getElementById('profileOcr').textContent,/Чтение завершено/);
 assert.equal(s.calls.filter(c=>c.body?.action==='page').length,1);
});

test('quick pause and resume waits for release then continues without getting stuck',async t=>{
 const s=await setup(t,{pending:[1],interruptible:true});await s.run();assert.equal(s.counts().recognitions,1);
 const toggle=s.d.querySelector('#profileOcr > button');toggle.click();toggle.click();
 for(let n=0;n<10;n++)await tick();
 assert.equal(s.counts().recognitions,2);assert.equal(s.calls.filter(c=>c.body?.action==='page').length,1);
 assert.match(s.d.getElementById('profileOcr').textContent,/Чтение завершено/);
});
