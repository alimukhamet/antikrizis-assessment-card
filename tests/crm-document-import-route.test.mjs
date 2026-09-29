import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
class RepositoryError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
function setup(options={}){
 const stats={downloads:0,stores:0,receipts:0,readPdf:0},client={iin:'991231300003',external:{dealId:'8595'}},record={id:'case',identity_revision:1},document={id:'doc',original_sha256:'hash',byte_size:3,original_name:'synthetic.pdf'};
 const repository={importedDocument:async()=>options.missing?null:document,findCaseByExternal:async()=>record,syncCase:async()=>options.changed?{...record,identity_revision:2}:record,cached:async()=>({document,extraction:{id:'extraction'},result:{read:{pages:[]},extraction:{credits:[]}}}),store:async()=>{stats.stores++;throw Error('Must not store');},appendReview:async()=>{stats.receipts++;throw Error('Must not append a receipt');}};
 const imports={
 '../../../staff-access':{requireStaffRequest:async()=>options.denied?Response.json({error:'SIGN_IN_REQUIRED'},{status:401}):null},
 '../../../../../lib/documents/request-context':{boundedJson:r=>r.json(),evidenceContext:async()=>({client,record,repository,actor:{worker:options.worker||'ali'}}),evidenceError:e=>Response.json({error:e.code},{status:e.status||500})},
 '../../../../../lib/crm/client-directory':{dealDocumentReferences:async()=>[{id:'94851'}]},
 '../../../../../lib/crm/document-download':{createCrmDocumentReader:()=>async()=>{stats.downloads++;return new Uint8Array([1,2,3]);}},
 '../../../../../lib/crm/document-upload':{DocumentUploadError:class extends Error{}},
 '../../../../../lib/documents/read-pdf':{DocumentReadError:class extends Error{},readPdf:async()=>{stats.readPdf++;throw Error('Already cached');}},
 '../../../../../lib/documents/extract-native':{extractNative:()=>{throw Error('Already cached');}},
 '../../../../../lib/documents/analysis-service':{analysisVersion:'test',storedAnalysis:async()=>({documentId:'doc',cacheHit:true}),analysisResponse:async()=>({})},
 '../../../../../lib/documents/repository':{RepositoryError,sha256:async()=>options.badHash?'wrong':'hash'},
 '../../../../../lib/crm/bitrix':{readClientContext:async()=>options.wrongClient?{...client,iin:'000000000010'}:client}
 };
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assessment/[dealId]/crm-documents/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{assert.ok(n in imports,n);return imports[n];},Response,Date,process:{env:{}},fetch:()=>{throw Error('Unexpected network')}});
 return{stats,run:(body={})=>exports.POST(new Request('https://synthetic.invalid/api/assessment/8595/crm-documents',{method:'POST',body:JSON.stringify({fileId:'94851',identityRevision:1,...body})}),{params:Promise.resolve({dealId:'8595'})})};
}
test('ordinary repeated CRM intake returns existing analysis without another PDF transfer',async()=>{const s=setup(),r=await s.run();assert.equal(r.status,200);assert.equal((await r.json()).cacheHit,true);assert.deepEqual(s.stats,{downloads:0,stores:0,receipts:0,readPdf:0});});
test('owner byte verification measures a real download without changing originals or origin receipts',async()=>{const s=setup(),r=await s.run({verifyOriginal:true});assert.equal(r.status,200);const result=await r.json();assert.equal(result.downloadVerification.verified,true);assert.equal(result.downloadVerification.byteSize,3);assert.deepEqual(s.stats,{downloads:1,stores:0,receipts:0,readPdf:0});});
test('download diagnostics reject unauthorized, changed, wrong-client or different-byte sources',async()=>{
 for(const option of [{denied:true},{worker:'darkhan'},{missing:true},{changed:true},{wrongClient:true},{badHash:true}]){const s=setup(option),r=await s.run({verifyOriginal:true});assert.ok(r.status>=400,JSON.stringify(option));assert.equal(s.stats.stores+s.stats.receipts,0);if(option.denied||option.worker||option.missing)assert.equal(s.stats.downloads,0);}
});
