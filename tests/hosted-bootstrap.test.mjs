import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
test('deal autoload waits for all form scripts before taking the draft baseline',async t=>{
 const dom=new JSDOM('<div id="hostDealId"></div><button id="hostLoadDeal"></button><p id="hostDealName"></p><input id="iin"><input id="afDate"><button id="afApply"></button><select id="afClient"></select><div class="draft-toolbar"></div>',{url:'https://synthetic.invalid/questionnaire.html?dealId=900001',runScripts:'outside-only'}),w=dom.window; t.after(()=>w.close());
 let phase='loading',requests=0,formFinished=false;Object.defineProperty(w.document,'readyState',{get:()=>phase});
 Object.assign(w,{documentState(){},afStatus(){},afRefresh(){},af:{sources:new Map()},fetch:async()=>{requests++;assert.equal(formFinished,true,'No draft baseline before late form initialization');return{ok:true,json:async()=>({client:{title:'SYNTHETIC',iin:null,external:{dealId:'900001'}},identityRevision:1})};}});
 vm.runInContext(fs.readFileSync('public/hosted-assessment.js','utf8'),dom.getInternalVMContext());w.HostedAssessment.mount();assert.equal(requests,0);
 const opened=new Promise(resolve=>w.document.addEventListener('assessment-case-opened',resolve,{once:true}));
 formFinished=true;phase='interactive';w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await opened;assert.equal(requests,1);
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));assert.equal(requests,1,'Autoload occurs only once');
});
