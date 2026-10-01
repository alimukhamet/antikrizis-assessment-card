import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import{webcrypto}from'node:crypto';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],crypto:webcrypto,TextEncoder,Uint8Array,Set});return exports;}
const repository=load('lib/documents/repository.ts'),{documentUploadPlan,uploadBatchId,MAX_UPLOAD_BATCH}=load('lib/documents/upload-plan.ts',{'./repository':repository});
const record={id:'case',external_id:'11665'},payload={answers:[{key:'fio',value:'ТЕСТОВ ИВАН ИВАНОВИЧ'}],documents:[{documentId:'a',type:'ГКБ — полный отчёт',person:'Клиент'},{documentId:'b',type:'ГКБ — полный отчёт',person:'Клиент'}]};
const repo={document:async(c,id)=>({id,original_name:'synthetic.PDF',original_sha256:id.repeat(64),byte_size:20*1024*1024})};
test('canonical filenames and part numbers survive batching with stable plan hash',async()=>{const plan=await documentUploadPlan(repo,record,payload);assert.equal(plan.batches.length,2);assert.equal(plan.batches[0][0].name,'08 Клиент - ГКБ полный - ТЕСТОВ И - 1.pdf');assert.equal(plan.batches[1][0].name,'08 Клиент - ГКБ полный - ТЕСТОВ И - 2.pdf');assert.equal(plan.planHash,(await documentUploadPlan(repo,record,payload)).planHash);for(const b of plan.batches)assert.ok(b.reduce((n,f)=>n+f.byteSize,0)<=MAX_UPLOAD_BATCH);});
test('credential, wrong-owner, duplicate and oversized documents cannot enter regular upload',async()=>{for(const documents of [[{...payload.documents[0],type:'ЭЦП файл'}],[{...payload.documents[0],person:'Супруг'}],[payload.documents[0],payload.documents[0]]])await assert.rejects(documentUploadPlan(repo,record,{...payload,documents}),/INVALID_UPLOAD_SELECTION/);await assert.rejects(documentUploadPlan({document:async()=>({id:'a',original_name:'a.pdf',original_sha256:'a'.repeat(64),byte_size:MAX_UPLOAD_BATCH+1})},record,{...payload,documents:[payload.documents[0]]}),/INVALID_UPLOAD_FILE/);});
test('batch operation IDs are deterministic and isolated across root requests',async()=>{const root='00000000-0000-0000-0000-000000000001';assert.equal(await uploadBatchId(root,0),await uploadBatchId(root,0));assert.notEqual(await uploadBatchId(root,0),await uploadBatchId(root,1));await assert.rejects(uploadBatchId(root,-1),/INVALID_UPLOAD_REQUEST/);});
test('the eight-file contract package retains the inspected encumbrance original',async()=>{
 const types=['Справка ЕНПФ','Ф6 об отсутствии имущества','Сведения об обременениях','ГКБ — краткий отчёт','ГКБ — полный отчёт','Выписка Kaspi Gold','Удостоверение личности','Справка по выплатам пенсии и пособий'];
 const documents=types.map((type,index)=>({documentId:String(index),type,person:'Клиент'}));
 const originals={document:async(c,id)=>({id,original_name:'synthetic.PDF',original_sha256:id.repeat(64),byte_size:1234})};
 const plan=await documentUploadPlan(originals,record,{...payload,documents});
 assert.equal(plan.batches.length,1);assert.equal(plan.batches[0].length,8);
 assert.equal(plan.batches[0][2].name,'29 Сведения об обременениях - ТЕСТОВ И.pdf');
 for(const [index,file] of plan.batches[0].entries()){assert.equal(file.documentId,String(index));assert.equal(file.sha256,String(index).repeat(64));assert.equal(file.byteSize,1234);}
});
test('every manually inspectable contract type has an upload path',async()=>{
 const {MANUAL_DOCUMENT_TYPES}=load('lib/documents/document-review.ts');
 for(const type of Object.keys(MANUAL_DOCUMENT_TYPES).filter(type=>type!=='Доверенность')){
  const plan=await documentUploadPlan(repo,record,{...payload,documents:[{documentId:'a',type,person:'Клиент'}]});
  assert.equal(plan.batches[0][0].documentId,'a',type);
 }
});
