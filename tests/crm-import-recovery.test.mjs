import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
class RepositoryError extends Error{constructor(code,status=409){super(code);this.code=code;this.status=status;}}
class DocumentUploadError extends Error{constructor(code){super(code);this.code=code;}}
class DocumentReadError extends Error{}
function setup(){
 const record={id:'case',identity_revision:2},client={iin:'synthetic',external:{system:'bitrix',dealId:'11665'}},document={id:'original',original_name:'synthetic.pdf'};
 const state={receipt:true,member:true,current:true,denied:false,cacheError:false,reads:0,contextReads:0};
 const repository={importedDocument:async(r,id)=>{assert.equal(r,record);assert.equal(id,'123');return state.receipt?document:null;},findCaseByExternal:async()=>state.current?record:{...record,identity_revision:3}};
 const context={record,client,repository,actor:{id:'synthetic'}},exports={};
 const imports={
  '../../../staff-access':{requireStaffRequest:async()=>state.denied?new Response(null,{status:401}):null},
  '../../../../../lib/documents/request-context':{evidenceContext:async()=>{state.contextReads++;return context;},evidenceError:error=>Response.json({error:error.code},{status:error.status||500})},
  '../../../../../lib/crm/client-directory':{dealDocumentReferences:async()=>state.member?[{id:'123'}]:[]},
  '../../../../../lib/crm/document-download':{createCrmDocumentReader:()=>{throw Error('No CRM download is permitted during recovery');}},
  '../../../../../lib/crm/document-upload':{DocumentUploadError},'../../../../../lib/documents/read-pdf':{DocumentReadError},
  '../../../../../lib/documents/extract-native':{},'../../../../../lib/documents/repository':{RepositoryError},'../../../../../lib/crm/bitrix':{},
  '../../../../../lib/documents/analysis-service':{storedAnalysis:async(c,r,repo,doc,actor,cacheOnly)=>{state.reads++;assert.equal(c,client);assert.equal(r,record);assert.equal(doc,document);assert.equal(cacheOnly,true);if(state.cacheError)throw new RepositoryError('CACHE_REPROCESS_REQUIRED');return{documentId:doc.id,identityRevision:r.identity_revision};}}
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/assessment/[dealId]/crm-documents/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{assert.ok(imports[name],name);return imports[name];},Response,URL,process:{env:{}}});
 return{state,get:query=>exports.GET(new Request('https://synthetic.invalid/api/assessment/11665/crm-documents'+query),{params:Promise.resolve({dealId:'11665'})})};
}
test('lost import readback returns only a verified current-client cached original',async()=>{
 const {state,get}=setup();const response=await get('?fileId=123&identityRevision=2');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{documentId:'original',identityRevision:2,originalName:'synthetic.pdf',crmFileId:'123'});assert.equal(state.reads,1);
});
test('absent import stays pending without downloading or creating analysis',async()=>{
 const {state,get}=setup();state.receipt=false;const response=await get('?fileId=123&identityRevision=2');assert.equal(response.status,202);assert.deepEqual(await response.json(),{pending:true,crmFileId:'123'});assert.equal(state.reads,0);
});
test('import recovery preserves auth, CRM membership, identity and analysis gates',async()=>{
 for(const [flag,query,status,code] of [['denied','?fileId=123&identityRevision=2',401,null],['member','?fileId=123&identityRevision=2',422,'FILE_NOT_IN_DEAL'],['current','?fileId=123&identityRevision=2',409,'CASE_IDENTITY_CHANGED'],['cacheError','?fileId=123&identityRevision=2',409,'CACHE_REPROCESS_REQUIRED'],[null,'?fileId=123&identityRevision=1',409,'CASE_IDENTITY_CHANGED'],[null,'?fileId=bad&identityRevision=2',400,'INVALID_FILE_ID']]){
  const {state,get}=setup();if(flag)state[flag]=['denied','cacheError'].includes(flag);const response=await get(query);assert.equal(response.status,status,flag||query);if(code)assert.equal((await response.json()).error,code);if(flag==='denied')assert.equal(state.contextReads,0);
 }
});
