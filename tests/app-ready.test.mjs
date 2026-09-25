import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {JSDOM} from 'jsdom';
const html=readFileSync('public/questionnaire.html','utf8'),script=readFileSync('public/app-ready.js','utf8');
function boot(t,{failed=false,missing=false,handoff=false}={}){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/questionnaire.html'+(handoff?'?mode=handoff':''),runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());let timeout;w.setTimeout=fn=>{timeout=fn;return 1;};w.clearTimeout=()=>{};
 for(const key of ['AssessmentWorkflow','AssessmentCheck','ClientContextUI','FileSelectionControls','GkbComparison'])w[key]={};
 if(missing)delete w.GkbComparison;
 w.eval(script);
 if(failed)w.dispatchEvent(new w.ErrorEvent('error',{message:'SYNTHETIC failed module'}));
 return{w,load:()=>w.document.dispatchEvent(new w.Event('DOMContentLoaded')),timeout:()=>timeout()};
}
test('original questionnaire becomes visible only after all working UI components initialize',t=>{
 const s=boot(t),d=s.w.document;assert.equal(s.w.getComputedStyle(d.querySelector('main')).visibility,'hidden');s.load();assert.equal(d.documentElement.hasAttribute('data-app-boot'),false);assert.equal(d.getElementById('appBoot'),null);assert.equal(s.w.getComputedStyle(d.querySelector('main')).visibility,'visible');
});
for(const [name,options] of [['script failure',{failed:true}],['missing module',{missing:true}],['missing handoff controls',{handoff:true}]])test(name+' keeps the raw form closed and offers recovery',t=>{
 const s=boot(t,options);s.load();const d=s.w.document;assert.equal(d.documentElement.hasAttribute('data-app-boot'),true);assert.equal(d.getElementById('appBootRetry').hidden,false);assert.match(d.getElementById('appBootMessage').textContent,/сохранённые данные останутся/);
});
test('a stalled script exposes a reload action instead of leaving an indefinite loading message',t=>{const s=boot(t);s.timeout();assert.equal(s.w.document.getElementById('appBootRetry').hidden,false);});
