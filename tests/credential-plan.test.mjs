import {test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import{webcrypto}from'node:crypto';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],crypto:webcrypto,TextEncoder,Uint8Array,Set});return exports;}
const repository=load('lib/documents/repository.ts'),{credentialUploadPlan,MAX_CREDENTIAL_BYTES}=load('lib/documents/credential-plan.ts',{'./repository':repository});
const fixture=()=>({clientName:'ТЕСТОВ ИВАН ИВАНОВИЧ',dealId:'11665',password:'TEST! 123',files:[{name:'synthetic.P12',bytes:new Uint8Array([1,2,3])}]});
test('separate credential plan preserves canonical password filename and stable identity',async()=>{
 const input=fixture(),plan=await credentialUploadPlan(input);assert.equal(plan.files[0].name,'26 ЭЦП - ТЕСТОВ И - пароль TEST 123.p12');assert.equal(plan.planHash,(await credentialUploadPlan(input)).planHash);
 assert.notEqual(plan.planHash,(await credentialUploadPlan({...input,password:'different'})).planHash);
 const multi=await credentialUploadPlan({...input,files:[...input.files,{name:'second.key',bytes:new Uint8Array([4])}]});assert.match(multi.files[0].name,/ - 1 - пароль /);assert.match(multi.files[1].name,/ - 2 - пароль /);
});
test('empty passwords, ordinary PDFs, duplicate keys and oversized credentials are rejected without echoing secrets',async()=>{
 for(const change of [{password:''},{files:[{name:'ordinary.pdf',bytes:new Uint8Array([1])}]},{files:[...fixture().files,...fixture().files]},{files:[{name:'huge.p12',bytes:new Uint8Array(MAX_CREDENTIAL_BYTES+1)}]}])await assert.rejects(credentialUploadPlan({...fixture(),...change}),error=>error instanceof Error? !error.message.includes('TEST!'):!String(error).includes('TEST!'));
});
