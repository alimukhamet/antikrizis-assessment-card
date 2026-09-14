import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{JSDOM}from'jsdom';
test('conflict comparison displays original values and safe source links without approving them',()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://example.test'});dom.window.eval(fs.readFileSync(new URL('../public/document-review.js',import.meta.url),'utf8'));
 const container=dom.window.document.querySelector('main');let saved=false;
 dom.window.DocumentReview.render(container,{documents:{conflicts:[{creditor:'<img src=x onerror=alert(1)>',contractNumber:'C1',field:'monthlyPayment',sources:[{documentId:'one/two',issuedAt:'2026-09-10',value:'10.00',page:2},{documentId:'three',issuedAt:null,value:'12.00',page:null}]}]}},'11665',[],()=>{saved=true;});
 assert.match(container.textContent,/Ежемесячный платёж/);assert.match(container.textContent,/10.00/);assert.match(container.textContent,/12.00/);assert.match(container.textContent,/не снимает расхождение/);assert.equal(container.querySelector('img'),null);
 const links=container.querySelectorAll('a');assert.equal(links.length,2);assert.equal(links[0].getAttribute('href'),'/document-viewer.html?dealId=11665&documentId=one%2Ftwo&page=2');assert.equal(links[1].textContent,'Отчёт · дата не определена');assert.equal(container.querySelector('button'),null);assert.equal(saved,false);
});
test('a structurally checked statement does not ask for a redundant manual inspection',()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync('public/document-review.js','utf8'));const container=dom.window.document.querySelector('main');
 dom.window.DocumentReview.render(container,{documents:{structurallyChecked:['Выписка Kaspi Gold'],issues:[{documentId:'enpf',code:'DOCUMENT_RULES_PENDING'}],manuallyReviewed:[]}},'11665',[{documentId:'kaspi',type:'Выписка Kaspi Gold',person:'Клиент'},{documentId:'enpf',type:'Справка ЕНПФ',person:'Клиент'}],()=>{});
 assert.equal(container.querySelectorAll('[data-document-review]').length,1);assert.match(container.querySelector('summary').textContent,/Справка ЕНПФ/);dom.window.close();
});
