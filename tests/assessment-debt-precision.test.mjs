/** Reproduces the production storage contract without copying customer data. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {httpHeaders} from './bitrix-headers-helper.mjs';

const compiled=ts.transpileModule(fs.readFileSync('lib/crm/assessment-write.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,
});
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const exports={};
vm.runInNewContext(compiled.outputText,{exports,require:n=>n==='./http-headers'?httpHeaders:undefined,Date,Set,AbortSignal});
const {ASSESSMENT_FIELDS:F,createAssessmentAdapter}=exports;
const totalLine=debt=>`КАРТОЧКА КЛИЕНТА\nОбщий долг по указанным обязательствам: ${debt} ₸\nДОГОВОР (только продажи)`;
const exact={fio:'SYNTHETIC CLIENT',iin:'000000000001',dognum:'TEST',marital:'TEST',procedure:'199',debt:'123456.99',comment:'',contractDate:'2026-09-17',months:'5',payDay:'7',grafType:'423',grafText:'TEST SCHEDULE',card:totalLine('123456.99'),summa:'500000',currency:'KZT'};
const schema={FIELD_NAME:F.debt,USER_TYPE_ID:'double',MULTIPLE:'N',SETTINGS:{PRECISION:0}};
function fixture({expected=exact,current={...expected,debt:'123457'},metadata=[schema],failSchema=false,onWrite}={}){
 let state={...current};const calls=[],writes=[];
 const adapter=createAssessmentAdapter('https://synthetic.invalid/',async(url,init)=>{
  const method=url.split('/').at(-1).replace('.json',''),body=JSON.parse(init.body);calls.push(method);
  if(method==='crm.deal.userfield.list'){
   assert.deepEqual(body,{filter:{FIELD_NAME:F.debt}});
   if(failSchema)throw Error('METADATA UNAVAILABLE');
   return Response.json({result:metadata});
  }
  assert.equal(body.id,'900001');
  if(method==='crm.deal.get')return Response.json({result:{ID:'900001',...Object.fromEntries(Object.entries(F).map(([k,f])=>[f,state[k]]))}});
  assert.equal(method,'crm.deal.update');writes.push(body.fields);
  state=Object.fromEntries(Object.entries(F).map(([k,f])=>[k,body.fields[f]]));
  if(onWrite)onWrite(state);
  return Response.json({result:true});
 });
 return{adapter,calls,writes,state:()=>state,reconcile:()=>adapter.reconcile('900001',expected.iin,expected)};
}

test('zero-decimal Bitrix debt plus identical exact questionnaire reconciles through reads only',async()=>{
 const f=fixture();assert.equal((await f.reconcile()).verified,true);assert.equal(f.writes.length,0);
 assert.deepEqual(f.calls,['crm.deal.get','crm.deal.userfield.list']);
});
test('new save sends exact debt unchanged and accepts the proven whole-tenge storage projection',async()=>{
 const before={...exact,card:'BEFORE',debt:'100'};
 const f=fixture({current:before,onWrite:state=>{state.debt='123457';}});
 const preserved=JSON.stringify(exact);
 assert.equal((await f.adapter.save('900001',exact.iin,before,exact)).verified,true);
 assert.equal(f.writes[0][F.debt],exact.debt);assert.equal(f.writes[0][F.card],exact.card);
 assert.equal(JSON.stringify(exact),preserved);
 assert.equal((await f.adapter.save('900001',exact.iin,before,exact)).alreadyApplied,true);
 assert.equal(f.writes.length,1);
});
test('half-up rounding uses decimal strings, including carry and values beyond safe integer range',async()=>{
 for(const [debt,stored]of [['123.01','123'],['123.49','123'],['123.50','124'],['999.99','1000'],['0.49','0'],['0.50','1'],['9007199254740992.99','9007199254740993']]){
  const expected={...exact,debt,card:totalLine(debt)};
  assert.equal((await fixture({expected,current:{...expected,debt:stored}}).reconcile()).verified,true,`${debt} -> ${stored}`);
 }
});
test('wrong whole-tenge value is not accepted; there is no numeric tolerance',async()=>{
 for(const debt of ['123456','123458','123457.01','123456.5'])assert.equal((await fixture({current:{...exact,debt}}).reconcile()).verified,false);
});
test('rounding never hides a changed questionnaire, another field or a different exact total',async()=>{
 for(const [key,value]of [['card',exact.card.replace('123456.99','123456.98')],['summa','500001'],['dognum','OTHER'],['procedure','201']]){
  const f=fixture({current:{...exact,debt:'123457',[key]:value}});
  assert.equal((await f.reconcile()).verified,false);assert.equal(f.calls.includes('crm.deal.userfield.list'),false);
 }
});
test('exact amount must be retained once in the identical canonical questionnaire',async()=>{
 for(const card of ['TEST CARD',totalLine('123456.98'),totalLine('123456.99')+'\nОбщий долг по указанным обязательствам: 123456.99 ₸']){
  const expected={...exact,card},f=fixture({expected,current:{...expected,debt:'123457'}});
  assert.equal((await f.reconcile()).verified,false);assert.equal(f.calls.includes('crm.deal.userfield.list'),false);
 }
});
test('field precision must be explicitly zero on the correct scalar numeric field',async()=>{
 for(const metadata of [[],[schema,schema],[{...schema,FIELD_NAME:'OTHER'}],[{...schema,USER_TYPE_ID:'string'}],[{...schema,MULTIPLE:'Y'}],[{...schema,SETTINGS:{PRECISION:2}}],[{...schema,SETTINGS:{}}],[{...schema,SETTINGS:{PRECISION:null}}]]){
  assert.equal((await fixture({metadata}).reconcile()).verified,false);
 }
 assert.equal((await fixture({metadata:[{...schema,SETTINGS:{PRECISION:'0'}}]}).reconcile()).verified,true);
});
test('unavailable schema does not turn a mismatch into success or a new write',async()=>{
 const f=fixture({failSchema:true});const result=await f.reconcile();assert.equal(result.verified,false);assert.deepEqual([...result.mismatches],['debt']);assert.equal(f.writes.length,0);
});
test('exact readback avoids metadata requests; higher-precision schema never allows truncation',async()=>{
 const f=fixture({current:{...exact,debt:'123456.9900'},failSchema:true});assert.equal((await f.reconcile()).verified,true);assert.deepEqual(f.calls,['crm.deal.get']);
 assert.equal((await fixture({metadata:[{...schema,SETTINGS:{PRECISION:2}}]}).reconcile()).verified,false);
});
test('identity checks and unexpected multivalue rejection remain enforced',async()=>{
 const identity=fixture({current:{...exact,debt:'123457',iin:'000000000002'}});await assert.rejects(identity.reconcile(),/CASE_IDENTITY_CHANGED/);assert.equal(identity.writes.length,0);
 for(const debt of [['123457'],true,{},'1e5'])assert.equal((await fixture({current:{...exact,debt}}).reconcile()).verified,false);
});

// Exercise the durable recovery path, not only the adapter's numeric comparison.
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
function load(file,imports={}){
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
 assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const exports={};vm.runInNewContext(compiled.outputText,{exports,require:n=>imports[n],crypto:webcrypto,TextEncoder,Date,Set,Map,AbortSignal,setTimeout,clearTimeout});return exports;
}
test('historic uncertain record finishes history and releases its original contract without another card update',async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec('PRAGMA foreign_keys=ON');
 for(const name of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync('drizzle/'+name,'utf8'));
 sql.exec("INSERT INTO assessment_cases (id,external_system,external_id,client_iin,title,created_at,updated_at) VALUES ('case','bitrix','900001','000000000001','SYNTHETIC','now','now')");
 const db={prepare(query){return{bind(...args){const q=sql.prepare(query);return{async first(){return q.get(...args)||null;},async run(){return{meta:{changes:Number(q.run(...args).changes)}};}};}};}};
 const evidence=load('lib/documents/repository.ts');
 const {SubmissionRepository}=load('lib/questionnaire/submission-repository.ts',{'../documents/repository':evidence});
 const repo=new SubmissionRepository(db),record=sql.prepare('SELECT * FROM assessment_cases').get();
 const actor={id:'worker:synthetic',authentication:'test',displayName:'SYNTHETIC'},requestId='00000000-0000-0000-0000-000000000001';
 const payload={schemaVersion:1,draft:{schemaVersion:1,answers:[],groups:[],documents:[],pendingFiles:[],docContext:{salary:'0',social:'0'}},baseline:{...exact,card:'BEFORE'},values:exact,contractData:{contract_number:'ORIGINAL'},contractRendererVersion:'a'.repeat(64),lawyerCard:'SYNTHETIC',reviewIds:[],evidence:[],validationVersion:'test',assessmentDay:'2026-09-17'};
 const prepared=await repo.prepare(record,requestId,payload,actor);
 sql.prepare("UPDATE assessment_submissions SET state='uncertain',outcome_code='ASSESSMENT_READBACK_MISMATCH' WHERE request_id=?").run(requestId);
 const final=load('lib/questionnaire/final-submission.ts',{'../documents/repository':evidence,'./submission-service':{},'./review-bindings':{},'./draft':{},'./history-snapshot':{},'./final-check':{},'../../public/contract-words.mjs':{}});
 const historyErrors=load('lib/crm/assessment-history.ts',{'./http-headers':httpHeaders});
 const historyService=load('lib/questionnaire/submission-history.ts',{'../documents/repository':evidence,'../crm/assessment-history':historyErrors});
 const operation=load('lib/questionnaire/contract-operation.ts',{'../documents/repository':evidence,'./final-submission':final,'./submission-history':historyService});
 const f=fixture();let appends=0;
 const historyAdapter={append:async()=>{appends++;return{commentId:'1'};},reconcile:async()=>({commentId:'1'})};
 const args={repository:{},submissions:repo,adapter:f.adapter,historyAdapter,record,actor,requestId,day:'2026-09-17',currentRecord:async()=>({...record})};
 const result=await operation.completeContractOperation(args);
 assert.equal(result.row.state,'verified');assert.equal(result.row.history_state,'verified');assert.equal(result.contract.data.contract_number,'ORIGINAL');
 assert.equal(result.row.payload_json,prepared.payload_json);assert.equal(f.writes.length,0);assert.equal(appends,1);
 await operation.completeContractOperation(args);assert.equal(f.writes.length,0);assert.equal(appends,1);
});
