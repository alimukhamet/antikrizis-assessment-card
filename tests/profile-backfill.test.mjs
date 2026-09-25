/** Profile backfill (documentologist mode). Synthetic data only; no real client or CRM data. */
import * as participants from '../public/loan-participants.mjs';
import * as intake from '../public/intake-data.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {JSDOM} from 'jsdom';
import * as schedule from '../public/payment-schedule.mjs';
import {httpHeaders} from './bitrix-headers-helper.mjs';

function load(path,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='./http-headers'?httpHeaders:n==='../../public/intake-data.mjs'?intake:imports[n],Date,Map,Set,TextEncoder,AbortSignal,JSON,BigInt,Number,String,Object,Array,Error,Promise,Response});return exports;}
const json=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const schema=json('lib/questionnaire/schema.json'),native=load('lib/documents/extract-native.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./kz-labels.json':json('lib/documents/kz-labels.json')});
const repository=load('lib/documents/repository.ts');
const {checkAnswers,SALES_ONLY_KEYS}=load('lib/questionnaire/check-answers.ts',{'./schema.json':schema,'../documents/extract-native':native,'../../public/payment-schedule.mjs':schedule,'../../public/loan-participants.mjs':participants});
const {validateDraft}=load('lib/questionnaire/draft.ts',{'./schema.json':schema,'./draft-recovery':load('lib/questionnaire/draft-recovery.ts'),'../documents/repository':repository});
const compileAssessmentModule=load('lib/questionnaire/compile-assessment.ts',{'./draft':{validateDraft},'./check-answers':{checkAnswers},'../documents/repository':repository,'../../public/payment-schedule.mjs':schedule,'../../public/loan-participants.mjs':participants});
const {compileProfile,PROFILE_SCHEMA}=load('lib/questionnaire/compile-profile.ts',{'./draft':{validateDraft},'./check-answers':{checkAnswers,SALES_ONLY_KEYS},'./compile-assessment':compileAssessmentModule,'../documents/repository':repository});
const fields=load('lib/crm/profile-fields.ts');
const {createProfileAdapter}=load('lib/crm/profile-write.ts',{'./profile-fields':fields});
const {sortProfileQueue}=load('lib/crm/profile-queue.ts',{'./profile-fields':fields});

const iin='000000000010';
const salesValues={fio:'SYNTHETIC ONLY',enforcementStatus:'no',enforcementDetails:'Нет',guarantors:'Нет',iin,dognum:'TEST',marital:'Холост / не замужем',dependents:'0',childrenTotal:'0',procedure:'199','count-clientjobs':'0','count-clientunofficial':'0',clientBenefitsCount:'0',c8037:'0',hardshipReason:'Платежи вношу, трудностей нет',kaspiAnnual:'0',gamblingTransfers:'no',lawyerNotesStatus:'no',n8044:'0',summa:'500000',contractDate:'2026-09-10',months:'5',payDay:'7',grafType:'423'};
const profileValues={regAddress:'TEST CITY, TEST STREET 1',factAddressSame:'same',clientPhone:'+7 700 000 00 00',contactChannel:'WhatsApp','count-profilefamily':'1'};
const credit={n8038:'TEST BANK',loanContractId:'TEST-001',n8038Start:'2025-01',n8039:'Потребительский кредит',loanStatus:'Платится по графику',n8040:'100.25',n8041:'20.00',n8042:'0',n8043:'Жильё',loanParticipants:'Нет'};
const member={familyName:'SYNTHETIC CHILD',familyRelation:'Сын',familyBirthDate:'01.02.2015',familyDependent:'Да, полностью',familyStudy:''};
function fixture({profile=false}={}){
 const values={...salesValues,...(profile?profileValues:{})};
 if(profile)for(const key of SALES_ONLY_KEYS)values[key]='';
 const row=(group,data)=>group.fields.map(f=>({key:f.key,value:data[f.key]||'',checked:false}));
 return {schemaVersion:1,answers:schema.scalar.map(f=>({key:f.key,value:values[f.key]||'',checked:['choice:socialStatus:Нет','holding:client:none','holding:client:businessNone','choice:debtPurpose:Жильё'].includes(f.key)})),
  groups:schema.groups.map(g=>{const rows=g.id==='creditors'?[row(g,credit)]:profile&&g.id==='profilefamily'?[row(g,member)]:[];return {id:g.id,rows,rowKeys:rows.map(()=>null)};}),
  docContext:{social:'0',salary:'0'},documents:[],pendingFiles:[]};
}
const set=(p,key,value,checked)=>{const a=p.answers.find(a=>a.key===key);a.value=value;if(checked!==undefined)a.checked=checked;};
const cell=(p,group,key)=>p.groups.find(g=>g.id===group).rows[0].find(a=>a.key===key);
const has=(result,key,code)=>result.issues.some(i=>i.key===key&&(!code||i.code===code));
const author={name:'Synthetic Worker',at:'2026-09-25T10:00:00.000Z'};

test('sales flow is unchanged: profile questions are inactive and employer names optional',()=>{
 const result=checkAnswers(validateDraft(fixture()),iin);
 assert.equal(result.answersComplete,true,JSON.stringify(result.issues));
 assert.ok(result.schedule);
 for(const key of ['regAddress','clientPhone','count-profilefamily','n8001Employer'])assert.ok(!has(result,key),key);
});

test('profile mode skips contract answers and asks for addresses, phone and family',()=>{
 const p=fixture();for(const key of SALES_ONLY_KEYS)set(p,key,'');
 const result=checkAnswers(validateDraft(p),iin,'2026-09-25',{profile:true});
 assert.equal(result.schedule,null);
 for(const key of SALES_ONLY_KEYS)assert.ok(!has(result,key),key);
 for(const key of ['regAddress','factAddressSame','clientPhone','contactChannel','count-profilefamily'])assert.ok(has(result,key,'ANSWER_REQUIRED'),key);
});

test('profile mode: complete answers pass, «Не знаю» becomes an open question, fact address is conditional',()=>{
 const p=fixture({profile:true});
 assert.equal(checkAnswers(validateDraft(p),iin,'2026-09-25',{profile:true}).answersComplete,true);
 set(p,'clientPhone','Не знаю');
 let result=checkAnswers(validateDraft(p),iin,'2026-09-25',{profile:true});
 assert.equal(result.answersComplete,true,JSON.stringify(result.issues));
 assert.deepEqual(JSON.parse(JSON.stringify(result.unresolved.map(a=>a.key))),['clientPhone']);
 set(p,'factAddressSame','other');
 assert.ok(has(checkAnswers(validateDraft(p),iin,'2026-09-25',{profile:true}),'factAddress','ANSWER_REQUIRED'));
 set(p,'factAddress','TEST FACT ADDRESS');
 assert.equal(checkAnswers(validateDraft(p),iin,'2026-09-25',{profile:true}).answersComplete,true);
 // Sales still treats «Не знаю» as unanswered.
 assert.ok(!checkAnswers(validateDraft({...fixture(),answers:fixture().answers.map(a=>a.key==='hardshipReason'?{...a,value:'Не знаю'}:a)}),iin).answersComplete);
});

test('profile mode validates birth dates and requires employer names for listed jobs',()=>{
 const p=fixture({profile:true});
 for(const bad of ['2015-02-01','31.02.2015','01.01.2099']){cell(p,'profilefamily','familyBirthDate').value=bad;assert.ok(has(checkAnswers(validateDraft(p),iin,'2026-09-25',{profile:true}),'familyBirthDate','INVALID_DATE'),bad);}
 cell(p,'profilefamily','familyBirthDate').value='Не знаю';
 assert.equal(checkAnswers(validateDraft(p),iin,'2026-09-25',{profile:true}).answersComplete,true);
 const jobs=fixture({profile:true});set(jobs,'count-clientjobs','1');
 const group=schema.groups.find(g=>g.id==='clientjobs');jobs.groups.find(g=>g.id==='clientjobs').rows=[group.fields.map(f=>({key:f.key,value:f.key==='n8001'?'150000':'',checked:false}))];jobs.groups.find(g=>g.id==='clientjobs').rowKeys=[null];
 assert.ok(has(checkAnswers(validateDraft(jobs),iin,'2026-09-25',{profile:true}),'n8001Employer','ANSWER_REQUIRED'));
 assert.ok(!has(checkAnswers(validateDraft({...jobs,answers:jobs.answers.map(a=>SALES_ONLY_KEYS.has(a.key)?{...a,value:salesValues[a.key]}:a)}),iin),'n8001Employer'));
});

test('compiled profile carries no contract data, lists open questions and keeps the debt honest',()=>{
 const p=fixture({profile:true});set(p,'clientPhone','Не знаю');
 const compiled=compileProfile(p,iin,'11665',author,'2026-09-25');
 assert.match(compiled.card,/^ПРОФИЛЬ КЛИЕНТА/);assert.match(compiled.card,/ТРЕБУЕТ УТОЧНЕНИЯ/);assert.match(compiled.card,/SYNTHETIC CHILD/);
 assert.doesNotMatch(compiled.card,/• Номер договора:|Сумма контракта|Всего платежей/);assert.match(compiled.card,/Где клиент живёт фактически\?: По адресу прописки/);
 const data=JSON.parse(compiled.values.profileJson);
 assert.equal(data.schema,PROFILE_SCHEMA);assert.equal(data.iin,iin);assert.equal(data.totalDebt,'100.25');assert.equal(data.debtComplete,true);
 assert.ok(!data.answers.some(a=>SALES_ONLY_KEYS.has(a.key)));
 assert.deepEqual(Object.keys(compiled.values).sort(),['debt','fio','marital','profileAt','profileCard','profileJson']);
 const unknownDebt=fixture({profile:true});unknownDebt.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='n8040').value='';
 assert.throws(()=>compileProfile(unknownDebt,iin,'11665',author,'2026-09-25'),/ANSWERS_INCOMPLETE/);
 assert.throws(()=>compileProfile(fixture({profile:true}),null,'11665',author),/DEAL_IDENTITY_UNVERIFIED/);
});

function bitrix({deal,failUpdate=false,roundDebt=false}){
 const calls=[];let state={...deal};
 const send=async(url,init)=>{
  const method=url.split('/').at(-1).replace('.json',''),body=JSON.parse(init.body);calls.push({method,body});
  if(method==='crm.deal.get')return Response.json({result:{...state}});
  if(method==='crm.deal.update'){if(failUpdate)return new Response('',{status:502});const update={...body.fields};if(roundDebt&&update.UF_CRM_AI_DEBT)update.UF_CRM_AI_DEBT=String(Math.round(Number(update.UF_CRM_AI_DEBT)));state={...state,...update};return Response.json({result:true});}
  if(method==='crm.contact.get')return Response.json({result:{PHONE:[{VALUE:'+7 700 000 00 01'}]}});
  return Response.json({error:'UNEXPECTED'});
 };
 return {send,calls,state:()=>state};
}
const F=fields.PROFILE_FIELDS;
const baseDeal={ID:'11665',TITLE:'SYNTHETIC CLIENT',UF_CRM_AI_IIN:iin,CONTACT_ID:'5',[F.fio]:'OLD NAME',[F.marital]:'',[F.debt]:'10',[F.profileCard]:'',[F.profileJson]:'',[F.profileAt]:'',UF_CRM_AI_CARD:'OLD CARD',UF_CRM_AI_DOGNUM:'KEEP'};
const values={fio:'NEW NAME',marital:'Холост / не замужем',debt:'100.25',profileCard:'CARD',profileJson:'{}',profileAt:'2026-09-25 · Synthetic'};

test('profile adapter writes only profile fields and verifies by readback',async()=>{
 const fake=bitrix({deal:baseDeal}),adapter=createProfileAdapter('https://portal.example/rest/1/token/',fake.send);
 const context=await adapter.context('11665');
 assert.equal(context.fieldsReady,true);assert.equal(context.legacyCard,'OLD CARD');assert.equal(context.phone,'+7 700 000 00 01');
 const result=await adapter.save('11665',iin,context.baseline,values);
 assert.equal(result.verified,true);
 const update=fake.calls.find(c=>c.method==='crm.deal.update');
 assert.deepEqual(Object.keys(update.body.fields).sort(),Object.values(F).sort());
 assert.equal(fake.state().UF_CRM_AI_DOGNUM,'KEEP');assert.equal(fake.state().UF_CRM_AI_CARD,'OLD CARD');
 // A repeated save is recognised as already applied and does not write again.
 const again=await adapter.save('11665',iin,context.baseline,values);
 assert.equal(again.alreadyApplied,true);assert.equal(fake.calls.filter(c=>c.method==='crm.deal.update').length,1);
});

test('profile adapter refuses missing fields, changed CRM values and wrong identity before writing',async()=>{
 const missing={...baseDeal};delete missing[F.profileCard];
 let fake=bitrix({deal:missing});
 await assert.rejects(createProfileAdapter('https://portal.example/rest/1/token/',fake.send).save('11665',iin,{},values),e=>e.code==='PROFILE_FIELDS_MISSING'&&e.notStarted);
 fake=bitrix({deal:{...baseDeal,[F.fio]:'EDITED IN CRM'}});
 await assert.rejects(createProfileAdapter('https://portal.example/rest/1/token/',fake.send).save('11665',iin,{...Object.fromEntries(Object.entries(F).map(([k,f])=>[k,baseDeal[f]]))},values),e=>e.code==='PROFILE_CHANGED_IN_CRM'&&e.fields.includes('fio'));
 fake=bitrix({deal:{...baseDeal,UF_CRM_AI_IIN:'000000000029'}});
 await assert.rejects(createProfileAdapter('https://portal.example/rest/1/token/',fake.send).save('11665',iin,{},values),e=>e.code==='CASE_IDENTITY_CHANGED');
 assert.ok(!fake.calls.some(c=>c.method==='crm.deal.update'));
});

test('profile adapter accepts whole-tenge debt storage and reports a lost write as uncertain',async()=>{
 const baseline=Object.fromEntries(Object.entries(F).map(([k,f])=>[k,baseDeal[f]]));
 let fake=bitrix({deal:baseDeal,roundDebt:true});
 assert.equal((await createProfileAdapter('https://portal.example/rest/1/token/',fake.send).save('11665',iin,baseline,values)).verified,true);
 fake=bitrix({deal:baseDeal,failUpdate:true});
 await assert.rejects(createProfileAdapter('https://portal.example/rest/1/token/',fake.send).save('11665',iin,baseline,values),e=>e.code==='PROFILE_READBACK_MISMATCH'&&!e.notStarted);
});

test('queue puts unfinished deals first, then the latest ZVI date',()=>{
 const item=(dealId,zviDate,profileSavedAt='')=>({dealId,title:'',stageName:'ЗВИ',zviDate,procedure:'',hasIin:true,hasLegacyCard:false,profileSavedAt});
 const order=JSON.parse(JSON.stringify(sortProfileQueue([item('1','2026-09-01'),item('2','2026-09-20','2026-09-24 · X'),item('3',''),item('4','2026-09-10')]).map(i=>i.dealId)));
 assert.deepEqual(order,['4','1','3','2']);
 assert.equal(fields.isProfileBackfillStage('В ожидании'),true);assert.equal(fields.isProfileBackfillStage('Подготовка ЗВИ'),true);assert.equal(fields.isProfileBackfillStage('Дело возбуждено'),false);
});

test('questionnaire hides the profile section for sales and loads the profile script',()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../public/questionnaire.html',import.meta.url),'utf8'));
 const section=dom.window.document.getElementById('profileOnly');
 assert.ok(section.classList.contains('hidden'));
 assert.ok(dom.window.document.querySelector('script[src="profile-backfill.js"]'));
 assert.ok(!section.querySelector('#dognum'));
 dom.window.close();
});

test('reconcile releases a save that never reached Bitrix and confirms one that did',async()=>{
 const baseline=Object.fromEntries(Object.entries(F).map(([k,f])=>[k,baseDeal[f]]));
 let fake=bitrix({deal:baseDeal});
 let result=await createProfileAdapter('https://portal.example/rest/1/token/',fake.send).reconcile('11665',iin,values,baseline);
 assert.equal(result.verified,false);assert.equal(result.untouched,true);
 fake=bitrix({deal:{...baseDeal,[F.fio]:'EDITED IN CRM'}});
 result=await createProfileAdapter('https://portal.example/rest/1/token/',fake.send).reconcile('11665',iin,values,baseline);
 assert.equal(result.verified,false);assert.equal(result.untouched,false);
 fake=bitrix({deal:{...baseDeal,...Object.fromEntries(Object.entries(F).map(([k,f])=>[f,values[k]]))}});
 result=await createProfileAdapter('https://portal.example/rest/1/token/',fake.send).reconcile('11665',iin,values,baseline);
 assert.equal(result.verified,true);assert.equal(result.untouched,false);
 assert.ok(!fake.calls.some(c=>c.method==='crm.deal.update'));
});
