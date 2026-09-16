import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>{if(n in imports)return imports[n];throw Error(n);},crypto:webcrypto,Uint8Array,TextEncoder,Date,JSON,Map,Set,fetch,AbortSignal});return exports;}
const repoModule=load('lib/documents/repository.ts');
const rules=load('lib/documents/extract-native.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./kz-labels.json':JSON.parse(fs.readFileSync('lib/documents/kz-labels.json'))});
const crm=load('lib/crm/bitrix.ts',{'../documents/extract-native':rules});
const adapterModule=load('lib/crm/document-identity.ts',{'../documents/repository':repoModule,'../documents/extract-native':rules,'./bitrix':crm});
const analysis=load('lib/documents/analysis-service.ts',{'./read-pdf':{},'./extract-native':rules,'./policy':load('lib/documents/policy.ts'),'./request-context':{operatingDay:()=> '2026-09-16'},'./repository':repoModule,'./power-validation':{},'./analysis-version':{analysisVersion:'test-version'},'./document-review':{}});
const {confirmDocumentIdentity}=load('lib/documents/identity-service.ts',{'./analysis-service':analysis,'./repository':repoModule,'./extract-native':rules});
const {DraftRepository}=load('lib/questionnaire/repository.ts',{'../documents/repository':repoModule});
const actor={id:'worker:synthetic',authentication:'test'},iin='991231300003',otherIin='000000000010';
const client=(value=null)=>({external:{system:'bitrix',dealId:'900001'},title:'SYNTHETIC ONLY',iin:value});
const payload=value=>({schemaVersion:1,answers:[{key:'iin',value,checked:false},{key:'fio',value:'MANUAL NAME',checked:false}],groups:[],documents:[],pendingFiles:[],docContext:{social:'',salary:''}});
function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync('drizzle').filter(p=>p.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 const db={prepare(sql){return{bind(...args){const q=sqlite.prepare(sql);return{async run(){return{success:true,meta:{changes:q.run(...args).changes}};},async first(){return q.get(...args)||null;},async all(){return{success:true,results:q.all(...args)};}};}};},async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.all());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const objects=new Map(),files={async put(k,v){objects.set(k,Buffer.from(v));},async get(k){const b=objects.get(k);return b?{text:async()=>b.toString(),arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;}};
 return{repo:new repoModule.EvidenceRepository(db,files),drafts:new DraftRepository(db),sqlite,objects};
}
async function source(s,record,changes={}){return s.repo.store(record.id,new Uint8Array([1,2,3]),'synthetic.pdf',actor,'test-version',{read:{totalPages:1,pages:[{text:'SYNTHETIC',needsOcr:false}]},extraction:{identity:{iin,name:'SYNTHETIC NAME'},kind:'gkb_full',issuedAt:'2026-09-16',findings:[],facts:[],credits:[],creditList:{complete:true},...changes}});}
function network({value=null,wrongDeal=false,lostWrite=false,readbackFails=false,apply=true}={}){
 let current=value,writes=0;const calls=[];
 const send=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});if(url.endsWith('crm.deal.update.json')){writes++;assert.deepEqual(Object.keys(body.fields),['UF_CRM_AI_IIN']);assert.equal(body.id,'900001');if(apply)current=body.fields.UF_CRM_AI_IIN;if(lostWrite)throw Error('lost response');return Response.json({result:true});}if(readbackFails&&writes)throw Error('offline');return Response.json({result:{ID:wrongDeal?'900002':'900001',TITLE:'SYNTHETIC ONLY',UF_CRM_AI_IIN:current}});};
 return{adapter:adapterModule.createDocumentIdentityAdapter('https://synthetic.invalid/rest/',send),calls,get writes(){return writes;},get value(){return current;}};
}
test('document supplies missing IIN, persists its provenance, and preserves the saved draft revision and every answer',async()=>{
 const s=setup(),record=await s.repo.syncCase(client()),d=await source(s,record),saved=await s.drafts.save(record,payload(iin),0,webcrypto.randomUUID(),actor),net=network();
 const input={documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,confirmed:true};
 const result=await confirmDocumentIdentity(s.repo,record,client(),actor,input,net.adapter);
 assert.equal(net.writes,1);assert.equal(result.client.iin,iin);assert.equal(result.identityRevision,1);assert.equal(result.analysis.eligibleForAutofill,true);assert.equal(result.analysis.reviews.length,0,'Identity confirmation must not approve financial facts');
 assert.equal((await s.drafts.latest(record.id)).payload_json,saved.payload_json);
 const reopened=await s.repo.syncCase(client(iin));assert.equal(reopened.identity_revision,1);assert.equal((await s.repo.identityBinding(reopened)).document_id,d.document.id);
 const exported=await s.repo.exportCase(record.id);assert.equal(exported.identityBindings.length,1);assert.equal(exported.documents.length,1);
 await confirmDocumentIdentity(s.repo,reopened,client(iin),actor,input,net.adapter);assert.equal(net.writes,1,'Retry never resends an applied IIN');
 assert.equal((await s.repo.syncCase(client(otherIin))).identity_revision,2,'A genuinely different identity still invalidates old evidence');
});
test('document identity cannot bypass employee confirmation, owner, revision, extraction version or document quality',async()=>{
 for(const change of [{confirmed:false},{revision:2},{documentId:'another-case'},{extractionId:'wrong'},{parsed:{identity:{iin:otherIin,name:'OTHER'}},existing:iin},{parsed:{issuedAt:'2020-01-01'}},{parsed:{creditList:{complete:false}}},{parsed:{findings:['OCR_OR_PAGE_REVIEW_REQUIRED']}},{parsed:{identity:{iin:'000000000000',name:'BAD'}}}]){
  const s=setup(),c=client(change.existing??null),r=await s.repo.syncCase(c),d=await source(s,r,change.parsed),net=network({value:c.iin});
  await assert.rejects(()=>confirmDocumentIdentity(s.repo,r,c,actor,{confirmed:change.confirmed??true,identityRevision:change.revision??1,documentId:change.documentId??d.document.id,extractionId:change.extractionId??d.extraction.id},net.adapter));assert.equal(net.writes,0);
 }
});
test('other saved client and simultaneous conflicting identity claims are refused before any CRM write',async()=>{
 const s=setup(),r=await s.repo.syncCase(client()),d=await source(s,r),net=network();await s.drafts.save(r,payload(otherIin),0,webcrypto.randomUUID(),actor);
 await assert.rejects(()=>confirmDocumentIdentity(s.repo,r,client(),actor,{documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,confirmed:true},net.adapter),/IDENTITY_CONFLICT/);assert.equal(net.writes,0);
 const fresh=setup(),c=await fresh.repo.syncCase(client()),doc=await source(fresh,c);
 const attempts=await Promise.allSettled([iin,otherIin].map(value=>fresh.repo.claimDocumentIdentity(c,doc.document,doc.extraction,value,actor)));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal((await fresh.repo.identityBinding(c)).iin,iin);
 await assert.rejects(()=>fresh.drafts.save(c,payload(otherIin),0,webcrypto.randomUUID(),actor),/DRAFT_CHANGED/,'A concurrent draft cannot change the confirmed owner');
});
test('narrow CRM identity write refuses nonempty conflicts and wrong deals, and reconciles a lost response without duplicate writes',async()=>{
 for(const options of [{value:otherIin},{value:'invalid existing value'},{wrongDeal:true}]){const n=network(options);await assert.rejects(()=>n.adapter.save('900001',iin));assert.equal(n.writes,0);}
 const lost=network({lostWrite:true});assert.equal((await lost.adapter.save('900001',iin)).iin,iin);await lost.adapter.save('900001',iin);assert.equal(lost.writes,1);
 const uncertain=network({readbackFails:true});await assert.rejects(()=>uncertain.adapter.save('900001',iin),/IDENTITY_SAVE_UNCERTAIN/);assert.equal(uncertain.writes,1);
 const unchanged=network({apply:false});await assert.rejects(()=>unchanged.adapter.save('900001',iin),/IDENTITY_SAVE_UNCERTAIN/);assert.equal(unchanged.writes,1);
});
test('an older in-flight CRM read cannot reset a newly confirmed document identity or invalidate its draft',async()=>{
 const s=setup(),r=await s.repo.syncCase({...client(),retrievedAt:'2026-09-16T00:00:01.000Z'}),d=await source(s,r);
 await s.repo.claimDocumentIdentity(r,d.document,d.extraction,iin,actor);
 await s.repo.syncCase({...client(iin),retrievedAt:'2026-09-16T00:00:03.000Z'});
 await assert.rejects(()=>s.repo.syncCase({...client(),retrievedAt:'2026-09-16T00:00:02.000Z'}),/CASE_IDENTITY_CHANGED/);
 const current=await s.repo.findCaseByExternal('bitrix','900001');assert.equal(current.client_iin,iin);assert.equal(current.identity_revision,1);
 const cleared=await s.repo.syncCase({...client(),retrievedAt:'2026-09-16T00:00:04.000Z'});assert.equal(cleared.identity_revision,2,'A genuine later CRM change is still detected');
});
