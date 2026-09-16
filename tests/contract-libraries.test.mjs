import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=fs.readFileSync(process.env.CONTRACT_LIBRARIES_SOURCE || new URL('../lib/browser/contract-libraries.js',import.meta.url),'utf8');
function setup(behaviour) {
 const scripts=[],timers=new Set();
 const w={};
 const ctx={window:w,Uint8Array,atob,document:{
  createElement(){return {remove(){this.removed=true;}};},
  head:{appendChild(script){scripts.push(script);queueMicrotask(()=>behaviour(script,w,scripts));}}
 },setTimeout(fn){const id=setTimeout(()=>{timers.delete(id);fn();},5);timers.add(id);return id;},clearTimeout(id){timers.delete(id);clearTimeout(id);}};
 vm.runInNewContext(source+'\nglobalThis.api={ensureLibs,LIB_URLS};',ctx);
 return {...ctx.api,w,scripts,timers,close(){for(const id of timers)clearTimeout(id);}};
}
function succeed(script,w){if(script.src.includes('pizzip'))w.PizZip=function(){};else w.docxtemplater=function(){};script.onload?.();}
async function outcome(promise){let timer;try{return await Promise.race([promise.then(()=> 'ready',()=> 'failed'),new Promise(r=>{timer=setTimeout(()=>r('hung'),80);})]);}finally{clearTimeout(timer);}}

test('a stalled first mirror times out and the next mirror loads both modules',async t=>{
 const s=setup((script,w,scripts)=>{if(scripts.length>1)succeed(script,w);});t.after(()=>s.close());
 assert.equal(await outcome(s.ensureLibs()),'ready');assert.equal(s.scripts.length,3);assert.equal(s.scripts[0].removed,true);assert.equal(s.timers.size,0);
});
test('a failed dependency load can be retried without reloading or clearing answers',async t=>{
 let online=false;const s=setup((script,w)=>online?succeed(script,w):script.onerror?.());t.after(()=>s.close());
 assert.equal(await outcome(s.ensureLibs()),'failed');const before=s.scripts.length;online=true;
 assert.equal(await outcome(s.ensureLibs()),'ready');assert.ok(s.scripts.length>before);
});
test('concurrent requests share one dependency load',async t=>{
 const s=setup(succeed);t.after(()=>s.close());const a=s.ensureLibs(),b=s.ensureLibs();assert.equal(a,b);await a;
 assert.equal(s.scripts.length,2);await s.ensureLibs();assert.equal(s.scripts.length,2);assert.equal(s.timers.size,0);
});
test('all stalled mirrors return a visible failure instead of hanging forever',async t=>{
 const s=setup(()=>{});t.after(()=>s.close());assert.equal(await outcome(s.ensureLibs()),'failed');assert.equal(s.scripts.length,4);assert.ok(s.scripts.every(script=>script.removed));
});
test('libraries are exact pinned production builds, not eval-based development bundles',()=>{
 const s=setup(succeed);for(const urls of Object.values(s.LIB_URLS))for(const url of urls){assert.match(url,/\.min\.js$/);assert.match(url,/3\.1\.7|3\.50\.0/);}s.close();
});
test('invalid preexisting globals do not count as a ready renderer',async t=>{
 const s=setup(succeed);t.after(()=>s.close());s.w.PizZip={};s.w.docxtemplater={};await s.ensureLibs();assert.equal(s.scripts.length,2);assert.equal(typeof s.w.PizZip,'function');
});
test('a docxtemplater failure retries it without reloading a working zip library',async t=>{
 let online=false;const s=setup((script,w)=>script.src.includes('pizzip')||online?succeed(script,w):script.onerror?.());t.after(()=>s.close());
 assert.equal(await outcome(s.ensureLibs()),'failed');online=true;assert.equal(await outcome(s.ensureLibs()),'ready');assert.equal(s.scripts.filter(script=>script.src.includes('pizzip')).length,1);
});
test('failed scripts are detached and their handlers are cleaned up',async t=>{
 const s=setup(script=>script.onerror?.());t.after(()=>s.close());await outcome(s.ensureLibs());
 assert.ok(s.scripts.every(script=>script.removed&&script.onload===null&&script.onerror===null));assert.equal(s.timers.size,0);
});
test('the generated renderer keeps the exact approved DOCX template and version',()=>{
 const template=/const TEMPLATE_B64 = '([^']+)';/;
 const canonical=fs.readFileSync(new URL('../templates/assessment-card.html',import.meta.url),'utf8').match(template)[1];
 const generated=fs.readFileSync(new URL('../public/contract-renderer.js',import.meta.url),'utf8');
 assert.equal(generated.match(template)[1],canonical);
 assert.equal(createHash('sha256').update(Buffer.from(canonical,'base64')).digest('hex'),'e3299ff99e0c0360bed85d1f791f87d098c511226889ec79c741b9a719b38cf9');
 const version=generated.match(/const version="([a-f0-9]{64})"/)[1];
 assert.equal(fs.readFileSync(new URL('../public/contract-renderers/'+version+'.js',import.meta.url),'utf8'),generated);
 assert.ok(fs.readFileSync(new URL('../public/contract-words.mjs',import.meta.url),'utf8').includes(version));
 assert.ok(generated.includes('ready:ensureLibs'));
});
