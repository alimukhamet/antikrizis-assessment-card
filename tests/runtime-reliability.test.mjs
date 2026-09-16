import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {JSDOM,requestInterceptor} from 'jsdom';

function browser(t,html='<input id="answer" value="UNSAVED ANSWER">'){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html',runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 const w=dom.window;w.crypto.randomUUID=()=>webcrypto.randomUUID();
 return {dom,w,run:file=>vm.runInContext(fs.readFileSync('public/'+file,'utf8'),dom.getInternalVMContext())};
}
test('expired session preserves answers, offers one separate login tab, and never retries writes automatically',async t=>{
 const {w,run}=browser(t);let calls=0,online=false;
 w.fetch=async()=>{calls++;return online?{ok:true,status:200,json:async()=>({ok:true})}:{ok:false,status:401,json:async()=>{throw Error('HTML login response');}};};
 run('hosted-assessment.js');
 for(let n=0;n<2;n++)await assert.rejects(w.HostedAssessment.requestJson('/api/test',{method:'POST'}),e=>e.code==='SIGN_IN_REQUIRED');
 assert.equal(calls,2);assert.equal(w.document.querySelector('#answer').value,'UNSAVED ANSWER');
 assert.equal(w.document.querySelectorAll('#assessmentSessionNotice').length,1);
 const link=w.document.querySelector('#assessmentSessionNotice a');assert.equal(link.target,'_blank');assert.equal(link.getAttribute('rel'),'noopener');
 online=true;await w.HostedAssessment.requestJson('/api/test');assert.equal(w.document.querySelector('#assessmentSessionNotice'),null);
});
test('HTML gateway failures and malformed JSON produce safe errors without clearing answers',async t=>{
 const {w,run}=browser(t);run('hosted-assessment.js');
 for(const [response,code] of [
  [{ok:false,status:502,json:async()=>{throw Error('<html>gateway</html>');}},'SERVER_UNAVAILABLE'],
  [{ok:true,status:200,json:async()=>null},'INVALID_SERVER_RESPONSE'],
  [{ok:true,status:200,json:async()=>[]},'INVALID_SERVER_RESPONSE'],
  [{ok:true,status:200,redirected:true,json:async()=>({})},'SIGN_IN_REQUIRED']
 ]){w.fetch=async()=>response;await assert.rejects(w.HostedAssessment.requestJson('/api/test'),e=>e.code===code);}
 assert.equal(w.document.querySelector('#answer').value,'UNSAVED ANSWER');
});
test('a stalled response body times out and leaves the form intact',async t=>{
 const {w,run}=browser(t);w.fetch=async()=>({ok:true,status:200,json:()=>new Promise(()=>{})});run('hosted-assessment.js');
 await assert.rejects(w.HostedAssessment.requestJson('/api/test',{}, {timeoutMs:10}),e=>e.code==='REQUEST_TIMEOUT');
 assert.equal(w.document.querySelector('#answer').value,'UNSAVED ANSWER');
});
function draftBrowser(t){
 const b=browser(t,'<section id="questionnaireStep"><input id="fio" value="INITIAL"></section><input id="needsSocialDoc"><input id="needsSalaryDoc"><button id="saveDraft"></button><button id="loadDraft"></button>');
 const ctx={client:{external:{dealId:'900001'}},identityRevision:1};
 Object.assign(b.w,{af:{busy:false,rowKeys:new Map(),sources:new Map(),results:new Map()},selectedFiles:[],renderDocuments(){},showDraftStatus(){},HostedAssessment:{ready:()=>false,getContext:()=>ctx},afExcluded:()=>false});
 b.run('server-drafts.js');b.w.HostedAssessment.ready=()=>true;return {...b,ctx};
}
test('two simultaneous draft saves return the same failure instead of silently sending a second write',async t=>{
 const {w}=draftBrowser(t);let writes=0,release;
 w.HostedAssessment.requestJson=async(_url,options)=>{if(!options?.method)return{draft:null};writes++;if(writes===1)await new Promise(resolve=>release=resolve);throw Error('temporary failure');};
 await w.ServerDrafts.inspect();w.document.getElementById('fio').value='UNSAVED CHANGE';
 const first=w.ServerDrafts.save(),second=w.ServerDrafts.save();release();
 assert.deepEqual(await Promise.all([first,second]),[false,false]);assert.equal(writes,1);assert.equal(w.ServerDrafts.isDirty(),true);assert.equal(w.ServerDrafts.isBusy(),false);
});
test('a late failure while opening the previous client does not overwrite the new client draft state',async t=>{
 const {w,ctx}=draftBrowser(t);let rejectFirst;
 w.HostedAssessment.requestJson=async url=>{if(url.includes('900001'))return new Promise((_resolve,reject)=>rejectFirst=reject);return{draft:null};};
 const first=w.ServerDrafts.inspect();ctx.client.external.dealId='900002';await w.ServerDrafts.inspect();
 rejectFirst(Error('old client failed'));await first;assert.equal(w.ServerDrafts.loadState().phase,'ready');
});
test('vendored contract packages are byte-identical to the pinned published builds',()=>{
 const hashes={'pizzip-3.1.7.min.js':'f1c851bff85c23f20555cfe18f6242dfd8c6117121050ad8bb53919230d2f571','docxtemplater-3.50.0.min.js':'b744ba75b698403ccd1b9e7abe8065354619893cc2fe0683801395766ba79906'};
 for(const[name,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(fs.readFileSync('public/vendor/contracts/'+name)).digest('hex'),hash);
});
test('the actual contract renderer generates a complete DOCX with every external CDN blocked',async t=>{
 const requested=[];
 const localOnly=requestInterceptor(request=>{requested.push(request.url);const path=new URL(request.url).pathname;if(path.startsWith('/vendor/contracts/'))return new Response(fs.readFileSync('public'+path),{headers:{'Content-Type':'text/javascript'}});throw Error('External network blocked');});
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://synthetic.invalid/',runScripts:'dangerously',resources:{interceptors:[localOnly]}});t.after(()=>dom.window.close());
 const w=dom.window,source=fs.readFileSync('public/contract-renderer.js','utf8');w.eval(source);await w.ContractRenderer.ready();
 const template=source.match(/const TEMPLATE_B64 = '([^']+)';/)[1],original=new w.PizZip(template,{base64:true});
 const data={payments:[{index:'1',amount:'200 000',date:'17 сентября 2026 г.'},{index:'2',amount:'200 000',date:'17 октября 2026 г.'}]};
 for(const name of Object.keys(original.files).filter(n=>n.endsWith('.xml'))){const text=original.file(name).asText().replace(/<[^>]*>/g,'');for(const [,key]of text.matchAll(/\{\{([^{}]+)\}\}/g)){if(!/^[#/]/.test(key))data[key]='SYNTHETIC';}}
 data.client_name='SYNTHETIC TEST CLIENT';data.contract_number='TEST-NOT-FOR-SIGNING';
 const blob=await w.ContractRenderer.render(data,w.ContractRenderer.version);
 assert.ok(blob.size>10000);assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 const buffer=await new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
 const generated=new w.PizZip(buffer),document=generated.file('word/document.xml').asText();
 assert.ok(document.includes('SYNTHETIC TEST CLIENT'));assert.ok(document.includes('TEST-NOT-FOR-SIGNING'));assert.ok(!document.includes('{{'));assert.ok(!document.includes('undefined'));
 assert.equal(requested.length,2);assert.ok(requested.every(url=>new URL(url).pathname.startsWith('/vendor/contracts/')));
});
