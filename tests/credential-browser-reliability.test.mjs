/** Full credential UI with the actual bounded request helper; no production access. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const reply=data=>({ok:true,json:async()=>data});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function setup(t){
 const dom=new JSDOM('<div data-required-document="ЭЦП файл"><label><input type="file"></label></div><div class="field"><label class="lbl">Пароль</label><input id="previewEdsPassword"><p class="hint"></p></div><input id="fio"><div id="hostDealName"></div>',{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 // Use the real timeout/race implementation with a short clock, not a fake fetch timeout.
 const timer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timer(fn,ms>=20000?35:ms,...args);
 w.eval(fs.readFileSync('public/hosted-assessment.js','utf8'));
 let context={identityRevision:1,client:{external:{dealId:'900001'},title:'SYNTHETIC',iin:'000000000010'}},handler=()=>reply({identityRevision:1,credentials:{verified:false},unsent:null});
 const calls=[];w.HostedAssessment.ready=()=>Boolean(context);w.HostedAssessment.getContext=()=>context;
 w.af={busy:false};w.selectedFiles=[];w.renderDocuments=()=>{};w.refreshRequiredDocuments=()=>{};
 w.fetch=(path,options={})=>{calls.push({path,options});return handler(path,options);};
 w.eval(fs.readFileSync('public/credential-upload.js','utf8'));
 const password=d.getElementById('previewEdsPassword'),owner=d.querySelector('input[type=checkbox]'),status=d.querySelector('[role=status]:not(.credential-selection-status)');
 const choose=(name='key.p12')=>{w.selectedFiles=[{id:Date.now(),type:'ЭЦП файл',person:'Клиент',file:{name,size:3,lastModified:1,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}}];w.CredentialUpload.selectionChanged();password.value='SYNTHETIC';owner.checked=true;};
 return{w,d,calls,password,owner,status,choose,setHandler:fn=>handler=fn,open(id){context={...context,client:{...context.client,external:{dealId:id}}};d.dispatchEvent(new w.Event('assessment-case-opened'));}};
}
test('a late saved-key status cannot approve a different newly selected key',async t=>{
 const s=setup(t);await tick();const gate=deferred();s.setHandler(()=>gate.promise);s.open('900001');
 s.choose('replacement.p12');gate.resolve(reply({identityRevision:1,credentials:{verified:true,requestId:'saved',files:[]},unsent:null}));await tick();await tick();
 assert.equal(s.w.CredentialUpload.verified(),false);assert.equal(s.password.hidden,false);assert.equal(s.owner.checked,true);
});
test('a credential response from a departed client cannot replace the current client status',async t=>{
 const s=setup(t);await tick();const gate=deferred();s.setHandler(path=>path.includes('900001')?gate.promise:reply({identityRevision:1,credentials:{verified:false},unsent:null}));
 s.open('900001');s.open('900002');await tick();const before=s.status.textContent;
 gate.resolve({ok:false,json:async()=>{throw Error('old client response');}});await tick();await tick();
 assert.equal(s.status.textContent,before);assert.equal(s.w.CredentialUpload.verified(),false);
});
test('a hung credential preflight ends with an actionable error and sends no key',async t=>{
 const s=setup(t);await tick();s.choose();s.setHandler(()=>new Promise(()=>{}));
 const completed=await Promise.race([s.w.CredentialUpload.submit().then(()=>({wrongSuccess:true}),error=>({error})),new Promise(resolve=>setTimeout(()=>resolve({hung:true}),180))]);
 assert.equal(completed.hung,undefined);assert.ok(completed.error);assert.equal(s.w.CredentialUpload.isBusy(),false);
 assert.equal(s.calls.some(c=>c.options.method==='POST'),false);
});
test('unchecking credential ownership during the preflight prevents sending',async t=>{
 const s=setup(t);await tick();s.choose();const gate=deferred();s.setHandler((path,options)=>options.method==='POST'?reply({verified:true,state:'verified'}):gate.promise);
 const pending=s.w.CredentialUpload.submit();s.owner.checked=false;gate.resolve(reply({identityRevision:1,credentials:{verified:false},unsent:null}));
 await assert.rejects(pending);assert.equal(s.calls.some(c=>c.options.method==='POST'),false);
});
test('a successful credential upload is not delayed by an optional cancellation lookup',async t=>{
 const s=setup(t);await tick();s.choose();let reads=0;s.setHandler((path,options)=>options.method==='POST'?reply({verified:true,state:'verified'}):++reads===1?reply({identityRevision:1,credentials:{verified:false},unsent:null}):new Promise(()=>{}));
 const result=await Promise.race([s.w.CredentialUpload.submit(),new Promise(resolve=>setTimeout(()=>resolve('hung'),180))]);
 assert.equal(result,true);assert.equal(s.w.CredentialUpload.isBusy(),false);assert.equal(s.w.CredentialUpload.verified(),true);
});
test('a failed existing-key lookup has a bounded read-only retry on the same screen',async t=>{
 const s=setup(t);await tick();s.setHandler(()=>Promise.reject(Error('offline')));await s.w.CredentialUpload.refreshStatus();
 const retry=s.d.getElementById('credentialStatusRetry');assert.equal(retry.hidden,false);
 s.setHandler(()=>reply({identityRevision:1,credentials:{verified:true,requestId:'saved',files:[]},unsent:null}));await retry.onclick();
 assert.equal(s.w.CredentialUpload.verified(),true);assert.equal(retry.hidden,true);assert.equal(s.calls.some(c=>c.options.method==='POST'),false);
});
test('a truthy non-boolean credential receipt never means verified',async t=>{
 const s=setup(t);await tick();s.setHandler(()=>reply({identityRevision:1,credentials:{verified:'false'},unsent:null}));await s.w.CredentialUpload.refreshStatus();assert.equal(s.w.CredentialUpload.verified(),false);
});
