import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';
function load(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>imports[n],Date,Map,Set});return exports;}
const repoTypes=load('lib/documents/repository.ts'),policy=load('lib/documents/policy.ts');
const reviews=load('lib/documents/review-service.ts',{'./repository':repoTypes,'./policy':policy,'./analysis-service':{analysisVersion:'current'}});
const {checkReviewBindings,parseReviewBindings}=load('lib/questionnaire/review-bindings.ts',{'../documents/loan-identity':load('lib/documents/loan-identity.ts'),'../documents/repository':repoTypes,'../documents/review-service':reviews});
function setup(){
 const record={id:'case',identity_revision:1,client_iin:'test-client'};
 const doc={id:'doc',case_id:'case',original_sha256:'test-hash'},extraction={id:'ext',document_id:'doc',version:'current'};
 const result={extraction:{identity:{iin:'test-client'},kind:'gkb_full',issuedAt:'2026-09-10',findings:[],facts:[],credits:[{contractNumber:'LOAN1',facts:[{key:'creditor',value:'TEST BANK',page:1,source:'TEST'},{key:'monthlyPayment',value:'10.00',page:2,source:'TEST PAYMENT'},{key:'debtOutstanding',value:'100.00',page:2,source:'TEST DEBT'}]}]}};
 let reads=0;const current=[{id:'review',fact_key:'credits.0.monthlyPayment',value_json:'"12.00"',disposition:'corrected',reason:'TEST correction'}];
 const repository={document:async(caseId,id)=>caseId==='case'&&id==='doc'?doc:null,extraction:async()=>extraction,readResult:async()=>{reads++;return result;},currentReviews:async()=>current};
 const payload={groups:[{id:'creditors',rowKeys:['creditors|test-client|TEST BANK|LOAN1']}]},active=[{key:'n8041',group:'creditors',row:0,value:'12.00'}];
 const binding={key:'n8041',group:'creditors',row:0,documentId:'doc',extractionId:'ext',factKey:'credits.0.monthlyPayment',reviewId:'review'};
 return{record,doc,extraction,result,current,payload,active,binding,reads:()=>reads,run:async(bs=[binding])=>checkReviewBindings(repository,record,payload,active,bs,'2026-09-10')};
}
test('review links corrected value to its exact loan field and original source',async()=>{const s=setup(),r=await s.run();assert.equal(r.issues.length,0);assert.equal(r.approved[0].value,'12.00');assert.equal(r.approved[0].page,2);assert.equal(r.approved[0].documentSha256,'test-hash');});
test('review accepts the printed contract code but prevents counting both aliases as separate loans',async()=>{
 const s=setup();s.result.extraction.credits[0].contractCode='CODE1';s.payload.groups[0].rowKeys=['creditors|test-client|TEST BANK|CODE1'];assert.equal((await s.run()).issues.length,0);
 s.payload.groups[0].rowKeys.push('creditors|test-client|TEST BANK|LOAN1');assert.equal((await s.run()).issues[0].code,'REVIEW_LOAN_DUPLICATE');
});
test('changed values, loan targets, field targets and pending reviews cannot borrow approval',async()=>{
 for(const [edit,code] of [[s=>s.active[0].value='13.00','REVIEW_VALUE_CHANGED'],[s=>s.payload.groups[0].rowKeys[0]='creditors|test-client|OTHER|LOAN2','REVIEW_LOAN_MISMATCH'],[s=>{s.binding.key='n8040';s.active[0].key='n8040';},'REVIEW_TARGET_MISMATCH'],[s=>s.binding.reviewId=null,'ANSWER_REVIEW_REQUIRED']]){const s=setup();edit(s);assert.equal((await s.run()).issues[0].code,code);}
});
test('old extraction, stale GKB and superseded reviews lose eligibility',async()=>{
 for(const [edit,code] of [[s=>s.extraction.version='old','EXTRACTION_VERSION_CHANGED'],[s=>s.result.extraction.issuedAt='2026-08-10','GKB_DATE_NOT_ACCEPTABLE'],[s=>s.current.splice(0),'REVIEW_SUPERSEDED_OR_MISSING'],[s=>s.binding.documentId='foreign','DOCUMENT_NOT_IN_CASE']]){const s=setup();edit(s);assert.equal((await s.run()).issues[0].code,code);}
});
test('duplicate target rejected; one cached source read serves several fields',async()=>{
 const s=setup();s.active.push({key:'n8040',group:'creditors',row:0,value:'100.00'});s.current.push({id:'review2',fact_key:'credits.0.debtOutstanding',value_json:'"100.00"',disposition:'confirmed',reason:''});
 const other={...s.binding,key:'n8040',factKey:'credits.0.debtOutstanding',reviewId:'review2'};
 const r=await s.run([s.binding,other,s.binding]);assert.equal(r.approved.length,2);assert.equal(r.issues[0].code,'DUPLICATE_REVIEW_TARGET');assert.equal(s.reads(),1);
});
test('binding input rejects invented shapes and unmatched group/row',()=>{assert.equal(parseReviewBindings(undefined).length,0);const s=setup();assert.equal(parseReviewBindings([s.binding]).length,1);assert.throws(()=>parseReviewBindings([{...s.binding,row:-1}]),/INVALID_REVIEW_BINDINGS/);assert.throws(()=>parseReviewBindings([{...s.binding,group:undefined}]),/INVALID_REVIEW_BINDINGS/);});

test('explicit client-confirmed debt is not misrepresented as approved document evidence',async()=>{
 const s=setup();s.payload.groups[0].rows=[[{key:'n8040',value:'1200.50',checked:false,clientConfirmed:true}]];
 s.active[0]={key:'n8040',group:'creditors',row:0,value:'1200.50'};s.binding.key='n8040';s.binding.factKey='credits.0.debtOutstanding';s.binding.reviewId=null;
 const r=await s.run();assert.equal(r.issues.length,0);assert.equal(r.approved.length,0);assert.equal(s.reads(),0);
 delete s.payload.groups[0].rows[0][0].clientConfirmed;assert.equal((await s.run()).issues[0].code,'ANSWER_REVIEW_REQUIRED');
});

test('participant approval is valid only for its own loan and never for a different loan at the same bank',async()=>{
 const s=setup(),value='TEST PERSON — Гарант';s.result.extraction.credits[0].facts.push({key:'relatedParties',value,page:3,source:'Связанные субъекты'});
 s.active[0]={key:'loanParticipants',group:'creditors',row:0,value};s.binding.key='loanParticipants';s.binding.factKey='credits.0.relatedParties';s.current[0]={id:'review',fact_key:s.binding.factKey,value_json:JSON.stringify(value),disposition:'confirmed',reason:''};
 const accepted=await s.run();assert.equal(accepted.issues.length,0);assert.equal(accepted.approved[0].page,3);
 s.payload.groups[0].rowKeys[0]='creditors|test-client|TEST BANK|LOAN2';assert.equal((await s.run()).issues[0].code,'REVIEW_LOAN_MISMATCH');
});

test('review accepts form-normalized creditor names, including Unicode and internal spacing',async()=>{
 for(const name of ['testbank','TEST  BANK','Test\u00a0Bank','ＴＥＳＴ ＢＡＮＫ']){const s=setup();s.payload.groups[0].rowKeys[0]=`creditors|test-client|${name}|LOAN1`;assert.equal((await s.run()).issues.length,0,name);}
});
test('normalized duplicate aliases are rejected without conflating client or contract identity',async()=>{
 const s=setup();s.result.extraction.credits[0].contractCode='CODE1';s.payload.groups[0].rowKeys=['creditors|test-client|testbank|CODE1','creditors|test-client|TEST  BANK|LOAN1'];assert.equal((await s.run()).issues[0].code,'REVIEW_LOAN_DUPLICATE');
 for(const key of ['creditors|TEST-CLIENT|testbank|LOAN1','creditors|test-client|otherbank|LOAN1','creditors|test-client|testbank|loan1','creditors|test-client|testbank|LOAN2']){const other=setup();other.payload.groups[0].rowKeys=[key];assert.equal((await other.run()).issues[0].code,'REVIEW_LOAN_MISMATCH',key);}
});
test('form and server loan identity rules stay in parity',()=>{
 const {loanRowKey}=load('lib/documents/loan-identity.ts'),script=fs.readFileSync(new URL('../public/assessment-review.js',import.meta.url),'utf8');
 const start=script.indexOf('const afCreditorKey='),end=script.indexOf('\nfunction afRow(',start);assert.ok(start>=0&&end>start);
 for(const key of ['creditors|123|TEST  BANK|Code1','creditors|123|ＴＥＳＴ\u00a0ＢＡＮＫ|Code1','creditors|123|АО "Банк Центр Кредит"|12-A','creditors|123|АО "Банк ЦентрКредит"| 12-A ','creditors|OTHER|testbank|code1','manual-row'])assert.equal(vm.runInNewContext(script.slice(start,end)+`;afLoanRowKey(${JSON.stringify(key)})`),loanRowKey(key));
});
