import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM}from'jsdom';
test('debt amounts remain editable without a separate client-confirmation action',()=>{
 const dom=new JSDOM('<div id="questionnaireStep"><input id="n8040" type="number" value="1200"></div>',{runScripts:'outside-only'});
 try{dom.window.eval(fs.readFileSync(new URL('../public/client-confirmed-amount.js',import.meta.url),'utf8'));
 const input=dom.window.document.querySelector('input');input.value='1300';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(input.value,'1300');assert.equal(input.dataset.clientConfirmedValue,undefined);assert.equal(dom.window.document.querySelectorAll('button').length,0);
 }finally{dom.window.close();}
});
