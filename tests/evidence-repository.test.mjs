import {buildSync} from 'esbuild';
import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {webcrypto} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
const compiled=buildSync({entryPoints:['lib/documents/repository.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,repoModule={exports:{}};vm.runInNewContext(compiled,{module:repoModule,exports:repoModule.exports,crypto:webcrypto,Uint8Array,TextEncoder,Date,JSON});const {EvidenceRepository}=repoModule.exports;
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
test('reader v4 retains unaffected evidence and reviews but rereads low-text GKB originals',async()=>{
 const {repo,sqlite}=setup(),c=await repo.syncCase(client());
 for(const [index,kind,needsOcr,compatible] of [[101,'gkb_full',false,true],[102,'gkb_full',true,false],[103,'gkb_short',true,false],[104,'identity',true,true],[105,'kaspi',false,true]]){
  const old=await repo.store(c.id,new Uint8Array([index]),'synthetic.pdf',actor,'native-pdf-3:rules-native-30',{read:{pages:[{text:'synthetic native text',needsOcr}]},extraction:{kind}});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'reader4-'+index,factKey:'synthetic',value:'saved fact',disposition:'confirmed',reason:''},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'native-pdf-4:rules-native-30');assert.equal(Boolean(cached),compatible);
  if(compatible){assert.equal(cached.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,cached.extraction.id,1))[0].id,review.id);}
  assert.ok(await repo.extraction(c.id,old.document.id,old.extraction.id));
  assert.equal(await repo.cached(c.id,old.document.original_sha256,'native-pdf-6:rules-native-30'),null);
 }
 assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,5);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_extractions').get().n,5);
});

test('v31 refreshes changed Kaspi interpretations while retaining unrelated and unchanged statement review IDs',async()=>{
 const compiledRules=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,rulesModule={exports:{}};
 vm.runInNewContext(compiledRules,{module:rulesModule,exports:rulesModule.exports,Date,JSON});
 const statement='Kaspi ҮЗІНДІ КӨШІРМЕ\nИИН: 000000000010\n01.09.25ж. бастап 31.08.26ж. дейінгі кезеңге\n01.09.25ж. қолжетімді: + 0,00 ₸\n31.08.26ж. қолжетімді: - 10,00 ₸\nКарта бойынша операциялардың қысқаша мазмұны:\nТолықтыру + 10,00 ₸\nӨз шоттарыңыздан түскені + 1,00 ₸\nКредиттер сомасын шотқа түсіру + 0,00 ₸\nАударым - 0,00 ₸\nӨз шоттарыңызға аудару - 0,75 ₸\nЗат сатып алу - 0,00 ₸\nАқша алу - 0,00 ₸\nӘртүрлі - 0,00 ₸\n15.01.26 + 10,00 ₸ Толықтыру\n15.01.26 + 1,00 ₸ Өз шотыңыздан\n15.01.26 - 0,50 ₸ Өз шотыңызға\n15.01.26 - 0,25 ₸ Өз шотыңызға';
 for(const reader of ['native-pdf-3','native-pdf-4'])for(const scenario of ['changed-kaspi','unchanged-kaspi','gkb','identity']){
  const {repo,sqlite}=setup(),c=await repo.syncCase(client());
  const text=scenario==='gkb'?'Персональный кредитный отчет':scenario==='identity'?'Удостоверение личности':scenario==='unchanged-kaspi'?statement.replaceAll('₸ Өз шотыңыздан','₸ Өз шоттарыңыздан түскені').replaceAll('₸ Өз шотыңызға','₸ Өз шоттарыңызға аудару'):statement;
  const pages=[{page:1,text,nativeCharacters:text.length,needsOcr:false}],current=rulesModule.exports.extractNative(pages),previous=JSON.parse(JSON.stringify(current));previous.version='rules-native-30';
  if(scenario==='changed-kaspi'){
   // Frozen v30 interpretation: rows were readable, but singular own-account
   // categories were unknown and prevented summary/top-up verification.
   previous.bankStatement.topUpsVerified=false;previous.bankStatement.reconciled=false;previous.bankStatement.reconciliation='unverified';
   previous.facts=previous.facts.filter(f=>f.key!=='statement.topUps');previous.findings.push('STATEMENT_RECONCILIATION_REQUIRED');
  }
  const oldVersion=reader+':rules-native-30',nextVersion=reader+':rules-native-31';
  const old=await repo.store(c.id,new Uint8Array([201]),'synthetic.pdf',actor,oldVersion,{read:{pages},extraction:previous});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'review',factKey:'document.manual-check.v1',value:{type:'synthetic'},disposition:'confirmed',reason:'synthetic'},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,nextVersion);
  if(scenario==='changed-kaspi'){
   assert.equal(cached,null);
   const updated=await repo.storeExtraction(old.document,nextVersion,{read:{pages},extraction:current});
   assert.notEqual(updated.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,updated.extraction.id,1)).length,0);
   assert.equal((await repo.cached(c.id,old.document.original_sha256,nextVersion)).extraction.id,updated.extraction.id);
  }else{
   assert.equal(cached.extraction.id,old.extraction.id);
   assert.equal((await repo.currentReviews(c.id,old.document.id,cached.extraction.id,1))[0].id,review.id);
  }
  assert.equal((await repo.currentReviews(c.id,old.document.id,old.extraction.id,1))[0].id,review.id);
  assert.equal((await repo.cached(c.id,old.document.original_sha256,oldVersion)).extraction.id,old.extraction.id);
  assert.deepEqual(await repo.original(old.document),new Uint8Array([201]));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,1);
 }
});

test('v31 refreshes Kazakh F6 previously labelled Kaspi or unknown without transferring old approvals',async()=>{
 const compiledRules=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,rulesModule={exports:{}};
 vm.runInNewContext(compiledRules,{module:rulesModule,exports:rulesModule.exports});
 const text='Құжат электрондық үкімет порталымен құрылған\nЖылжымайтын мүліктің болмауы (болуы) туралы\nақпарат\n27.08.2026 Дата получения:\nКімге берілді: СЫНАҚ КЛИЕНТ, 31.12.1999, ИИН 991231300003\nKaspi Bank; выписка регистрации залога';
 const pages=[{page:1,text,nativeCharacters:text.length,needsOcr:false}],current=rulesModule.exports.extractNative(pages);
 for(const priorKind of ['kaspi','unknown','property']){
  const {repo,sqlite}=setup(),c=await repo.syncCase(client()),previous=JSON.parse(JSON.stringify(current));previous.version='rules-native-30';
  if(priorKind!=='property'){previous.kind=priorKind;previous.identity.name=null;previous.issuedAt=null;previous.facts=[];previous.findings=['STATEMENT_RECONCILIATION_REQUIRED'];}
  const old=await repo.store(c.id,new Uint8Array([211]),'synthetic.pdf',actor,'native-pdf-4:rules-native-30',{read:{pages},extraction:previous});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'review',factKey:'document.manual-check.v1',value:{type:'synthetic'},disposition:'confirmed',reason:'synthetic'},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'native-pdf-4:rules-native-31');
  if(priorKind==='property')assert.equal(cached.extraction.id,old.extraction.id);
  else{
   assert.equal(cached,null);
   const updated=await repo.storeExtraction(old.document,'native-pdf-4:rules-native-31',{read:{pages},extraction:current});
   assert.notEqual(updated.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,updated.extraction.id,1)).length,0);
  }
  assert.equal((await repo.currentReviews(c.id,old.document.id,old.extraction.id,1))[0].id,review.id);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,1);
 }
});

test('v31 reclassifies loan-account evidence and does not transfer approval from a misleading Kaspi result',async()=>{
 const {repo}=setup(),c=await repo.syncCase(client());
 const text='ВЫПИСКА\nпо кредитам за период с 01.09.25 по 31.08.26\n01.01.26 +10,00 т Поступление С Kaspi Gold';
 const pages=[{page:1,text,nativeCharacters:text.length,needsOcr:false}];
 for(const priorKind of ['kaspi','unknown']){
  const old=await repo.store(c.id,new Uint8Array([priorKind==='kaspi'?221:222]),'synthetic.pdf',actor,'native-pdf-4:rules-native-30',{read:{pages},extraction:{version:'rules-native-30',kind:priorKind,identity:{iin:null,name:null},issuedAt:null,facts:[],credits:[],findings:['DOCUMENT_IDENTITY_UNVERIFIED','DOCUMENT_TYPE_UNVERIFIED']}});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'review-'+priorKind,factKey:'document.manual-check.v1',value:{type:'synthetic'},disposition:'confirmed',reason:'synthetic'},actor);
  assert.equal(await repo.cached(c.id,old.document.original_sha256,'native-pdf-4:rules-native-31'),null);
  assert.equal((await repo.currentReviews(c.id,old.document.id,old.extraction.id,1))[0].id,review.id);
 }
});
test('v23 refreshes newly supported native layouts but preserves unrelated evidence and approvals',async()=>{
 const {repo,sqlite}=setup(),c=await repo.syncCase(client());
 const pension='Сведения об остатках и о движении денег на счете\nУсловный пенсионный счет\nВыписка с индивидуального пенсионного счета';
 const rights='о зарегистрированных правах (обременениях)\nна недвижимое имущество и его технических характеристиках';
 for(const [index,kind,text,compatible] of [[91,'unknown',pension,false],[92,'kaspi',pension,false],[93,'unknown',rights,false],[94,'gkb_full','Полный отчет',true],[95,'enpf','Старая поддерживаемая форма ЕНПФ',true],[96,'property','Ф6',true],[97,'unknown','Несвязанный документ',true]]){
  const old=await repo.store(c.id,new Uint8Array([index]),'synthetic.pdf',actor,'pdf-test:rules-native-22',{read:{pages:[{text}]},extraction:{kind}});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'v23-'+index,factKey:'synthetic',value:'saved fact',disposition:'confirmed',reason:''},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'pdf-test:rules-native-23');assert.equal(Boolean(cached),compatible);
  if(compatible){assert.equal(cached.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,cached.extraction.id,1))[0].id,review.id);}
  assert.ok(await repo.extraction(c.id,old.document.id,old.extraction.id));assert.equal(await repo.cached(c.id,old.document.original_sha256,'different-reader:rules-native-23'),null);
 }
 assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,7);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_extractions').get().n,7);
});
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
test('Kazakh Kaspi update invalidates only affected v18 analyses and preserves unrelated review identities',async()=>{
 const {repo}=setup(),c=await repo.syncCase(client());
 for(const [index,kind,text,compatible] of [[1,'gkb_full','Персональный кредитный отчет',true],[2,'kaspi','Kaspi ВЫПИСКА',true],[3,'unknown','«Kaspi Bank» АҚ ҮЗІНДІ КӨШІРМЕ',false],[4,'identity','Удостоверение личности',true]]){
  const a=await repo.store(c.id,new Uint8Array([index]),'synthetic.pdf',actor,'pdf-test:rules-native-18',{read:{pages:[{text}]},extraction:{kind}});
  const cached=await repo.cached(c.id,a.document.original_sha256,'pdf-test:rules-native-19');assert.equal(Boolean(cached),compatible);if(compatible)assert.equal(cached.extraction.id,a.extraction.id);
  assert.equal(await repo.cached(c.id,a.document.original_sha256,'pdf-different:rules-native-19'),null);
  assert.ok(await repo.cached(c.id,a.document.original_sha256,'pdf-test:rules-native-18'));
 }
});
test('v20 keeps current Kaspi evidence and preserves employee ID reviews while refreshing unreviewed layouts',async()=>{
 const {repo}=setup(),c=await repo.syncCase(client());
 const kaspi=await repo.store(c.id,new Uint8Array([51]),'statement.pdf',actor,'pdf-test:rules-native-19',{read:{pages:[{text:'Kaspi ҮЗІНДІ КӨШІРМЕ'}]},extraction:{kind:'kaspi'}});
 assert.equal((await repo.cached(c.id,kaspi.document.original_sha256,'pdf-test:rules-native-20')).extraction.id,kaspi.extraction.id);
 const old=await repo.store(c.id,new Uint8Array([52]),'card.pdf',actor,'pdf-test:rules-native-18',{read:{pages:[{text:'991231300003\n123456789\n17.12.2024 - 16.12.2034\nTESTOV<<SYNAQ<<<<<<<<<<<<'}]},extraction:{kind:'unknown'}});
 const read=()=>repo.cached(c.id,old.document.original_sha256,'pdf-test:rules-native-20');
 assert.equal(await read(),null);
 const base={caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,factKey:'document.manual-check.v1',value:{type:'Удостоверение личности'},disposition:'confirmed',reason:'Synthetic inspection'};
 await repo.appendReview({...base,requestId:'id-confirmed'},actor);
 assert.equal((await read()).extraction.id,old.extraction.id);
 await repo.appendReview({...base,requestId:'id-unresolved',disposition:'unresolved'},actor);assert.equal(await read(),null);
 await repo.appendReview({...base,requestId:'id-confirmed-again'},actor);
 await repo.syncCase(client('11665','different-identity'));assert.equal(await read(),null);
});

test('v21 refreshes bank statements misidentified by transfer recipients without invalidating unrelated reviews',async()=>{
 const {repo}=setup(),c=await repo.syncCase(client());
 const bank='АО "Евразийский Банк"\nwww.eubank.kz БИК EURIKZKA\nВыписка по счёту\nПеревод Kaspi';
 for(const [index,kind,text,compatible] of [[61,'kaspi',bank,false],[62,'unknown',bank,false],[63,'gkb_full','Персональный кредитный отчет',true],[64,'kaspi','Kaspi ВЫПИСКА',true],[65,'salary',bank,true],[66,'kaspi','Народный банк Казахстана\nВыписка по счету\nТип счета: Зарплата\nПеревод Kaspi',false]]){
  const old=await repo.store(c.id,new Uint8Array([index]),'synthetic.pdf',actor,'pdf-test:rules-native-20',{read:{pages:[{text}]},extraction:{kind}});
  const cached=await repo.cached(c.id,old.document.original_sha256,'pdf-test:rules-native-21');assert.equal(Boolean(cached),compatible);if(compatible)assert.equal(cached.extraction.id,old.extraction.id);
  assert.ok(await repo.cached(c.id,old.document.original_sha256,'pdf-test:rules-native-20'),'original evidence is retained');
  assert.equal(await repo.cached(c.id,old.document.original_sha256,'different-reader:rules-native-21'),null);
 }
});

test('v22 preserves unaffected evidence and review IDs, but refreshes Latin short-report lenders',async()=>{
 const {repo,sqlite}=setup(),c=await repo.syncCase(client());
 for(const [index,kind,text,layoutText,compatible] of [
  [71,'gkb_short','АО Банк\nТОО Ломбард','',true],
  [72,'gkb_short','AO Bank','',false],
  [73,'gkb_short','text','TOO Lender',false],
  [74,'gkb_full','TOO Lender','',true],
  [75,'identity','identity card','',true],
  [76,'salary','salary bank','',true],
  [77,'kaspi','Kaspi ВЫПИСКА','',true],
  [78,'power_of_attorney','power','',true],
 ]){
  const old=await repo.store(c.id,new Uint8Array([index]),'synthetic.pdf',actor,'pdf-test:rules-native-21',{read:{pages:[{text,layoutText}]},extraction:{kind}});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'v22-'+index,factKey:'synthetic',value:'confirmed fact',disposition:'confirmed',reason:''},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'pdf-test:rules-native-22');
  assert.equal(Boolean(cached),compatible);
  if(compatible){assert.equal(cached.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,cached.extraction.id,1))[0].id,review.id);}
  assert.ok(await repo.extraction(c.id,old.document.id,old.extraction.id));
  assert.equal(await repo.cached(c.id,old.document.original_sha256,'different-reader:rules-native-22'),null);
 }
 assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_extractions').get().n,8);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,8);
});

test('v22 retains older compatibility exclusions and prefers a new extraction when present',async()=>{
 const {repo}=setup(),c=await repo.syncCase(client());
 const wrong=await repo.store(c.id,new Uint8Array([81]),'bank.pdf',actor,'pdf-test:rules-native-20',{read:{pages:[{text:'АО "Евразийский Банк"\nwww.eubank.kz БИК EURIKZKA\nВыписка по счёту\nПеревод Kaspi'}]},extraction:{kind:'kaspi'}});
 assert.equal(await repo.cached(c.id,wrong.document.original_sha256,'pdf-test:rules-native-22'),null);
 const old=await repo.store(c.id,new Uint8Array([82]),'short.pdf',actor,'pdf-test:rules-native-21',{read:{pages:[{text:'АО Банк'}]},extraction:{kind:'gkb_short'}});
 const current=await repo.store(c.id,new Uint8Array([82]),'short.pdf',actor,'pdf-test:rules-native-22',{read:{pages:[{text:'АО Банк'}]},extraction:{kind:'gkb_short'}});
 assert.equal((await repo.cached(c.id,old.document.original_sha256,'pdf-test:rules-native-22')).extraction.id,current.extraction.id);
 assert.notEqual(old.extraction.id,current.extraction.id);
});

test('inbound reuse requires the same case, identity revision and exact origin hash and size',async()=>{
 const {repo,sqlite}=setup(),c=await repo.syncCase(client()),other=await repo.syncCase(client('11666')),d=await repo.store(c.id,new Uint8Array([9,8,7]),'synthetic.pdf',actor,'v1',{});
 const base={caseId:c.id,documentId:d.document.id,extractionId:d.extraction.id,identityRevision:1,factKey:'document.origin.bitrix.v1',disposition:'confirmed',reason:'synthetic'};
 const value={system:'bitrix',fileId:'123',sha256:d.document.original_sha256,byteSize:3};
 await repo.appendReview({...base,requestId:'origin-1',value},actor);assert.equal((await repo.importedDocument(c,'123')).id,d.document.id);assert.equal(await repo.importedDocument(other,'123'),null);assert.equal(await repo.importedDocument(c,'124'),null);assert.equal(await repo.importedDocument({...c,identity_revision:2},'123'),null);
 for(const [index,change]of [{byteSize:4},{sha256:'wrong'},{system:'other'}].entries()){await repo.appendReview({...base,requestId:'invalid-'+index,value:{...value,...change}},actor);assert.equal(await repo.importedDocument(c,'123'),null);}
 await repo.appendReview({...base,requestId:'withdrawn',value,disposition:'unresolved'},actor);assert.equal(await repo.importedDocument(c,'123'),null);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);
});
test('v24 preserves unchanged extraction/review IDs and stores improved rules without re-uploading the PDF',async()=>{
 const {repo,sqlite}=setup(),c=await repo.syncCase(client()),pages=[{page:1,text:'Персональный кредитный отчет\nИИН: 991231300003\nДействующие обязательства: (0)\nСтраница 1 из 1',needsOcr:false,nativeCharacters:200}],compiled=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,rulesModule={exports:{}};vm.runInNewContext(compiled,{module:rulesModule,exports:rulesModule.exports});
 const extraction=rulesModule.exports.extractNative(pages),old=await repo.store(c.id,new Uint8Array([81]),'synthetic.pdf',actor,'native-pdf-3:rules-native-23',{read:{pages},extraction:{...extraction,version:'rules-native-23'}});
 const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'unchanged',factKey:'identity.iin',value:'991231300003',disposition:'confirmed',reason:''},actor);
 const cached=await repo.cached(c.id,old.document.original_sha256,'native-pdf-3:rules-native-25');assert.equal(cached.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,cached.extraction.id,1))[0].id,review.id);
 assert.equal(await repo.previousAnalysis(old.document,'different-reader'),null);assert.equal((await repo.previousAnalysis(old.document,'native-pdf-3')).extraction.id,old.extraction.id);
 const updated=await repo.storeExtraction(old.document,'native-pdf-3:rules-native-24',{read:{pages},extraction});assert.equal(updated.document.id,old.document.id);assert.notEqual(updated.extraction.id,old.extraction.id);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_reviews').get().n,1);
});

test('v26 compares non-GKB facts and retains unchanged review IDs instead of reusing stale ID and benefit results',async()=>{
 const compiledRules=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,rulesModule={exports:{}};vm.runInNewContext(compiledRules,{module:rulesModule,exports:rulesModule.exports,Date,JSON});
 for(const changed of [false,true]){
  const {repo,sqlite}=setup(),c=await repo.syncCase(client());
  const text='ТЕСТОВА\nСЫНАҚ\n31.12.1999 Ж\n991231300003\n123456789\n01.01.2025 - 31.12.2034\nTESTOVA<<SYNAQ<<<<<<<<<<<<';
  const pages=[{page:1,text,nativeCharacters:text.length,needsOcr:false}],current=rulesModule.exports.extractNative(pages);
  const previous=changed?{...current,kind:'unknown',identity:{iin:null,name:null},facts:[],issuedAt:null}:current;
  const old=await repo.store(c.id,new Uint8Array([90]),'synthetic.pdf',actor,'native-pdf-3:rules-native-25',{read:{pages},extraction:{...previous,version:'rules-native-25'}});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'review',factKey:'document.manual-check.v1',value:{type:'Удостоверение личности'},disposition:'confirmed',reason:'synthetic'},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'native-pdf-3:rules-native-26');
  if(changed){
   assert.equal(cached,null);const updated=await repo.storeExtraction(old.document,'native-pdf-3:rules-native-26',{read:{pages},extraction:current});assert.notEqual(updated.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,updated.extraction.id,1)).length,0);
  }else assert.equal(cached.extraction.id,old.extraction.id);
  assert.equal((await repo.currentReviews(c.id,old.document.id,old.extraction.id,1))[0].id,review.id);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);assert.ok(await repo.cached(c.id,old.document.original_sha256,'native-pdf-3:rules-native-25'));
 }
});

test('v27 keeps unchanged v26 evidence but reprocesses a newly readable joint borrower without inheriting approval',async()=>{
 const compiledRules=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,rulesModule={exports:{}};vm.runInNewContext(compiledRules,{module:rulesModule,exports:rulesModule.exports,Date,JSON});
 for(const scenario of ['unchanged-credit','changed-credit','unchanged-other']){
  const {repo,sqlite}=setup(),c=await repo.syncCase(client());
  const text=scenario==='unchanged-other'?'Информация о пенсионных выплатах и пособиях\nЖСН/ИИН 991231300003\nДата получения: 15.09.2026':'Персональный кредитный отчет\nИИН: 991231300003\nОбязательство 1\nРоль субъекта: Заемщик\nКредитор: TEST BANK\nФаза контракта: Действующий\nНомер договора: TEST-1\nСвязанные субъекты\nСозаемщик\n(присоединившееся лицо) с солидарными обязательствами\nТЕСТОВ ТЕСТ ТЕСТОВИЧ\n991231300003 Удостоверение личности 123456789\nСтраница 1 из 1';
  const pages=[{page:1,text,nativeCharacters:text.length,needsOcr:false}],current=rulesModule.exports.extractNative(pages),previous=JSON.parse(JSON.stringify(current));previous.version='rules-native-26';
  if(scenario==='changed-credit')previous.credits[0].facts=previous.credits[0].facts.filter(f=>f.key!=='relatedParties');
  const old=await repo.store(c.id,new Uint8Array([91]),'synthetic.pdf',actor,'native-pdf-3:rules-native-26',{read:{pages},extraction:previous});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'review',factKey:'document.manual-check.v1',value:{type:'synthetic'},disposition:'confirmed',reason:'synthetic'},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'native-pdf-3:rules-native-27');
  if(scenario==='changed-credit'){
   assert.equal(cached,null);const updated=await repo.storeExtraction(old.document,'native-pdf-3:rules-native-27',{read:{pages},extraction:current});assert.notEqual(updated.extraction.id,old.extraction.id);assert.equal((await repo.currentReviews(c.id,old.document.id,updated.extraction.id,1)).length,0);
  }else assert.equal(cached.extraction.id,old.extraction.id);
  assert.equal((await repo.currentReviews(c.id,old.document.id,old.extraction.id,1))[0].id,review.id);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);assert.equal((await repo.cached(c.id,old.document.original_sha256,'native-pdf-3:rules-native-26')).extraction.id,old.extraction.id);
 }
});

test('v28 preserves unchanged evidence and old approvals while refreshing legacy short contract IDs',async()=>{
 const compiled=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,compiledModule={exports:{}};vm.runInNewContext(compiled,{module:compiledModule,exports:compiledModule.exports,Date,JSON});
 for(const changed of [false,true]){
  const {repo,sqlite}=setup(),c=await repo.syncCase(client());
  const text='Персональный кредитный отчет (краткая форма)\nИИН: 991231300003\nДействующие обязательства: 1\nОбщая сумма задолженности/валюта: 100.00 KZT\nАО "Тест"   000123   100.00 KZT   0   Нет данных   Нет данных\nСтраница 1 из 1';
  const pages=[{page:1,text,nativeCharacters:text.length,needsOcr:false}],current=compiledModule.exports.extractNative(pages),previous=JSON.parse(JSON.stringify(current));previous.version='rules-native-27';
  if(changed)previous.credits[0].facts=previous.credits[0].facts.filter(f=>f.key!=='contractIdentifier');
  const old=await repo.store(c.id,new Uint8Array([93]),'synthetic.pdf',actor,'native-pdf-3:rules-native-27',{read:{pages},extraction:previous});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'review',factKey:'credits.0.debtOutstanding',value:'100.00',disposition:'confirmed',reason:'synthetic'},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'native-pdf-3:rules-native-28');
  if(changed)assert.equal(cached,null);else assert.equal(cached.extraction.id,old.extraction.id);
  assert.equal((await repo.currentReviews(c.id,old.document.id,old.extraction.id,1))[0].id,review.id);assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_documents').get().n,1);
 }
});


test('reader v5 rereads only sparse closing-disclaimer candidates and preserves all historical reviews',async()=>{
 const header='ВЫПИСКА по Kaspi Gold за период с 01.09.25 по 31.08.26 Краткое содержание операций по карте:';
 const prefix='Раздел «Краткое содержание операций по карте», в строках «Поступления со своих счетов», «Зачисления кредитов», «Переводы на свои';
 const tail='АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz счета» содержит информацию об операциях клиента между счетами в Kaspi.';
 for(const [index,kind,lastText,needsOcr,compatible] of [[221,'kaspi',tail,true,false],[222,'kaspi',tail,false,true],[223,'kaspi','Скан страницы с нечитаемыми операциями',true,true],[224,'identity','Удостоверение личности',true,true],[225,'gkb_full','Персональный кредитный отчет',false,true]]){
  const {repo,sqlite}=setup(),c=await repo.syncCase(client()),pages=[{page:1,text:kind==='kaspi'?header:'Other original',needsOcr:false},{page:2,text:prefix,needsOcr:false},{page:3,text:lastText,needsOcr}];
  const old=await repo.store(c.id,new Uint8Array([index]),'synthetic.pdf',actor,'native-pdf-4:rules-native-31',{read:{pages},extraction:{kind}});
  const review=await repo.appendReview({caseId:c.id,documentId:old.document.id,extractionId:old.extraction.id,identityRevision:1,requestId:'reader5-'+index,factKey:'synthetic',value:'saved fact',disposition:'confirmed',reason:''},actor);
  const cached=await repo.cached(c.id,old.document.original_sha256,'native-pdf-5:rules-native-31');assert.equal(Boolean(cached),compatible);
  if(compatible)assert.equal(cached.extraction.id,old.extraction.id);
  assert.equal((await repo.currentReviews(c.id,old.document.id,old.extraction.id,1))[0].id,review.id);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_extractions').get().n,1);
  assert.deepEqual(await repo.original(old.document),new Uint8Array([index]));
 }
});
