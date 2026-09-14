import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {DatabaseSync} from 'node:sqlite';
function load(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],AbortSignal,fetch:()=>{throw Error('Unexpected network')}});return exports;}
const upload=load('lib/crm/document-upload.ts',{'../documents/repository':{}}),directory=load('lib/crm/client-directory.ts',{'./document-upload':upload});
test('recent clients expose a bounded metadata list and only perform a deal-list read',async()=>{
 const calls=[];const rows=await directory.recentDocumentClients('https://crm.example/rest/test/',async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({result:[{ID:'123',TITLE:'SYNTHETIC',DATE_MODIFY:'2026-09-12',UF_CRM_ANK_PRIMARY_DOCS:[{id:1,urlMachine:'SECRET'}],UF_CRM_AI_IIN:'PRIVATE'},{ID:'124',TITLE:'EMPTY',UF_CRM_ANK_PRIMARY_DOCS:[]}]});});
 assert.equal(calls.length,1);assert.match(calls[0].url,/crm.deal.list.json$/);assert.equal(rows.length,1);assert.equal(rows[0].fileCount,1);assert.equal(JSON.stringify(rows).includes('SECRET'),false);assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
});
test('file references are scoped to the selected client and never contain signed URLs',async()=>{
 const response=()=>Response.json({result:{item:{id:'123',ufCrmAiIin:'000000000010',ufCrmAnkPrimaryDocs:[{id:1,urlMachine:'SECRET'}]}}});
 const refs=await directory.dealDocumentReferences('https://crm.example/rest/test/','123','000000000010',response);assert.equal(JSON.stringify(refs),'[{"id":"1"}]');
 await assert.rejects(directory.dealDocumentReferences('https://crm.example/rest/test/','123','000000000020',response),/CASE_IDENTITY_CHANGED/);
 await assert.rejects(directory.dealDocumentReferences('https://crm.example/rest/test/','124','000000000010',response),/DEAL_NOT_FOUND/);
});
test('the draft directory lists each client once using the latest saved version',async()=>{
 const sql=new DatabaseSync(':memory:');for(const file of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+file,'utf8'));
 const db={prepare:query=>({all:async()=>({results:sql.prepare(query).all()})})};
 const {DraftRepository}=load('lib/questionnaire/repository.ts',{'../documents/repository':{}});const repo=new DraftRepository(db);
 sql.exec("INSERT INTO assessment_cases VALUES ('a','bitrix','123',NULL,1,'CLIENT A','2026-09-10','2026-09-10'),('b','bitrix','124',NULL,1,'CLIENT B','2026-09-10','2026-09-10')");
 const insert=sql.prepare('INSERT INTO assessment_draft_versions VALUES (?,?,?,?,?,?,?,?,?)');
 for(const [id,c,revision,day]of [['v1','a',1,'2026-09-10'],['v2','a',2,'2026-09-12'],['v3','b',1,'2026-09-11']])insert.run(id,c,revision,1,id,JSON.stringify({documents:[]}),id,'worker:ali',day);
 const rows=await repo.recent();assert.deepEqual(rows.map(r=>[r.dealId,r.revision]),[['123',2],['124',1]]);assert.equal(rows.some(r=>'payload_json'in r),false);sql.close();
});
