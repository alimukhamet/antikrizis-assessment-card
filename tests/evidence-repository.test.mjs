import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import ts from 'typescript';import {webcrypto} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
const source=fs.readFileSync(new URL('../lib/documents/repository.ts',import.meta.url),'utf8'),exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:webcrypto,Uint8Array,TextEncoder,Date,JSON});const {EvidenceRepository}=exports;
const actor={id:'worker:ramazan',worker:'ramazan',displayName:'Ramazan',authentication:'shared-password-worker-selection'};
function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const migration of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(p=>p.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));
 const db = {
  async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push({...await statement.all(),success:true});sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
  prepare(sql) {
   return {
    bind(...args) {
     const query = sqlite.prepare(sql);
     return {
      async run() { query.run(...args); return { success:true }; },
      async first() { return query.get(...args) || null; },
      async all() { return { results:query.all(...args) }; },
     };
    },
   };
  },
 };
 const objects=new Map();const files={async put(key,value){objects.set(key,typeof value==='string'?Buffer.from(value):Buffer.from(value));},async get(key){const b=objects.get(key);return b?{text:async()=>b.toString(),arrayBuffer:async()=>Uint8Array.from(b).buffer}:null}};
 return{repo:new EvidenceRepository(db,files),sqlite,objects,db,files};
}
const client=(id='11665',iin='test-identity-one')=>({external:{system:'bitrix',dealId:id},iin,title:'SYNTHETIC ONLY'});
test('identity changes increment revision; title refresh does not',async()=>{const {repo}=setup();const a=await repo.syncCase(client());const b=await repo.syncCase({...client(),title:'Changed test title'});assert.equal(a.id,b.id);assert.equal(b.identity_revision,1);const c=await repo.syncCase(client('11665','different-test-identity'));assert.equal(c.identity_revision,2)});
test('same bytes/version reuse one document and extraction; another case remains isolated',async()=>{const {repo,sqlite}=setup();const c=await repo.syncCase(client()),bytes=new Uint8Array([1,2,3]);const a=await repo.store(c.id,bytes,'one.pdf',actor,'v1',{facts:[1]});const b=await repo.store(c.id,bytes,'renamed.pdf',actor,'v1',{facts:[1]});assert.equal(a.document.id,b.document.id);assert.equal(a.extraction.id,b.extraction.id);const d=await repo.syncCase(client('11666'));assert.equal(await repo.cached(d.id,a.document.original_sha256,'v1'),null);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);assert.deepEqual(await repo.original(a.document),bytes);});
test('new extraction version preserves previous evidence and reviews',async()=>{const {repo}=setup();const c=await repo.syncCase(client()),bytes=new Uint8Array([1,2]);const a=await repo.store(c.id,bytes,'x.pdf',actor,'v1',{facts:['old']});const b=await repo.store(c.id,bytes,'x.pdf',actor,'v2',{facts:['new']});assert.notEqual(a.extraction.id,b.extraction.id);assert.equal((await repo.cached(c.id,a.document.original_sha256,'v1')).result.facts[0],'old');});
test('retry-safe review: identical request returns one row; changed payload with same key rejected',async()=>{const {repo,sqlite}=setup();const c=await repo.syncCase(client());const d=await repo.store(c.id,new Uint8Array([4]),'x.pdf',actor,'v1',{});const input={caseId:c.id,documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,requestId:'test-request-1',factKey:'creditor',value:'TEST',disposition:'confirmed',reason:''};const a=await repo.appendReview(input,actor),b=await repo.appendReview(input,actor);assert.equal(a.id,b.id);await assert.rejects(()=>repo.appendReview({...input,value:'DIFFERENT'},actor),/IDEMPOTENCY_KEY_REUSED/);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,1);});
test('a stale identity revision cannot receive new review',async()=>{const {repo}=setup();const c=await repo.syncCase(client());const d=await repo.store(c.id,new Uint8Array([1]),'x.pdf',actor,'v1',{});await repo.syncCase(client('11665','changed'));await assert.rejects(()=>repo.appendReview({caseId:c.id,documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,requestId:'stale',factKey:'x',value:'x',disposition:'confirmed',reason:''},actor),/CASE_IDENTITY_CHANGED/);});
test('cross-case document/review access rejected; hashes detect altered storage',async()=>{const {repo,objects}=setup();const a=await repo.syncCase(client()),b=await repo.syncCase(client('11666'));const d=await repo.store(a.id,new Uint8Array([3]),'x.pdf',actor,'v1',{facts:[]});assert.equal(await repo.document(b.id,d.document.id),null);assert.equal(await repo.extraction(b.id,d.document.id,d.extraction.id),null);objects.set(d.extraction.result_key,Buffer.from('{}'));await assert.rejects(()=>repo.readResult(d.extraction),/EVIDENCE_INTEGRITY_FAILED/);});
test('new repository instance reads stored identity, files, extraction and review history',async()=>{const s=setup();const c=await s.repo.syncCase(client());await s.repo.store(c.id,new Uint8Array([1]),'x.pdf',actor,'v1',{facts:[]});const reopened=new EvidenceRepository(s.db,s.files);const bundle=await reopened.exportCase(c.id);assert.equal(bundle.schemaVersion,2);assert.equal(bundle.documents.length,1);assert.equal(bundle.extractions.length,1);assert.equal(bundle.case.id,c.id);});
test('review replay uses insertion order and does not carry an unresolved or stale-identity answer',async()=>{const {repo}=setup(),c=await repo.syncCase(client()),d=await repo.store(c.id,new Uint8Array([9]),'test.pdf',actor,'v1',{});const base={caseId:c.id,documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,factKey:'credits.0.monthlyPayment',reason:''};await repo.appendReview({...base,requestId:'r1',value:'20.00',disposition:'confirmed'},actor);const corrected=await repo.appendReview({...base,requestId:'r2',value:'25.00',disposition:'corrected',reason:'test correction'},actor);assert.equal((await repo.currentReviews(c.id,d.document.id,d.extraction.id,1))[0].id,corrected.id);await repo.appendReview({...base,requestId:'r3',value:null,disposition:'unresolved',reason:'test pending'},actor);assert.equal((await repo.currentReviews(c.id,d.document.id,d.extraction.id,1)).length,0);assert.equal((await repo.currentReviews(c.id,d.document.id,d.extraction.id,2)).length,0);});
test('withdrawal preserves history, retries once, and cannot supersede a newer inspection',async()=>{
 const {repo,sqlite}=setup(),c=await repo.syncCase(client()),d=await repo.store(c.id,new Uint8Array([12]),'synthetic.pdf',actor,'v1',{});
 const base={caseId:c.id,documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,factKey:'document.manual-check.v1',reason:'synthetic inspection'};
 const first=await repo.appendReview({...base,requestId:'first',value:{test:true},disposition:'confirmed'},actor);
 const second=await repo.appendReview({...base,requestId:'second',value:{test:2},disposition:'confirmed'},actor);
 await assert.rejects(()=>repo.appendReview({...base,requestId:'stale-withdrawal',value:null,disposition:'unresolved',expectedReviewId:first.id},actor),/REVIEW_CHANGED/);
 const input={...base,requestId:'withdrawal',value:null,disposition:'unresolved',expectedReviewId:second.id};
 const withdrawn=await repo.appendReview(input,actor);assert.equal((await repo.appendReview(input,actor)).id,withdrawn.id);assert.equal((await repo.currentReviews(c.id,d.document.id,d.extraction.id,1)).length,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,3);
 const restored=await repo.appendReview({...base,requestId:'third',value:{test:3},disposition:'confirmed'},actor);assert.equal((await repo.currentReviews(c.id,d.document.id,d.extraction.id,1))[0].id,restored.id);
});

test('export preserves same-timestamp review insertion order, including withdrawal, and excludes other cases',async()=>{
 const {repo,sqlite}=setup(),c=await repo.syncCase(client()),other=await repo.syncCase(client('11666'));
 const d=await repo.store(c.id,new Uint8Array([5]),'test.pdf',actor,'v1',{});
 const base={caseId:c.id,documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,factKey:'creditor',reason:'test'};
 const first=await repo.appendReview({...base,requestId:'first',value:'BANK',disposition:'confirmed'},actor);
 const last=await repo.appendReview({...base,requestId:'last',value:null,disposition:'unresolved'},actor);
 // Force UUID order opposite to insertion order at an identical timestamp.
 sqlite.prepare('UPDATE assessment_reviews SET id=?,created_at=? WHERE id=?').run('zz-first','2026-09-12T00:00:00.000Z',first.id);
 sqlite.prepare('UPDATE assessment_reviews SET id=?,created_at=? WHERE id=?').run('aa-last','2026-09-12T00:00:00.000Z',last.id);
 const bundle=await repo.exportCase(c.id);assert.deepEqual(Array.from(bundle.reviews,r=>r.id),['zz-first','aa-last']);
 assert.ok(bundle.reviews[1].sequence>bundle.reviews[0].sequence);assert.equal(bundle.reviews.at(-1).disposition,'unresolved');
 assert.equal((await repo.exportCase(other.id)).reviews.length,0);await assert.rejects(()=>repo.exportCase('missing'),/CASE_NOT_FOUND/);
});
