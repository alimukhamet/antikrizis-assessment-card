import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {httpHeaders} from './bitrix-headers-helper.mjs';
import {JSDOM} from 'jsdom';
function load(path,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(!(n in deps))throw Error(n);return deps[n];},fetch,AbortSignal,Date,Error,Response,process:{env:{}}});return exports;}
const crm=load('lib/crm/bitrix.ts',{'./http-headers':httpHeaders,'../documents/extract-native':{validIin:()=>false}});
class RepositoryError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}
const {evidenceError}=load('lib/documents/request-context.ts',{'../crm/bitrix':crm,'../worker-session':{},'./storage':{},'./repository':{RepositoryError}});

for(const [status,body,code,expectedStatus]of [
 [400,{error:'',error_description:'Not found'},'DEAL_NOT_FOUND',404],
 [400,{error:'',error_description:'Access denied'},'DEAL_ACCESS_DENIED',403],
 [401,{error:'INVALID_CREDENTIALS'},'BITRIX_ACCESS_DENIED',503],
 [403,{error:'PORTAL_DELETED'},'BITRIX_ACCESS_DENIED',503],
 [400,{error:'',error_description:'private-provider-text'},'DEAL_READ_FAILED',502],
])test(`case opening reports ${code} without disguising it as a document failure`,async()=>{
 let calls=0;
 try{await crm.readClientContext('900001','https://synthetic.invalid/rest/',async()=>{calls++;return Response.json(body,{status});});assert.fail('must reject');}
 catch(error){assert.equal(error.message,code);const response=evidenceError(error);assert.equal(response.status,expectedStatus);assert.deepEqual(await response.json(),{error:code});}
 assert.equal(calls,1,'a permanent provider rejection must not be retried');
});
test('unexpected errors remain private and repository statuses are retained',async()=>{
 assert.deepEqual(await evidenceError(new Error('private-client-data')).json(),{error:'EVIDENCE_REQUEST_FAILED'});
 const response=evidenceError(new RepositoryError('CASE_IDENTITY_CHANGED',409));assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'CASE_IDENTITY_CHANGED'});
});
test('missing deal shows a specific actionable message and never announces an opened case',async t=>{
 const dom=new JSDOM('<div id="hostDealId"></div><button id="hostLoadDeal"></button><p id="hostDealName"></p><input id="iin"><input id="afDate"><button id="afApply"></button><select id="afClient"></select><div class="draft-toolbar"></div>',{url:'https://synthetic.invalid/questionnaire.html',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
 let status='',opened=0;Object.assign(w,{documentState(){},afStatus:text=>{status=text;},afRefresh(){},af:{sources:new Map()},fetch:async()=>({ok:false,status:404,json:async()=>({error:'DEAL_NOT_FOUND'})})});
 w.document.addEventListener('assessment-case-opened',()=>opened++);
 vm.runInContext(fs.readFileSync('public/hosted-assessment.js','utf8'),dom.getInternalVMContext());w.HostedAssessment.mount();
 w.document.getElementById('hostDealId').value='900001';await w.document.getElementById('hostLoadDeal').onclick();
 assert.match(status,/не найдена в Bitrix/);assert.match(status,/выберите клиента по имени/);assert.equal(opened,0);assert.equal(w.HostedAssessment.ready(),false);
});
