import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto, createHmac} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {session, TEST_SECRET} from './session-helper.mjs';
const secret = 'synthetic-only-platform-entry-secret-12345';
function module(path, dependencies = {}) {
 const exports = {};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,require:name => {if (!(name in dependencies)) throw Error(name); return dependencies[name];},crypto:webcrypto,TextEncoder,TextDecoder,btoa,atob,Uint8Array,Response,URL,process:{env:{}},Date});
 return exports;
}
const entry = module('lib/platform-entry.ts');
const worker = module('worker/index.ts', {
 '../lib/worker-session': session,
 '../lib/platform-entry': entry,
 '../lib/operations-monitor':{recordServerFailure:async()=>{}},
 '../templates/tools-home.html?raw':{default:readFileSync('templates/tools-home.html','utf8')},
 'vinext/server/image-optimization':{},
 'vinext/server/app-router-entry':{default:{fetch:async()=>new Response('APP')}},
}).default;
const origin = 'https://assessment.anti-krizis.kz';
async function request(path, who='darkhan', init={}) {
 const cookie=who ? session.SESSION_COOKIE+'='+await session.issueSession(who,TEST_SECRET) : '';
 return worker.fetch(new Request(origin+path,{...init,headers:{cookie,...init.headers}}),{SITE_SESSION_TOKEN:TEST_SECRET,PLATFORM_ENTRY_SECRET:secret},{waitUntil(){}});
}
test('only the three authenticated salespeople see the compact native button',async()=>{
 for(const who of ['darkhan','ramazan','nurdaulet','ali','azhar']) {
  const response=await request('/assessment-card.html',who);
  const dom=new JSDOM(await response.text());
  const form=dom.window.document.querySelector('[data-platform-entry]');
  if(['ali','azhar'].includes(who)) assert.equal(form,null);
  else {assert.ok(form);assert.equal(form.hidden,false);assert.equal(form.method,'post');assert.equal(form.action,'/platform-entry');assert.equal(form.target,'_blank');assert.equal(form.getAttribute('rel'),'noopener');assert.equal(form.nextElementSibling.textContent.trim(),'Профиль →');}
  dom.window.close();
 }
});
test('entry requires signed session and same-origin POST; GET and prefetch never mint tickets',async()=>{
 assert.equal((await request('/platform-entry',null,{method:'POST',headers:{origin}})).status,303);
 for(const headers of [{},{origin:'https://evil.invalid'},{origin,'sec-fetch-site':'cross-site'}]) assert.equal((await request('/platform-entry','darkhan',{method:'POST',headers})).status,403);
 assert.equal((await request('/platform-entry','ali',{method:'POST',headers:{origin}})).status,403);
 assert.equal((await request('/platform-entry','azhar',{method:'POST',headers:{origin}})).status,403);
 const get=await request('/platform-entry');assert.equal(get.status,200);assert.doesNotMatch(await get.text(),/name="ticket"/);
 assert.equal((await request('/platform-entry','darkhan',{method:'DELETE',headers:{origin}})).status,405);
});
test('POST uses authenticated subject only and puts signed one-minute ticket in a no-store form body',async()=>{
 const response=await request('/platform-entry?sub=ali&returnTo=https://evil.invalid','ramazan',{method:'POST',headers:{origin},body:'sub=ali'});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'same-origin');
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'.*form-action 'self' https:\/\/platform.anti-krizis.kz/);
 assert.equal(response.headers.get('location'),null);
 const dom=new JSDOM(await response.text()); const form=dom.window.document.querySelector('form');
 assert.equal(form.action,'https://platform.anti-krizis.kz/api/auth/assessment-entry');assert.equal(form.method,'post');
 const token=form.querySelector('input').value;const [payload,signature]=token.split('.');
 assert.equal(signature,createHmac('sha256',secret).update(payload).digest('base64url'));
 const claims=JSON.parse(Buffer.from(payload,'base64url'));assert.equal(claims.sub,'ramazan');assert.equal(claims.aud,'antikrizis-platform-entry');assert.equal(claims.v,1);assert.equal(claims.exp-claims.iat,60);assert.match(claims.jti,/^[0-9a-f-]{36}$/);
 const script=dom.window.document.querySelector('script');assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${script.nonce}'`));
 dom.window.close();
});
test('each click has a fresh nonce and missing configuration fails without a ticket',async()=>{
 const actor={worker:'darkhan'};
 const a=JSON.parse(Buffer.from((await entry.issuePlatformEntry(actor,secret,1000)).split('.')[0],'base64url'));
 const b=JSON.parse(Buffer.from((await entry.issuePlatformEntry(actor,secret,1000)).split('.')[0],'base64url'));
 assert.notEqual(a.jti,b.jti);
 const response=await entry.platformEntryResponse(new Request(origin+'/platform-entry',{method:'POST'}),actor,'');
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/name="ticket"/);
 await assert.rejects(entry.issuePlatformEntry({worker:'constructor'},secret),/FORBIDDEN/);
});
