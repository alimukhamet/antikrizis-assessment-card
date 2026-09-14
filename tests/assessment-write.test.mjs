import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/crm/assessment-write.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Set,AbortSignal});
const {ASSESSMENT_FIELDS:F,createAssessmentAdapter}=exports;
const values={fio:'SYNTHETIC CLIENT',iin:'000000000001',dognum:'TEST',marital:'Холост / не замужем',procedure:'test-procedure',debt:'123456.78',comment:'TEST ONLY',contractDate:'2026-09-10',months:'5',payDay:'7',grafType:'423',grafText:'TEST SCHEDULE',card:'TEST CARD',summa:'500000',currency:'KZT'};
function fixture(options={}) {
 const baseline={...values,card:'BEFORE',debt:'100.00'};
 let state=Object.fromEntries(Object.entries(F).map(([key,field])=>[field,baseline[key]]));
 const writes=[];let reads=0;
 const send=async(url,init)=>{
  const body=JSON.parse(init.body);
  assert.equal(body.id,'11665');
  if(url.endsWith('/crm.deal.get.json')){
   reads++;if(options.failReadback&&reads>1)throw new Error('offline');
   return Response.json({result:{ID:'11665',...state}});
  }
  assert.ok(url.endsWith('/crm.deal.update.json'));
  writes.push(body.fields);
  if(!options.rejectWrite)state={...state,...body.fields};
  if(options.dropFraction)state[F.debt]='123456';
  if(options.formatReadback){state[F.debt]='123456.7800';state[F.contractDate]='2026-09-10T00:00:00+05:00';state[F.months]=5;}
  if(options.loseResponse)throw new Error('lost response after commit');
  return Response.json(options.rejectWrite?{error:'DENIED'}:{result:true});
 };
 return {adapter:createAssessmentAdapter('https://synthetic.invalid/',send),baseline,writes,edit:(key,value)=>{state[F[key]]=value;}};
}
test('write maps only canonical assessment fields and preserves debt cents',async()=>{
 const f=fixture({formatReadback:true});const result=await f.adapter.save('11665',values.iin,f.baseline,values);
 assert.equal(result.verified,true);assert.equal(f.writes.length,1);assert.equal(f.writes[0][F.debt],'123456.78');
 assert.deepEqual(Object.keys(f.writes[0]).sort(),Object.values(F).sort());
 assert.ok(!('UF_CRM_ANK_PRIMARY_DOCS' in f.writes[0]));assert.ok(!('STAGE_ID' in f.writes[0]));
});
test('lost write response is reconciled and retry does not write twice',async()=>{
 const f=fixture({loseResponse:true});assert.equal((await f.adapter.save('11665',values.iin,f.baseline,values)).verified,true);
 assert.equal((await f.adapter.save('11665',values.iin,f.baseline,values)).alreadyApplied,true);assert.equal(f.writes.length,1);
});
test('changed assessment or client identity stops before any write',async()=>{
 for(const [key,value,code] of [['card','EXTERNAL EDIT','ASSESSMENT_CHANGED_IN_CRM'],['iin','000000000002','CASE_IDENTITY_CHANGED']]){
  const f=fixture();f.edit(key,value);await assert.rejects(f.adapter.save('11665',values.iin,f.baseline,values),new RegExp(code));assert.equal(f.writes.length,0);
 }
});
test('success is withheld for partial, rejected or uncertain saves',async()=>{
 for(const [options,code] of [[{dropFraction:true},'ASSESSMENT_READBACK_MISMATCH'],[{rejectWrite:true},'ASSESSMENT_READBACK_MISMATCH'],[{failReadback:true},'ASSESSMENT_SAVE_UNCERTAIN']]){
  const f=fixture(options);await assert.rejects(f.adapter.save('11665',values.iin,f.baseline,values),new RegExp(code));
 }
});
test('unexpected multi-values or invalid numbers never count as verified readback',async()=>{
 const f=fixture();f.edit('debt',['100.00']);await assert.rejects(f.adapter.save('11665',values.iin,f.baseline,values),/ASSESSMENT_CHANGED_IN_CRM/);assert.equal(f.writes.length,0);
 await assert.rejects(f.adapter.save('11665',values.iin,f.baseline,{...values,debt:'123,456.78'}),/INVALID_ASSESSMENT_VALUES/);
});
test('explicit reconciliation only reads and retains exact decimal comparisons',async()=>{
 const f=fixture();const before=await f.adapter.reconcile('11665',values.iin,values);assert.equal(before.verified,false);assert.ok(before.mismatches.includes('card'));assert.equal(f.writes.length,0);
 for(const [key,value]of Object.entries(values))f.edit(key,value);f.edit('debt','123456.7800');assert.equal((await f.adapter.reconcile('11665',values.iin,values)).verified,true);assert.equal(f.writes.length,0);
 f.edit('debt','123456');assert.equal((await f.adapter.reconcile('11665',values.iin,values)).verified,false);f.edit('iin','other');await assert.rejects(f.adapter.reconcile('11665',values.iin,values),/CASE_IDENTITY_CHANGED/);assert.equal(f.writes.length,0);
});
