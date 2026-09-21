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

async function reviewFixture(t,{saveOk=true,loseFirstResponse=false,savedReview=null}={}){
 const dom=new JSDOM('<div id="creditors"><div class="repeat-rows"><div class="repeat-item" id="loan-1"><input id="n8038_r1" value="TEST BANK"><input id="loanContractId_r1" value="CONTRACT-A-123"><div class="field"><input id="n8040_r1" value="77.25"></div></div></div></div><input id="unrelated" value="leave this answer">',{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const credit=(missing)=>({contractNumber:missing?'CONTRACT-A-123':'CONTRACT-A..',page:missing?7:2,facts:[{key:'creditor',value:'TEST BANK',page:2},...(!missing?[{key:'debtOutstanding',value:'1250.25',page:2}]:[]),{key:'overdueDays',value:'0',page:missing?7:2}]});
 const report=(kind,missing)=>({kind,date:'2026-09-21',identity:{iin:'test'},server:{dealId:'900001',documentId:missing?'full-doc':'short-doc',extractionId:missing?'full-read':'short-read'},creditEvidence:{readable:true,creditList:{complete:missing,declared:1},findings:missing?['TOTAL_DEBT_REQUIRES_RECONCILIATION']:['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'],credits:[credit(missing)]}});
 const plan={planKey:'stable-plan',plan:{activeLoans:1,balances:[{creditor:'TEST BANK',aliases:['CONTRACT-A-123'],contractNumber:'CONTRACT-A-123',amount:'1250.25',shortPage:2,fullPage:7}]},review:savedReview};
 const calls=[],order=[];let savedAmount=null,lost=false;
 Object.assign(w,{compareGkb,creditorKey,selectedFiles:[{id:1,person:'Клиент'},{id:2,person:'Клиент'}],af:{results:new Map([[1,report('gkbShort',false)],[2,report('gkbFull',true)]]),rowKeys:new Map([['creditors|test|TEST BANK|CONTRACT-A-123','loan-1']]),sources:new Map(),conflicts:[]},afSource(){},afFocus(){},afDispatchChange(e){e.dispatchEvent(new w.Event('change',{bubbles:true}));},afRefresh(){},ServerDrafts:{changed(){},async save(){order.push('draft');savedAmount=d.getElementById('n8040_r1').value;return saveOk;}},AssessmentCheck:{async documents(){order.push('check');}},HostedAssessment:{getContext:()=>({client:{iin:'test',external:{dealId:'900001'}},identityRevision:1,assessmentDay:'2026-09-21'}),async requestJson(path,options){const body=JSON.parse(options.body);calls.push(body);if(body.action==='inspect')return{inspection:structuredClone(plan)};order.push('review');assert.equal(savedAmount,'1250.25');plan.review={reviewId:'saved-review',reviewedAt:'2026-09-21T10:00:00Z'};if(loseFirstResponse&&!lost){lost=true;throw Error('Ответ потерян. Повторите действие.');}return{ok:true};}}});
 w.eval(fs.readFileSync('public/gkb-comparison-ui.mjs','utf8').replace(/^import .+;\n/,''));w.GkbComparison.open();await new Promise(resolve=>setTimeout(resolve,0));
 return{w,d,calls,order,plan,agree(){const a=d.querySelector('[data-gkb-agree]');a.checked=true;a.dispatchEvent(new w.Event('change'));},save(){[...d.querySelectorAll('button')].find(b=>b.textContent==='Внести и подтвердить суммы из краткого ГКБ').click();},async settled(){await new Promise(resolve=>setTimeout(resolve,0));}};
}
test('manager sees the missing source amount and explicitly saves it before durable confirmation; a lost response reuses the request',async t=>{
 const s=await reviewFixture(t,{loseFirstResponse:true});assert.match(s.d.body.textContent,/В полном ГКБ остаток не указан/);assert.match(s.d.body.textContent,/Страница 2/);assert.equal(s.d.querySelector('.btn-main').disabled,true);
 s.agree();s.save();await s.settled();assert.match(s.d.body.textContent,/Ответ потерян/);assert.equal(s.d.getElementById('n8040_r1').value,'1250.25');assert.equal(s.d.getElementById('unrelated').value,'leave this answer');
 s.agree();s.save();await s.settled();assert.match(s.d.body.textContent,/Сверка сохранена/);assert.equal(s.w.GkbComparison.resolved(1),true);
 const mutations=s.calls.filter(c=>c.action==='confirm');assert.equal(mutations.length,2);assert.equal(mutations[0].requestId,mutations[1].requestId);assert.deepEqual(s.order,['draft','review','draft','review','check']);
 s.d.getElementById('gkbComparisonDialog').close();s.w.GkbComparison.open();assert.match(s.d.body.textContent,/Сверка сохранена/);
 s.d.getElementById('n8040_r1').value='1250.26';assert.equal(s.w.GkbComparison.resolved(1),false,'Changing the amount invalidates the local readiness badge');
});
test('failed draft persistence cannot create a source confirmation',async t=>{
 const s=await reviewFixture(t,{saveOk:false});s.agree();s.save();await s.settled();assert.match(s.d.body.textContent,/Не удалось сохранить суммы/);assert.equal(s.calls.some(c=>c.action==='confirm'),false);assert.equal(s.w.GkbComparison.resolved(1),false);
});

test('a stale row key cannot cause the confirmation to overwrite a different loan',async t=>{
 const s=await reviewFixture(t);s.d.getElementById('loanContractId_r1').value='ANOTHER-CONTRACT';s.agree();s.save();await s.settled();assert.equal(s.d.getElementById('n8040_r1').value,'77.25');assert.equal(s.calls.some(c=>c.action==='confirm'),false);assert.equal(s.order.length,0);
});
