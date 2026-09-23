import {RepositoryError,sha256,type CaseRow,type EvidenceRepository} from '../documents/repository';
import {DraftRepository,type DraftRow} from './repository';
import {validateDraft} from './draft';
import {compileAssessment} from './compile-assessment';
import {finalCheck} from './final-check';
import {documentUploadPlan,uploadBatchId} from '../documents/upload-plan';
import {UploadManifestRepository,type UploadManifest} from '../documents/upload-manifest';
import {uploadStoredDocuments} from '../documents/upload-service';
import {createVerifiedDocumentUploadAdapter} from '../crm/document-download';
import {ASSESSMENT_FIELDS} from '../crm/assessment-write';
import {bitrixHeaders} from '../crm/http-headers';
import type {Actor} from '../worker-session';

// Incident recovery is deliberately bounded to the two immutable employee saves
// the owner asked us to recover. This is not an alternate final-submission path.
export const RECOVERY_SOURCES:Record<string,{draft:string;handoff:string}>={
 '11727':{draft:'b5ec1bef797c5382b21819bd5a9f501eba87542c9f4687c9c65b866c72e3b7d8',handoff:'1b67a7019009c04a9f5475edff9bc7699664ff4b5f638b83a0834f229ddaf490'},
 '12221':{draft:'15685e280dd581524565b128a3ef85b6cca3bbeea96f2d2e500601f3d182e812',handoff:'a7a538b1889ff4535b060a1bbeefa1535053209da3215ffe77ff2319d52db8b4'},
};
type Snapshot=Record<string,unknown>;
export type RecoveryPlan={version:1;policy:'RECOVER_DRAFT_NOT_APPROVAL';dealId:string;iin:string;identityRevision:number;sourceHash:string;sourceRevision:number;sourceActor:string;sourceTime:string;before:Snapshot;fields:Record<string,string>;files:Awaited<ReturnType<typeof documentUploadPlan>>;remainingGates:string[]};
export type RecoveryRow={case_id:string;request_id:string;identity_revision:number;source_hash:string;plan_json:string;plan_hash:string;actor_id:string;state:string};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const empty=(v:unknown)=>v===null||v===undefined||v===false||v==='';
const protectedKeys=[...Object.values(ASSESSMENT_FIELDS),'TITLE','CATEGORY_ID','STAGE_ID','ASSIGNED_BY_ID','CONTACT_ID','COMPANY_ID'];
export function recoveryFields(values:ReturnType<typeof compileAssessment>['values'],before:Snapshot,source:DraftRow,gates:string[],dealId:string){
 if(String(before.CATEGORY_ID)!=='1'||before.STAGE_ID!=='C1:NEW'||typeof before.TITLE!=='string'||!/^.+\s+-\s+\[whatcrm\]\s+line\s+#\d+\s*$/i.test(before.TITLE)||values.procedure!=='199')throw new RepositoryError('RECOVERY_SCOPE_CHANGED');
 const fields:Record<string,string>={};
 for(const key of ['fio','procedure','dognum','contractDate','card'] as const){if(!empty(before[ASSESSMENT_FIELDS[key]]))throw new RepositoryError('RECOVERY_EXISTING_DATA_CONFLICT');}
 for(const key of ['fio','procedure','dognum','contractDate'] as const){if(!values[key])throw new RepositoryError('RECOVERY_SOURCE_INCOMPLETE');fields[ASSESSMENT_FIELDS[key]]=values[key];}
 fields.TITLE='ВП '+values.fio.trim().replace(/\s+/gu,' ');
 fields[ASSESSMENT_FIELDS.card]=[
  'ВОССТАНОВЛЕННЫЙ ЧЕРНОВИК — ПРОВЕРКА НЕ ЗАВЕРШЕНА',
  `Сделка № ${dealId}. Восстановлены сохранённые ответы сотрудника без изменения сумм.`,
  `Источник: версия ${source.revision}, ${source.created_at}, ${source.actor_id}.`,
  'Это копия черновика, а не завершённая оценка и не подтверждение сумм по документам.',
  'Открытые проверки: '+gates.join(', ')+'. Суммы ниже сохранены в исходном виде; не использовать как проверенный расчёт.',
  `Проверить источники и завершить оценку: https://assessment.anti-krizis.kz/assessment-review?dealId=${dealId}`,
  '',values.card,
 ].join('\n');
 return fields;
}
export function createRecoveryCrm(webhook:string,send:typeof fetch=fetch){
 async function call(method:string,body:unknown){
  if(!webhook)throw new RepositoryError('BITRIX_NOT_CONFIGURED');
  const r=await send(webhook.replace(/\/?$/,'/')+method+'.json',{method:'POST',headers:bitrixHeaders(webhook),body:JSON.stringify(body),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new RepositoryError('RECOVERY_CRM_UNAVAILABLE');
  const data=await r.json() as {result?:unknown;error?:string};if(data.error||data.result===undefined)throw new RepositoryError('RECOVERY_CRM_UNAVAILABLE');return data.result;
 }
 async function read(dealId:string,iin:string){
  const d=await call('crm.deal.get',{id:dealId}) as Snapshot;
  if(!d||String(d.ID)!==dealId||d.UF_CRM_AI_IIN!==iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
  return Object.fromEntries(protectedKeys.map(k=>[k,d[k]??null]));
 }
 async function reconcile(p:RecoveryPlan){const now=await read(p.dealId,p.iin);return protectedKeys.every(k=>equal(now[k],p.fields[k]??p.before[k])||(k===ASSESSMENT_FIELDS.contractDate&&typeof now[k]==='string'&&(now[k] as string).slice(0,10)===p.fields[k]));}
 async function write(p:RecoveryPlan){
  if(!equal(await read(p.dealId,p.iin),p.before))throw new RepositoryError('RECOVERY_CRM_CHANGED');
  // Once the durable claim exists, even a timeout here permits readback only.
  try{await call('crm.deal.update',{id:p.dealId,fields:p.fields});}catch{/* outcome unknown */}
  return reconcile(p);
 }
 return {read,write,reconcile};
}
export class DraftRecoveryRepository{
 constructor(readonly db:D1Database){}
 get(caseId:string){return this.db.prepare('SELECT * FROM assessment_draft_recoveries WHERE case_id=?').bind(caseId).first<RecoveryRow>();}
 async source(record:CaseRow){
  const pin=RECOVERY_SOURCES[record.external_id],draft=await new DraftRepository(this.db).latest(record.id);
  if(!pin||!draft||draft.payload_hash!==pin.draft||draft.identity_revision!==record.identity_revision||!record.client_iin)throw new RepositoryError('RECOVERY_SOURCE_CHANGED');
  if(await sha256(JSON.stringify({payload:JSON.parse(draft.payload_json),expectedRevision:draft.revision-1,identityRevision:draft.identity_revision,actorId:draft.actor_id}))!==draft.payload_hash)throw new RepositoryError('RECOVERY_SOURCE_INTEGRITY_FAILED');
  const h=await this.db.prepare("SELECT payload_hash,identity_revision FROM assessment_handoffs WHERE case_id=? AND state='verified'").bind(record.id).first<{payload_hash:string;identity_revision:number}>();
  if(!h||h.payload_hash!==pin.handoff||h.identity_revision!==record.identity_revision)throw new RepositoryError('RECOVERY_HANDOFF_CHANGED');
  if(await this.db.prepare('SELECT id FROM assessment_submissions WHERE case_id=? LIMIT 1').bind(record.id).first())throw new RepositoryError('RECOVERY_SUBMISSION_EXISTS');
  return draft;
 }
 async prepare(record:CaseRow,plan:RecoveryPlan,actor:Actor,expectedHash:string){
  const serialized=JSON.stringify(plan),hash=await sha256(serialized);if(hash!==expectedHash)throw new RepositoryError('RECOVERY_PROPOSAL_CHANGED');
  const now=new Date().toISOString();
  await this.db.prepare("INSERT INTO assessment_draft_recoveries (case_id,request_id,identity_revision,source_hash,plan_json,plan_hash,actor_id,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'prepared',?,? WHERE NOT EXISTS(SELECT 1 FROM assessment_submissions WHERE case_id=?) AND EXISTS(SELECT 1 FROM assessment_draft_versions WHERE case_id=? AND payload_hash=? AND revision=(SELECT MAX(revision) FROM assessment_draft_versions WHERE case_id=?)) ON CONFLICT DO NOTHING").bind(record.id,crypto.randomUUID(),record.identity_revision,plan.sourceHash,serialized,hash,actor.id,now,now,record.id,record.id,plan.sourceHash,record.id).run();
  const row=await this.get(record.id);if(!row||row.plan_hash!==hash)throw new RepositoryError('RECOVERY_PROPOSAL_CHANGED');return row;
 }
 async claim(record:CaseRow){return (await this.db.prepare("UPDATE assessment_draft_recoveries SET state='writing',updated_at=? WHERE case_id=? AND state='prepared' AND EXISTS(SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?)").bind(new Date().toISOString(),record.id,record.id,record.identity_revision).run()).meta.changes===1;}
 async finish(caseId:string,verified:boolean){await this.db.prepare("UPDATE assessment_draft_recoveries SET state=?,updated_at=? WHERE case_id=? AND state IN ('writing','uncertain')").bind(verified?'verified':'uncertain',new Date().toISOString(),caseId).run();}
 async cancel(caseId:string,hash:string){
  const row=await this.get(caseId);if(!row||row.plan_hash!==hash)throw new RepositoryError('RECOVERY_PROPOSAL_CHANGED');
  await this.db.prepare("UPDATE assessment_draft_recoveries SET state='cancelled',updated_at=? WHERE case_id=? AND state='prepared'").bind(new Date().toISOString(),caseId).run();
  if((await this.get(caseId))?.state!=='cancelled')throw new RepositoryError('RECOVERY_ALREADY_STARTED');
  return {state:'cancelled',finalAssessment:false};
 }
}
export async function inspectDraftRecovery(store:DraftRecoveryRepository,evidence:EvidenceRepository,record:CaseRow,crm:ReturnType<typeof createRecoveryCrm>,day:string){
 const source=await store.source(record),payload=validateDraft(JSON.parse(source.payload_json));
 const checked=await finalCheck(evidence,record,payload,[],day);
 if(!checked.publicResult.answersComplete||!checked.compiled||!checked.publicResult.documents.loanCoverage?.complete||checked.publicResult.evidence.issues.length)throw new RepositoryError('RECOVERY_SOURCE_INCOMPLETE');
 if(checked.publicResult.documents.issues.some(i=>!['SHORT_CREDIT_REVIEW_REQUIRED','EDS_SEPARATE_UPLOAD_REQUIRED'].includes(i.code)))throw new RepositoryError('RECOVERY_OTHER_DOCUMENT_ISSUES');
 const files=await documentUploadPlan(evidence,record,payload);
 if(files.batches.length!==1)throw new RepositoryError('RECOVERY_BATCH_REVIEW_REQUIRED');
 // Verify every original against its stored SHA before any CRM mutation.
 for(const file of files.batches.flat()){const doc=await evidence.document(record.id,file.documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');const bytes=await evidence.original(doc);if(bytes.length!==file.byteSize)throw new RepositoryError('ORIGINAL_INTEGRITY_FAILED');}
 const before=await crm.read(record.external_id,record.client_iin!);
 const gates=['Сверка сумм краткого и полного ГКБ','Финальное сохранение оценки'];
 const plan:RecoveryPlan={version:1,policy:'RECOVER_DRAFT_NOT_APPROVAL',dealId:record.external_id,iin:record.client_iin!,identityRevision:record.identity_revision,sourceHash:source.payload_hash,sourceRevision:source.revision,sourceActor:source.actor_id,sourceTime:source.created_at,before,fields:recoveryFields(checked.compiled.values,before,source,gates,record.external_id),files,remainingGates:gates};
 return {plan,planHash:await sha256(JSON.stringify(plan))};
}
export async function runDraftRecovery(store:DraftRecoveryRepository,evidence:EvidenceRepository,record:CaseRow,actor:Actor,crm:ReturnType<typeof createRecoveryCrm>,webhook:string,action:string,expectedHash:string,day:string,uploadAdapter?:ReturnType<typeof createVerifiedDocumentUploadAdapter>){
 if(actor.worker!=='ali')throw new RepositoryError('OWNER_REQUIRED',403);
 let row=await store.get(record.id);
 if(!row){if(action!=='recover')throw new RepositoryError('RECOVERY_NOT_PREPARED');const proposal=await inspectDraftRecovery(store,evidence,record,crm,day);row=await store.prepare(record,proposal.plan,actor,expectedHash);}
 if(row.plan_hash!==expectedHash||row.actor_id!==actor.id||row.identity_revision!==record.identity_revision)throw new RepositoryError('RECOVERY_PROPOSAL_CHANGED');
 if(row.state==='cancelled')throw new RepositoryError('RECOVERY_CANCELLED');
 await store.source(record);
 const plan=JSON.parse(row.plan_json) as RecoveryPlan;
 if(row.state==='prepared'){
  if(action!=='recover')return {state:'prepared',finalAssessment:false};
  if(!equal(await crm.read(record.external_id,record.client_iin!),plan.before))throw new RepositoryError('RECOVERY_CRM_CHANGED');
  if(await store.claim(record)){try{if(!await crm.write(plan))return {state:'uncertain',finalAssessment:false};}catch{await store.finish(record.id,false);return {state:'uncertain',finalAssessment:false};}}
 }
 // A retry never repeats the questionnaire write, including after a process restart.
 if(!await crm.reconcile(plan)){await store.finish(record.id,false);return {state:'uncertain',finalAssessment:false};}
 const manifests=new UploadManifestRepository(store.db),adapter=uploadAdapter??createVerifiedDocumentUploadAdapter(webhook,record.external_id,record.client_iin!);
 for(let index=0;index<plan.files.batches.length;index++){
  await store.source(record);
  if(!await crm.reconcile(plan))throw new RepositoryError('RECOVERY_CRM_CHANGED');
  const batch=plan.files.batches[index],id=await uploadBatchId(row.request_id,index);
  let upload=await manifests.get(record.id,id);
  if(!upload||upload.state==='prepared'){
   // Reconciliation cannot initiate a not-yet-started batch. Explicit recovery
   // may continue one, but never repeats an uncertain upload.
   if(action!=='recover')return {state:'files_pending',nextBatch:index,finalAssessment:false};
   const saved=upload?JSON.parse(upload.manifest_json) as UploadManifest:null;
   const baseline=saved?.baseline??(await adapter.read(record.external_id)).refs;
   const reused=saved?.reused??await manifests.reusableFiles(record,batch,baseline);
   upload=await uploadStoredDocuments(evidence,manifests,adapter,record,id,baseline,batch,actor,{planHash:'draft-recovery:'+row.plan_hash,rootRequestId:row.request_id,batchIndex:index,reviewIds:[],reused});
  }
  if(upload&&['writing','uncertain','verified'].includes(upload.state)){
   const m=JSON.parse(upload.manifest_json) as UploadManifest;
   try{const receipt=await adapter.reconcile(record.external_id,record.client_iin!,m.baseline,m.files,m.reused);if(upload.state!=='verified')upload=await manifests.finish(record.id,id,receipt,'RECOVERED_ORIGINAL_BYTES_VERIFIED');}
   catch{await store.finish(record.id,false);return {state:'files_uncertain',batch:index,finalAssessment:false};}
  }
  if(upload?.state!=='verified')return {state:'files_pending',batch:index,finalAssessment:false};
 }
 await store.source(record);const verified=await crm.reconcile(plan);await store.finish(record.id,verified);
 return {state:verified?'verified':'uncertain',restoredOriginals:plan.files.batches.flat().length,sourceRevision:plan.sourceRevision,sourceActor:plan.sourceActor,finalAssessment:false,remainingGates:plan.remainingGates};
}
