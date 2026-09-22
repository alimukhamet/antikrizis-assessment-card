import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {TEST_SECRET,testCookie} from './session-helper.mjs';
const built=await build({entryPoints:['lib/knowledge/source.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {buildKnowledgeData}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const model=await build({entryPoints:['lib/knowledge/model.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {filterRows,periodFor}=await import('data:text/javascript;base64,'+Buffer.from(model.outputFiles[0].text).toString('base64'));
const data=buildKnowledgeData();
test('import preserves the full source hierarchy and exact outcome totals',()=>{
 assert.equal(data.regions.length,20);assert.equal(data.courts.length,222);
 assert.deepEqual([data.total.granted,data.total.refused,data.total.decided,data.total.withoutConsideration,data.total.undated],[4850,3663,8513,4516,109]);
 for(const field of ['granted','refused','decided','withoutConsideration','undated']){
  assert.equal(data.courts.reduce((n,r)=>n+r[field],0),data.total[field]);
  assert.equal(data.regions.reduce((n,r)=>n+r[field],0),data.total[field]);
  for(const region of data.regions)assert.equal(data.courts.filter(r=>r.region===region.name).reduce((n,r)=>n+r[field],0),region[field]);
 }
 assert.deepEqual(data.total.periods.map(p=>p.count),[752,1436,3584,2520]);
});
test('each source row keeps its region, exact displayed rates, monthly values and supplied percentage-point change',async()=>{
 const source=JSON.parse(await readFile('data/vps-sheet-snapshot.json','utf8'));
 for(const row of [data.total,...data.regions,...data.courts]){
  const i=row.sourceRow-1;
  assert.equal(source.sheets['Регионы и суды'].values[i][0].trim(),row.name);
  const trend=source.sheets['Тренды 2025–2026'].values[i];
  row.periods.forEach((p,j)=>assert.equal(p.rate,trend[1+j*2]==='—'?null:parseFloat(trend[1+j*2])));
  assert.equal(row.delta2026,trend[9]==='—'?null:Number(trend[9]));
  for(const [year,months]of [[2025,row.months2025],[2026,row.months2026]])months.forEach((p,j)=>{
   const value=source.sheets['По месяцам '+year].values[i][j+1];
   assert.equal(p.rate,value==='—'?null:parseFloat(value));
   assert.equal(p.count,value==='—'?0:Number(value.match(/\((\d+)\)/)[1]));
  });
 }
});
test('search and filters preserve court-region pairing, keep missing data distinct from zero, and never average percentages',()=>{
 const talgar=filterRows(data.courts,'','талгар',4,0,'name');assert.equal(talgar.length,1);assert.equal(talgar[0].region,'Алматинская обл.');
 assert.equal(filterRows(data.courts,'Абай обл.','талгар',4,0,'name').length,0);
 assert.ok(filterRows(data.courts,'','',4,30,'rate').every(r=>r.periods[3].count>=30));
 const empty=data.courts.find(r=>!r.periods[3].count);assert.equal(periodFor(empty,4).rate,null);
 const zero=data.courts.find(r=>r.periods[3].count&&r.periods[3].rate===0);assert.equal(periodFor(zero,4).rate,0);
 assert.equal(periodFor(data.total,0).rate,4850/8513*100);
});
process.env.SITE_SESSION_TOKEN=TEST_SECRET;
async function request(path,authenticated=true){
 const {default:worker}=await import('../dist/server/index.js');
 return worker.fetch(new Request('https://synthetic.invalid'+path,{headers:{cookie:authenticated?await testCookie():''}}),{SITE_SESSION_TOKEN:TEST_SECRET,ASSETS:{fetch:async()=>new Response('Missing',{status:404})}},{waitUntil(){},passThroughOnException(){}});
}
test('knowledge is staff-only, uncached and returns the exact imported snapshot',async()=>{
 for(const path of ['/knowledge','/knowledge/']){
  const r=await request(path,false);assert.equal(r.status,303);assert.match(r.headers.get('location'),/login/);
 }
 const denied=await request('/api/knowledge',false);assert.equal(denied.status,401);
 const allowed=await request('/api/knowledge');assert.equal(allowed.status,200);assert.match(allowed.headers.get('cache-control'),/private, no-store/);assert.deepEqual(await allowed.json(),data);
 const page=await request('/knowledge');assert.equal(page.status,200);assert.match(await page.text(),/Практика судов/);
 const launcher=await request('/assessment-card.html');assert.match(await launcher.text(),/href="\/knowledge" target="_top"/);
});
test('source aggregates are absent from public client assets',async()=>{
 for(const file of await readdir('dist/client/assets')){
  if(!file.endsWith('.js'))continue;
  const contents=await readFile('dist/client/assets/'+file,'utf8');
  assert.ok(!contents.includes('0ed8d92b5ab95473c14329a8cab44dc8e6d3b7dea6b918b4f4257a0f8b599d36'),file);
  assert.ok(!contents.includes('Глубоковский районный суд'),file);
 }
});
