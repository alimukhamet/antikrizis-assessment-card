// Read-only release check through the normal salesperson login.
// Never log passwords, sessions or individual client information.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const origin='https://assessment.anti-krizis.kz';
const report={origin,worker:'ramazan',authenticated:false,passed:false};
const options={redirect:'manual'};
const request=(path,init={})=>fetch(origin+path,{...options,signal:AbortSignal.timeout(30000),...init});
const compiled=await build({entryPoints:['lib/knowledge/source.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {buildKnowledgeData}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
try{
 for(const path of ['/knowledge','/knowledge/','/api/knowledge']){
  const r=await request(path);assert.equal(r.status,path.startsWith('/api/')?401:303);
  if(!path.startsWith('/api/'))assert.ok(new URL(r.headers.get('location'),origin).pathname==='/login');
 }
 report.anonymousBlocked=true;
 assert.ok(process.env.ASSESSMENT_TEST_PASSWORD,'Missing verification credential');
 const login=await request('/api/session',{...options,method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({worker:'ramazan',password:process.env.ASSESSMENT_TEST_PASSWORD})});
 assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie);
 const headers={cookie};
 const session=await request('/api/session',{...options,headers});assert.equal(session.status,200);report.authenticated=(await session.json()).ok===true;assert.ok(report.authenticated);
 const page=await request('/knowledge',{...options,headers});assert.equal(page.status,200);assert.match(await page.text(),/Практика судов/);assert.match(page.headers.get('cache-control'),/private, no-store/);
 const r=await request('/api/knowledge',{...options,headers});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);
 const actual=await r.json(),expected=buildKnowledgeData();assert.deepEqual(actual,expected);
 const launcher=await request('/assessment-card.html',{...options,headers});assert.equal(launcher.status,200);assert.match(await launcher.text(),/href="\/knowledge" target="_top"/);
 Object.assign(report,{snapshotDate:actual.snapshotDate,regions:actual.regions.length,courts:actual.courts.length,datasetSha256:createHash('sha256').update(JSON.stringify(actual)).digest('hex'),launcherLink:true,passed:true});
 console.log('Knowledge release verified: normal salesperson login, protected page/API, homepage link, and complete source-data parity.');
}finally{await writeFile('live-knowledge-audit.json',JSON.stringify(report,null,2)+'\n');}
