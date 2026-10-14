import * as loanDates from '../public/loan-dates.mjs';
import * as profileExplanations from '../public/profile-explanations.mjs';
import {webcrypto} from 'node:crypto';
import * as intake from '../public/intake-data.mjs';
// Final readiness regressions with synthetic source files and repository records only.
import {test} from 'node:test';
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'package.json'),ts=require('typescript');
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>{if(n==='../../public/loan-dates.mjs')return loanDates;if(n==='../../public/intake-data.mjs')return intake;if(n in imports)return imports[n];throw Error('Missing audit import: '+n);},Date,Map,Set,TextEncoder,crypto:webcrypto});return exports;}
const schema=JSON.parse(fs.readFileSync(root+'lib/questionnaire/schema.json'));
const participants=await import(root+'public/loan-participants.mjs'),schedule=await import(root+'public/payment-schedule.mjs'),words=await import(root+'public/contract-words.mjs');
const native=load('lib/documents/extract-native.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./kz-labels.json':JSON.parse(fs.readFileSync(root+'lib/documents/kz-labels.json'))});
const image=load('lib/documents/read-image.ts',{'./read-document-limits':load('lib/documents/read-document-limits.ts')});
const repoTypes=load('lib/documents/repository.ts',{'./extract-native':native,'./read-image':image,'./pdf-text-heuristics':load('lib/documents/pdf-text-heuristics.ts')}),policy=load('lib/documents/policy.ts');
const {validateDraft}=load('lib/questionnaire/draft.ts',{'./schema.json':schema,'./draft-recovery':load('lib/questionnaire/draft-recovery.ts'),'../documents/repository':repoTypes});
const {checkAnswers}=load('lib/questionnaire/check-answers.ts',{'../../public/profile-explanations.mjs':profileExplanations,'./schema.json':schema,'../documents/extract-native':native,'../../public/payment-schedule.mjs':schedule,'../../public/loan-participants.mjs':participants});
const compiler=load('lib/questionnaire/compile-assessment.ts',{'./draft':{validateDraft},'./check-answers':{checkAnswers},'../documents/repository':repoTypes,'../../public/payment-schedule.mjs':schedule});
const {contractData}=load('lib/questionnaire/contract-data.ts',{'./compile-assessment':compiler,'./check-answers':{checkAnswers},'../../public/contract-words.mjs':words,'../documents/repository':repoTypes});
const powerValidation=load('lib/documents/power-validation.ts',{'./power-of-attorney':load('lib/documents/power-of-attorney.ts'),'./policy':policy,'./approved-representatives.server.json':[]});
const reviewService=load('lib/documents/review-service.ts',{'./power-validation':powerValidation,'./repository':repoTypes,'./policy':policy,'./analysis-service':{analysisVersion:'audit-current'}});
const {checkReviewBindings,parseReviewBindings}=load('lib/questionnaire/review-bindings.ts',{'../documents/loan-identity':load('lib/documents/loan-identity.ts'),'../documents/repository':repoTypes,'../documents/review-service':reviewService});
const manual={'Удостоверение личности':'identity','Доверенность':'power_of_attorney','Справка ЕНПФ':'enpf','Ф6 об отсутствии имущества':'property'};
const balanceService=load('lib/documents/gkb-balance-review.ts',{'./repository':repoTypes,'./analysis-version':{analysisVersion:'audit-current'},'./credit-report-match':load('lib/documents/credit-report-match.ts',{'./policy':policy,'./loan-identity':load('lib/documents/loan-identity.ts')}),'./loan-identity':load('lib/documents/loan-identity.ts')});
const {checkDocumentPackage}=load('lib/documents/package-check.ts',{'./gkb-balance-review':balanceService,'./loan-identity':load('lib/documents/loan-identity.ts'),'./analysis-service':{analysisVersion:'audit-current',documentReviewContext:load('lib/documents/analysis-service.ts',{'./loan-date-evidence':load('lib/documents/loan-date-evidence.ts',{'./extract-native':native}),'./policy':policy,'./extract-native':native,'./read-pdf':{},'./read-image':image,'./read-document':{},'./request-context':{},'./repository':repoTypes,'./power-validation':powerValidation,'./analysis-version':{},'./document-review':{}}).documentReviewContext},'./policy':policy,'./credit-report-match':load('lib/documents/credit-report-match.ts',{'./policy':policy,'./loan-identity':load('lib/documents/loan-identity.ts')}),'./document-review':{MANUAL_DOCUMENT_TYPES:manual,currentDocumentReview:async(_repo,_record,id,_extraction,_analysis,type)=>({id:'audit-review-'+id,value:{type:Array.isArray(type)?type[0]:type},actorId:'synthetic',reviewedAt:'2026-09-14'})},'./power-validation':powerValidation});
const iin='000000000010',day='2026-09-14';
function fixture(){
 const values={fio:'SYNTHETIC AUDIT',enforcementStatus:'no',enforcementDetails:'Нет',iin,dognum:'AUDIT',marital:'Холост / не замужем',regAddress:'TEST REGISTRATION',factAddressSame:'same',dependents:'0',childrenTotal:'0',procedure:'199','count-clientjobs':'0','count-clientunofficial':'0',clientBenefitsCount:'0',c8037:'0',hardshipReason:'Платежи вношу, трудностей нет',kaspiAnnual:'0',gamblingTransfers:'no',lawyerNotesStatus:'no',n8044:'0',summa:'500000',contractDate:day,months:'5',payDay:'7',grafType:'423'};
 const credit={n8038:'TEST BANK',loanContractId:'LOAN1',n8038Start:'2025-01',n8039:'Потребительский кредит',loanStatus:'Платится по графику',n8040:'100.25',n8041:'10.00',n8042:'0',loanParticipants:'Нет'};
 return {schemaVersion:1,answers:schema.scalar.map(f=>({key:f.key,value:values[f.key]||'',checked:['choice:socialStatus:Нет','holding:client:none','holding:client:businessNone','choice:debtPurpose:Жильё'].includes(f.key)})),groups:schema.groups.map(g=>({id:g.id,rows:g.id==='creditors'?[g.fields.map(f=>({key:f.key,value:credit[f.key]||'',checked:false}))]:[],rowKeys:g.id==='creditors'?[`creditors|${iin}|TEST BANK|LOAN1`]:[]})),docContext:{social:'0',salary:'0',salaryBank:'none'},documents:[],pendingFiles:[]};
}
const set=(p,key,value,checked)=>{const a=p.answers.find(a=>a.key===key);a.value=value;if(checked!==undefined)a.checked=checked;};
function repositoryFor(p){
 const entries=[['short','ГКБ — краткий отчёт','gkb_short'],['full','ГКБ — полный отчёт','gkb_full'],['enpf','Справка ЕНПФ','enpf'],['property','Ф6 об отсутствии имущества','property'],['identity','Удостоверение личности','identity'],['power','Доверенность','power_of_attorney'],['kaspi','Выписка Kaspi Gold','kaspi']];
 const sources=new Map();for(const [id,type,kind] of entries){p.documents.push({documentId:id,type,person:'Клиент'});sources.set(id,{read:{pages:[{text:'SYNTHETIC',needsOcr:false}]},extraction:{kind,identity:{iin},issuedAt:day,facts:[],findings:[],bankStatement:{from:'2025-09-01',to:'2026-08-31',reconciled:true,rowsReadable:true},credits:kind.startsWith('gkb_')?[{contractNumber:'LOAN1',page:1,facts:[{key:'creditor',value:'TEST BANK',page:1},{key:'contractIdentifier',value:'LOAN1',page:1},{key:'loanStatus',value:'Платится по графику',page:1},{key:'debtOutstanding',value:'100.25',page:1},{key:'monthlyPayment',value:'10.00',page:1},{key:'overdueDays',value:'0',page:1}]}]:[]}});}
 const repository={document:async(_case,id)=>sources.has(id)?{id,case_id:_case,original_sha256:id}:null,cached:async(_case,id)=>({result:sources.get(id),extraction:{id}}),credentialStatus:async()=>({verified:true})};
 return {repository,sources,run:()=>checkDocumentPackage(repository,{id:'synthetic-case',client_iin:iin},p,day)};
}

const {finalCheck}=load('lib/questionnaire/final-check.ts',{'./draft':{validateDraft},'./check-answers':{checkAnswers},'./compile-assessment':compiler,'./review-bindings':{parseReviewBindings,checkReviewBindings},'../documents/package-check':{checkDocumentPackage},'./contract-data':{contractData}});
const record={id:'synthetic-case',client_iin:iin,identity_revision:1};
const check=async(p,s,bindings=[])=> (await finalCheck(s.repository,record,p,bindings,day)).publicResult;
test('final readiness accepts a reviewed loan with the form normalized key',async()=>{
 const p=fixture(),s=repositoryFor(p);assert.equal((await check(p,s)).readyToSubmit,true);
 p.groups.find(g=>g.id==='creditors').rowKeys[0]=`creditors|${iin}|testbank|LOAN1`;
 s.repository.extraction=async()=>({id:'ext',document_id:'full',version:'audit-current'});s.repository.readResult=async()=>s.sources.get('full');
 s.repository.currentReviews=async()=>[{id:'review',fact_key:'credits.0.monthlyPayment',value_json:'"10.00"',disposition:'confirmed',reason:''}];
 const r=await check(p,s,[{key:'n8041',group:'creditors',row:0,documentId:'full',extractionId:'ext',factKey:'credits.0.monthlyPayment',reviewId:'review'}]);assert.equal(r.readyToSubmit,true,JSON.stringify(r.evidence.issues));assert.equal(r.evidence.approved.length,1);
});
test('a bank spacing discrepancy blocks the complete package at the final gate',async()=>{
 const p=fixture(),s=repositoryFor(p);assert.equal((await check(p,s)).readyToSubmit,true);
 const facts=s.sources.get('full').extraction.credits[0].facts;facts.find(f=>f.key==='monthlyPayment').value='12.00';facts.find(f=>f.key==='creditor').value='TEST  BANK';
 const r=await check(p,s);assert.equal(r.answersComplete,true);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.packageReady,false);assert.ok(r.documents.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));assert.deepEqual(Array.from(r.remainingGates),['document-validation']);
});
test('a later pension cannot finish without a matching benefit answer and certificate',async()=>{
 const p=fixture(),s=repositoryFor(p);assert.equal((await check(p,s)).readyToSubmit,true);
 set(p,'clientBenefitsCount','1');const group=p.groups.find(g=>g.id==='clientbenefits'),values={clientBenefitType:'Пенсия',clientBenefitAmount:'200000',clientBenefitFrequency:'Ежемесячно'};
 group.rows=[schema.groups.find(g=>g.id===group.id).fields.map(f=>({key:f.key,value:values[f.key]||'',checked:false}))];group.rowKeys=[null];
 let r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.preview,null);assert.ok(r.issues.some(i=>i.code==='BENEFITS_CONTEXT_CONFLICT'));assert.ok(r.documents.missing.includes('Справка по выплатам пенсии и пособий'));
 p.docContext.social='1';r=await check(p,s);assert.equal(r.answersComplete,true);assert.equal(r.readyToSubmit,false);assert.match(r.preview.contractData.official_income,/200000/);assert.match(r.preview.contractData.official_income,/Ежемесячно/);assert.doesNotMatch(r.preview.contractData.official_income,/доход: 0/);
});
test('future loan month cannot generate contract data through final readiness',async()=>{
 const p=fixture(),s=repositoryFor(p);assert.equal((await check(p,s)).readyToSubmit,true);
 p.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='n8038Start').value='2099-01';
 const r=await check(p,s);assert.equal(r.documents.packageReady,true);assert.equal(r.answersComplete,false);assert.equal(r.preview,null);assert.equal(r.readyToSubmit,false);assert.ok(r.issues.some(i=>i.code==='FUTURE_LOAN_MONTH'));
});
test('final gate checks every active source loan against actual saved answers, including zero balances',async()=>{
 for(const failure of ['none','missing','duplicate','wrong-number','wrong-bank','stale-key']){
  const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction;full.creditList={complete:true,declared:2};
  const extra=structuredClone(full.credits[0]);extra.contractNumber='ZERO-CARD';extra.page=4;extra.facts.find(f=>f.key==='debtOutstanding').value='0.00';full.credits.push(extra);
  const group=p.groups.find(g=>g.id==='creditors'),row=structuredClone(group.rows[0]);row.find(a=>a.key==='loanContractId').value='ZERO-CARD';row.find(a=>a.key==='n8040').value='0.00';group.rows.push(row);group.rowKeys.push(`creditors|${iin}|TEST BANK|ZERO-CARD`);
  if(failure==='missing'){group.rows.pop();group.rowKeys.pop();}
  if(failure==='duplicate'){group.rows.push(structuredClone(row));group.rowKeys.push(null);}
  if(failure==='wrong-number')row.find(a=>a.key==='loanContractId').value='WRONG';
  if(failure==='wrong-bank')row.find(a=>a.key==='n8038').value='OTHER BANK';
  if(failure==='stale-key')group.rowKeys[1]='creditors|old-row-key';
  const r=await check(p,s),ok=['none','stale-key'].includes(failure);assert.equal(r.readyToSubmit,ok,failure);assert.equal(r.documents.loanCoverage.expected,2);assert.equal(r.documents.loanCoverage.complete,ok,failure);assert.equal(r.documents.packageReady,true,'missing answers do not masquerade as broken documents');
  if(!ok){assert.equal(r.preview,null);assert.ok(r.issues.some(i=>['ACTIVE_LOAN_MISSING','ACTIVE_LOAN_DUPLICATE'].includes(i.code)),failure);}
  if(failure==='wrong-number'){const issue=r.issues.find(i=>i.code==='ACTIVE_LOAN_MISSING');assert.equal(issue.row,1);assert.match(issue.label,/проверьте номер договора в кредитах 2/);assert.doesNotMatch(issue.label,/добавьте/);assert.equal(row.find(a=>a.key==='loanContractId').value,'WRONG');}
  if(failure==='missing')assert.match(r.issues.find(i=>i.code==='ACTIVE_LOAN_MISSING').label,/добавьте/);
 }
});

test('final gate accepts MFO spelling variants and catches duplicate bank aliases without changing answers',async()=>{
 for(const [shortName,fullName] of [['ТОО Микрофинансовая организация «Synthetic Finance»','ТОО «МФО «Synthetic Finance»'],['АО "Народный банк Казахстана"','"Народный банк Казахстана"']]){
  const p=fixture(),s=repositoryFor(p),group=p.groups.find(g=>g.id==='creditors');
  group.rows[0].find(a=>a.key==='n8038').value=shortName;group.rowKeys[0]=`creditors|${iin}|${shortName}|LOAN1`;
  for(const [id,name] of [['short',shortName],['full',fullName]]){const report=s.sources.get(id).extraction;report.creditList={complete:true,declared:1};report.credits[0].facts.find(f=>f.key==='creditor').value=name;}
  const before=JSON.stringify(p);let r=await check(p,s);assert.equal(r.readyToSubmit,true,JSON.stringify(r.issues));assert.equal(r.documents.loanCoverage.present,1);assert.equal(JSON.stringify(p),before);
  const duplicate=structuredClone(group.rows[0]);duplicate.find(a=>a.key==='n8038').value=fullName;group.rows.push(duplicate);group.rowKeys.push(null);
  const duplicated=JSON.stringify(p);r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.missing,0);assert.equal(r.documents.loanCoverage.duplicates,1);assert.match(r.issues.find(i=>i.code==='ACTIVE_LOAN_DUPLICATE').label,/кредитах 1, 2/);assert.equal(JSON.stringify(p),duplicated);
 }
});

test('an unidentified old sourced alias cannot double a loan, but stale keys cannot override valid different numbers',async()=>{
 const p=fixture(),s=repositoryFor(p),group=p.groups.find(g=>g.id==='creditors');s.sources.get('full').extraction.creditList={complete:true,declared:1};
 const alias=structuredClone(group.rows[0]);alias.find(a=>a.key==='loanContractId').value='';group.rows.push(alias);group.rowKeys.push(`creditors|${iin}|test  bank|LOAN1`);
 let r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.duplicates,1);assert.match(r.issues.find(i=>i.code==='ACTIVE_LOAN_DUPLICATE').label,/кредитах 1, 2/);assert.equal(alias.find(a=>a.key==='loanContractId').value,'');
 alias.find(a=>a.key==='loanContractId').value='OTHER-LOAN';r=await check(p,s);assert.equal(r.documents.loanCoverage.duplicates,1,'an arbitrary replacement number cannot hide an old sourced duplicate');
 const otherLoan=structuredClone(s.sources.get('full').extraction.credits[0]);otherLoan.contractNumber='OTHER-LOAN';s.sources.get('full').extraction.credits.push(otherLoan);s.sources.get('full').extraction.creditList.declared=2;
 r=await check(p,s);assert.equal(r.documents.loanCoverage.complete,true,'a stale key never overrides a different actual loan in the report');s.sources.get('full').extraction.credits.pop();s.sources.get('full').extraction.creditList.declared=1;
 group.rows.shift();group.rowKeys.shift();alias.find(a=>a.key==='loanContractId').value='';r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.missing,1,'a source key alone never counts as an included loan');assert.match(r.issues.find(i=>i.code==='ACTIVE_LOAN_MISSING').label,/проверьте номер/);
});
test('a pensioner without an ENPF account needs the benefits certificate instead of the ENPF certificate',async()=>{
 const requiredFor=async ctx=>{const p=fixture();p.docContext={social:'1',salary:'0',salaryBank:'none',...ctx};return (await repositoryFor(p).run()).required;};
 const none=await requiredFor({enpf:'none'});assert.equal(none.includes('Справка ЕНПФ'),false);assert.ok(none.includes('Справка по выплатам пенсии и пособий'));
 assert.ok((await requiredFor({})).includes('Справка ЕНПФ'));assert.ok((await requiredFor({enpf:''})).includes('Справка ЕНПФ'));
 const draft=fixture();draft.docContext={social:'1',salary:'0',salaryBank:'none',enpf:'none'};assert.equal(validateDraft(draft).docContext.enpf,'none');
 draft.docContext={social:'0',salary:'0',salaryBank:'none',enpf:'none'};assert.throws(()=>validateDraft(draft),/INVALID_ENPF_CONTEXT/);
});

test('newest short GKB updates matched amounts but missing prior-full obligations require reconciliation',async()=>{
 const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
 full.issuedAt='2026-06-17';full.creditList={complete:true,declared:2};short.issuedAt='2026-08-04';short.creditList={complete:true,declared:1};
 const historical=structuredClone(full.credits[0]);historical.contractNumber='OLDER-ONLY';full.credits.push(historical);
 full.credits[0].facts.find(f=>f.key==='monthlyPayment').value='55.00';full.credits[0].facts.find(f=>f.key==='debtOutstanding').value='500.00';
 const before=JSON.stringify(p),originals=JSON.stringify([...s.sources]);
 let r=await check(p,s);assert.equal(r.readyToSubmit,false,JSON.stringify(r));assert.equal(r.documents.loanCoverage.expected,2);assert.equal(r.documents.loanCoverage.rows[0].documentId,'short');assert.equal(r.documents.conflicts.length,0);
 const prior=r.documents.loanCoverage.rows.find(loan=>loan.contractNumber==='OLDER-ONLY');assert.equal(prior.priorReportOnly,true);assert.equal(prior.status,'missing');
 const priorIssue=r.issues.find(i=>i.code==='ACTIVE_LOAN_MISSING');assert.match(priorIssue.label,/сверьте обязательство из более раннего ГКБ/);assert.match(priorIssue.label,/не подтверждает закрытие/);assert.doesNotMatch(priorIssue.label,/добавьте активный/);
 assert.equal(JSON.stringify(p),before);assert.equal(JSON.stringify([...s.sources]),originals);
 p.groups.find(g=>g.id==='creditors').rows[0].find(a=>a.key==='loanContractId').value='WRONG';
 r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.missing,2);assert.match(r.issues.find(i=>i.code==='ACTIVE_LOAN_MISSING').label,/В ГКБ/);assert.doesNotMatch(r.issues.find(i=>i.code==='ACTIVE_LOAN_MISSING').label,/полном/);
});

test('newer incomplete, unreadable, wrongly selected or wrong-owner GKB cannot hide earlier complete obligations',async()=>{
 for(const failure of ['incomplete','role-warning','unreadable','wrong-owner','wrong-type','future','invalid','no-pages']){
  const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
  full.issuedAt='2026-06-17';full.creditList={complete:true,declared:2};const historical=structuredClone(full.credits[0]);historical.contractNumber='STILL-REQUIRED';full.credits.push(historical);
  short.issuedAt='2026-08-04';short.creditList={complete:true,declared:1};
  if(failure==='incomplete')short.creditList.complete=false;
  if(failure==='role-warning')short.findings=['CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES'];
  if(failure==='unreadable')s.sources.get('short').read.pages[0].needsOcr=true;
  if(failure==='wrong-owner')short.identity.iin='another-client';
  if(failure==='wrong-type')p.documents.find(d=>d.documentId==='short').type='ГКБ — полный отчёт';
  if(failure==='future')short.issuedAt='2099-01-01';
  if(failure==='invalid')short.issuedAt='2026-02-30';
  if(failure==='no-pages')s.sources.get('short').read.pages=[];
  const before=JSON.stringify(p),r=await check(p,s);assert.equal(r.readyToSubmit,false,failure);assert.equal(r.documents.loanCoverage.expected,2,failure);assert.equal(r.documents.loanCoverage.missing,1,failure);assert.ok(r.issues.some(i=>i.code==='ACTIVE_LOAN_MISSING'),failure);assert.equal(JSON.stringify(p),before);
 }
});

test('newest full report also supersedes an older short report; same-date conflicts still block',async()=>{
 const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
 full.creditList={complete:true,declared:1};short.creditList={complete:true,declared:1};short.issuedAt='2025-01-01';short.credits[0].facts.find(f=>f.key==='monthlyPayment').value='55.00';
 let r=await check(p,s);assert.equal(r.readyToSubmit,true);assert.equal(r.documents.conflicts.length,0);assert.equal(r.documents.loanCoverage.rows[0].documentId,'full');
 short.issuedAt=full.issuedAt;r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.conflicts.length,1);assert.deepEqual(Array.from(r.documents.conflicts[0].documentIds),['short','full']);assert.ok(r.documents.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));
});

test('same-date complete reports retain every active obligation including full-report zero limits',async()=>{
 const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
 full.creditList={complete:true,declared:2};short.creditList={complete:true,declared:1};const zero=structuredClone(full.credits[0]);zero.contractNumber='ZERO-LIMIT';zero.facts.find(f=>f.key==='debtOutstanding').value='0.00';full.credits.push(zero);
 const r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.expected,2);assert.equal(r.documents.loanCoverage.missing,1);assert.equal(r.documents.loanCoverage.rows.find(loan=>loan.contractNumber==='ZERO-LIMIT').status,'missing');
});

test('same-date complete report aliases identify one loan only when the match is unique',async()=>{
 const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
 full.creditList={complete:true,declared:1};short.creditList={complete:true,declared:1};full.credits[0].contractCode='CODE1';
 let r=await check(p,s);assert.equal(r.readyToSubmit,true,JSON.stringify(r));assert.equal(r.documents.loanCoverage.expected,1);assert.deepEqual(Array.from(r.documents.loanCoverage.rows[0].aliases),['CODE1','LOAN1']);
 short.credits[0].facts.find(f=>f.key==='monthlyPayment').value='11.00';r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.ok(r.documents.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'),'a printed alias cannot hide a same-date financial conflict');
 short.credits[0].facts.find(f=>f.key==='monthlyPayment').value='10.00';
 const ambiguous=structuredClone(full.credits[0]);ambiguous.contractCode='CODE2';full.credits.push(ambiguous);full.creditList.declared=2;
 r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.ok(r.documents.loanCoverage.duplicates>0,'one printed alias must never satisfy two distinct contract codes');
});

test('a newer short report cannot erase zero or unknown obligations from a prior full report',async()=>{
 for(const amount of ['0.00',null]){
  const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
  full.issuedAt='2026-06-17';full.creditList={complete:true,declared:2};short.issuedAt='2026-08-04';short.creditList={complete:true,declared:1};
  const omitted=structuredClone(full.credits[0]);omitted.contractNumber='OMITTED';
  if(amount===null)omitted.facts=omitted.facts.filter(f=>f.key!=='debtOutstanding');else omitted.facts.find(f=>f.key==='debtOutstanding').value=amount;
  full.credits.push(omitted);
  const before=JSON.stringify(p),r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.expected,2);assert.equal(r.documents.loanCoverage.missing,1);assert.equal(r.documents.loanCoverage.rows.find(loan=>loan.contractNumber==='OMITTED').priorReportOnly,true);assert.equal(JSON.stringify(p),before);
 }
});

test('newer unrelated short rows do not hide prior obligation conflicts and may add coverage',async()=>{
 const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
 full.issuedAt='2026-06-17';full.creditList={complete:true,declared:1};short.issuedAt='2026-08-04';short.creditList={complete:true,declared:1};short.credits[0].contractNumber='NEW-LOAN';
 const secondFull=structuredClone(s.sources.get('full'));secondFull.extraction.credits[0].facts.find(f=>f.key==='monthlyPayment').value='12.00';s.sources.set('full-2',secondFull);p.documents.push({documentId:'full-2',type:'ГКБ — полный отчёт',person:'Клиент'});
 const r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.expected,2);assert.ok(r.documents.loanCoverage.rows.some(loan=>loan.contractNumber==='NEW-LOAN'&&loan.status==='missing'));
 assert.equal(r.documents.conflicts.length,1);assert.equal(r.documents.conflicts[0].contractNumber,'LOAN1');assert.deepEqual(Array.from(r.documents.conflicts[0].documentIds),['full','full-2']);assert.ok(r.documents.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));
});

test('partial reports cannot supersede matched financial evidence regardless of their date',async()=>{
 for(const date of ['2026-06-17','2026-09-14']){
  const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction,short=s.sources.get('short').extraction;
  full.issuedAt='2026-08-04';full.creditList={complete:true,declared:1};short.issuedAt=date;short.creditList={complete:false,declared:2};short.credits[0].facts.find(f=>f.key==='monthlyPayment').value='55.00';short.findings=['CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES'];
  const r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.expected,1);assert.equal(r.documents.conflicts.length,1);assert.ok(r.documents.issues.some(i=>i.code==='CREDIT_REPORT_CONFLICT'));assert.ok(r.documents.issues.some(i=>i.code==='CREDIT_LIST_REVIEW_REQUIRED'));
 }
});

test('existing full-report coverage union is preserved without automatically declaring prior-only loans closed',async()=>{
 const p=fixture(),s=repositoryFor(p),full=s.sources.get('full').extraction;full.issuedAt='2026-06-17';full.creditList={complete:true,declared:2};const prior=structuredClone(full.credits[0]);prior.contractNumber='PRIOR-ONLY';full.credits.push(prior);
 const latest=structuredClone(s.sources.get('full'));latest.extraction.issuedAt=day;latest.extraction.credits.pop();latest.extraction.creditList.declared=1;s.sources.set('latest-full',latest);p.documents.push({documentId:'latest-full',type:'ГКБ — полный отчёт',person:'Клиент'});
 const r=await check(p,s);assert.equal(r.readyToSubmit,false);assert.equal(r.documents.loanCoverage.expected,2);assert.equal(r.documents.loanCoverage.rows.find(loan=>loan.contractNumber==='PRIOR-ONLY').priorReportOnly,true);assert.match(r.issues.find(i=>i.code==='ACTIVE_LOAN_MISSING').label,/сверьте обязательство/);
});
