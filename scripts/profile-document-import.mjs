// Pure inbound-selection helpers. The caller owns current-queue, presence,
// revision and draft-history guards; these helpers never publish or approve.
import {normalizeIntake} from '../public/intake-data.mjs';

// Keep the established HostedAssessment.adapt classifications and labels.
const documentTypes={
 gkb_full:'ГКБ — полный отчёт',gkb_short:'ГКБ — краткий отчёт',
 identity:'Удостоверение личности',property:'Ф6 об отсутствии имущества',
 encumbrance:'Сведения об обременениях',kaspi:'Выписка Kaspi Gold',
 power_of_attorney:'Доверенность',benefits:'Справка по выплатам пенсии и пособий',
 enpf:'Справка ЕНПФ',salary:'Выписка зарплатного банка',
};

/** A canonical empty draft contains no client answers or inferred zeroes. */
export function blankProfileDraft(){
 return normalizeIntake({schemaVersion:1,answers:[],groups:[],docContext:{social:'',salary:''},documents:[],pendingFiles:[]});
}

/** CRM currently returns IDs only; filename filters are optional exclusions,
 * never a classification or ownership assertion. Never retain credential names. */
export function crmImportCandidates(files){
 const seen=new Set();
 return (Array.isArray(files)?files:[]).flatMap(ref=>{
  const id=ref?.id;
  if(typeof id!=='string'||!/^[1-9]\d*$/.test(id)||seen.has(id))return [];
  const name=typeof ref.name==='string'?ref.name:typeof ref.filename==='string'?ref.filename:'';
  const extension=name.match(/\.([a-z\d]+)$/iu)?.[1].toLowerCase();
  if(extension&&!['pdf','png','jpg','jpeg'].includes(extension))return [];
  seen.add(id);return [{id}];
 });
}

/** Append a recognized original without changing any saved selection or answer.
 * Native reading/ownership is separate from eligibility to populate facts.
 * The runner checks all previous draft revisions; callers may additionally pass
 * removedDocumentIds on context to preserve known removed selections here. */
export function appendProfileDocument(payload,analysis,context){
 const unchanged=skipped=>({payload:structuredClone(payload),skipped});
 if(!context?.caseId||!Number.isSafeInteger(context.identityRevision)||context.identityRevision<1||!/^\d{12}$/.test(context.client?.iin||''))return unchanged('DEAL_IDENTITY_UNVERIFIED');
 if(!analysis||analysis.caseId!==context.caseId||analysis.identityRevision!==context.identityRevision)return unchanged('CASE_IDENTITY_CHANGED');
 if(analysis.client?.external?.dealId&&context.client.external?.dealId&&analysis.client.external.dealId!==context.client.external.dealId)return unchanged('CASE_IDENTITY_CHANGED');
 const documentId=analysis.documentId,document=analysis.document,extraction=document?.extraction;
 if(typeof documentId!=='string'||!documentId||analysis.persisted!==true||!analysis.extractionId||!/^[a-f\d]{64}$/iu.test(document?.originalSha256||''))return unchanged('PERSISTED_ORIGINAL_REQUIRED');
 if(extraction?.identity?.iin!==context.client.iin)return unchanged(extraction?.identity?.iin?'WRONG_CLIENT':'DOCUMENT_IDENTITY_UNVERIFIED');
 const savedIin=payload.answers.find(a=>a.key==='iin')?.value.trim();
 if(savedIin&&savedIin!==context.client.iin)return unchanged('DRAFT_CLIENT_IDENTITY_CONFLICT');
 if((context.removedDocumentIds||[]).includes(documentId))return unchanged('STAFF_REMOVED_DOCUMENT_PRESERVED');
 if(payload.documents.some(d=>d.documentId===documentId))return unchanged('ALREADY_SELECTED');
 const type=documentTypes[extraction.kind];if(!type)return unchanged('DOCUMENT_TYPE_UNVERIFIED');
 if(document.format&&document.format!=='application/pdf'||document.readAllPhysicalPages!==true||!Number.isSafeInteger(document.totalPages)||document.totalPages<1||!Array.isArray(document.pages)||document.pages.length!==document.totalPages||document.pages.some((p,i)=>p.page!==i+1||p.needsOcr===true))return unchanged('NATIVE_DOCUMENT_REQUIRED');
 const next=structuredClone(payload);
 next.documents.push({documentId,type,person:'Клиент'});
 return {payload:next};
}
