import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {JSDOM} from 'jsdom';

function load(file,imports={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>imports[name],Date,Map,Set});return exports;
}
const policy=load('lib/documents/policy.ts'),repo=load('lib/documents/repository.ts');
const reviews=load('lib/documents/document-review.ts',{'./repository':repo,'./analysis-version':{analysisVersion:'test'},'./policy':policy});
const packages=load('lib/documents/package-check.ts',{'./analysis-service':{analysisVersion:'test'},'./document-review':reviews,'./policy':policy,'./loan-identity':load('lib/documents/loan-identity.ts')});

test('three unrecognized document details can be reviewed explicitly, then uploaded and downloaded through the real browser flows',async t=>{
 const dom=new JSDOM('<section id="documentStep"></section><div id="questionnaireStep"><button id="checkQuestions">Check</button><p id="checkStatus"></p></div>',{url:'https://synthetic.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 const record={id:'case',client_iin:'synthetic-client',identity_revision:1},saved=new Map(),sources=new Map(),calls=[];
 const types=[...packages.REQUIRED_DOCUMENTS,'Выписка зарплатного банка'];
 const kinds=['gkb_short','gkb_full','enpf','property','unknown','kaspi','unknown'];
 const payload={answers:[],groups:[],pendingFiles:[],docContext:{social:'0',salary:'1'},documents:types.map((type,i)=>({documentId:'doc-'+i,type,person:'Клиент'}))};
 for(const [i,kind]of kinds.entries())sources.set('doc-'+i,{read:{totalPages:1,pages:[{needsOcr:false}]},extraction:{kind,identity:{iin:record.client_iin},issuedAt:'2026-09-16',findings:[],credits:[],coverage:null,...(kind==='kaspi'?{bankStatement:{from:'2025-09-16',to:'2026-09-16',reconciled:true,rowsReadable:true}}:{})}});
 // Property inspection is already complete; the remaining three mirror the reported failure.
 const property={type:types[3],iin:record.client_iin,pages:1,issuedAt:'',expiresAt:'',from:'',to:'',complete:true,contentMatches:true,periodChecked:true,reason:'Synthetic original inspected'};
 saved.set('doc-3',{id:'review-3',fact_key:reviews.DOCUMENT_REVIEW_KEY,value_json:JSON.stringify(property)});
 const repository={document:async(_,id)=>({id,original_sha256:id}),cached:async(_,id)=>({extraction:{id:'parsed-'+id},result:sources.get(id)}),currentReviews:async(_,id)=>saved.has(id)?[saved.get(id)]:[]};
 let downloads=0,row=null;
 w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>downloads++;
 w.HostedAssessment={ready:()=>true,getContext:()=>({client:{title:'SYNTHETIC',iin:record.client_iin,external:{dealId:'900001'}}}),requestJson:async(path,options)=>{const response=await w.fetch(path,options);const value=await response.json();if(!response.ok)throw Error(value.error);return value;}};
 w.ServerDrafts={capture:()=>payload,reviewBindings:()=>[],save:async()=>true};w.afConfirmPending=async()=>true;
 w.SubmissionDestination={confirm:async()=>({dealId:'900001',iin:record.client_iin,identityRevision:1})};
 w.ContractRenderers={['a'.repeat(64)]:{render:async()=>new w.Blob(['SYNTHETIC CONTRACT'])}};
 w.selectedFiles=payload.documents.map((item,i)=>({id:i,...item,storedDocumentId:item.documentId}));
 w.af={results:new Map(payload.documents.map((item,i)=>[i,{server:{documentId:item.documentId},pages:1,reviewContext:{iin:record.client_iin,pages:1,issuedAt:i===2?'2026-09-16':''}}]))};
 w.fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):null;if(body)calls.push({path,body});let value;
  if(path.endsWith('/check')){const documents=await packages.checkDocumentPackage(repository,record,payload,'2026-09-16');value={identityRevision:1,answersComplete:true,readyToSubmit:documents.packageReady,issues:[],evidence:{issues:[]},documents};}
  else if(path.endsWith('/document-reviews')){
   try{const review=reviews.validateDocumentReview(body.review,sources.get(body.documentId),record,'2026-09-16');saved.set(body.documentId,{id:'review-'+body.documentId,fact_key:reviews.DOCUMENT_REVIEW_KEY,value_json:JSON.stringify(review)});value={ok:true};}
   catch(error){return{ok:false,json:async()=>({error:error.code})};}
  }else if(path.endsWith('/uploads')){if(body)assert.equal((await packages.checkDocumentPackage(repository,record,payload,'2026-09-16')).packageReady,true);value=body?{state:'verified',documentsUploaded:true}:{unsent:null};}
  else if(path.endsWith('/submission')){
   if(!body)value={submission:row};
   else if(body.action==='prepare')value=row={requestId:body.requestId,state:'prepared'};
   else if(body.action==='commit')value=row={...row,state:'verified',assessmentSaved:true};
   else if(body.action==='history')value=row={...row,historySaved:true};
   else if(body.action==='contract')value={contract:{rendererVersion:'a'.repeat(64),data:{}}};
   else throw Error('Unexpected action '+body.action);
  }else throw Error('Unexpected request '+path);
  return{ok:true,json:async()=>value};
 };
 for(const name of ['document-review','document-upload','submission-flow','server-answer-check'])w.eval(fs.readFileSync('public/'+name+'.js','utf8'));
 const download=d.getElementById('saveAssessment');await download.onclick();
 assert.equal(downloads,0);assert.equal(w.AssessmentCheck.result().documents.issues.length,3);assert.equal(calls.some(c=>c.path.endsWith('/uploads')||c.path.endsWith('/submission')),false);
 for(const id of ['doc-2','doc-4','doc-6']){
  const section=d.querySelector(`[data-review-document-id="${id}"]`),fields=[...section.querySelectorAll('.document-review-fields > label')];
  const set=(label,value)=>{const input=fields.find(field=>field.firstChild.textContent===label)?.querySelector('input');assert.ok(input,label);input.value=value;};
  if(id==='doc-4')set('Действует до','2030-01-01');
  else{set('Начало периода','2025-09-16');set('Конец периода','2026-09-16');}
  section.querySelector('input[type=checkbox]').checked=true;await section.querySelector('button').onclick();
  assert.ok(saved.has(id));
 }
 assert.equal(w.AssessmentCheck.result().readyToSubmit,true);await download.onclick();
 assert.equal(downloads,1);assert.equal(calls.filter(c=>c.path.endsWith('/document-reviews')).length,3);
 assert.deepEqual(calls.filter(c=>c.path.endsWith('/submission')).map(c=>c.body.action),['prepare','commit','history','contract']);
 assert.equal(calls.filter(c=>c.path.endsWith('/uploads')).length,1);
});
