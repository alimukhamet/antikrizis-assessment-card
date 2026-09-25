import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{JSDOM}from'jsdom';
const script=fs.readFileSync(new URL('../public/server-answer-check.js',import.meta.url),'utf8');
function setup(send){const dom=new JSDOM('<section id="documentStep"></section><div id="questionnaireStep"><button id="checkQuestions">Check</button><div id="checkStatus"></div><input id="fio"></div>',{runScripts:'outside-only',url:'https://assessment.example'});const w=dom.window;let payload={answers:[],documents:[]};w.eval(fs.readFileSync(new URL("../public/hosted-assessment.js",import.meta.url),"utf8"));w.HostedAssessment={...w.HostedAssessment,ready:()=>true,getContext:()=>({client:{external:{dealId:'11665'}}})};w.ServerDrafts={capture:()=>payload,reviewBindings:()=>[]};w.afConfirmPending=async()=>true;w.fetch=send;w.eval(fs.readFileSync(new URL('../public/document-review.js',import.meta.url),'utf8'));w.eval(fs.readFileSync(new URL('../public/document-upload.js',import.meta.url),'utf8'));w.eval(fs.readFileSync(new URL('../public/submission-flow.js',import.meta.url),'utf8'));w.eval(script);return{w,button:w.document.getElementById('checkQuestions'),preview:[...w.document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Предпросмотр карточки для юриста'),edit:()=>{payload={answers:[{value:'changed'}]};w.document.getElementById('fio').dispatchEvent(new w.Event('input',{bubbles:true}));}};}
test('lawyer preview is plain text and disappears when an answer changes',async()=>{const s=setup(async()=>({ok:true,json:async()=>({answersComplete:true,preview:{lawyerCard:'TEST <img src=x onerror=alert(1)>'}})}));await s.button.onclick();assert.equal(s.preview.hidden,false);assert.equal(s.preview.querySelector('pre').textContent,'TEST <img src=x onerror=alert(1)>');assert.equal(s.preview.querySelector('img'),null);s.edit();assert.equal(s.preview.hidden,true);});
test('response for an older answer snapshot cannot display a card',async()=>{let resolve;const response=new Promise(r=>{resolve=r});const s=setup(()=>response);const checking=s.button.onclick();s.edit();resolve({ok:true,json:async()=>({answersComplete:true,preview:{lawyerCard:'STALE'}})});await checking;assert.equal(s.preview.hidden,true);assert.match(s.w.document.getElementById('checkStatus').textContent,/изменились/);});

test('review contract uses the full name, contract number and deal filename',async()=>{
 const contractData={client_name:'  Тестова   Әсел Қанатқызы  ',contract_number:' 22/А:*?"<>| '};
 const s=setup(async()=>({ok:true,json:async()=>({answersComplete:true,preview:{contractData}})}));let filename,rendered;
 s.w.ContractRenderer={render:async data=>{rendered=data;return new s.w.Blob(['SYNTHETIC']);}};
 s.w.URL.createObjectURL=()=> 'blob:test';s.w.URL.revokeObjectURL=()=>{};
 s.w.HTMLAnchorElement.prototype.click=function(){filename=this.download;};
 await s.button.onclick();assert.equal(s.preview.querySelector('button').textContent,'Скачать договор для проверки');await s.preview.querySelector('button').onclick();
 assert.equal(rendered,contractData);
 assert.equal(filename,'Тестова Әсел Қанатқызы - Договор 22А - ID 11665.docx');s.w.close();
});

test('review contract cannot receive another client deal ID while rendering',async()=>{
 for(const change of [s=>s.edit(),s=>{s.w.HostedAssessment.getContext=()=>({client:{external:{dealId:'other'}}});}]){
  const s=setup(async()=>({ok:true,json:async()=>({answersComplete:true,preview:{contractData:{client_name:'SYNTHETIC',contract_number:'22'}}})}));let finish,downloads=0;
  s.w.ContractRenderer={render:()=>new Promise(resolve=>{finish=resolve;})};
  s.w.HTMLAnchorElement.prototype.click=()=>{downloads++;};
  await s.button.onclick();const rendering=s.preview.querySelector('button').onclick();change(s);finish(new s.w.Blob(['SYNTHETIC']));await rendering;
  assert.equal(downloads,0);assert.match(s.w.document.getElementById('checkStatus').textContent,/изменились/);s.w.close();
 }
});

test('editing document review keeps the inspection form visible and saves scoped evidence',async()=>{
 const calls=[];const s=setup(async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return{ok:true,json:async()=>path.endsWith('/document-reviews')?{ok:true,reviewId:'review'}:{answersComplete:true,identityRevision:7,documents:{issues:[],manuallyReviewed:[]},preview:{lawyerCard:'TEST'}}};});
 s.w.selectedFiles=[{id:1,storedDocumentId:'doc'}];s.w.af={results:new Map([[1,{server:{documentId:'doc'},reviewContext:{pages:2,issuedAt:'2026-09-10',from:'2025-09-10',to:'2026-09-10'}}]])};s.w.ServerDrafts.capture=()=>({answers:[],documents:[{documentId:'doc',type:'Справка ЕНПФ',person:'Клиент'}]});await s.button.onclick();
 const form=s.w.document.querySelector('[data-document-review]');assert.ok(form);const fields=form.querySelectorAll('input');fields[0].value='TEST-IIN';fields[0].dispatchEvent(new s.w.Event('input',{bubbles:true}));assert.equal(form.isConnected,true);assert.equal(form.querySelector('input[type=number]'),null);form.querySelectorAll('input[type=checkbox]').forEach(f=>f.checked=true);fields[fields.length-1].value='SYNTHETIC inspection';
 await form.querySelector('button').onclick();const saved=calls.find(c=>c.path.endsWith('/document-reviews'));assert.equal(saved.body.documentId,'doc');assert.equal(saved.body.identityRevision,7);assert.equal(saved.body.review.iin,'TEST-IIN');assert.equal(saved.body.review.pages,2);assert.ok(saved.body.requestId);
});
test('withdrawal UI targets the displayed approval and reuses request ID after a lost response',async()=>{
 const calls=[];let fail=true;const s=setup(async(path,options)=>{const body=JSON.parse(options.body);if(body.action==='withdraw'){calls.push(body);if(fail){fail=false;throw Error('Synthetic lost response');}return{ok:true,json:async()=>({ok:true,reviewId:'withdrawn'})};}return{ok:true,json:async()=>({answersComplete:true,identityRevision:7,documents:{issues:[],manuallyReviewed:[{documentId:'doc',type:'Справка ЕНПФ',reviewId:'approved'}]},preview:{lawyerCard:'TEST'}})};});
 s.w.selectedFiles=[{id:1,storedDocumentId:'doc'}];s.w.af={results:new Map([[1,{server:{documentId:'doc'},reviewContext:{pages:2,issuedAt:'2026-09-10',from:'2025-09-10',to:'2026-09-10'}}]])};s.w.ServerDrafts.capture=()=>({answers:[],documents:[{documentId:'doc',type:'Справка ЕНПФ',person:'Клиент'}]});await s.button.onclick();const form=s.w.document.querySelector('[data-document-review]');const reason=form.querySelector('input[aria-label="Причина отмены проверки"]');reason.value='SYNTHETIC mistaken approval';const button=[...form.querySelectorAll('button')].find(b=>b.textContent==='Отменить проверку');await button.onclick();assert.equal(button.disabled,false);await button.onclick();assert.equal(calls.length,2);assert.equal(calls[0].reviewId,'approved');assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(calls[0].identityRevision,7);
});
test('document checks stay before the questionnaire and do not jump to unanswered fields',async()=>{
 const s=setup(async()=>({ok:true,json:async()=>({identityRevision:1,answersComplete:false,issues:[{key:'fio',label:'ФИО'}],documents:{issues:[{code:'EDS_SEPARATE_UPLOAD_REQUIRED',message:'ЭЦП отдельно'}],manuallyReviewed:[]}})}));
 const d=s.w.document,section=d.getElementById('documentReviewStep');assert.equal(d.getElementById('documentStep').nextElementSibling,section);assert.equal(section.nextElementSibling.id,'questionnaireStep');
 await d.getElementById('checkDocuments').onclick();assert.notEqual(d.activeElement.id,'fio');assert.equal(s.preview.hidden,true);assert.equal(d.getElementById('documentCheckStatus').textContent,'Проверка обновлена · замечаний: 1.');assert.equal(d.querySelector('#documentReviewResults > details').open,false);assert.match(d.querySelector('#documentReviewResults li').textContent,/ЭЦП отдельно/);
 assert.ok([...section.querySelectorAll('button')].some(b=>b.textContent==='Загрузить проверенные документы в Bitrix'));assert.equal(d.getElementById('checkStatus').textContent,'');
});

test('client search leaves the current review and lawyer preview intact',async()=>{
 const s=setup(async()=>({ok:true,json:async()=>({answersComplete:true,preview:{lawyerCard:'SYNTHETIC PREVIEW'},documents:{issues:[],manuallyReviewed:[]}})}));
 await s.button.onclick();assert.equal(s.preview.hidden,false);
 const search=s.w.document.createElement('input');search.type='search';s.w.document.body.append(search);search.value='11749';search.dispatchEvent(new s.w.Event('input',{bubbles:true}));
 assert.equal(s.preview.hidden,false);assert.equal(s.preview.querySelector('pre').textContent,'SYNTHETIC PREVIEW');
 s.edit();assert.equal(s.preview.hidden,true);s.w.close();
});

test('every missing answer has a link to the exact repeated loan row',async()=>{
 const issues=Array.from({length:6},(_,row)=>({group:'creditors',row,key:'n8041',label:'Ежемесячный платёж'}));
 const s=setup(async()=>({ok:true,json:async()=>({answersComplete:false,issues})})),d=s.w.document;
 const group=d.createElement('section');group.id='creditors';group.innerHTML='<h3>Кредиты</h3><div class="repeat-rows">'+issues.map((_,i)=>'<div><input id="n8041_r'+i+'"></div>').join('')+'</div>';d.getElementById('questionnaireStep').append(group);
 await s.button.onclick();const links=d.querySelectorAll('#answerCheckIssues button');assert.equal(links.length,6);assert.match(links[5].textContent,/6 — Ежемесячный платёж/);links[5].click();assert.equal(d.activeElement.id,'n8041_r5');assert.equal(d.activeElement.value,'');
 s.edit();assert.equal(d.getElementById('answerCheckIssues').hidden,true);s.w.close();
});

test('missing checkbox-group answers link to their visible choices',async()=>{
 const s=setup(async()=>({ok:true,json:async()=>({answersComplete:false,issues:[{key:'choice:socialStatus:',label:'Социальный статус'},{key:'holding:client:',label:'Имущество'}]})})),d=s.w.document;
 d.getElementById('questionnaireStep').insertAdjacentHTML('beforeend','<input type="checkbox" name="socialStatus" id="social-choice"><input type="checkbox" data-holding="none" data-owner="client" id="property-choice">');
 await s.button.onclick();assert.equal(d.activeElement.id,'social-choice');d.querySelectorAll('#answerCheckIssues button')[1].click();assert.equal(d.activeElement.id,'property-choice');assert.equal(d.activeElement.checked,false);s.w.close();
});
