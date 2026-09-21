import {normalizeIntake} from '../../public/intake-data.mjs';
import schema from './schema.json';
import {RepositoryError}from'../documents/repository';
import {distinctDraftDocuments} from './draft-recovery';
export type Answer={key:string;value:string;checked:boolean;clientConfirmed?:true;sourceReplaced?:true};
export type DocumentReviewDraft={documentId:string;type:string;values:Partial<Record<'iin'|'issuedAt'|'expiresAt'|'from'|'to'|'reason'|'kind'|'legalName'|'identifier',string>>};
export type DraftPayload={schemaVersion:1;answers:Answer[];groups:Array<{id:string;rows:Answer[][];rowKeys:(string|null)[]}>;docContext:{social:string;salary:string;salaryBank?:'kaspi'|'other'|'none'|''};documents:Array<{documentId:string;type:string;person:string}>;pendingFiles:string[];documentReviewDrafts?:DocumentReviewDraft[]};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new RepositoryError('INVALID_DRAFT',400);return value as Record<string,unknown>;}
function text(value:unknown,max=8000){if(typeof value!=='string'||value.length>max)throw new RepositoryError('INVALID_DRAFT',400);return value;}
type Definition={key:string;type:string;options?:string[];compactCount?:boolean;groupTarget?:string};
const definitions=new Map<string,Definition>([...schema.scalar,...schema.groups.flatMap<Definition>(g=>g.fields)].map(f=>[f.key,f]));
function answers(value:unknown,allowed:Set<string>):Answer[]{if(!Array.isArray(value)||value.length>allowed.size)throw new RepositoryError('INVALID_DRAFT',400);const used=new Set<string>();return value.map(item=>{const a=object(item),key=text(a.key,120);if(!allowed.has(key)||used.has(key)||typeof a.checked!=='boolean')throw new RepositoryError('INVALID_DRAFT_FIELD',400);const value=text(a.value),definition=definitions.get(key);
 if(key.startsWith('exact:')&&value!==''&&(!/^\d{1,3}$/.test(value)||Number(value)>200))throw new RepositoryError('INVALID_DRAFT_COUNT',400);
 if(definition?.options&&!definition.options.includes(value)&&!['unknown','Не знаю'].includes(value)&&!(definition.compactCount&&/^\d{1,3}$/.test(value)&&Number(value)<=200))throw new RepositoryError('INVALID_DRAFT_OPTION',400);
 if(a.sourceReplaced!==undefined&&a.sourceReplaced!==true)throw new RepositoryError('INVALID_SOURCE_REPLACEMENT',400);
 if(a.clientConfirmed!==undefined&&(a.clientConfirmed!==true||key!=='n8040'||!/^\d+(?:[.]\d{1,2})?$/.test(value)))throw new RepositoryError('INVALID_CLIENT_CONFIRMATION',400);
 used.add(key);return{key,value,checked:a.checked,...(a.sourceReplaced?{sourceReplaced:true as const}:{}),...(a.clientConfirmed===true?{clientConfirmed:true as const}:{})};});}
export function validateDraft(value:unknown):DraftPayload{
 const draft=object(value);if(draft.schemaVersion!==1)throw new RepositoryError('DRAFT_SCHEMA_UNSUPPORTED',400);
 const scalar=new Set(schema.scalar.map(f=>f.key)),groupMap=new Map(schema.groups.map(g=>[g.id,new Set(g.fields.map(f=>f.key))]));
 if(!Array.isArray(draft.groups)||draft.groups.length>groupMap.size)throw new RepositoryError('INVALID_DRAFT',400);
 const used=new Set<string>();const groups=draft.groups.map(item=>{const g=object(item),id=text(g.id,100),allowed=groupMap.get(id);if(!allowed||used.has(id)||!Array.isArray(g.rows)||g.rows.length>200)throw new RepositoryError('INVALID_DRAFT_GROUP',400);used.add(id);const rows=g.rows.map(row=>answers(row,allowed));const rawKeys=g.rowKeys??rows.map(()=>null);if(!Array.isArray(rawKeys)||rawKeys.length!==rows.length)throw new RepositoryError('INVALID_DRAFT_ROW_KEYS',400);const rowKeys=rawKeys.map(k=>{if(k===null)return null;const key=text(k,500);if(!key.startsWith(id+'|'))throw new RepositoryError('INVALID_DRAFT_ROW_KEYS',400);return key;});const keys=rowKeys.filter(k=>k!==null);if(new Set(keys).size!==keys.length)throw new RepositoryError('DUPLICATE_DRAFT_ROW_KEYS',400);return{id,rows,rowKeys};});
 const ctx=object(draft.docContext);if(!['','0','1'].includes(String(ctx.social))||!['','0','1'].includes(String(ctx.salary)))throw new RepositoryError('INVALID_DRAFT',400);
 if(ctx.salaryBank!==undefined&&(!['','kaspi','other','none'].includes(String(ctx.salaryBank))||ctx.salary!==(ctx.salaryBank==='other'?'1':ctx.salaryBank?'0':'')))throw new RepositoryError('INVALID_SALARY_BANK',400);
 if(!Array.isArray(draft.documents)||draft.documents.length>200||!Array.isArray(draft.pendingFiles)||draft.pendingFiles.length>200)throw new RepositoryError('INVALID_DRAFT',400);
 const documents=distinctDraftDocuments(draft.documents.map(item=>{const d=object(item);return{documentId:text(d.documentId,80),type:text(d.type,160),person:text(d.person,80)};}));
 if(documents.some(d=>/эцп/i.test(d.type)))throw new RepositoryError('CREDENTIAL_NOT_IN_DRAFT',400);
 // Typed inspection fields are drafts, never approval records or extracted facts.
 let documentReviewDrafts:DocumentReviewDraft[]|undefined;
 if(draft.documentReviewDrafts!==undefined){
  if(!Array.isArray(draft.documentReviewDrafts)||draft.documentReviewDrafts.length>200)throw new RepositoryError('INVALID_REVIEW_DRAFT',400);
  const seen=new Set<string>();
  documentReviewDrafts=draft.documentReviewDrafts.map(item=>{
   const d=object(item),documentId=text(d.documentId,80),type=text(d.type,160),values=object(d.values),key=JSON.stringify([documentId,type]);
   if(seen.has(key)||!documents.some(doc=>doc.documentId===documentId&&doc.type===type&&doc.person==='Клиент'))throw new RepositoryError('INVALID_REVIEW_DRAFT',400);
   seen.add(key);const clean:DocumentReviewDraft['values']={};
   for(const [field,value]of Object.entries(values)){
    if(!['iin','issuedAt','expiresAt','from','to','reason','kind','legalName','identifier'].includes(field))throw new RepositoryError('INVALID_REVIEW_DRAFT',400);
    clean[field as keyof DocumentReviewDraft['values']]=text(value,field==='reason'?2000:240);
   }
   return {documentId,type,values:clean};
  });
 }
 const scalarAnswers=answers(draft.answers,scalar);for(const answer of scalarAnswers){const target=definitions.get(answer.key)?.groupTarget;if(target&&/^\d+$/.test(answer.value)){const group=groups.find(g=>g.id===target);if(!group||group.rows.length!==Number(answer.value))throw new RepositoryError('DRAFT_COUNT_MISMATCH',400);}}
 return normalizeIntake({schemaVersion:1 as const,answers:scalarAnswers,groups,docContext:{social:String(ctx.social),salary:String(ctx.salary),...(ctx.salaryBank!==undefined?{salaryBank:ctx.salaryBank as DraftPayload['docContext']['salaryBank']}:{})},documents,pendingFiles:draft.pendingFiles.map(f=>text(f,240)),...(documentReviewDrafts?.length?{documentReviewDrafts}:{})});
}
