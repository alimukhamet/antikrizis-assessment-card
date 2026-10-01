// Deterministic, additive draft proposals. No network, approvals or publication.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {creditorKey} from '../public/gkb-comparison.mjs';
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const storedPayload=payload=>{const p=structuredClone(payload);for(const d of p.documents)delete d.originalName;return p;};
const get=(row,key)=>row?.find(a=>a.key===key);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const identifier=n=>typeof n==='string'&&n.trim()&&!/\.{2,}|…|[\r\n]/u.test(n);
const loanFields={creditor:'n8038',contractIdentifier:'loanContractId',startedAtMonth:'n8038Start',monthlyPayment:'n8041',overdueDays:'n8042',debtOutstanding:'n8040',creditType:'n8039',relatedParties:'loanParticipants',loanStatus:'loanStatus'};
const scalarFields={'identity.iin':'iin','identity.name':'fio','statement.topUps':'kaspiAnnual','benefits.count':'clientBenefitsCount'};
const sameValue=(key,a,b)=>key==='n8038'?creditorKey(a)===creditorKey(b):String(a).trim()===String(b).trim();
export function planProfileSourceFill(draft,context,analyses,validateDraft,history={protectedFields:[],allowNewLoans:true}){
 if(!draft||draft.recovery||draft.identityRevision!==context.identityRevision||!/^\d{12}$/.test(context.client?.iin||''))fail('CURRENT_IDENTITY_REQUIRED');
 const before=storedPayload(draft.payload),payload=validateDraft(before);
 // Permit canonical split controls from existing legacy answers; never
 // change or discard an original answer while migrating those controls.
 const previousKeys=new Set(before.answers.map(a=>a.key));
 const migrated=payload.answers.filter(a=>!previousKeys.has(a.key));
 const migrationKeys=new Set(['holding:client:businessNone','holding:partner:businessNone','enforcementStatus']);
 if(migrated.some(a=>!migrationKeys.has(a.key)||(a.key.endsWith('businessNone')?a.value!=='businessNone':a.checked||!['','no','legacy'].includes(a.value))))fail('DRAFT_NORMALIZATION_REQUIRED');
 const comparison=structuredClone(payload);comparison.answers=comparison.answers.filter(a=>previousKeys.has(a.key));
 if(!isDeepStrictEqual(comparison,before))fail('DRAFT_NORMALIZATION_REQUIRED');
 const selected=new Set(payload.documents.filter(d=>d.person==='Клиент'&&!/Подписанный договор|ЭЦП|парол/iu.test(d.type)).map(d=>d.documentId));
 const eligible=analyses.filter(a=>selected.has(a.documentId)&&a.caseId===context.caseId&&a.identityRevision===context.identityRevision&&a.persisted===true&&a.eligibleForAutofill===true&&a.document?.extraction?.identity?.iin===context.client.iin&&a.document.readAllPhysicalPages===true&&a.document.pages.length===a.document.totalPages&&a.document.originalSha256&&a.extractionId);
 const sources=eligible.map(a=>({documentId:a.documentId,extractionId:a.extractionId,sha256:a.document.originalSha256,issuedAt:a.document.extraction.issuedAt,kind:a.document.extraction.kind}));
 const changes=[],skipped=[],protectedFields=new Set((history.protectedFields||[]).map(p=>JSON.stringify(p)));
 const ref=(group,row,key)=>group?{group,row,key}:{key};
 const candidates=new Map();
 const add=(target,value,source)=>{const key=JSON.stringify(target);const entry=candidates.get(key)||{target,values:[]};entry.values.push({value,source});candidates.set(key,entry);};
 const evidence=(a,f,factKey)=>({documentId:a.documentId,extractionId:a.extractionId,sha256:a.document.originalSha256,factKey,page:f.page});
 // The newest date wins only for separate complete reports of the same kind.
 const newest=kind=>eligible.filter(a=>a.document.extraction.kind===kind).sort((a,b)=>(b.document.extraction.issuedAt||'').localeCompare(a.document.extraction.issuedAt||''));
 for(const kind of ['identity','gkb_full','gkb_short','kaspi','benefits']){
  const docs=newest(kind);if(!docs.length)continue;
  for(const a of docs.filter(a=>a.document.extraction.issuedAt===docs[0].document.extraction.issuedAt))for(const f of a.document.extraction.facts){
   const key=scalarFields[f.key];if(!key||key==='iin'&&f.value!==context.client.iin)continue;
   // Benefit count is a structural form control; only an already matching row
   // count can be filled without inventing payment descriptions.
   if(key==='clientBenefitsCount'&&Number(f.value)!==payload.groups.find(g=>g.id==='clientbenefits')?.rows.length)continue;
   add({key},f.value,evidence(a,f,f.key));
  }
 }
 const full=newest('gkb_full').filter(a=>a.document.extraction.creditList?.complete),short=newest('gkb_short').filter(a=>a.document.extraction.creditList?.complete);
 const reports=[...full,...short],latest=reports.map(a=>a.document.extraction.issuedAt||'').sort().at(-1);
 // Never silently mix financial facts from different reporting dates. Reports
 // of the same date must agree; only the latest complete evidence is used.
 const loans=[];
 for(const a of reports.filter(a=>a.document.extraction.issuedAt===latest))for(const [index,c]of a.document.extraction.credits.entries()){
  const lender=c.facts.find(f=>f.key==='creditor')?.value,aliases=[c.contractNumber,c.contractCode].filter(identifier).map(n=>n.trim());
  if(!lender||!aliases.length)continue;
  const fields=c.facts.filter(f=>loanFields[f.key]).map(f=>({key:loanFields[f.key],value:f.value,source:evidence(a,f,`credits.${index}.${f.key}`)}));
  loans.push({lender:creditorKey(lender),aliases,number:identifier(c.contractCode)?c.contractCode:c.contractNumber,fields});
 }
 let group=payload.groups.find(g=>g.id==='creditors');
 const createdRows=new Set();
 const rowMatches=(loan,row,key)=>{const p=key?.split('|'),lender=get(row,'n8038')?.value,number=get(row,'loanContractId')?.value;return p?.length===4&&p[0]==='creditors'&&p[1]===context.client.iin&&creditorKey(p[2])===loan.lender&&loan.aliases.includes(p[3].trim())||lender&&number&&creditorKey(lender)===loan.lender&&loan.aliases.includes(number.trim());};
 const occupied=row=>row.some(a=>a.sourceReplaced||a.key.startsWith('unknown:')?Boolean(a.sourceReplaced||a.checked):a.key==='loanClaimIncluded'?!a.checked:a.checked||a.value.trim()!=='');
 for(const loan of loans){
  const matches=(group?.rows||[]).map((r,i)=>rowMatches(loan,r,group.rowKeys[i])?i:-1).filter(i=>i>=0);
  if(matches.length>1){skipped.push({code:'AMBIGUOUS_EXISTING_LOAN'});continue;}
  let rowIndex=matches[0];
  if(rowIndex===undefined){
   if(!history.allowNewLoans){skipped.push({code:'PREVIOUSLY_REMOVED_LOAN_PRESERVED'});continue;}
   // A manual row without its identifier may describe this same loan. Do not duplicate it.
   if(group?.rows.some(r=>get(r,'n8038')?.value&&creditorKey(get(r,'n8038').value)===loan.lender&&!get(r,'loanContractId')?.value)){skipped.push({code:'MANUAL_LOAN_ID_REQUIRED'});continue;}
   if(!group){group={id:'creditors',rows:[],rowKeys:[]};payload.groups.push(group);}
   rowIndex=group.rows.findIndex((r,i)=>!occupied(r)&&!group.rowKeys[i]);
   if(rowIndex<0){rowIndex=group.rows.length;group.rows.push([{key:'loanClaimIncluded',value:'on',checked:true}]);group.rowKeys.push(null);}
   const sourceKey='creditors|'+context.client.iin+'|'+loan.lender+'|'+loan.number;
   group.rowKeys[rowIndex]=sourceKey;createdRows.add(rowIndex);
  }
  if((get(group.rows[rowIndex],'n8038')?.value&&creditorKey(get(group.rows[rowIndex],'n8038').value)!==loan.lender)||(get(group.rows[rowIndex],'loanContractId')?.value&&!loan.aliases.includes(get(group.rows[rowIndex],'loanContractId').value.trim()))){skipped.push({row:rowIndex,code:'EXISTING_LOAN_IDENTITY_CHANGED'});continue;}
  if(group.rows[rowIndex].some(a=>a.sourceReplaced)){skipped.push({row:rowIndex,code:'REPLACED_SOURCE_PRESERVED'});continue;}
  for(const f of loan.fields)add(ref('creditors',rowIndex,f.key),f.value,f.source);
 }
 for(const {target,values}of candidates.values()){
  const row=target.group?payload.groups.find(g=>g.id===target.group).rows[target.row]:payload.answers;
  const existing=get(row,target.key);
  if(existing&&(existing.checked||existing.value.trim()||existing.sourceReplaced))continue;
  if(protectedFields.has(JSON.stringify(target))){skipped.push({...target,code:'STAFF_CLEARED_VALUE_PRESERVED'});continue;}
  const unique=values.filter((v,i)=>values.findIndex(x=>sameValue(target.key,x.value,v.value))===i);
  if(unique.length!==1){skipped.push({...target,code:'CONFLICTING_DOCUMENT_VALUES'});continue;}
  const value=unique[0].value;if(typeof value!=='string'||!value.trim())continue;
  // Scheduled amounts must not be inserted into a manually defaulted loan.
  if(target.key==='n8041'&&(get(row,'loanStatus')?.value&&get(row,'loanStatus').value!=='Платится по графику'||(candidates.get(JSON.stringify(ref('creditors',target.row,'loanStatus')))?.values||[]).some(v=>v.value!=='Платится по графику'))){skipped.push({...target,code:'CURRENT_LOAN_STATUS_CONFLICT'});continue;}
  const source=unique[0].source;
  if(existing)existing.value=value;else row.push({key:target.key,value,checked:false});
  changes.push({...target,value,source});
 }
 // If different source reports disagreed on a newly-created row, don't leave
 // an unidentifiable shell or a guessed loan count behind.
 if(group)for(const i of createdRows)if(!get(group.rows[i],'n8038')?.value||!get(group.rows[i],'loanContractId')?.value)fail('NEW_LOAN_IDENTITY_CONFLICT');
 // Prove every original control and non-answer section survives. Only named
 // blank fields, new rows and empty canonical migrations may change.
 for(const previous of before.answers){const now=get(payload.answers,previous.key);if(!changes.some(c=>!c.group&&c.key===previous.key)&&!isDeepStrictEqual(previous,now))fail('EXISTING_ANSWER_CHANGED');}
 for(const previous of before.groups){const now=payload.groups.find(g=>g.id===previous.id);if(!now||now.rows.length<previous.rows.length)fail('EXISTING_GROUP_CHANGED');for(const [i,row] of previous.rows.entries()){if(previous.rowKeys[i]!==now.rowKeys[i]&&!createdRows.has(i))fail('EXISTING_ROW_KEY_CHANGED');for(const answer of row)if(!changes.some(c=>c.group===previous.id&&c.row===i&&c.key===answer.key)&&!isDeepStrictEqual(answer,get(now.rows[i],answer.key)))fail('EXISTING_ANSWER_CHANGED');}}
 for(const key of ['docContext','documents','pendingFiles','documentReviewDrafts'])if(!isDeepStrictEqual(before[key],payload[key]))fail('PROTECTED_SECTION_CHANGED');
 const final=validateDraft(payload);if(!isDeepStrictEqual(final,payload))fail('FILLED_DRAFT_NORMALIZATION_REQUIRED');
 const planHash=digest({caseId:context.caseId,identityRevision:context.identityRevision,revision:draft.revision,before,payload,sources,history});
 return {payload,changes,skipped,sources,planHash,beforeHash:digest(before),afterHash:digest(payload),migrated:migrated.map(a=>a.key),newLoans:createdRows.size};
}
