import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/questionnaire/draft-recovery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {canRecoverDocumentDraft,distinctDraftDocuments}=exports;
const blank=()=>({answers:[{key:'debtPurposeVersion',value:'1',checked:false}],groups:[{id:'creditors',rows:[[{key:'n8038',value:'',checked:false},{key:'loanClaimIncluded',value:'on',checked:true}]]}],documents:[{documentId:'pdf',type:'',person:'Клиент'}]});
test('only document-only drafts can recover after identity revision changes',()=>{
 assert.equal(canRecoverDocumentDraft(blank(),'current-client'),true);
 assert.equal(canRecoverDocumentDraft(blank(),null),false);
 const noFiles=blank();noFiles.documents=[];assert.equal(canRecoverDocumentDraft(noFiles,'current-client'),false);
 for(const answer of [{key:'iin',value:'old-client',checked:false},{key:'fio',value:'SYNTHETIC',checked:false},{key:'choice:socialStatus:Нет',value:'Нет',checked:true}]){const p=blank();p.answers.push(answer);assert.equal(canRecoverDocumentDraft(p,'current-client'),false);}
 const loan=blank();loan.groups[0].rows[0][0].value='TEST BANK';assert.equal(canRecoverDocumentDraft(loan,'current-client'),false);
 const exclusion=blank();exclusion.groups[0].rows[0][1].checked=false;assert.equal(canRecoverDocumentDraft(exclusion,'current-client'),false);
});
test('duplicate selection keeps its assigned type without combining different owners or conflicting types',()=>{
 const docs=[{documentId:'same',type:'',person:'Клиент'},{documentId:'same',type:'Выписка зарплатного банка',person:'Клиент'},{documentId:'same',type:'Выписка зарплатного банка',person:'Клиент'},{documentId:'same',type:'Выписка зарплатного банка',person:'Супруг(а)'},{documentId:'same',type:'Другой документ',person:'Клиент'},{documentId:'other',type:'',person:'Клиент'}];
 const result=distinctDraftDocuments(docs);assert.equal(result.length,4);assert.equal(result[0].type,'Выписка зарплатного банка');assert.equal(result[1].person,'Супруг(а)');assert.equal(result[2].type,'Другой документ');assert.equal(docs.length,6);
});
