import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import {createHash,webcrypto} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
function bundle(file){const out=buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,mod={exports:{}};vm.runInNewContext(out,{module:mod,exports:mod.exports,crypto:webcrypto,Uint8Array,Uint32Array,DataView,TextEncoder,Date,JSON});return mod.exports;}
const image=bundle('lib/documents/read-image.ts'),{EvidenceRepository}=bundle('lib/documents/repository.ts');
const jpeg=Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAUAB4DASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgAAAAAAA//9k=','base64'));
function crc32(data){let v=0xffffffff;for(const b of data){v^=b;for(let i=0;i<8;i++)v=v&1?0xedb88320^(v>>>1):v>>>1;}return(v^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name),result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);type.copy(result,4);data.copy(result,8);result.writeUInt32BE(crc32(Buffer.concat([type,data])),8+data.length);return result;}
function png(width=2,height=3,extra=[]){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;return Uint8Array.from(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...extra,chunk('IDAT',deflateSync(Buffer.alloc(27))),chunk('IEND',Buffer.alloc(0))]));}
const digest=data=>createHash('sha256').update(data).digest('hex');

test('PNG and JPEG remain the exact originals with one explicitly unverified OCR page',async()=>{
 for(const [bytes,format,width,height] of [[png(),'image/png',2,3],[jpeg,'image/jpeg',30,20]]){
  const before=Uint8Array.from(bytes),read=await image.readImage(bytes);
  assert.equal(read.format,format);assert.equal(read.width,width);assert.equal(read.height,height);assert.equal(read.readerVersion,'native-image-1');
  assert.equal(read.originalSha256,digest(bytes));assert.equal(read.pdfSha256,digest(bytes));assert.equal(read.totalPages,1);assert.equal(read.signature,'not_checked');
  assert.equal(read.pages[0].text,'');assert.equal(read.pages[0].needsOcr,true);assert.deepEqual(bytes,before);
 }
});
test('image framing rejects HTML/disguised data, corrupt CRCs, truncated files, animation and allocation bombs',async()=>{
 const badCrc=png();badCrc[45]^=1;
 for(const bytes of [new TextEncoder().encode('<html>login</html>'),badCrc,png().slice(0,-1),jpeg.slice(0,-2),new Uint8Array([255,216,255,217]),png(2,3,[chunk('acTL',Buffer.alloc(8))])])await assert.rejects(image.readImage(bytes));
 for(const bytes of [png(25001,1),png(6000,6000)])await assert.rejects(image.readImage(bytes),error=>error.code==='IMAGE_DIMENSIONS_TOO_LARGE'&&error.status===413);
 await assert.rejects(image.readImage(new Uint8Array(35*1024*1024+1)),error=>error.code==='FILE_TOO_LARGE');
});
function setup(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const name of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 const db={prepare(sql){return{bind(...args){const q=sqlite.prepare(sql);return{async run(){q.run(...args);return{success:true};},async first(){return q.get(...args)||null;},async all(){return{results:q.all(...args)};}};}};}};
 const objects=new Map(),metadata=new Map(),files={async put(key,value,options){objects.set(key,Buffer.from(value));metadata.set(key,options);},async get(key){const b=objects.get(key);return b?{text:async()=>b.toString(),arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;}};
 return{repo:new EvidenceRepository(db,files),metadata,sqlite};}
const actor={id:'synthetic-worker',authentication:'test'};
test('image storage preserves MIME and bytes; global PDF-version callers resolve the same image review',async()=>{
 const {repo,metadata,sqlite}=setup(),record=await repo.syncCase({external:{system:'test',dealId:'1'},iin:'test',title:'SYNTHETIC'});
 for(const [bytes,extension,mime] of [[png(),'png','image/png'],[jpeg,'jpg','image/jpeg']]){
  const read=await image.readImage(bytes),stored=await repo.store(record.id,bytes,'original.'+extension,actor,'native-pdf-3:rules-native-27',{read,extraction:{kind:'unknown',findings:['OCR_REQUIRED']}});
  assert.ok(stored.document.original_key.endsWith('.'+extension));assert.equal(metadata.get(stored.document.original_key).httpMetadata.contentType,mime);assert.deepEqual(await repo.original(stored.document),bytes);assert.equal(stored.extraction.version,'native-image-1:rules-native-27');
  const review=await repo.appendReview({caseId:record.id,documentId:stored.document.id,extractionId:stored.extraction.id,identityRevision:1,requestId:'review-'+extension,factKey:'document.manual-check.v1',value:{test:true},disposition:'confirmed',reason:'synthetic'},actor);
  for(const version of ['native-pdf-3:rules-native-27','native-image-1:rules-native-27']){const cached=await repo.cached(record.id,stored.document.original_sha256,version);assert.equal(cached.extraction.id,stored.extraction.id);assert.equal((await repo.currentReviews(record.id,stored.document.id,cached.extraction.id,1))[0].id,review.id);}
 }
 const pdf=await repo.store(record.id,new TextEncoder().encode('%PDF-synthetic'),'original.pdf',actor,'native-pdf-3:rules-native-27',{});assert.ok(pdf.document.original_key.endsWith('.pdf'));assert.equal(pdf.extraction.version,'native-pdf-3:rules-native-27');assert.equal(metadata.get(pdf.document.original_key).httpMetadata.contentType,'application/pdf');
 assert.equal(sqlite.prepare('SELECT count(*) n FROM assessment_extractions').get().n,3);
});
test('original view serves exact image bytes and MIME behind the existing case authorization',async()=>{
 const bytes=png(),exports={},imports={
 '../../../../staff-access':{requireStaffRequest:async()=>null},
 '../../../../../../lib/documents/request-context':{evidenceContext:async()=>({record:{id:'case'},repository:{document:async(c,id)=>id==='mine'?{original_name:'original.png'}:null,original:async()=>bytes}}),evidenceError:e=>Response.json({error:e.code},{status:e.status||500})},
 '../../../../../../lib/documents/repository':{RepositoryError:class extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}},
 '../../../../../../lib/documents/read-image':image,
 '../../../../../../lib/documents/read-document':{previewDocument:data=>({bytes:data,format:image.inspectImage(data).format})},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assessment/[dealId]/documents/[documentId]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name],URL,Response,Uint8Array});
 for(const suffix of ['','?view=pdf']){const response=await exports.GET(new Request('https://example.invalid/api/source'+suffix),{params:Promise.resolve({dealId:'1',documentId:'mine'})});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);}
 const denied=await exports.GET(new Request('https://example.invalid/api/source?view=pdf'),{params:Promise.resolve({dealId:'1',documentId:'foreign'})});assert.equal(denied.status,404);
});

test('format-aware dispatch leaves PDF results untouched and validates images before analysis',async()=>{
 const exports={},pdfResult={readerVersion:'native-pdf-3',originalSha256:'original',pdfSha256:'pdf',pages:[]};let pdfReads=0;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/documents/read-document.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>name==='./read-image'?image:{readPdf:async()=>{pdfReads++;return pdfResult;}}});
 assert.equal(await exports.readDocument(new TextEncoder().encode('%PDF-original')),pdfResult);assert.equal(pdfReads,1);
 const read=await exports.readDocument(png());assert.equal(read.format,'image/png');assert.equal(pdfReads,1);
 await assert.rejects(exports.readDocument(jpeg.slice(0,-2)));assert.equal(pdfReads,1);
});

test('CRM image intake validates the original, stores image reader version and pins the exact inbound bytes',async()=>{
 const bytes=png(),record={id:'case',identity_revision:1},client={iin:'991231300003',external:{dealId:'8595'}},exports={};let stores=0,receipts=0;
 const repository={importedDocument:async()=>null,cached:async(caseId,hash,version)=>{assert.equal(hash,digest(bytes));assert.equal(version,'native-image-1:rules-native-27');return null;},findCaseByExternal:async()=>record,syncCase:async()=>record,
  store:async(caseId,source,name,actor,version,result)=>{stores++;assert.deepEqual(source,bytes);assert.equal(result.read.format,'image/png');assert.equal(result.read.pages[0].needsOcr,true);assert.equal(version,'native-image-1:rules-native-27');return{document:{id:'doc',original_sha256:digest(bytes),byte_size:bytes.length,original_name:name},extraction:{id:'extract'},result};},
  appendReview:async input=>{receipts++;assert.equal(input.value.sha256,digest(bytes));assert.equal(input.value.byteSize,bytes.length);assert.equal(input.value.fileId,'94851');},
 };
 class Failure extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
 const imports={
 '../../../staff-access':{requireStaffRequest:async()=>null},
 '../../../../../lib/documents/request-context':{boundedJson:r=>r.json(),evidenceContext:async()=>({client,record,repository,actor:{worker:'synthetic'}}),evidenceError:e=>Response.json({error:e.code},{status:e.status||500})},
 '../../../../../lib/crm/client-directory':{},
 '../../../../../lib/crm/document-download':{createCrmDocumentReader:(w,d,i,f,options)=>{assert.equal(options.documentsOnly,true);options.onFilename('photo.png');return async()=>bytes;}},
 '../../../../../lib/crm/document-upload':{DocumentUploadError:Failure},
 '../../../../../lib/documents/read-pdf':{DocumentReadError:Failure},
 '../../../../../lib/documents/read-document':{readDocument:image.readImage},
 '../../../../../lib/documents/read-image':image,
 '../../../../../lib/documents/extract-native':{extractNative:pages=>({kind:'unknown',findings:pages[0].needsOcr?['OCR_REQUIRED']:[]})},
 '../../../../../lib/documents/analysis-service':{analysisVersionForFormat:format=>format==='image/png'?'native-image-1:rules-native-27':'native-pdf-3:rules-native-27',analysisResponse:async(c,r,repo,stored)=>({documentId:stored.document.id,document:stored.result.read})},
 '../../../../../lib/documents/repository':{RepositoryError:Failure,sha256:async data=>digest(data)},
 '../../../../../lib/crm/bitrix':{readClientContext:async()=>client},
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assessment/[dealId]/crm-documents/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name],Response,Date,process:{env:{}},fetch:()=>{throw Error('Unexpected network');},crypto:webcrypto});
 const response=await exports.POST(new Request('https://synthetic.invalid/api/assessment/8595/crm-documents',{method:'POST',body:JSON.stringify({fileId:'94851',identityRevision:1})}),{params:Promise.resolve({dealId:'8595'})});
 assert.equal(response.status,200);assert.equal((await response.json()).document.format,'image/png');assert.equal(stores,1);assert.equal(receipts,1);
});

test('existing manual-review service and upload plan accept photo evidence without changing original content',async()=>{
 const {reviewDocument,currentDocumentReview}=bundle('lib/documents/document-review.ts'),{documentUploadPlan}=bundle('lib/documents/upload-plan.ts');
 const {repo}=setup(),record=await repo.syncCase({external:{system:'test',dealId:'1'},iin:'991231300003',title:'SYNTHETIC'}),bytes=png(),read=await image.readImage(bytes);
 const analysis={read,extraction:{kind:'unknown',identity:{iin:null},findings:['OCR_REQUIRED']}};
 const stored=await repo.store(record.id,bytes,'photo.png',actor,'native-image-1:rules-native-27',analysis);
 const raw={type:'Ф6 об отсутствии имущества',iin:record.client_iin,pages:1,complete:true,contentMatches:true,periodChecked:true,reason:'Synthetic complete visual inspection.',issuedAt:'2026-09-30',expiresAt:'',from:'',to:''};
 const review=await reviewDocument(repo,record,stored.document.id,'synthetic_photo_review_1',1,raw,actor,'2026-09-30');
 assert.equal(review.extraction_id,stored.extraction.id);
 const reopened=await currentDocumentReview(repo,record,stored.document.id,stored.extraction.id,analysis,raw.type,'2026-09-30');assert.equal(reopened.id,review.id);
 const plan=await documentUploadPlan(repo,record,{answers:[{key:'fio',value:'Synthetic Person'}],documents:[{type:raw.type,person:'Клиент',documentId:stored.document.id}]});
 assert.ok(plan.batches[0][0].name.endsWith('.png'));assert.equal(plan.batches[0][0].sha256,digest(bytes));assert.equal(plan.batches[0][0].byteSize,bytes.length);assert.deepEqual(await repo.original(stored.document),bytes);
});
