import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{JSDOM}from'jsdom';
function setup(t){
 const dom=new JSDOM('<select id="gamblingTransfers"><option value=""></option><option value="yes">Yes</option><option value="no">No</option></select><input id="n8044"><div id="gamblingTools"><button id="analyzeGambling"></button><p id="gamblingStatus"></p><div id="gamblingMatches"></div></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];t.after(()=>w.close());
 w.af={results:new Map(),sources:new Map()};w.HostedAssessment={getContext:()=>({client:{iin:'test-client'}})};w.afPut=(e,value,source)=>{calls.push({value,source});e.value=value;};w.afSource=()=>{};w.afRefresh=()=>{};w.afRenderConflicts=()=>{};
 w.eval(fs.readFileSync('public/gambling-review.js','utf8'));
 const set=value=>{d.getElementById('gamblingTransfers').value=value;d.getElementById('gamblingTransfers').dispatchEvent(new w.Event('change'));};
 const doc={kind:'kaspi',identity:{iin:'test-client'},gambling:{value:'100.00',page:2,source:'test row'},server:{documentId:'doc'},statement:{period:'test year',gambling:{matches:[{date:'2026-01-01',amount:'100.00',description:'test merchant',page:2}]}}};
 return{w,d,calls,set,doc,click:()=>d.getElementById('analyzeGambling').onclick(),amount:()=>d.getElementById('n8044').value};
}
test('statement transfer review is optional and retains its source for employee confirmation',t=>{const s=setup(t);s.w.af.results.set(1,s.doc);s.click();assert.equal(s.calls.length,0);s.set('yes');s.click();assert.equal(s.amount(),'100.00');assert.equal(s.calls[0].source.serverFactKey,'statement.gambling');assert.equal(s.calls[0].source.reviewId,undefined);assert.equal(s.d.querySelectorAll('#gamblingMatches button').length,1);});
test('no merchant match, a foreign client, or overlapping statements cannot invent a gambling total',t=>{
 for(const mode of ['absent','foreign','multiple']){const s=setup(t);s.set('yes');if(mode==='absent')delete s.doc.gambling;if(mode==='foreign')s.doc.identity.iin='another-client';s.w.af.results.set(1,s.doc);if(mode==='multiple')s.w.af.results.set(2,s.doc);s.click();assert.equal(s.amount(),'');assert.equal(s.calls.length,0);}
 const s=setup(t);s.set('no');assert.equal(s.amount(),'0');s.set('yes');assert.equal(s.amount(),'');
});
