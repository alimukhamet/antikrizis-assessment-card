import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

test('an expired PDF session can retry the cited page without leaving or changing the draft',async t=>{
 const dom=new JSDOM('<input id="draft" value="keep this answer"><div id="preview"></div>',{url:'https://assessment.example/questionnaire?dealId=11665',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,d=w.document;let signedIn=false;const requests=[];
 w.fetch=async url=>{requests.push(url);return{status:signedIn?200:401,ok:signedIn,arrayBuffer:async()=>new ArrayBuffer(8)};};
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
