import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import{JSDOM}from'jsdom';
function load(path,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n]});return exports;}
const repository=load('lib/documents/repository.ts');
const {assertSubmissionDestination}=load('lib/questionnaire/submission-destination.ts',{'../documents/repository':repository});
test('server rejects stale or wrong destination before outbound work',()=>{
 const record={external_id:'11665',client_iin:'SYNTHETIC',identity_revision:4};
 for(const value of [null,{}, {dealId:'11666',iin:'SYNTHETIC',identityRevision:4},{dealId:'11665',iin:'OTHER',identityRevision:4},{dealId:'11665',iin:'SYNTHETIC',identityRevision:3}])assert.throws(()=>assertSubmissionDestination(record,value),/SUBMISSION_DESTINATION_CHANGED/);
 assert.doesNotThrow(()=>assertSubmissionDestination(record,{dealId:'11665',iin:'SYNTHETIC',identityRevision:4}));
});
test('destination dialog shows a fresh identity and requires a deliberate confirmation',async t=>{
 const dom=new JSDOM('<body/>',{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const context={client:{title:'SYNTHETIC CLIENT',iin:'SYNTHETIC',external:{dealId:'11665'}},identityRevision:4};w.HostedAssessment={getContext:()=>context};let reads=0;w.fetch=async()=>{reads++;return{ok:true,json:async()=>context};};w.eval(fs.readFileSync('public/submission-destination.js','utf8'));
 const pending=w.SubmissionDestination.confirm();await new Promise(r=>setTimeout(r,0));const d=w.document.querySelector('dialog');assert.match(d.textContent,/SYNTHETIC CLIENT/);assert.match(d.textContent,/11665.*SYNTHETIC/);const send=[...d.querySelectorAll('button')].at(-1);assert.equal(send.disabled,true);const check=d.querySelector('input');check.checked=true;check.dispatchEvent(new w.Event('change'));send.click();assert.equal((await pending).dealId,'11665');assert.equal(reads,1);
 w.fetch=async()=>({ok:true,json:async()=>({...context,identityRevision:5})});await assert.rejects(w.SubmissionDestination.confirm(),/Клиент сделки изменился/);assert.equal(w.document.querySelector('dialog'),null);
});
