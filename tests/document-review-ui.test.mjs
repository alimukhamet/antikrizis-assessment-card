import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
function setup(t,approved=false,type='Удостоверение личности'){
 const dom=new JSDOM('<main id="review"></main>',{runScripts:'outside-only',url:'https://test.example/'}),w=dom.window,d=w.document;t.after(()=>w.close());
 w.HTMLElement.prototype.scrollIntoView=function(){};
 const source={server:{documentId:'pdf'},pages:2,reviewContext:{iin:'test-client',pages:2,issuedAt:'2020-01-01'}};
 w.selectedFiles=[{id:1,type,person:'Клиент',storedDocumentId:'pdf'}];w.af={results:new Map([[1,source]])};w.afRenderResults=()=>{};w.refreshRequiredDocuments=()=>{};w.HostedAssessment={getContext:()=>({client:{iin:'test-client'}})};
 const posts=[];w.fetch=async(url,options)=>{posts.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};};
 const drafts=new Map();w.ServerDrafts={getDocumentReviewDraft:(id,type)=>drafts.get(JSON.stringify([id,type]))||{},setDocumentReviewDraft:(id,type,values)=>{drafts.set(JSON.stringify([id,type]),values);return true;}};
 w.eval(fs.readFileSync('public/document-review.js','utf8'));
 const result={identityRevision:2,documents:{manuallyReviewed:approved?[{reviewId:'approved',documentId:'pdf',type,reviewedAt:'2026-09-10T10:00:00Z'}]:[],issues:[{documentId:'pdf'}]}};let saved=0;
 const render=()=>{d.getElementById('review').replaceChildren();w.DocumentReview.render(d.getElementById('review'),result,'test-deal',[{documentId:'pdf',type,person:'Клиент'}],async()=>{saved++;});};render();
 return {w,d,posts,source,result,render,drafts,saved:()=>saved};
}
test('ID dates remain after checking documents again; typed dates never confirm inspection',async t=>{
 const s=setup(t),issued=s.d.querySelector('[data-review-field=issuedAt]'),expiry=s.d.querySelector('[data-review-field=expiresAt]');
 issued.value='2021-02-03';issued.dispatchEvent(new s.w.Event('input',{bubbles:true}));
 expiry.value='2031-02-03';expiry.dispatchEvent(new s.w.Event('change',{bubbles:true}));
 s.d.querySelector('[type=checkbox]').checked=true;s.render();
 assert.equal(s.d.querySelector('[data-review-field=issuedAt]').value,'2021-02-03');assert.equal(s.d.querySelector('[data-review-field=expiresAt]').value,'2031-02-03');
 assert.equal(s.d.querySelector('[type=checkbox]').checked,false);assert.equal(s.posts.length,0);assert.equal('confirmed'in s.drafts.values().next().value,false);
});
test('all-history ENPF never asks staff to invent a start date',t=>{
 const s=setup(t);s.w.selectedFiles[0].type='Справка ЕНПФ';s.source.reviewContext={iin:'test-client',pages:2,issuedAt:'2026-09-10',to:'2026-09-10',allHistory:true};s.d.getElementById('review').replaceChildren();
 s.w.DocumentReview.render(s.d.getElementById('review'),{identityRevision:2,documents:{issues:[{documentId:'pdf'}]}},'test-deal',[{documentId:'pdf',type:'Справка ЕНПФ',person:'Клиент'}],()=>{});
 assert.match(s.d.body.textContent,/весь период до 2026-09-10/);assert.equal(s.d.querySelector('[data-review-field=from]'),null);assert.equal(s.d.querySelector('[data-review-field=to]'),null);
});
test('document review prefills known evidence and needs one deliberate inspection confirmation',async t=>{
 const s=setup(t),inputs=[...s.d.querySelectorAll('.document-review-fields input')],button=[...s.d.querySelectorAll('button')].find(b=>b.textContent==='Документ проверен');
 assert.equal(inputs[0].value,'test-client');assert.equal(inputs.filter(i=>i.type==='checkbox').length,1);assert.equal(inputs.find(i=>i.type==='date').value,'2020-01-01');assert.equal(inputs.some(i=>i.type==='number'),false);
 await button.onclick();assert.equal(s.posts.length,0);assert.match(s.d.querySelector('[role=status]').textContent,/Подтвердите/);
 inputs.filter(i=>i.type==='date')[1].value='2030-01-01';inputs.find(i=>i.type==='checkbox').checked=true;await button.onclick();
 assert.equal(s.posts.length,1);assert.equal(s.posts[0].body.identityRevision,2);assert.equal(s.posts[0].body.review.pages,2);assert.equal(s.posts[0].body.review.iin,'test-client');assert.equal(s.posts[0].body.review.complete,true);assert.equal(s.saved(),1);
});
test('an approved document reopens as approved and withdrawal remains explicit',async t=>{
 const s=setup(t,true);assert.equal(s.source.documentReview.reviewId,'approved');assert.match(s.d.querySelector('summary').textContent,/проверено сотрудником/);assert.equal(s.d.querySelectorAll('.document-review-fields').length,0);
 const button=s.d.querySelector('button');await button.onclick();assert.equal(s.posts.length,0);
 s.d.querySelector('input').value='SYNTHETIC: selected the wrong document';await button.onclick();assert.equal(s.posts[0].body.action,'withdraw');assert.equal(s.posts[0].body.reviewId,'approved');assert.equal(s.saved(),1);
});
test('saved inspection context supplies real pages with an empty browser analysis cache and retains typed power details',async t=>{
 const s=setup(t,false,'Доверенность');
 for(const [key,value]of Object.entries({issuedAt:'2026-09-30',expiresAt:'2027-09-29',legalName:'SYNTHETIC REPRESENTATIVE',identifier:'000000000002'})){
  const field=s.d.querySelector('[data-review-field='+key+']');field.value=value;field.dispatchEvent(new s.w.Event('input',{bubbles:true}));
 }
 s.w.af.results.clear();
 s.result.documents.inspections=[{documentId:'pdf',type:'Доверенность',context:{iin:'test-client',pages:3,issuedAt:'2026-09-30',expiresAt:'2029-09-30'},review:null}];
 s.render();assert.match(s.d.body.textContent,/3 стр\./);assert.doesNotMatch(s.d.body.textContent,/0 стр\./);
 assert.equal(s.d.querySelector('[data-review-field=expiresAt]').value,'2027-09-29');assert.equal(s.d.querySelector('[data-review-field=legalName]').value,'SYNTHETIC REPRESENTATIVE');
 assert.equal(s.d.querySelector('[type=checkbox]').checked,false);s.d.querySelector('[type=checkbox]').checked=true;
 await [...s.d.querySelectorAll('button')].find(b=>b.textContent==='Документ проверен').onclick();
 assert.equal(s.posts.length,1);assert.equal(s.posts[0].body.review.pages,3);assert.equal(s.posts[0].body.review.expiresAt,'2027-09-29');assert.equal(s.posts[0].body.review.representative.identifier,'000000000002');
});
test('missing current metadata blocks approval even if an old browser analysis has pages',async t=>{
 const s=setup(t);s.result.documents.inspections=[{documentId:'pdf',type:'Удостоверение личности',context:null,review:null}];s.render();
 const button=[...s.d.querySelectorAll('button')].find(b=>b.textContent==='Документ проверен');assert.equal(button.disabled,true);assert.doesNotMatch(s.d.body.textContent,/0 стр\./);
 s.d.querySelector('[type=checkbox]').checked=true;await button.onclick();assert.equal(s.posts.length,0);
 await [...s.d.querySelectorAll('button')].find(b=>b.textContent==='Обновить данные документа').onclick();assert.equal(s.saved(),1);
});
test('power review stays approved independently of the contract package and clears after withdrawal',t=>{
 const s=setup(t,false,'Доверенность'),review={documentId:'pdf',type:'Доверенность',reviewId:'power-review',reviewedAt:'2026-09-30'};
 s.result.documents.inspections=[{documentId:'pdf',type:'Доверенность',context:{pages:3,issuedAt:'2026-09-30',expiresAt:'2029-09-30'},review}];
 s.render();assert.equal(s.result.documents.manuallyReviewed.length,0);assert.equal(s.source.documentReview.reviewId,'power-review');assert.match(s.d.querySelector('summary').textContent,/проверено сотрудником/);assert.equal(s.d.querySelectorAll('.document-review-fields').length,0);
 s.result.documents.inspections[0].review=null;s.render();assert.equal(s.source.documentReview,null);assert.match(s.d.querySelector('summary').textContent,/сверить/);
});
test('copying the source representative is explicit, saves the draft and does not confirm inspection',async t=>{
 const s=setup(t,false,'Доверенность');s.drafts.set(JSON.stringify(['pdf','Доверенность']),{legalName:'Typed short name',identifier:'typed'});
 s.result.documents.inspections=[{documentId:'pdf',type:'Доверенность',context:{pages:3,representative:{kind:'person',legalName:'SYNTHETIC FULL REPRESENTATIVE NAME',identifier:'000000000002'}},review:null}];s.render();
 assert.equal(s.d.querySelector('[data-review-field=legalName]').value,'Typed short name');
 await [...s.d.querySelectorAll('button')].find(b=>b.textContent==='Взять реквизиты поверенного из документа').onclick();
 assert.equal(s.d.querySelector('[data-review-field=legalName]').value,'SYNTHETIC FULL REPRESENTATIVE NAME');assert.equal(s.d.querySelector('[data-review-field=identifier]').value,'000000000002');assert.equal(s.d.querySelector('[type=checkbox]').checked,false);assert.equal(s.posts.length,0);
 assert.equal(s.drafts.values().next().value.legalName,'SYNTHETIC FULL REPRESENTATIVE NAME');
});
