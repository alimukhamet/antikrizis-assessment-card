import type {Answer, DraftPayload} from './draft';

/** Recover uploads after an IIN was added, never carry answers across identities. */
export function canRecoverDocumentDraft(payload:DraftPayload, currentIin:string|null){
 const answered=(answer:Answer)=>answer.key==='loanClaimIncluded'?!answer.checked:/^(choice|holding|unknown):/.test(answer.key)
  ? answer.checked : answer.key==='debtPurposeVersion' ? false : Boolean(answer.value.trim());
 return Boolean(currentIin&&payload.documents.length&&!payload.answers.some(answered)&&!payload.groups.some(group=>group.rows.some(row=>row.some(answered))));
}

/** The same stored PDF may have been selected twice before its type was assigned. */
export function distinctDraftDocuments<T extends DraftPayload['documents'][number]>(documents:T[]):T[]{
 const result:T[]=[];
 for(const document of documents){
  const index=result.findIndex(previous=>previous.documentId===document.documentId&&previous.person===document.person&&(!previous.type||!document.type||previous.type===document.type));
  if(index<0)result.push(document);else if(document.type)result[index]=document;
 }
 return result;
}

/** An old month-only editor cannot round-trip a precise date or the issuance field. */
export function requiresFullLoanDateEditor(previous:DraftPayload|undefined,next:DraftPayload){
 return next.loanDatesVersion!==1&&Boolean(previous?.groups.some(g=>g.id==='creditors'&&g.rows.some(row=>row.some(a=>(a.key==='n8038Start'||a.key==='loanDisbursementDate')&&/^\d{4}-\d{2}-\d{2}$/.test(a.value)))));
}
