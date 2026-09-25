import * as intake from '../public/intake-data.mjs';
import * as participants from '../public/loan-participants.mjs';
import {test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import * as schedule from'../public/payment-schedule.mjs';
function load(path,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='../../public/intake-data.mjs'?intake:imports[n],Date,Map,Set,TextEncoder});return exports;}
const json=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const schema=json('lib/questionnaire/schema.json'),native=load('lib/documents/extract-native.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./kz-labels.json':json('lib/documents/kz-labels.json')});
const {checkAnswers}=load('lib/questionnaire/check-answers.ts',{'./schema.json':schema,'../documents/extract-native':native,'../../public/payment-schedule.mjs':schedule,'../../public/loan-participants.mjs':participants});
const {validateDraft}=load('lib/questionnaire/draft.ts',{'./schema.json':schema,'./draft-recovery':load('lib/questionnaire/draft-recovery.ts'),'../documents/repository':load('lib/documents/repository.ts')});
const iin='000000000010';
function fixture(){const values={fio:'SYNTHETIC ONLY',enforcementStatus:'no',enforcementDetails:'Нет',guarantors:'Нет',iin,dognum:'TEST',marital:'Холост / не замужем',dependents:'0',childrenTotal:'0',procedure:'199','count-clientjobs':'0','count-clientunofficial':'0',clientBenefitsCount:'0',c8037:'0',hardshipReason:'Платежи вношу, трудностей нет',kaspiAnnual:'0',gamblingTransfers:'no',lawyerNotesStatus:'no',n8044:'0',summa:'500000',contractDate:'2026-09-10',months:'5',payDay:'7',grafType:'423'};
 const credit={n8038:'TEST BANK',loanContractId:'TEST-001',n8038Start:'2025-01',n8039:'Потребительский кредит',loanStatus:'Платится по графику',n8040:'100.25',n8041:'20.00',n8042:'0',n8043:'Жильё',loanParticipants:'Нет'};
 return {schemaVersion:1,answers:schema.scalar.map(f=>({key:f.key,value:values[f.key]||'',checked:['choice:socialStatus:Нет','holding:client:none','holding:client:businessNone','choice:debtPurpose:Жильё'].includes(f.key)})),groups:schema.groups.map(g=>({id:g.id,rows:g.id==='creditors'?[g.fields.map(f=>({key:f.key,value:credit[f.key]||'',checked:false}))]:[],rowKeys:g.id==='creditors'?[null]:[]})),docContext:{social:'0',salary:'0'},documents:[],pendingFiles:[]};}
const set=(p,key,value,checked)=>{const a=p.answers.find(a=>a.key===key);a.value=value;if(checked!==undefined)a.checked=checked;};
const run=p=>checkAnswers(validateDraft(p),iin);
const has=(result,key,code)=>result.issues.some(i=>i.key===key&&(!code||i.code===code));
test('complete single client answers pass without inventing spouse details',()=>{const result=run(fixture());assert.equal(result.answersComplete,true,JSON.stringify(result.issues));assert.equal(result.schedule.firstPaymentDate,'2026-12-07');});
test('blank and explicit unknown stay distinct, with consistent child counts',()=>{const p=fixture();set(p,'childrenTotal','');assert.ok(has(run(p),'childrenTotal','ANSWER_REQUIRED'));set(p,'unknown:childrenTotal','on',true);assert.ok(has(run(p),'childrenTotal','ANSWER_REQUIRED'));set(p,'unknown:childrenTotal','on',false);set(p,'childrenTotal','1');set(p,'childrenUnder18','2');assert.ok(has(run(p),'childrenUnder18','CHILD_COUNT_CONFLICT'));});
test('married clients require spouse income, assets and bank answers',()=>{const p=fixture();set(p,'marital','В браке');const r=run(p);for(const key of ['count-partnerjobs','partnerKaspiAnnual','holding:partner:'])assert.ok(has(r,key),key);});
test('other overall purpose requires an explanation only when selected',()=>{const p=fixture();set(p,'choice:debtPurpose:Другое','Другое',true);assert.ok(has(run(p),'debtPurposeOther'));set(p,'debtPurposeOther','TEST EXPLANATION');assert.ok(!has(run(p),'debtPurposeOther'));set(p,'choice:debtPurpose:Другое','Другое',false);assert.ok(!compileAssessment(p,iin).lawyerCard.includes('TEST EXPLANATION'));assert.ok(schema.groups.find(g=>g.id==='transfers').fields.some(f=>f.key==='transferOther'));});
test('selected property requires a row; incompatible none choice is rejected',()=>{const p=fixture();set(p,'holding:client:real','real',true);const r=run(p);assert.ok(has(r,'clientreal','ROW_REQUIRED'));assert.ok(has(r,'holding:client:','CONFLICTING_CHOICES'));});
test('negative amounts, fractional overdue days, invalid schedule and wrong identity fail',()=>{const p=fixture(),credit=p.groups.find(g=>g.id==='creditors').rows[0];credit.find(a=>a.key==='n8040').value='-1';credit.find(a=>a.key==='n8042').value='1.5';set(p,'months','61');set(p,'iin','000000000011');const r=run(p);for(const key of ['n8040','n8042','summa','iin'])assert.ok(has(r,key),key);});
test('defaulted loans require the full amount but not a monthly payment',()=>{
 const p=fixture(),row=p.groups.find(g=>g.id==='creditors').rows[0],put=(key,value)=>row.find(a=>a.key===key).value=value;
 put('loanStatus','В просрочке — требуют полную сумму');put('n8042','322');put('n8041','');assert.equal(run(p).answersComplete,true,JSON.stringify(run(p).issues));
 put('loanStatus','Платится по графику');assert.ok(has(run(p),'n8041','ANSWER_REQUIRED'));assert.ok(has(run(p),'loanStatus','LOAN_STATUS_CONFLICT'));
 put('n8042','0');assert.ok(!has(run(p),'loanStatus','LOAN_STATUS_CONFLICT'));
});
test('bank turnover above threshold requires an explanation even with zero official jobs',()=>{const p=fixture();set(p,'kaspiAnnual','1.00');assert.ok(has(run(p),'kaspiWhy'));set(p,'kaspiWhy','TEST turnover explanation');assert.ok(!has(run(p),'kaspiWhy'));});
test('gambling requires an explicit answer consistent with the amount',()=>{
 const p=fixture();set(p,'gamblingTransfers','');assert.ok(has(run(p),'gamblingTransfers','ANSWER_REQUIRED'));
 set(p,'gamblingTransfers','yes');assert.ok(has(run(p),'n8044','GAMBLING_AMOUNT_CONFLICT'));set(p,'n8044','100.25');assert.equal(run(p).answersComplete,true);
 set(p,'gamblingTransfers','no');assert.ok(has(run(p),'n8044','GAMBLING_AMOUNT_CONFLICT'));set(p,'n8044','0');assert.equal(run(p).answersComplete,true);
});
test('lawyer handoff requires a choice and notes only when there are extra circumstances',()=>{
 const p=fixture();set(p,'lawyerNotesStatus','');assert.ok(has(run(p),'lawyerNotesStatus','ANSWER_REQUIRED'));
 set(p,'lawyerNotesStatus','yes');set(p,'comment','   ');assert.ok(has(run(p),'comment','ANSWER_REQUIRED'));
 set(p,'comment','SYNTHETIC IMPORTANT NOTE');assert.equal(run(p).answersComplete,true);assert.match(compileAssessment(p,iin).lawyerCard,/SYNTHETIC IMPORTANT NOTE/);
 set(p,'lawyerNotesStatus','no');const compiled=compileAssessment(p,iin);assert.doesNotMatch(compiled.lawyerCard,/SYNTHETIC IMPORTANT NOTE/);assert.equal(compiled.values.comment,'');assert.equal(validateDraft(p).answers.find(a=>a.key==='comment').value,'SYNTHETIC IMPORTANT NOTE');
});
const {compileAssessment,displayAnswer}=load('lib/questionnaire/compile-assessment.ts',{'./draft':{validateDraft},'./check-answers':{checkAnswers},'../documents/repository':load('lib/documents/repository.ts'),'../../public/payment-schedule.mjs':schedule,'../../public/loan-participants.mjs':participants});
test('compiler preserves debt cents and keeps payment terms out of the lawyer card',()=>{
 const p=fixture();set(p,'dognum','CONTRACT-PRIVATE-TEST');set(p,'summa','987654');
 const g=p.groups.find(g=>g.id==='creditors'),second=structuredClone(g.rows[0]);second.find(a=>a.key==='n8040').value='0.02';second.find(a=>a.key==='n8038').value='SECOND TEST BANK';g.rows.push(second);g.rowKeys.push(null);
 const compiled=compileAssessment(validateDraft(p),iin);
 assert.equal(compiled.values.debt,'100.27');assert.ok(compiled.lawyerCard.includes('SECOND TEST BANK'));assert.ok(compiled.lawyerCard.includes('100.27'));
 assert.ok(!compiled.lawyerCard.includes('CONTRACT-PRIVATE-TEST'));assert.ok(!compiled.lawyerCard.includes('987654'));assert.ok(!compiled.lawyerCard.includes('ГРАФИК ПЛАТЕЖЕЙ'));
 assert.ok(compiled.fullCard.includes('CONTRACT-PRIVATE-TEST'));assert.equal(compiled.values.card,compiled.fullCard);assert.equal(compiled.values.grafType,'423');
});
test('compiler blocks legacy unknowns and retains other explanations after staff answers',()=>{
 const p=fixture();set(p,'partnerKaspiAnnual','987654321');set(p,'childrenTotal','');set(p,'unknown:childrenTotal','on',true);
 set(p,'choice:debtPurpose:Другое','Другое',true);set(p,'debtPurposeOther','EXPLANATION TO PRESERVE');
 assert.throws(()=>compileAssessment(validateDraft(p),iin),/ANSWERS_INCOMPLETE/);set(p,'childrenTotal','0');set(p,'unknown:childrenTotal','on',false);
 const c=compileAssessment(validateDraft(p),iin);assert.ok(!c.lawyerCard.includes('987654321'));assert.ok(!c.lawyerCard.includes('Неизвестно — уточнить'));assert.ok(c.lawyerCard.includes('EXPLANATION TO PRESERVE'));
});
test('incomplete questionnaire cannot be compiled into save values',()=>{const p=fixture();set(p,'fio','');assert.throws(()=>compileAssessment(validateDraft(p),iin),/ANSWERS_INCOMPLETE/);});

test('compiler itself rejects an unsupported procedure before creating CRM values',()=>{const p=fixture();set(p,'procedure','UNSUPPORTED');assert.throws(()=>compileAssessment(p,iin),/INVALID_DRAFT_OPTION/);});
test('compiled card identifies reviewed answer source and refuses stale evidence value',()=>{
 const p=fixture(),evidence={key:'n8041',group:'creditors',row:0,documentId:'doc',extractionId:'ext',factKey:'credits.0.monthlyPayment',reviewId:'review',value:'20.00',page:2,source:'TEST',documentSha256:'test-hash',documentName:'synthetic.pdf',reviewedAt:'2026-09-10',reviewActorId:'worker:test',disposition:'confirmed'};
 const c=compileAssessment(p,iin,[evidence]);assert.ok(c.lawyerCard.includes('synthetic.pdf, стр. 2'));assert.ok(c.lawyerCard.includes('не удостоверяет подлинность'));assert.throws(()=>compileAssessment(p,iin,[{...evidence,value:'21.00'}]),/REVIEW_VALUE_CHANGED/);
});
const contractWords=await import('../public/contract-words.mjs');
const {contractData}=load('lib/questionnaire/contract-data.ts',{'./compile-assessment':{compileAssessment,displayAnswer},'./check-answers':{checkAnswers},'../../public/contract-words.mjs':contractWords,'../documents/repository':load('lib/documents/repository.ts')});
test('new questionnaire produces canonical contract slots and exact payment totals',()=>{const data=contractData(fixture(),iin);assert.equal(data.company_name,'ТОО «Aplus Corporation»');assert.equal(data.total_debt,'100,25');assert.equal(data.contract_date_full,'10.09.2026');assert.equal(data.service_price_words,'пятьсот тысяч');assert.equal(data.payments.length,5);assert.equal(data.payments[0].date,'07 декабря 2026 г.');assert.equal(data.spouse_property,'не применимо');assert.equal(data.enforcement,'Нет');assert.equal(data.guarantors,'Нет');});

test('participants require a separate answer for each loan; legacy answers cannot fill them',()=>{
 const p=fixture();set(p,'enforcementStatus','');set(p,'enforcementDetails','');set(p,'guarantors','LEGACY PERSON');
 const group=p.groups.find(g=>g.id==='creditors'),first=group.rows[0];first.find(a=>a.key==='loanParticipants').value='';
 const second=structuredClone(first);second.find(a=>a.key==='loanParticipants').value='SECOND PERSON — Гарант';group.rows.push(second);group.rowKeys.push(null);
 const incomplete=run(p);assert.ok(has(incomplete,'enforcementStatus'));assert.ok(incomplete.issues.some(i=>i.key==='loanParticipants'&&i.row===0));assert.ok(!incomplete.issues.some(i=>i.key==='loanParticipants'&&i.row===1));
 set(p,'unknown:enforcementDetails','on',true);first.find(a=>a.key==='unknown:loanParticipants').checked=true;
 assert.ok(run(p).issues.some(i=>i.key==='loanParticipants'&&i.row===0));first.find(a=>a.key==='loanParticipants').value='Нет';assert.ok(has(run(p),'enforcementStatus','ANSWER_REQUIRED'));set(p,'unknown:enforcementDetails','on',false);set(p,'enforcementDetails','Нет');set(p,'enforcementStatus','no');assert.equal(run(p).answersComplete,true);const data=contractData(p,iin);assert.equal(data.enforcement,'Нет');assert.match(data.guarantors,/Кредит 1 .*Нет/);assert.match(data.guarantors,/Кредит 2 .*SECOND PERSON — Гарант/);assert.doesNotMatch(data.guarantors,/LEGACY PERSON/);
 assert.doesNotMatch(compileAssessment(p,iin).lawyerCard,/LEGACY PERSON/);assert.equal(validateDraft(p).answers.find(a=>a.key==='guarantors').value,'LEGACY PERSON');
});

test('contract retains other property, separates business categories and names ownership',()=>{
 const p=fixture();set(p,'holding:client:none','none',false);set(p,'holding:client:other','other',true);set(p,'n8017','SYNTHETIC OTHER ASSET');set(p,'holding:client:ip','ip',true);set(p,'holding:client:businessNone','businessNone',false);
 const group=p.groups.find(g=>g.id==='clientip');group.rows=[schema.groups.find(g=>g.id==='clientip').fields.map(f=>({key:f.key,value:f.key==='n8010'?'Да':'12345',checked:false}))];group.rowKeys=[null];
 const c=contractData(p,iin);assert.match(c.property,/SYNTHETIC OTHER ASSET/);assert.match(c.ip_status,/12345/);assert.equal(c.legal_entities,'Нет');
 set(p,'holding:client:real','real',true);const real=p.groups.find(g=>g.id==='clientreal');const values={n8003:'Квартира',n8004Kind:'share',n8004:'25',n8005:'10000000',n8006:'Нет'};real.rows=[schema.groups.find(g=>g.id==='clientreal').fields.map(f=>({key:f.key,value:values[f.key]||'',checked:false}))];real.rowKeys=[null];
 assert.match(contractData(p,iin).property,/Долевая собственность/);assert.match(compileAssessment(p,iin).lawyerCard,/Долевая собственность/);assert.match(contractData(p,iin).property,/SYNTHETIC OTHER ASSET/);
});

test('participant completion requires a closed choice or named people with known roles',()=>{
 const p=fixture(),answer=p.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='loanParticipants');
 for(const invalid of ['Есть','Не знаю','ИВАНОВ ИВАН','ИВАНОВ ИВАН — Друг','— Гарант','ИВАНОВ ИВАН —']){answer.value=invalid;assert.ok(run(p).issues.some(i=>i.key==='loanParticipants'),invalid);}
 for(const role of participants.participantRoles){answer.value='ТЕСТОВЫЙ УЧАСТНИК — '+role;assert.equal(run(p).answersComplete,true,role);}
 answer.value='ТЕСТОВЫЙ УЧАСТНИК — Залогодатель (в ГКБ: Кепіл беруші)';assert.equal(run(p).answersComplete,true);
});


test('purpose is required once overall and old loan answers remain in the draft without entering the card',()=>{
 const p=fixture(),row=p.groups.find(g=>g.id==='creditors').rows[0];
 row.find(a=>a.key==='n8043').value='Другое';row.find(a=>a.key==='creditPurposeOther').value='LEGACY PURPOSE TEXT';
 set(p,'choice:debtPurpose:Жильё','Жильё',false);
 const r=run(p);assert.equal(r.issues.filter(i=>i.key==='debtPurposes').length,1);assert.equal(r.issues.some(i=>['n8043','creditPurposeOther'].includes(i.key)),false);
 set(p,'choice:debtPurpose:Жильё','Жильё',true);set(p,'choice:debtPurpose:Бизнес','Бизнес',true);
 assert.equal(run(p).answersComplete,true);const c=compileAssessment(p,iin);
 assert.equal(c.lawyerCard.split('На что в целом брали кредиты / почему возникли долги?').length-1,1);
 assert.match(c.lawyerCard,/Жильё; Бизнес/);assert.doesNotMatch(c.lawyerCard,/LEGACY PURPOSE TEXT|На что взяли кредит \/ почему возник долг/);
 assert.equal(validateDraft(p).groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='creditPurposeOther').value,'LEGACY PURPOSE TEXT');
});

function benefits(p,owner='client',frequency='Ежемесячно',amount='200000'){
 const group=p.groups.find(g=>g.id===owner+'benefits'),values={[owner+'BenefitType']:'Пенсия',[owner+'BenefitAmount']:amount,[owner+'BenefitFrequency']:frequency};
 set(p,owner+'BenefitsCount','1');group.rows=[schema.groups.find(g=>g.id===group.id).fields.map(f=>({key:f.key,value:values[f.key]||'',checked:false}))];group.rowKeys=[null];
}
test('pension-only contract includes actual benefits and preserves every payment frequency',()=>{
 for(const frequency of ['Ежемесячно','Ежеквартально','Ежегодно','Единовременно','Нерегулярно']){const p=fixture();p.docContext.social='1';benefits(p,'client',frequency);assert.equal(run(p).answersComplete,true);const income=contractData(p,iin).official_income;assert.match(income,/Пенсия/);assert.match(income,/200000/);assert.ok(income.includes(frequency));assert.doesNotMatch(income,/доход: 0|₸\/мес/);}
});
test('contract includes spouse benefits only while spouse answers apply',()=>{
 const p=fixture();benefits(p,'partner','Единовременно','345678');assert.doesNotMatch(contractData(p,iin).official_income,/345678/);
 set(p,'marital','В браке');for(const key of ['count-partnerjobs','count-partnerunofficial','partnerKaspiAnnual'])set(p,key,'0');set(p,'holding:partner:none','none',true);set(p,'holding:partner:businessNone','businessNone',true);
 assert.equal(run(p).answersComplete,true,JSON.stringify(run(p).issues));const income=contractData(p,iin).official_income;assert.match(income,/Супруг\(а\)/);assert.match(income,/345678/);assert.match(income,/Единовременно/);
});
test('benefit answers cannot silently contradict the document-step answer',()=>{
 const p=fixture();benefits(p);assert.ok(has(run(p),'clientBenefitsCount','BENEFITS_CONTEXT_CONFLICT'));assert.throws(()=>contractData(p,iin),/ANSWERS_INCOMPLETE/);
 p.docContext.social='1';assert.equal(run(p).answersComplete,true);
 const no=fixture();no.docContext.social='1';assert.ok(has(run(no),'clientBenefitsCount','BENEFITS_CONTEXT_CONFLICT'));set(no,'clientBenefitsCount','');assert.ok(has(run(no),'clientBenefitsCount','ANSWER_REQUIRED'));assert.equal(has(run(no),'clientBenefitsCount','BENEFITS_CONTEXT_CONFLICT'),false);
});
test('received-loan month is bounded by the operating day through validation and contract compilation',()=>{
 const p=fixture(),answer=p.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='n8038Start');
 for(const [month,day,valid] of [['2026-09','2026-09-01',true],['2026-10','2026-09-30',false],['2027-01','2026-12-31',false],['2027-01','2027-01-01',true],['2099-01','2026-09-14',false]]){answer.value=month;const checked=checkAnswers(validateDraft(p),iin,day);assert.equal(checked.answersComplete,valid,month+' / '+day);if(valid)assert.ok(contractData(p,iin,[],day));else{assert.ok(checked.issues.some(i=>i.code==='FUTURE_LOAN_MONTH'&&i.group==='creditors'&&i.row===0));assert.throws(()=>contractData(p,iin,[],day),/ANSWERS_INCOMPLETE/);}}
 for(const invalid of ['0000-01','2026-13']){answer.value=invalid;assert.ok(has(checkAnswers(p,iin,'2026-09-14'),'n8038Start','INVALID_MONTH'));}
});

// These exercise the served fourth tool, rather than the retired static prototype page.
test('active contract keeps enforcement separate from named loan participants',()=>{
 const p=fixture();p.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='loanParticipants').value='SYNTHETIC PERSON — Гарант';
 const data=contractData(p,iin);assert.equal(data.enforcement,'Нет');assert.match(data.guarantors,/SYNTHETIC PERSON/);
});
test('both active handoff outputs retain the lawyer note and exact documentary source',()=>{
 const p=fixture();set(p,'lawyerNotesStatus','yes');set(p,'comment','SYNTHETIC FOLLOW-UP');
 const evidence={key:'n8041',group:'creditors',row:0,value:'20.00',documentName:'synthetic.pdf',page:2,disposition:'confirmed'};
 const result=compileAssessment(p,iin,[evidence]);
 for(const card of [result.fullCard,result.lawyerCard]){assert.match(card,/SYNTHETIC FOLLOW-UP/);assert.match(card,/synthetic.pdf, стр. 2/);assert.match(card,/не удостоверяет подлинность/);}
});
test('legacy unknown property blocks final saving and cannot turn missing income or participants into zero or no',()=>{
 const p=fixture();set(p,'holding:client:none','none',false);set(p,'holding:client:unknown','unknown',true);
 assert.throws(()=>contractData(p,iin),/ANSWERS_INCOMPLETE/);set(p,'holding:client:unknown','unknown',false);set(p,'holding:client:none','none',true);
 set(p,'count-clientjobs','');assert.throws(()=>contractData(p,iin),/ANSWERS_INCOMPLETE/);
 set(p,'count-clientjobs','0');p.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='loanParticipants').value='';
 assert.throws(()=>contractData(p,iin),/ANSWERS_INCOMPLETE/);
});
test('retired document source remains a blocker after draft serialization',()=>{
 const p=fixture();p.answers.find(a=>a.key==='fio').sourceReplaced=true;
 const restored=validateDraft(JSON.parse(JSON.stringify(p)));assert.equal(restored.answers.find(a=>a.key==='fio').sourceReplaced,true);assert.ok(has(checkAnswers(restored,iin),'fio','ANSWER_SOURCE_REPLACED'));assert.throws(()=>compileAssessment(restored,iin),/ANSWERS_INCOMPLETE/);
});

test('claim inclusion defaults to yes for legacy loans; exclusion reaches the lawyer without reducing recorded debt',()=>{
 const p=fixture(),group=p.groups.find(g=>g.id==='creditors');
 group.rows[0]=group.rows[0].filter(a=>a.key!=='loanClaimIncluded');
 let c=compileAssessment(p,iin);assert.match(c.lawyerCard,/Включить в иск: Да/);assert.doesNotMatch(c.lawyerCard,/НЕ ВКЛЮЧАТЬ В ИСК/);
 group.rows[0].push({key:'loanClaimIncluded',value:'on',checked:false});
 const second=structuredClone(group.rows[0]);second.find(a=>a.key==='loanClaimIncluded').checked=true;second.find(a=>a.key==='n8038').value='SECOND BANK';second.find(a=>a.key==='n8040').value='200.50';group.rows.push(second);group.rowKeys.push(null);
 c=compileAssessment(p,iin);assert.equal(c.values.debt,'300.75');assert.match(c.lawyerCard,/НЕ ВКЛЮЧАТЬ В ИСК\n• Кредит 1: TEST BANK · 100.25 ₸/);assert.doesNotMatch(c.lawyerCard.split('ОБЩИЕ СВЕДЕНИЯ')[0],/SECOND BANK/);assert.match(c.lawyerCard,/Включить в иск: Нет/);assert.match(c.fullCard,/НЕ ВКЛЮЧАТЬ В ИСК/);assert.equal(validateDraft(p).groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='loanClaimIncluded').checked,false);
 assert.equal(contractData(p,iin).total_debt,'300,75');
 group.rows[0].find(a=>a.key==='loanParticipants').value='';assert.equal(run(p).answersComplete,false);
});

test('property and business choices are independent and each requires an explicit answer',()=>{
 const p=fixture();set(p,'holding:client:businessNone','businessNone',false);assert.ok(has(run(p),'holding:client:business','CHOICE_REQUIRED'));
 set(p,'holding:client:ip','ip',true);const group=p.groups.find(g=>g.id==='clientip');group.rows=[schema.groups.find(g=>g.id==='clientip').fields.map(f=>({key:f.key,value:f.key==='n8010'?'Нет':'0',checked:false}))];group.rowKeys=[null];
 assert.equal(run(p).answersComplete,true,JSON.stringify(run(p).issues));assert.equal(contractData(p,iin).property,'Нет');assert.match(contractData(p,iin).ip_status,/0/);
 set(p,'holding:client:businessNone','businessNone',true);assert.ok(has(run(p),'holding:client:business','CONFLICTING_CHOICES'));assert.ok(!has(run(p),'holding:client:','CONFLICTING_CHOICES'));
});
test('enforcement records require creditor and exact amount, persist zero and never double the debt',()=>{
 const p=fixture();set(p,'enforcementStatus','yes');assert.ok(has(run(p),'enforcements','ROW_REQUIRED'));
 const group=p.groups.find(g=>g.id==='enforcements');group.rows=[schema.groups.find(g=>g.id==='enforcements').fields.map(f=>({key:f.key,value:'',checked:false}))];group.rowKeys=[null];
 assert.ok(has(run(p),'enforcementCreditor'));assert.ok(has(run(p),'enforcementAmount'));
 group.rows[0].find(a=>a.key==='enforcementCreditor').value='SYNTHETIC BANK';group.rows[0].find(a=>a.key==='enforcementAmount').value='0';
 assert.equal(run(p).answersComplete,true);assert.match(contractData(p,iin).enforcement,/SYNTHETIC BANK — 0 ₸/);
 group.rows[0].find(a=>a.key==='enforcementAmount').value='500.25';assert.equal(contractData(p,iin).total_debt,'100,25');assert.match(compileAssessment(p,iin).lawyerCard,/Взыскание 1/);
 set(p,'enforcementStatus','no');assert.equal(contractData(p,iin).enforcement,'Нет');assert.doesNotMatch(compileAssessment(p,iin).lawyerCard,/SYNTHETIC BANK/);assert.equal(validateDraft(p).groups.find(g=>g.id==='enforcements').rows.length,1);
});
test('legacy enforcement notes remain usable without inventing structured facts',()=>{
 const p=fixture();p.answers=p.answers.filter(a=>a.key!=='enforcementStatus'&&!a.key.endsWith(':businessNone'));
 set(p,'enforcementDetails','  нет  ');assert.equal(run(p).answersComplete,true);assert.equal(contractData(p,iin).enforcement,'Нет');
 set(p,'enforcementDetails','Original creditor notes without a known amount');const saved=validateDraft(p);assert.equal(saved.answers.find(a=>a.key==='enforcementStatus').value,'legacy');assert.equal(saved.groups.find(g=>g.id==='enforcements').rows.length,0);assert.equal(contractData(p,iin).enforcement,'Original creditor notes without a known amount');
 set(p,'unknown:enforcementDetails','on',true);assert.ok(has(run(p),'enforcementStatus'));
});

test('land has separate repeated details, validates shares and reaches the contract and lawyer card',()=>{
 const p=fixture();set(p,'holding:client:none','none',false);set(p,'holding:client:land','land',true);
 assert.ok(has(run(p),'clientland','ROW_REQUIRED'));
 const group=p.groups.find(g=>g.id==='clientland'),definition=schema.groups.find(g=>g.id==='clientland');
 const values={clientLandDescription:'SYNTHETIC LAND 1',clientLandOwnership:'share',clientLandShare:'25',clientLandValue:'0',clientLandPledged:'Нет'};
 group.rows=[definition.fields.map(f=>({key:f.key,value:values[f.key]||'',checked:false}))];group.rowKeys=[null];
 assert.equal(run(p).answersComplete,true,JSON.stringify(run(p).issues));
 const second=structuredClone(group.rows[0]);second.find(a=>a.key==='clientLandDescription').value='SYNTHETIC LAND 2';second.find(a=>a.key==='clientLandOwnership').value='sole';second.find(a=>a.key==='clientLandShare').value='';group.rows.push(second);group.rowKeys.push(null);
 for(const text of [contractData(p,iin).property,compileAssessment(p,iin).lawyerCard]){assert.match(text,/SYNTHETIC LAND 1/);assert.match(text,/SYNTHETIC LAND 2/);assert.match(text,/Долевая собственность/);}
 const share=group.rows[0].find(a=>a.key==='clientLandShare');share.value='';assert.ok(has(run(p),'clientLandShare','ANSWER_REQUIRED'));share.value='101';assert.ok(has(run(p),'clientLandShare','INVALID_NUMBER'));
 set(p,'holding:client:none','none',true);assert.ok(has(run(p),'holding:client:','CONFLICTING_CHOICES'));
});
test('legacy land remains in the original property group and spouse land is conditional on marriage',()=>{
 const p=fixture();p.answers=p.answers.filter(a=>!a.key.endsWith(':land'));p.groups=p.groups.filter(g=>!g.id.endsWith('land'));
 set(p,'holding:client:none','none',false);set(p,'holding:client:real','real',true);const g=p.groups.find(g=>g.id==='clientreal'),values={n8003:'Земельный участок',n8004Kind:'sole',n8005:'10000',n8006:'Нет'};
 g.rows=[schema.groups.find(g=>g.id==='clientreal').fields.map(f=>({key:f.key,value:values[f.key]||'',checked:false}))];g.rowKeys=['clientreal|SYNTHETIC EXISTING LAND'];
 const restored=validateDraft(p);assert.equal(JSON.stringify(restored.groups),JSON.stringify(p.groups));assert.match(contractData(restored,iin).property,/Земельный участок/);
 p.answers.push({key:'holding:partner:land',value:'land',checked:true});assert.ok(!has(run(p),'partnerland','ROW_REQUIRED'));set(p,'marital','В браке');assert.ok(has(run(p),'partnerland','ROW_REQUIRED'));
});
