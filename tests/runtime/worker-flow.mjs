// Runs the built production Worker with real local D1/R2. All CRM traffic is
// intercepted at the network boundary; no production bindings or secrets used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {syntheticCrm} from './synthetic-crm.mjs';
import {renderContract} from './render-contract.mjs';

const origin='https://assessment.synthetic.invalid';

test('built Worker persists a complete contract and recovers a handoff without duplicate CRM writes',{timeout:120_000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'assessment-runtime-'));
 let mf;
 t.after(async()=>{await mf?.dispose();await rm(dir,{recursive:true,force:true});});
 await mkdir('.wrangler',{recursive:true});
 const fixtureDir=await mkdtemp(resolve('.wrangler/runtime-fixture-'));
 t.after(()=>rm(fixtureDir,{recursive:true,force:true}));
 await build({entryPoints:['tests/runtime/fixture.mjs'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:join(fixtureDir,'fixture.mjs'),logLevel:'silent'});
 const {seed,seedMissingBalance}=await import(pathToFileURL(join(fixtureDir,'fixture.mjs')).href);
 const modulePaths=(await readdir('dist/server',{recursive:true})).filter(n=>/\.m?js$/.test(n)).sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
 const modules=await Promise.all(modulePaths.map(async path=>({type:'ESModule',path,contents:await readFile(join('dist/server',path),'utf8')})));
 const crm=syntheticCrm();
 // The pinned local workerd supports May 2026. Production keeps its September
 // compatibility date; this local suite does not claim production parity.
 const options={modules,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],
  d1Databases:{DB:'synthetic-db'},r2Buckets:{FILES:'synthetic-files'},d1Persist:join(dir,'d1'),r2Persist:join(dir,'r2'),
  bindings:{AUTH_PROVIDER:'local',SITE_ACCESS_PASSWORD:'synthetic-password',SITE_SESSION_TOKEN:'synthetic-session-key-never-used-in-production',BITRIX_WEBHOOK:'https://bitrix.synthetic.invalid/rest/'},
  assets:{directory:resolve('dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none'}},
  outboundService:crm.handle
 };
 mf=new Miniflare(options);
 const db=await mf.getD1Database('DB');
 for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort()){
  const sql=await readFile(join('drizzle',name),'utf8');
  for(const statement of sql.split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();
 }
 let cookie='';
 async function api(path,body,status=200){
  const response=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(path==='/api/session'&&body)cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const data=await response.json();assert.equal(response.status,status,path+' '+JSON.stringify(data));return data;
 }
 await api('/api/assessment/900001',undefined,401);
 await api('/api/session',{worker:'ali',password:'synthetic-password'});
 assert.equal((await api('/api/session')).ok,true);
 const crossOrigin=await mf.dispatchFetch(origin+'/api/assessment/900001/draft',{method:'POST',headers:{origin:'https://untrusted.synthetic.invalid',cookie,'content-type':'application/json'},body:'{}'});
 assert.equal(crossOrigin.status,403);await crossOrigin.arrayBuffer();
 for(const method of ['crm.deal.update','crm.timeline.comment.add','crm.item.update'])assert.equal((await api('/api/bitrix/'+method,{id:900001},410)).error,'OLD_TOOL_RETIRED');
 assert.equal(crm.counts.assessmentWrites,0);assert.equal(crm.counts.historyWrites,0);
 const context=await api('/api/assessment/900001');
 assert.equal(context.identityRevision,1);
 const fixture=await seed(db,await mf.getR2Bucket('FILES'));
 const root='/api/assessment/900001';
 for(const doc of fixture.documents.filter(d=>!['gkb_short','gkb_full','unknown'].includes(d.kind))){
  await api(root+'/document-reviews',{requestId:crypto.randomUUID(),documentId:doc.documentId,identityRevision:1,review:{type:doc.type,iin:fixture.iin,pages:1,complete:true,contentMatches:true,periodChecked:true,reason:'SYNTHETIC ONLY fixture inspection',issuedAt:fixture.today,expiresAt:'2099-12-31',from:fixture.from,to:fixture.today,representative:doc.kind==='power_of_attorney'?{kind:'organization',legalName:'ТОО «Aplus Corporation»',identifier:'251040012303'}:null,authorityChecked:doc.kind==='power_of_attorney'}});
 }
 await api(root+'/draft',{requestId:crypto.randomUUID(),identityRevision:1,expectedRevision:0,payload:fixture.payload});
 const saved=await api(root+'/draft');assert.equal(saved.draft.revision,1);assert.equal(saved.draft.payload.documents.length,6);
 const checked=await api(root+'/check',{payload:fixture.payload,bindings:[]});
 assert.equal(checked.readyToSubmit,true,JSON.stringify(checked));
 assert.equal(checked.documents.matchedShortReports.length,1);assert.equal(checked.documents.loanCoverage.present,1);
 const missingLoan=structuredClone(fixture.payload);missingLoan.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='loanContractId').value='WRONG';
 const missingCheck=await api(root+'/check',{payload:missingLoan,bindings:[]});assert.equal(missingCheck.readyToSubmit,false);assert.equal(missingCheck.documents.packageReady,true);assert.ok(missingCheck.issues.some(i=>i.code==='ACTIVE_LOAN_MISSING'));
 assert.equal((await api(root+'/draft')).draft.revision,1,'read-only coverage checks preserve the draft');
 const destination={dealId:'900001',iin:fixture.iin,identityRevision:1},requestId=crypto.randomUUID();
 await api(root+'/submission',{action:'prepare',requestId,identityRevision:1,payload:fixture.payload,bindings:[],destination});
 const complete=await api(root+'/submission',{action:'complete',requestId,destination});
 assert.equal(complete.assessmentSaved,true,JSON.stringify(complete));assert.equal(complete.historySaved,true,JSON.stringify(complete));assert.ok(complete.contract?.data);
 await api(root+'/submission',{action:'complete',requestId,destination});
 assert.equal(crm.counts.assessmentWrites,1);assert.equal(crm.counts.historyWrites,1);
 await renderContract(mf,origin,complete.contract);
 const uploadRequest=crypto.randomUUID();let batchIndex=0;
 for(;;){const result=await api(root+'/uploads',{requestId:uploadRequest,identityRevision:1,batchIndex,payload:fixture.payload});assert.equal(result.state,'verified',JSON.stringify(result));if(result.documentsUploaded)break;assert.ok(result.nextBatch>batchIndex);batchIndex=result.nextBatch;assert.ok(batchIndex<20);}
 const credentials=await api(root+'/credentials',{requestId:crypto.randomUUID(),identityRevision:1,clientName:'SYNTHETIC ONLY',password:'dummy-not-a-private-key',ownerConfirmed:true,files:[{name:'synthetic.key',base64:Buffer.from('SYNTHETIC ONLY - NOT A PRIVATE KEY').toString('base64')}]});
 assert.equal(credentials.verified,true,JSON.stringify(credentials));
 const stage=(await api(root+'/handoff')).destination;assert.ok(stage);
 const handoffRequest=crypto.randomUUID();
 const handoff=await api(root+'/handoff',{action:'send',requestId:handoffRequest,destination,stage,powerId:fixture.documents.find(d=>d.kind==='power_of_attorney').documentId,signedId:fixture.documents.find(d=>d.kind==='unknown').documentId,signedConfirmed:true});
 assert.equal(handoff.handoff.state,'uncertain',JSON.stringify(handoff));assert.equal(crm.counts.stageWrites,1);
 // Destroy the process, preserving only D1/R2 and the remote CRM state.
 await mf.dispose();crm.restore();mf=new Miniflare(options);
 const resumed=await api(root+'/handoff',{action:'resume',requestId:handoffRequest,destination});
 assert.equal(resumed.handoff.state,'verified',JSON.stringify(resumed));
 const counts={...crm.counts};
 await api(root+'/handoff',{action:'resume',requestId:handoffRequest,destination});
 assert.deepEqual(crm.counts,counts);assert.equal(crm.counts.stageWrites,1);
 const recovered=await api(root+'/submission',{action:'contract',requestId});assert.deepEqual(recovered.contract,complete.contract);
 assert.deepEqual((await api(root+'/draft')).draft,saved.draft);
 // Optimistic concurrency must reject a stale save without damaging recovery.
 await api(root+'/draft',{requestId:crypto.randomUUID(),identityRevision:1,expectedRevision:0,payload:fixture.payload},409);
 assert.deepEqual((await api(root+'/draft')).draft,saved.draft);
 assert.equal((await api(root+'/credentials')).credentials.verified,true);
 // The manager's source choice uses the same deployed routes and durable storage.
 const missing=await seedMissingBalance(await mf.getD1Database('DB'),await mf.getR2Bucket('FILES'),fixture);
 await api(root+'/draft',{requestId:crypto.randomUUID(),identityRevision:1,expectedRevision:1,payload:missing.payload});
 const reviewInput={shortDocumentId:missing.shortDocumentId,fullDocumentId:missing.fullDocumentId,identityRevision:1};
 const blocked=await api(root+'/check',{payload:missing.payload,bindings:[]});assert.equal(blocked.readyToSubmit,false);assert.ok(blocked.documents.issues.some(i=>i.code==='SHORT_CREDIT_REVIEW_REQUIRED'));
 const {inspection}=await api(root+'/gkb-reviews',{action:'inspect',...reviewInput});assert.equal(inspection.plan.balances.length,1);assert.equal(inspection.review,null);
 const confirm={action:'confirm',...reviewInput,planKey:inspection.planKey,requestId:crypto.randomUUID()};
 await api(root+'/gkb-reviews',{...confirm,planKey:'stale'},409);
 const receipt=await api(root+'/gkb-reviews',confirm);assert.deepEqual(await api(root+'/gkb-reviews',confirm),receipt);
 const ready=await api(root+'/check',{payload:missing.payload,bindings:[]});assert.equal(ready.readyToSubmit,true,JSON.stringify(ready));assert.equal(ready.documents.loanCoverage.present,1);assert.equal(ready.documents.gkbEvidence[0].reviewId,receipt.reviewId);
 await mf.dispose();mf=new Miniflare(options);
 const reopened=await api(root+'/gkb-reviews',{action:'inspect',...reviewInput});assert.equal(reopened.inspection.review.reviewId,receipt.reviewId);assert.equal((await api(root+'/draft')).draft.revision,2);
 const changed=structuredClone(missing.payload);changed.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='n8040').value='100.26';
 const invalidated=await api(root+'/check',{payload:changed,bindings:[]});assert.equal(invalidated.readyToSubmit,false);assert.equal(invalidated.documents.gkbEvidence.length,0);
 await api(root+'/gkb-reviews',{action:'withdraw',...reviewInput,planKey:inspection.planKey,reviewId:receipt.reviewId,requestId:crypto.randomUUID()});
 assert.equal((await api(root+'/check',{payload:missing.payload,bindings:[]})).readyToSubmit,false);assert.equal(crm.counts.assessmentWrites,1);assert.equal(crm.counts.historyWrites,1);assert.equal(crm.counts.stageWrites,1);
 console.log('Verified: durable draft, contract, handoff recovery and explicit GKB source confirmation; retries, restart, changed amounts and withdrawal; no duplicate CRM writes.');
});
