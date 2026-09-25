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

async function reviewFixture(t,{saveOk=true,loseFirstResponse=false,count=1,unconfirmedTotal=false}={}){
 const rows=Array.from({length:count},(_,i)=>`<div class="repeat-item" id="loan-${i}"><input id="n8038_r${i}" value="TEST BANK"><input id="loanContractId_r${i}" value="CONTRACT-${i}-123"><div class="field"><input id="n8040_r${i}" value="77.25"></div></div>`).join('');
 const dom=new JSDOM(`<div id="creditors"><div class="repeat-rows">${rows}</div></div><input id="unrelated" value="leave this answer">`,{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const credit=(i,missing)=>({contractNumber:missing?`CONTRACT-${i}-123`:`CONTRACT-${i}..`,page:missing?7+i:2,facts:[{key:'creditor',value:'TEST BANK',page:2},...(!missing?[{key:'debtOutstanding',value:'1250.25',page:2}]:[]),{key:'overdueDays',value:'0',page:missing?7+i:2}]});
 const report=(kind,missing)=>({kind,date:'2026-09-21',identity:{iin:'test'},server:{dealId:'900001',documentId:missing?'full-doc':'short-doc',extractionId:missing?'full-read':'short-read'},creditEvidence:{readable:true,creditList:{complete:missing,declared:count},findings:missing?['TOTAL_DEBT_REQUIRES_RECONCILIATION']:['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'],credits:Array.from({length:count},(_,i)=>credit(i,missing))}});
 const plan={planKey:'stable-plan',plan:{activeLoans:count,balances:Array.from({length:count},(_,i)=>({fullIndex:i,creditor:'TEST BANK',aliases:[`CONTRACT-${i}-123`],contractNumber:`CONTRACT-${i}-123`,amount:'1250.25',shortPage:2,fullPage:7+i,...(unconfirmedTotal?{reason:'FULL_TOTAL_UNCONFIRMED'}:{})}))},decisions:[],rowHeads:Array.from({length:count},(_,i)=>({fullIndex:i,reviewId:null})),review:null};
 const calls=[],order=[],savedAmounts=[],receipts=new Map();let lost=false;
 Object.assign(w,{compareGkb,creditorKey,selectedFiles:[{id:1,person:'Клиент'},{id:2,person:'Клиент'}],af:{results:new Map([[1,report('gkbShort',false)],[2,report('gkbFull',true)]]),rowKeys:new Map(Array.from({length:count},(_,i)=>[`creditors|test|TEST BANK|CONTRACT-${i}-123`,`loan-${i}`])),sources:new Map(),conflicts:[]},afSource(){},afFocus(){},afDispatchChange(e){e.dispatchEvent(new w.Event('change',{bubbles:true}));},afRefresh(){},ServerDrafts:{changed(){},async save(){order.push('draft');for(let i=0;i<count;i++)savedAmounts[i]=d.getElementById(`n8040_r${i}`).value;return saveOk;}},AssessmentCheck:{async documents(){order.push('check');}},HostedAssessment:{getContext:()=>({client:{iin:'test',external:{dealId:'900001'}},identityRevision:1,assessmentDay:'2026-09-21'}),async requestJson(path,options){const body=JSON.parse(options.body);calls.push(body);if(body.action==='inspect')return{inspection:structuredClone(plan)};order.push('review');if(!receipts.has(body.requestId)){
  const amount=body.decision==='correct'?body.amount:'1250.25';if(['confirm','correct'].includes(body.decision))assert.equal(savedAmounts[body.fullIndex],amount);
  const receipt={reviewId:'saved-'+receipts.size,reviewedAt:'2026-09-21T10:00:00Z'};receipts.set(body.requestId,receipt);plan.decisions=plan.decisions.filter(v=>v.fullIndex!==body.fullIndex);plan.decisions.push({...receipt,fullIndex:body.fullIndex,decision:body.action==='withdraw'?'unresolved':body.decision,amount,reason:body.reason||''});plan.rowHeads[body.fullIndex].reviewId=receipt.reviewId;plan.review=plan.decisions.filter(v=>['confirm','correct'].includes(v.decision)).length===count?receipt:null;
 }if(loseFirstResponse&&!lost){lost=true;throw Error('Ответ потерян. Повторите действие.');}return{ok:true,...receipts.get(body.requestId)};}}});
 w.eval(fs.readFileSync('public/gkb-comparison-ui.mjs','utf8').replace(/^import .+;\n/,''));w.GkbComparison.open();await new Promise(resolve=>setTimeout(resolve,0));
 const box=i=>d.querySelector(`[data-gkb-loan="${i}"]`);
 return{w,d,calls,order,plan,choose(label,i=0){[...box(i).querySelectorAll('button')].find(b=>b.textContent===label).click();},input(selector,value,i=0){const el=box(i).querySelector(selector);el.value=value;el.dispatchEvent(new w.Event('input'));},save(i=0){box(i).querySelector('[data-gkb-save]').click();},async settled(){await new Promise(resolve=>setTimeout(resolve,0));}};
}
test('per-loan confirmation saves first and reuses a lost request without changing another answer',async t=>{
 const s=await reviewFixture(t,{loseFirstResponse:true});assert.match(s.d.body.textContent,/CONTRACT-0-123/);assert.match(s.d.body.textContent,/Страница 2/);assert.equal(s.d.querySelector('[data-gkb-save]').textContent,'Подтвердить сумму');
 s.save();await s.settled();assert.match(s.d.body.textContent,/Ответ потерян/);assert.equal(s.d.getElementById('n8040_r0').value,'1250.25');assert.equal(s.d.getElementById('unrelated').value,'leave this answer');
 s.save();await s.settled();assert.match(s.d.body.textContent,/Все суммы подтверждены/);assert.equal(s.w.GkbComparison.resolved(1),true);
 const mutations=s.calls.filter(c=>c.action==='confirm');assert.equal(mutations.length,2);assert.equal(mutations[0].requestId,mutations[1].requestId);assert.deepEqual(s.order,['draft','review','draft','review','check']);
 s.d.getElementById('gkbComparisonDialog').close();s.w.GkbComparison.open();assert.match(s.d.body.textContent,/Сохранено 1 из 1/);
 s.d.getElementById('n8040_r0').value='1250.26';assert.equal(s.w.GkbComparison.resolved(1),false);
});
test('an unknown full total explains the source choice and waits for an explicit per-loan confirmation',async t=>{
 const s=await reviewFixture(t,{unconfirmedTotal:true});assert.match(s.d.body.textContent,/Полный · итог не подтверждён/);assert.doesNotMatch(s.d.body.textContent,/в полном ГКБ суммы не указаны/);assert.equal(s.d.getElementById('n8040_r0').value,'77.25');assert.equal(s.calls.some(c=>c.action==='confirm'),false);assert.equal(s.w.GkbComparison.resolved(1),false);
 s.save();await s.settled();assert.equal(s.w.GkbComparison.resolved(1),true);assert.equal(s.d.getElementById('n8040_r0').value,'1250.25');assert.equal(s.d.getElementById('unrelated').value,'leave this answer');assert.equal(s.calls.find(c=>c.action==='confirm').fullIndex,0);assert.equal(s.w.af.results.get(2).creditEvidence.credits[0].facts.some(f=>f.key==='debtOutstanding'),false);
});
test('inline correction accepts localized amounts, requires a reason, and preserves the extracted source',async t=>{
 const s=await reviewFixture(t);s.choose('Изменить');s.input('[data-gkb-amount]','1 100,50');assert.equal(s.d.querySelector('[data-gkb-save]').disabled,true);s.input('[data-gkb-reason]','Сумма в оригинале на странице 2');
 // Looking at the source and reopening must not discard typed corrections.
 [...s.d.querySelectorAll('button')].find(b=>b.textContent.startsWith('Краткий ·')).click();s.w.GkbComparison.open();assert.equal(s.d.querySelector('[data-gkb-amount]').value,'1 100,50');
 s.save();await s.settled();assert.equal(s.d.getElementById('n8040_r0').value,'1100.50');assert.match(s.d.body.textContent,/исправлено/);assert.equal(s.w.GkbComparison.resolved(1),true);assert.equal(s.w.af.results.get(1).creditEvidence.credits[0].facts.find(f=>f.key==='debtOutstanding').value,'1250.25');
});
test('one saved row does not confirm another, and rejecting a match preserves all loans and balances',async t=>{
 const s=await reviewFixture(t,{count:2});s.save(0);await s.settled();assert.match(s.d.body.textContent,/Сохранено 1 из 2/);assert.equal(s.w.GkbComparison.resolved(1),false);assert.equal(s.d.getElementById('n8040_r1').value,'77.25');
 s.choose('Отметить несовпадение',1);await s.settled();assert.equal(s.d.getElementById('n8040_r1').value,'77.25');assert.match(s.d.body.textContent,/Уточните кредитора/);assert.match(s.d.body.textContent,/Сохранено 1 из 2/);assert.equal(s.d.querySelectorAll('#creditors .repeat-item').length,2);assert.equal(s.w.GkbComparison.resolved(1),false);
});
test('failed draft persistence cannot create a source confirmation',async t=>{
 const s=await reviewFixture(t,{saveOk:false});s.save();await s.settled();assert.match(s.d.body.textContent,/Не удалось сохранить анкету/);assert.equal(s.calls.some(c=>c.action==='confirm'),false);assert.equal(s.w.GkbComparison.resolved(1),false);
});
test('a stale row key cannot overwrite a different loan',async t=>{
 const s=await reviewFixture(t);s.d.getElementById('loanContractId_r0').value='ANOTHER-CONTRACT';s.save();await s.settled();assert.equal(s.d.getElementById('n8040_r0').value,'77.25');assert.equal(s.calls.some(c=>c.action==='confirm'),false);assert.equal(s.order.length,0);
});

test('source viewing keeps the exact reconciliation editor open with its unsaved amount and reason',async t=>{
 const s=await reviewFixture(t);s.choose('Изменить');s.input('[data-gkb-amount]','1 100,50');s.input('[data-gkb-reason]','Page 2 of the original report');
 const comparison=s.d.getElementById('gkbComparisonDialog'),amount=s.d.querySelector('[data-gkb-amount]'),reason=s.d.querySelector('[data-gkb-reason]');comparison.scrollTop=180;
 const source=s.d.createElement('dialog');s.d.body.append(source);let opened;
 s.w.afSource=src=>{opened=src;source.showModal();};
 [...comparison.querySelectorAll('button')].find(b=>b.textContent.startsWith('Краткий ·')).click();
 assert.equal(comparison.open,true);assert.equal(source.open,true);assert.equal(opened.returnLabel,'← К сверке');assert.equal(opened.page,2);
 source.close();assert.equal(comparison.open,true);assert.equal(comparison.scrollTop,180);assert.equal(s.d.querySelector('[data-gkb-amount]'),amount);assert.equal(s.d.querySelector('[data-gkb-reason]'),reason);assert.equal(amount.value,'1 100,50');assert.equal(reason.value,'Page 2 of the original report');assert.equal(s.calls.some(c=>c.action==='confirm'),false);assert.equal(s.d.getElementById('n8040_r0').value,'77.25');
});
