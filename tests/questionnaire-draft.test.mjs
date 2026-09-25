import * as intake from '../public/intake-data.mjs';
import {test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import{DatabaseSync}from'node:sqlite';import{webcrypto}from'node:crypto';
function load(path,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:n=>n==='../../public/intake-data.mjs'?intake:imports[n],crypto:webcrypto,TextEncoder,Uint8Array,Date,Map,Set});return exports;}
const documentRepo=load('lib/documents/repository.ts'),schema=JSON.parse(fs.readFileSync(new URL('../lib/questionnaire/schema.json',import.meta.url),'utf8'));const {validateDraft}=load('lib/questionnaire/draft.ts',{'./schema.json':schema,'./draft-recovery':load('lib/questionnaire/draft-recovery.ts'),'../documents/repository':documentRepo});const {DraftRepository}=load('lib/questionnaire/repository.ts',{'../documents/repository':documentRepo});
const payload=()=>({schemaVersion:1,answers:[{key:'fio',value:'SYNTHETIC ONLY',checked:false}],groups:[],docContext:{social:'',salary:''},documents:[],pendingFiles:[]});
function setup(){const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');for(const f of fs.readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));sql.exec("INSERT INTO assessment_cases VALUES ('case','test','test',NULL,1,'TEST','2026-09-10','2026-09-10')");const db = {
  prepare(query) {
    return {
      bind(...args) {
        const statement=sql.prepare(query);
        return {
          async first() { return statement.get(...args)||null; },
          async run() { statement.run(...args);return {success:true}; },
        };
      },
    };
  },
};return{repo:new DraftRepository(db),sql};}
const record={id:'case',identity_revision:1},actor={id:'worker:ramazan'};
test('drafts persist structured values and drop caller HTML and state flags',()=>{const d=validateDraft({...payload(),html:'<script>bad</script>',verified:true});assert.equal(d.answers[0].value,'SYNTHETIC ONLY');assert.equal(d.html,undefined);assert.equal(d.verified,undefined)});
test('inspection dates survive server validation and readback without becoming approvals',async()=>{
 const p={...payload(),documents:[{documentId:'identity',type:'Удостоверение личности',person:'Клиент'}],documentReviewDrafts:[{documentId:'identity',type:'Удостоверение личности',values:{issuedAt:'2020-01-01',expiresAt:'2030-01-01'}}]};
 const {repo,sql}=setup();await repo.save(record,validateDraft(p),0,webcrypto.randomUUID(),actor);
 const saved=await repo.latest('case');assert.deepEqual(JSON.parse(saved.payload_json).documentReviewDrafts,p.documentReviewDrafts);
 assert.throws(()=>validateDraft({...p,documentReviewDrafts:[{...p.documentReviewDrafts[0],documentId:'other'}]}),/INVALID_REVIEW_DRAFT/);
 for(const key of ['confirmed','complete','contentMatches','authenticity','password'])assert.throws(()=>validateDraft({...p,documentReviewDrafts:[{...p.documentReviewDrafts[0],values:{[key]:'true'}}]}),/INVALID_REVIEW_DRAFT/);
 sql.close();
});
test('unknown controls, options, enormous counts and credential references rejected',()=>{assert.throws(()=>validateDraft({...payload(),answers:[{key:'invented',value:'x',checked:false}]}),/INVALID_DRAFT_FIELD/);assert.throws(()=>validateDraft({...payload(),answers:[{key:'marital',value:'injected',checked:false}]}),/INVALID_DRAFT_OPTION/);assert.throws(()=>validateDraft({...payload(),answers:[{key:'count-clientjobs',value:'99999999999',checked:false}]}),/INVALID_DRAFT_OPTION/);assert.throws(()=>validateDraft({...payload(),documents:[{documentId:'d',type:'ЭЦП файл',person:'Клиент'}]}),/CREDENTIAL_NOT_IN_DRAFT/)});
test('save/retry preserves one version; altered retry and stale writes rejected',async()=>{const{repo,sql}=setup(),key=webcrypto.randomUUID(),p=validateDraft(payload());const one=await repo.save(record,p,0,key,actor),retry=await repo.save(record,p,0,key,actor);assert.equal(one.id,retry.id);assert.equal((await repo.latest('case')).revision,1);await assert.rejects(()=>repo.save(record,{...p,pendingFiles:['new']},0,key,actor),/IDEMPOTENCY_KEY_REUSED/);await assert.rejects(()=>repo.save(record,p,0,webcrypto.randomUUID(),actor),/DRAFT_CHANGED/);assert.equal(sql.prepare('SELECT count(*) n FROM assessment_draft_versions').get().n,1)});
test('new revisions retain history; changed client identity blocks stale save',async()=>{const{repo,sql}=setup();await repo.save(record,validateDraft(payload()),0,webcrypto.randomUUID(),actor);await repo.save(record,validateDraft({...payload(),pendingFiles:['not-uploaded.pdf']}),1,webcrypto.randomUUID(),actor);assert.equal((await repo.latest('case')).revision,2);assert.equal(sql.prepare('SELECT count(*) n FROM assessment_draft_versions').get().n,2);sql.exec("UPDATE assessment_cases SET identity_revision=2 WHERE id='case'");await assert.rejects(()=>repo.save(record,validateDraft(payload()),2,webcrypto.randomUUID(),actor),/DRAFT_CHANGED/);assert.equal(await repo.latest('other-case'),null)});

test('client-confirmed debt source survives validation while unsupported or empty confirmations fail',()=>{
 const p=payload();p.groups=[{id:'creditors',rows:[[{key:'n8040',value:'1200.50',checked:false,clientConfirmed:true}]],rowKeys:[null]}];
 assert.equal(validateDraft(p).groups[0].rows[0][0].clientConfirmed,true);
 p.groups[0].rows[0][0].value='';assert.throws(()=>validateDraft(p),/INVALID_CLIENT_CONFIRMATION/);
 const other=payload();other.answers[0].clientConfirmed=true;assert.throws(()=>validateDraft(other),/INVALID_CLIENT_CONFIRMATION/);
});


test('salary bank persists without changing the required package and rejects contradictory context',()=>{
 for(const [salaryBank,salary] of [['kaspi','0'],['none','0'],['other','1'],['','']]){const p=payload();p.docContext={social:'0',salary,salaryBank};assert.equal(validateDraft(p).docContext.salaryBank,salaryBank);}
 const bad=payload();bad.docContext={social:'0',salary:'0',salaryBank:'other'};assert.throws(()=>validateDraft(bad),/INVALID_SALARY_BANK/);
});
