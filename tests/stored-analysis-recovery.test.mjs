import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const context={client:{title:'SYNTHETIC',iin:null,external:{dealId:'900001'}},identityRevision:1};
async function setup(t,handler){
 const dom=new JSDOM('<input id="hostDealId"><button id="hostLoadDeal"></button><p id="hostDealName"></p><input id="iin"><input id="afDate"><button id="afApply"></button><select id="afClient"></select><div class="draft-toolbar"></div>',{url:'https://synthetic.invalid/',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
 Object.assign(w,{documentState(){},afStatus(){},afRefresh(){},af:{sources:new Map()},fetch:async(path,options)=>path==='/api/assessment/900001'?{ok:true,json:async()=>structuredClone(context)}:handler(path,options)});
 w.eval(fs.readFileSync('public/hosted-assessment.js','utf8'));w.HostedAssessment.mount();w.document.getElementById('hostDealId').value='900001';await w.document.getElementById('hostLoadDeal').onclick();return w;
}
const stale=()=>({ok:false,status:409,json:async()=>({error:'CACHE_REPROCESS_REQUIRED'})});
test('reopening a saved draft refreshes obsolete analysis from the same stored PDF',async t=>{
 const calls=[];const w=await setup(t,async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return calls.length===1?stale():{ok:true,json:async()=>({documentId:'saved-doc',extractionId:'new-analysis'})};});
 const item={storedDocumentId:'saved-doc',file:{name:'original.pdf'}};const result=await w.HostedAssessment.analyzeFile(item,{cacheOnly:true,restoreOnly:true});
 assert.equal(result.extractionId,'new-analysis');assert.equal(item.storedDocumentId,'saved-doc');assert.deepEqual(calls,[{path:'/api/assessment/900001/documents/saved-doc/analyze',body:{cacheOnly:true}},{path:'/api/assessment/900001/documents/saved-doc/analyze',body:{cacheOnly:false}}]);
});
test('a replaced PDF cannot trigger a stale retry or receive the old result',async t=>{
 let resolve,calls=0;const w=await setup(t,()=>{calls++;return new Promise(r=>resolve=r);});const item={storedDocumentId:'old-doc',file:{name:'old.pdf'}};
 const waiting=w.HostedAssessment.analyzeFile(item,{cacheOnly:true,restoreOnly:true});item.storedDocumentId='replacement';resolve(stale());await assert.rejects(waiting);assert.equal(calls,1);assert.equal(item.storedDocumentId,'replacement');
 const second=w.HostedAssessment.analyzeFile(item);item.file={name:'new.pdf'};resolve({ok:true,json:async()=>({documentId:'unexpected'})});await assert.rejects(second,/изменился/);assert.equal(item.storedDocumentId,'replacement');
});
test('a reader failure is actionable and does not discard the saved document reference',async t=>{
 let calls=0;const w=await setup(t,async()=>{calls++;return calls===1?stale():{ok:false,status:422,json:async()=>({error:'PDF_UNREADABLE'})};});const item={storedDocumentId:'saved-doc',file:{name:'original.pdf'}};
 await assert.rejects(w.HostedAssessment.analyzeFile(item,{cacheOnly:true,restoreOnly:true}));assert.equal(calls,2);assert.equal(item.storedDocumentId,'saved-doc');
});
