import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const SOURCE=Object.freeze({dealId:'6579',identityRevision:1,sha256:'e6c2bbe0c860c85121173f673ab9e4f9bbcd3c9909d6cdf253fafc4fd5a22db3',byteSize:674111,pages:98,loans:3,
  platformDocumentId:'a8fa948f-ed01-4a0c-9775-ec2de87e0567',platformVersionId:'c1c8c4bd-44fd-4d34-988c-2636076f1ef9',
  bucket:'antikrizis-legal-crm-production-files',key:'cases/6579/a8fa948f-ed01-4a0c-9775-ec2de87e0567/1/c1c8c4bd-44fd-4d34-988c-2636076f1ef9/Клиент — 10.2. ГКБ — отчёт полной формы.pdf',
  name:'Клиент — 10.2. ГКБ — отчёт полной формы.pdf',type:'ГКБ — полный отчёт',person:'Клиент'});
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const byteHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const requireCondition=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
export function storedPayload(payload){const copy=structuredClone(payload);for(const doc of copy.documents)delete doc.originalName;return copy;}
export function assertSource(bytes,read,extraction,iin){
 requireCondition(bytes.byteLength===SOURCE.byteSize&&byteHash(bytes)===SOURCE.sha256,'SOURCE_BYTES_CHANGED');
 requireCondition(read.originalSha256===SOURCE.sha256&&read.totalPages===SOURCE.pages&&read.readAllPhysicalPages===true&&read.pages.length===SOURCE.pages,'SOURCE_PAGES_CHANGED');
 requireCondition(read.signature==='present_not_verified','SOURCE_CONTAINER_CHANGED');
 requireCondition(extraction.kind==='gkb_full'&&extraction.identity?.iin===iin&&/^\d{12}$/.test(iin),'SOURCE_OWNER_CHANGED');
 requireCondition(extraction.credits?.length===SOURCE.loans,'SOURCE_LOANS_CHANGED');
}
export function assertGuard(guard,context,draft,requestId,now=Date.now()){
 requireCondition(guard&&guard.dealId===SOURCE.dealId&&guard.caseId===context.caseId&&guard.identityRevision===1&&guard.revision===draft.revision&&guard.beforeHash===digest(storedPayload(draft.payload)),'ROOT_GUARD_CHANGED');
 const age=now-Date.parse(guard.checkedAt);
 requireCondition(Number.isFinite(age)&&age>=0&&age<=300000,'ROOT_GUARD_STALE');
 requireCondition(Array.isArray(guard.documents)&&guard.documents.length===0&&Array.isArray(guard.pendingWrites)&&guard.pendingWrites.length===0&&guard.profileCompleted===false&&guard.pendingHistory===false&&guard.requestId===requestId&&guard.requestIdUnused===true,'ROOT_GUARD_BLOCKED');
}
function assertDraft(context,draft,validateDraft){
 requireCondition(context.identityRevision===1&&draft?.identityRevision===1&&!draft.recovery&&/^\d{12}$/.test(context.client?.iin||''),'IDENTITY_OR_DRAFT_CHANGED');
 const before=storedPayload(draft.payload);
 requireCondition(before.documents.length===0,'DOCUMENT_SELECTION_ALREADY_EXISTS');
 requireCondition(isDeepStrictEqual(validateDraft(before),before)&&JSON.stringify(validateDraft(before))===JSON.stringify(before),'DRAFT_NORMALIZATION_REQUIRED');
 return before;
}
function assertQuiet(activity,submission){
 requireCondition(Array.isArray(activity.active)&&!activity.active.some(row=>row.dealId===SOURCE.dealId),'ACTIVE_PROFILE_PRESENCE');
 requireCondition(Array.isArray(activity.completed)&&!activity.completed.some(row=>row.dealId===SOURCE.dealId),'PROFILE_ALREADY_COMPLETED');
 requireCondition(submission?.submission===null,'SUBMISSION_EXISTS');
}
export async function runRecovery({api,bytes,read,extraction,validateDraft,guard,requestId,commit,apply=false,planPin='',report,now=()=>Date.now()}){
 requireCondition(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId),'EXACT_REQUEST_ID_REQUIRED');
 requireCondition(/^[0-9a-f]{40}$/.test(commit),'EXACT_COMMIT_REQUIRED');
 const context=await api.context(),draft=await api.draft(),before=assertDraft(context,draft,validateDraft);
 assertSource(bytes,read,extraction,context.client.iin);assertGuard(guard,context,draft,requestId,now());
 assertQuiet(await api.activity(),await api.submission());
 const plan={schema:1,dealId:SOURCE.dealId,caseId:context.caseId,identityRevision:1,revision:draft.revision,beforeHash:digest(before),
  commit,requestId,source:SOURCE,clientIinHash:digest(context.client.iin),extractionHash:digest(extraction),
  change:{appendDocumentByHash:SOURCE.sha256,type:SOURCE.type,person:SOURCE.person},
  rootGuardHash:digest({...guard,checkedAt:undefined})};
 const planHash=digest(plan);Object.assign(report,{plan,planHash,previewOnly:!apply});
 async function recheck(){
  const current=await api.context(),latest=await api.draft();
  requireCondition(current.caseId===context.caseId&&current.client.iin===context.client.iin&&current.identityRevision===1,'LIVE_IDENTITY_CHANGED');
  requireCondition(latest?.revision===draft.revision&&latest.identityRevision===1&&!latest.recovery&&digest(storedPayload(latest.payload))===plan.beforeHash,'LIVE_DRAFT_CHANGED');
  assertGuard(guard,current,latest,requestId,now());assertQuiet(await api.activity(),await api.submission());
 }
 await recheck();
 if(!apply)return report;
 requireCondition(planPin===planHash,'EXACT_REVIEWED_PLAN_REQUIRED');
 // Exactly one upload call. Any non-success or lost response halts here. Reruns
 // are forbidden until owner readback reconciles content hash and draft receipt.
 report.uploadAttempted=true;
 const analysis=await api.upload(bytes);
 const document=analysis.document,parsed=document?.extraction;
 requireCondition(analysis.persisted===true&&analysis.caseId===context.caseId&&analysis.identityRevision===1&&typeof analysis.documentId==='string'&&typeof analysis.extractionId==='string','UPLOAD_CONTEXT_CHANGED');
 assertSource(bytes,document,parsed,context.client.iin);
 requireCondition(digest(parsed)===plan.extractionHash&&Array.isArray(analysis.reviews)&&analysis.reviews.length===0&&analysis.reviewRequired===true,'UPLOAD_ANALYSIS_CHANGED');
 requireCondition(!analysis.findings?.some(code=>['WRONG_CLIENT','DOCUMENT_IDENTITY_UNVERIFIED','DEAL_IDENTITY_UNVERIFIED'].includes(code)),'UPLOAD_OWNER_BLOCKED');
 const original=await api.original(analysis.documentId);
 requireCondition(original.byteLength===SOURCE.byteSize&&byteHash(original)===SOURCE.sha256,'UPLOADED_ORIGINAL_READBACK_MISMATCH');
 report.uploadVerified=true;report.documentId=analysis.documentId;report.extractionId=analysis.extractionId;
 const payload=structuredClone(before);payload.documents.push({documentId:analysis.documentId,type:SOURCE.type,person:SOURCE.person});
 requireCondition(isDeepStrictEqual(validateDraft(payload),payload)&&JSON.stringify(validateDraft(payload))===JSON.stringify(payload),'SELECTION_NORMALIZATION_REQUIRED');
 const undo=structuredClone(payload);undo.documents.pop();requireCondition(isDeepStrictEqual(undo,before),'UNRELATED_DRAFT_CHANGE');
 report.afterHash=digest(payload);await recheck();
 report.draftAttempted=true;
 const saved=await api.saveDraft({payload,expectedRevision:draft.revision,identityRevision:1,requestId});
 requireCondition(saved.revision===draft.revision+1&&saved.latestRevision===saved.revision&&saved.identityRevision===1,'DRAFT_SAVE_RESPONSE_CHANGED');
 const after=await api.draft();
 requireCondition(after?.revision===saved.revision&&after.identityRevision===1&&digest(storedPayload(after.payload))===report.afterHash,'DRAFT_READBACK_MISMATCH');
 const preserved=storedPayload(after.payload);preserved.documents.pop();requireCondition(isDeepStrictEqual(preserved,before),'UNRELATED_SAVED_CHANGE');
 const current=await api.context();requireCondition(current.caseId===context.caseId&&current.client.iin===context.client.iin&&current.identityRevision===1,'FINAL_IDENTITY_CHANGED');
 Object.assign(report,{verified:true,afterRevision:after.revision,selectionOnly:true});return report;
}
