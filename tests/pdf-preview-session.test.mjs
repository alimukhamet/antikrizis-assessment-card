import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

test('an expired PDF session can retry the cited page without leaving or changing the draft',async t=>{
 const dom=new JSDOM('<input id="draft" value="keep this answer"><div id="preview"></div>',{url:'https://assessment.example/questionnaire?dealId=11665',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,d=w.document;let signedIn=false;const requests=[];
 w.fetch=async url=>{requests.push(url);return{status:signedIn?200:401,ok:signedIn,headers:new Headers({'content-type':'application/pdf'}),arrayBuffer:async()=>new ArrayBuffer(8)};};
 w.HTMLCanvasElement.prototype.getContext=()=>({});w.GlobalWorkerOptions={};
 w.getDocument=()=>({destroy(){},promise:Promise.resolve({numPages:4,getPage:async()=>({getViewport:()=>({width:500,height:700}),render:()=>({promise:Promise.resolve(),cancel(){}})})})});
 const code=fs.readFileSync('public/pdf-preview.mjs','utf8').replace(/import \{getDocument,GlobalWorkerOptions\} from '[^']+';/,'').replace('export async function mount','async function mount');
 vm.runInContext(code+';window.mount=mount;',dom.getInternalVMContext());
 const preview=d.getElementById('preview'),url='/api/assessment/11665/documents/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?view=pdf';
 await w.mount(preview,{url,page:3});
 assert.match(preview.textContent,/Сессия завершилась/);const login=[...preview.querySelectorAll('a')].find(a=>a.textContent==='Войти');
 assert.equal(login.target,'_blank');assert.equal(new URL(login.href).pathname,'/login');assert.equal(new URL(login.href).searchParams.get('returnTo'),'/assessment-review?dealId=11665');
 signedIn=true;[...preview.querySelectorAll('button')].find(b=>b.textContent==='Повторить').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(preview.dataset.renderedPage,'3');assert.equal(preview.querySelector('canvas').getAttribute('aria-label'),'Страница 3 из 4');
 assert.equal(d.getElementById('draft').value,'keep this answer');assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
 await assert.rejects(()=>w.mount(preview,{url:'https://elsewhere.example/private.pdf'}),/Недоступный источник/);
});

test('a photographed original opens locally, zooms and closes without a PDF conversion',async t=>{
 const dom=new JSDOM('<div id="preview"></div>',{url:'https://assessment.example/',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,container=w.document.getElementById('preview');let closed=0,draws=0;
 w.fetch=async()=>({ok:true,status:200,headers:new Headers({'content-type':'image/jpeg'}),arrayBuffer:async()=>new ArrayBuffer(8)});
 w.createImageBitmap=async()=>({width:800,height:1200,close:()=>closed++});
 w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){draws++;}});
 w.GlobalWorkerOptions={};w.getDocument=()=>{throw Error('An image must not be sent to the PDF parser');};
 const code=fs.readFileSync('public/pdf-preview.mjs','utf8').replace(/import \{getDocument,GlobalWorkerOptions\} from '[^']+';/,'').replace('export async function mount','async function mount');
 vm.runInContext(code+';window.mount=mount;',dom.getInternalVMContext());
 const dispose=await w.mount(container,{url:'/api/assessment/900001/documents/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?view=pdf'});
 assert.equal(container.dataset.renderedPage,'1');assert.equal(container.querySelector('canvas').getAttribute('aria-label'),'Фотография документа');
 assert.equal(container.querySelector('a').textContent,'Скачать оригинал');assert.equal(container.querySelector('input').disabled,true);
 container.querySelectorAll('button')[3].click();assert.equal(draws,2);dispose();assert.equal(closed,1);
});
