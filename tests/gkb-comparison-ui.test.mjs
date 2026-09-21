import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';import {compareGkb,creditorKey} from '../public/gkb-comparison.mjs';
test('comparison opens both source pages and navigates to the exact loan without changing answers',t=>{
 const dom=new JSDOM('<details open><summary id="debtSummary">Долги</summary><div id="loan-1"><input id="n8040_r1" value="77.25"></div></details>',{runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.compareGkb=compareGkb;w.creditorKey=creditorKey;w.selectedFiles=[{id:1,person:'Клиент'},{id:2,person:'Клиент'}];w.HostedAssessment={getContext:()=>({client:{iin:'test',external:{dealId:'test-deal'}},assessmentDay:'2026-09-14'})};
 const report=(kind,value,page)=>({kind,date:'2026-09-14',identity:{iin:'test'},server:{dealId:'test-deal'},creditEvidence:{readable:true,creditList:{complete:true},findings:[],credits:[{contractNumber:'EXACT',page,facts:[{key:'creditor',value:'TEST BANK',page},{key:'debtOutstanding',value,page},{key:'overdueDays',value:'0',page}]}]}});
 w.af={results:new Map([[1,report('gkbShort','100.00',2)],[2,report('gkbFull','101.00',7)]]),rowKeys:new Map([['creditors|test|TEST BANK|EXACT','loan-1']])};
 const sources=[],focused=[];w.afSource=src=>sources.push(src);w.afFocus=node=>focused.push(node.id);w.AssessmentWorkflow={refresh(){d.getElementById('debtSummary').append(w.GkbComparison.statusButton());}};
 w.eval(fs.readFileSync('public/gkb-comparison-ui.mjs','utf8').replace(/^import .+;\n/,''));
 const status=d.querySelector('.wf-gkb-status'),click=prefix=>[...d.querySelectorAll('#gkbComparisonDialog button')].find(b=>b.textContent.startsWith(prefix)).click();
 assert.equal(status.textContent,'ГКБ: расхождение');status.click();assert.equal(d.querySelector('details').open,true);assert.equal(d.getElementById('gkbComparisonDialog').open,true);
 click('Краткий ·');assert.equal(sources[0].fileId,1);assert.equal(sources[0].page,2);status.click();click('Полный ·');assert.equal(sources[1].fileId,2);assert.equal(sources[1].page,7);
 status.click();click('К вопросу');assert.deepEqual(focused,['n8040_r1']);assert.equal(d.getElementById('n8040_r1').value,'77.25');
});
