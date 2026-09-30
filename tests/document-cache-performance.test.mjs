import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],Date,Set,Map,JSON});return exports;}
class RepositoryError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
const record={id:'case',identity_revision:3},client={iin:'991231300003',external:{system:'bitrix',dealId:'11665'}},actor={id:'synthetic'};
test('batch cache restore isolates documents, retains errors and uses one supplied client context',async()=>{
 const calls=[],repository={document:async(caseId,id)=>{assert.equal(caseId,'case');return id==='foreign'?null:{id};},findCaseByExternal:async()=>record};
 const {cachedAnalyses}=load('lib/documents/batch-analysis.ts',{'./repository':{RepositoryError},'./analysis-service':{storedAnalysis:async(c,r,repo,doc,a,cacheOnly)=>{calls.push(doc.id);assert.equal(c,client);assert.equal(r,record);assert.equal(a,actor);assert.equal(cacheOnly,true);if(doc.id==='stale')throw new RepositoryError('CACHE_REPROCESS_REQUIRED');return{documentId:doc.id,cacheHit:true};}}});
 const context={record,client,repository,actor},result=await cachedAnalyses({documentIds:['one','foreign','stale','two'],identityRevision:3},context);
 assert.deepEqual(JSON.parse(JSON.stringify(result.results)),[{documentId:'one',analysis:{documentId:'one',cacheHit:true}},{documentId:'foreign',error:'DOCUMENT_NOT_IN_CASE'},{documentId:'stale',error:'CACHE_REPROCESS_REQUIRED'},{documentId:'two',analysis:{documentId:'two',cacheHit:true}}]);assert.deepEqual(calls,['one','stale','two']);
 await assert.rejects(()=>cachedAnalyses({documentIds:['one'],identityRevision:2},context),/CASE_IDENTITY_CHANGED/);
 for(const documentIds of [[],['one','one'],Array.from({length:9},(_,i)=>String(i)),[3]])await assert.rejects(()=>cachedAnalyses({documentIds,identityRevision:3},context),/INVALID_DOCUMENT_IDS/);
 repository.findCaseByExternal=async()=>({...record,identity_revision:4});await assert.rejects(()=>cachedAnalyses({documentIds:['one'],identityRevision:3},context),/CASE_IDENTITY_CHANGED/);
});
test('rule-only updates reuse verified native pages; incompatible reads fall back to the stored original',async()=>{
 for(const variant of ['valid','reader','hash','incomplete','pages']){
  const read={readerVersion:'reader-current',originalSha256:'sha',readAllPhysicalPages:true,pages:[{page:1,text:'synthetic',needsOcr:false}],totalPages:1};
  const saved=structuredClone(read);if(variant==='reader')saved.readerVersion='old';if(variant==='hash')saved.originalSha256='wrong';if(variant==='incomplete')saved.readAllPhysicalPages=false;if(variant==='pages')saved.totalPages=2;
  const document={id:'doc',case_id:'case',original_sha256:'sha'};let originals=0,pdfReads=0,saves=0;
  const repository={cached:async()=>null,previousAnalysis:async(d,version)=>{assert.equal(d,document);assert.equal(version,'reader-current');return{result:{read:saved}};},original:async()=>{originals++;return new Uint8Array([1]);},storeExtraction:async(d,version,result)=>{saves++;assert.equal(d,document);assert.equal(version,'reader-current:rules-new');return{document,extraction:{id:'new'},result};},currentReviews:async()=>[]};
  const {storedAnalysis}=load('lib/documents/analysis-service.ts',{'./repository':{RepositoryError},'./analysis-version':{analysisVersion:'reader-current:rules-new'},'./read-pdf':{PDF_READER_VERSION:'reader-current'},'./read-image':{IMAGE_READER_VERSION:'native-image-1'},'./read-document':{originalDocumentFormat:()=> 'application/pdf',readDocument:async()=>{pdfReads++;return read;}},'./extract-native':{extractNative:()=>({kind:'gkb_full',identity:{iin:client.iin},issuedAt:'2026-09-29',findings:[]})},'./request-context':{operatingDay:()=> '2026-09-29'},'./policy':{gkbFreshness:()=>[],requiresDocumentValidation:()=>false}});
  await assert.rejects(()=>storedAnalysis(client,record,repository,document,actor,true),/CACHE_REPROCESS_REQUIRED/);assert.equal(saves,0);
  const result=await storedAnalysis(client,record,repository,document,actor);assert.equal(result.documentId,'doc');assert.equal(result.extractionId,'new');assert.equal(originals,variant==='valid'?0:1);assert.equal(pdfReads,originals);assert.equal(saves,1);
 }
});
