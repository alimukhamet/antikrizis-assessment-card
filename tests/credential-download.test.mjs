import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {webcrypto} from 'node:crypto';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],crypto:webcrypto,TextEncoder,Uint8Array});return exports;}
const repo=load('lib/documents/repository.ts'),{downloadCredential}=load('lib/documents/credential-download.ts',{'./repository':repo,'./credential-plan':{MAX_CREDENTIAL_BYTES:2*1024*1024}});
test('credential migration requires scoped verified receipt and exact bytes; filename omits password',async()=>{
 const bytes=new Uint8Array([1,2,3]),sha=await repo.sha256(bytes),id='00000000-0000-0000-0000-000000000001';let reads=0;
 const row={identity_revision:1,state:'verified',manifest_json:JSON.stringify({scope:'credentials',credentialOwnerConfirmed:true,files:[{sha256:sha,byteSize:3,name:'26 ЭЦП пароль SECRET.p12'}]}),receipt_json:JSON.stringify({verified:true,files:[{id:'22',sha256:sha}]})};
 const manifests={get:async(caseId,requestId)=>{assert.equal(caseId,'case');assert.equal(requestId,id);return row;}},record={id:'case',identity_revision:1};
 const read=async ref=>{reads++;assert.equal(ref.id,'22');return bytes;};
 const result=await downloadCredential(manifests,record,id,'22',read);assert.equal(result.sha256,sha);assert.equal(result.filename,'credential-22.p12');
 for(const change of [{state:'uncertain'},{identity_revision:2},{manifest_json:JSON.stringify({scope:'documents'})}]){const old={...row};Object.assign(row,change);await assert.rejects(downloadCredential(manifests,record,id,'22',read));Object.assign(row,old);}
 await assert.rejects(downloadCredential(manifests,record,id,'23',read),/CREDENTIAL_NOT_IN_RECEIPT/);assert.equal(reads,1);
 await assert.rejects(downloadCredential(manifests,record,id,'22',async()=>new Uint8Array([9,9,9])),/CREDENTIAL_CONTENT_CHANGED/);
});
