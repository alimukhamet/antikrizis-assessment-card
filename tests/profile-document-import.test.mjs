import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {blankProfileDraft,crmImportCandidates,appendProfileDocument} from '../scripts/profile-document-import.mjs';

const built=buildSync({entryPoints:['lib/questionnaire/draft.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {validateDraft}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const context={caseId:'synthetic-case',identityRevision:1,client:{iin:'991231300003',external:{dealId:'900001'}}};
function fixture(kind='gkb_full'){
 return {caseId:context.caseId,identityRevision:1,documentId:'synthetic-original',extractionId:'synthetic-extraction',persisted:true,eligibleForAutofill:true,document:{format:'application/pdf',originalSha256:'a'.repeat(64),readAllPhysicalPages:true,totalPages:1,pages:[{page:1,text:'SYNTHETIC ORIGINAL',needsOcr:false}],extraction:{kind,identity:{iin:context.client.iin}}}};
}

test('blank profile is canonical and records no guessed client facts',()=>{
 const p=blankProfileDraft();assert.deepEqual(validateDraft(p),p);
 assert.equal(p.answers.some(a=>a.checked),false);
 assert.deepEqual(p.answers.map(a=>a.key),['holding:client:businessNone','holding:partner:businessNone','enforcementStatus']);
 assert.equal(p.answers.find(a=>a.key==='enforcementStatus').value,'');
 assert.deepEqual(p.groups,[]);assert.deepEqual(p.documents,[]);assert.deepEqual(p.pendingFiles,[]);
 p.answers[0].checked=true;assert.equal(blankProfileDraft().answers[0].checked,false);
});

test('CRM candidates deduplicate valid IDs and omit known unsupported files without exposing filenames',()=>{
 assert.deepEqual(crmImportCandidates([{id:'1'},{id:'1'},{id:'02'},{id:3},{id:'4',name:'PRIVATE_KEY_PASSWORD.p12'},{id:'5',name:'source.pdf'},{id:'6',filename:'photo.JPG'},{id:'7',name:'document.docx'},null]),[{id:'1'},{id:'5'},{id:'6'}]);
 assert.deepEqual(crmImportCandidates(null),[]);
});

test('selection uses native contents and appends only a document reference',()=>{
 const p=blankProfileDraft();p.answers.push({key:'fio',value:'STAFF ANSWER',checked:false});p.pendingFiles=['UNAVAILABLE ORIGINAL'];
 const before=structuredClone(p),a=fixture();a.originalName='Misleading salary filename.pdf';
 const result=appendProfileDocument(p,a,context);assert.equal(result.skipped,undefined);
 assert.deepEqual(result.payload.documents,[{documentId:a.documentId,type:'ГКБ — полный отчёт',person:'Клиент'}]);
 assert.deepEqual({...result.payload,documents:[]},before);assert.deepEqual(p,before);assert.deepEqual(validateDraft(result.payload),result.payload);
});

test('recognized native originals may be selected while extracted values remain ineligible',()=>{
 const labels={gkb_short:'ГКБ — краткий отчёт',identity:'Удостоверение личности',property:'Ф6 об отсутствии имущества',encumbrance:'Сведения об обременениях',kaspi:'Выписка Kaspi Gold',power_of_attorney:'Доверенность',benefits:'Справка по выплатам пенсии и пособий',enpf:'Справка ЕНПФ',salary:'Выписка зарплатного банка'};
 for(const [kind,type]of Object.entries(labels)){
  const a=fixture(kind);a.eligibleForAutofill=false;a.findings=['DATE_UNVERIFIED'];const result=appendProfileDocument(blankProfileDraft(),a,context);
  assert.equal(result.payload.documents[0]?.type,type);assert.equal(result.payload.answers.some(x=>x.key==='iin'),false);assert.equal(a.eligibleForAutofill,false);
 }
});

test('foreign, unpersisted, incomplete, scanned and unrecognized evidence cannot be selected',()=>{
 const changes=[
  [a=>a.caseId='other','CASE_IDENTITY_CHANGED'],[a=>a.identityRevision=2,'CASE_IDENTITY_CHANGED'],
  [a=>a.document.extraction.identity.iin='991231300004','WRONG_CLIENT'],[a=>a.document.extraction.identity.iin=null,'DOCUMENT_IDENTITY_UNVERIFIED'],
  [a=>a.persisted=false,'PERSISTED_ORIGINAL_REQUIRED'],[a=>a.document.originalSha256='bad','PERSISTED_ORIGINAL_REQUIRED'],
  [a=>a.document.readAllPhysicalPages=false,'NATIVE_DOCUMENT_REQUIRED'],[a=>a.document.totalPages=2,'NATIVE_DOCUMENT_REQUIRED'],
  [a=>a.document.pages[0].needsOcr=true,'NATIVE_DOCUMENT_REQUIRED'],[a=>a.document.format='image/jpeg','NATIVE_DOCUMENT_REQUIRED'],
  [a=>a.document.pages[0].page=2,'NATIVE_DOCUMENT_REQUIRED'],[a=>a.document.extraction.kind='other','DOCUMENT_TYPE_UNVERIFIED'],
 ];
 for(const [change,code]of changes){const a=fixture(),p=blankProfileDraft();change(a);const result=appendProfileDocument(p,a,context);assert.equal(result.skipped,code);assert.deepEqual(result.payload,p);}
});

test('existing classifications and prior removed originals remain unchanged',()=>{
 const a=fixture(),p=blankProfileDraft();p.documents.push({documentId:a.documentId,type:'STAFF CLASSIFICATION',person:'Супруг(а)'});
 assert.equal(appendProfileDocument(p,a,context).skipped,'ALREADY_SELECTED');assert.deepEqual(appendProfileDocument(p,a,context).payload,p);
 const removed=appendProfileDocument(blankProfileDraft(),a,{...context,removedDocumentIds:[a.documentId]});assert.equal(removed.skipped,'STAFF_REMOVED_DOCUMENT_PRESERVED');assert.deepEqual(removed.payload.documents,[]);
});

test('a draft for another client and missing trusted identity never receive documents',()=>{
 const p=blankProfileDraft();p.answers.push({key:'iin',value:'991231300004',checked:false});assert.equal(appendProfileDocument(p,fixture(),context).skipped,'DRAFT_CLIENT_IDENTITY_CONFLICT');
 assert.equal(appendProfileDocument(blankProfileDraft(),fixture(),{...context,client:{iin:''}}).skipped,'DEAL_IDENTITY_UNVERIFIED');
});
