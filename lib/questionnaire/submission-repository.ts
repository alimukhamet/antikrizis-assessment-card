import {RepositoryError,sha256,type CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import type {AssessmentBaseline,AssessmentValues} from '../crm/assessment-write';
import type {DraftPayload} from './draft';
import type {ApprovedAnswerEvidence,ReviewBinding} from './review-bindings';
export type SubmissionPayload = {
 schemaVersion:1; draft:DraftPayload; inputBindings?:ReviewBinding[]; baseline:AssessmentBaseline; values:AssessmentValues;
 // Trusted review IDs collected by the submission validator, never caller assertions.
 contractData:Record<string,unknown>;contractRendererVersion:string;lawyerCard:string;historyCard?:string; reviewIds:string[]; evidence:ApprovedAnswerEvidence[]; validationVersion:string; assessmentDay:string;
};
export type SubmissionRow = {
 id:string;case_id:string;request_id:string;identity_revision:number;payload_json:string;payload_hash:string;
 actor_id:string;authentication:string;state:'prepared'|'writing'|'uncertain'|'verified'|'cancelled';outcome_code:string|null;
 history_state:'pending'|'writing'|'uncertain'|'verified';history_comment_id:string|null;history_outcome_code:string|null;
 created_at:string;updated_at:string;
};
/** Metadata is not user intent. A fresh CRM read or audit timestamp must not create
 * another save of identical content. The persisted payload/hash remain immutable;
 * validation version, day, contract, answers and evidence are still compared. */
function samePreparedContent(left:SubmissionPayload,right:SubmissionPayload){
 const content=(payload:SubmissionPayload)=>JSON.stringify(Object.fromEntries(
  Object.entries(payload).filter(([key])=>key!=='baseline'&&key!=='historyCard').sort(([a],[b])=>a.localeCompare(b)),
  (_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
   ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 return content(left)===content(right);
}
/** No automatic lease expiry after an external write: writing/uncertain work must be reconciled. */
export class SubmissionRepository {
 constructor(private db:D1Database){}
 get(caseId:string,requestId:string){return this.db.prepare('SELECT * FROM assessment_submissions WHERE case_id=? AND request_id=?').bind(caseId,requestId).first<SubmissionRow>();}
 latest(caseId:string,actorId:string){return this.db.prepare("SELECT * FROM assessment_submissions WHERE case_id=? AND actor_id=? AND state<>'cancelled' ORDER BY CASE WHEN state<>'verified' THEN 0 WHEN history_state<>'verified' THEN 1 ELSE 2 END,created_at DESC,rowid DESC LIMIT 1").bind(caseId,actorId).first<SubmissionRow>();}
 active(caseId:string){return this.db.prepare("SELECT * FROM assessment_submissions WHERE case_id=? AND state NOT IN ('verified','cancelled') ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(caseId).first<SubmissionRow>();}
 async prepare(record:CaseRow,requestId:string,payload:SubmissionPayload,actor:Actor){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId))throw new RepositoryError('INVALID_REQUEST_ID',400);
  const current=await this.db.prepare('SELECT identity_revision FROM assessment_cases WHERE id=?').bind(record.id).first<{identity_revision:number}>();
  if(!current||current.identity_revision!==record.identity_revision)throw new RepositoryError('SUBMISSION_PENDING_OR_IDENTITY_CHANGED');
  const serialized=JSON.stringify(payload);
  if(new TextEncoder().encode(serialized).length>500000)throw new RepositoryError('SUBMISSION_TOO_LARGE',413);
  const hash=await sha256(JSON.stringify({payload,identityRevision:record.identity_revision,actorId:actor.id}));
  const prior=await this.get(record.id,requestId);
  if(prior){if(prior.payload_hash!==hash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');return prior;}
  const active=await this.active(record.id);
  if(active){
   if(active.identity_revision!==record.identity_revision)throw new RepositoryError('SUBMISSION_PENDING_OR_IDENTITY_CHANGED');
   if(active.actor_id===actor.id&&samePreparedContent(JSON.parse(active.payload_json),payload))return active;
   // A same-worker prepared snapshot has never claimed the external write. It is safe to
   // supersede after a page reload/new request ID when the employee changed the answers.
   if(active.actor_id===actor.id&&active.state==='prepared'){
    const cancelled=await this.db.prepare("UPDATE assessment_submissions SET state='cancelled',outcome_code='SUPERSEDED_BEFORE_WRITE',updated_at=? WHERE case_id=? AND request_id=? AND actor_id=? AND state='prepared' AND identity_revision=? AND EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?)")
     .bind(new Date().toISOString(),record.id,active.request_id,actor.id,record.identity_revision,record.id,record.identity_revision).run();
    if(cancelled.meta.changes!==1)throw new RepositoryError('SUBMISSION_PENDING_OR_IDENTITY_CHANGED');
   }else throw new RepositoryError('SUBMISSION_PENDING_OR_IDENTITY_CHANGED');
  }
  const now=new Date().toISOString();
  await this.db.prepare("INSERT INTO assessment_submissions (id,case_id,request_id,identity_revision,payload_json,payload_hash,actor_id,authentication,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'prepared',?,? WHERE EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) ON CONFLICT DO NOTHING")
   .bind(crypto.randomUUID(),record.id,requestId,record.identity_revision,serialized,hash,actor.id,actor.authentication,now,now,record.id,record.identity_revision).run();
  const saved=await this.get(record.id,requestId);
  if(!saved){
   // Another identical tab may have won the unique active-case insert after our read.
   const winner=await this.active(record.id);
   if(winner&&winner.identity_revision===record.identity_revision&&winner.actor_id===actor.id&&samePreparedContent(JSON.parse(winner.payload_json),payload))return winner;
   throw new RepositoryError('SUBMISSION_PENDING_OR_IDENTITY_CHANGED');
  }
  if(saved.payload_hash!==hash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');
  return saved;
 }
 async claim(record:CaseRow,requestId:string){
  const result=await this.db.prepare("UPDATE assessment_submissions SET state='writing',updated_at=? WHERE case_id=? AND request_id=? AND state='prepared' AND identity_revision=? AND EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) AND NOT EXISTS (SELECT 1 FROM json_each(assessment_submissions.payload_json, '$.reviewIds') required WHERE NOT EXISTS (SELECT 1 FROM assessment_reviews r WHERE r.id=required.value AND r.case_id=assessment_submissions.case_id AND r.identity_revision=assessment_submissions.identity_revision AND r.disposition IN ('confirmed','corrected') AND NOT EXISTS (SELECT 1 FROM assessment_reviews newer WHERE newer.case_id=r.case_id AND newer.document_id=r.document_id AND newer.extraction_id=r.extraction_id AND newer.identity_revision=r.identity_revision AND newer.fact_key=r.fact_key AND newer.rowid>r.rowid)))")
   .bind(new Date().toISOString(),record.id,requestId,record.identity_revision,record.id,record.identity_revision).run();
  return result.meta.changes===1;
 }
 async claimHistory(record:CaseRow,requestId:string){
  const result=await this.db.prepare("UPDATE assessment_submissions SET history_state='writing',updated_at=? WHERE case_id=? AND request_id=? AND state='verified' AND history_state='pending' AND identity_revision=? AND EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?)").bind(new Date().toISOString(),record.id,requestId,record.identity_revision,record.id,record.identity_revision).run();return result.meta.changes===1;
 }
 async finishHistory(caseId:string,requestId:string,commentId:string|null,code:string){
  if(commentId!==null&&!/^[1-9]\d*$/.test(commentId))throw new RepositoryError('INVALID_HISTORY_RECEIPT');
  await this.db.prepare("UPDATE assessment_submissions SET history_state=?,history_comment_id=?,history_outcome_code=?,updated_at=? WHERE case_id=? AND request_id=? AND state='verified' AND history_state IN ('writing','uncertain')").bind(commentId?'verified':'uncertain',commentId,code,new Date().toISOString(),caseId,requestId).run();return this.get(caseId,requestId);
 }
 /** Only the claimant may call these with explicit adapter proof of zero external writes.
  * Existing uncertain records are not unlocked merely because their outcome is old. */
 async releaseUnsent(caseId:string,requestId:string,code:string){
  await this.db.prepare("UPDATE assessment_submissions SET state='prepared',outcome_code=?,updated_at=? WHERE case_id=? AND request_id=? AND state IN ('writing','uncertain') AND history_state='pending'")
   .bind('NOT_SENT:'+code,new Date().toISOString(),caseId,requestId).run();
  return this.get(caseId,requestId);
 }
 async releaseHistoryUnsent(caseId:string,requestId:string,code:string){
  await this.db.prepare("UPDATE assessment_submissions SET history_state='pending',history_outcome_code=?,updated_at=? WHERE case_id=? AND request_id=? AND state='verified' AND history_state IN ('writing','uncertain') AND history_comment_id IS NULL")
   .bind('NOT_SENT:'+code,new Date().toISOString(),caseId,requestId).run();
  return this.get(caseId,requestId);
 }
 async cancelPrepared(caseId:string,requestId:string,actorId:string){
  await this.db.prepare("UPDATE assessment_submissions SET state='cancelled',outcome_code='CANCELLED_BEFORE_WRITE',updated_at=? WHERE case_id=? AND request_id=? AND actor_id=? AND state='prepared'").bind(new Date().toISOString(),caseId,requestId,actorId).run();
  return this.get(caseId,requestId);
 }
 async finish(caseId:string,requestId:string,verified:boolean,code:string){
  // A late uncertain result cannot overwrite a verified reconciliation.
  await this.db.prepare("UPDATE assessment_submissions SET state=?,outcome_code=?,updated_at=? WHERE case_id=? AND request_id=? AND state IN ('writing','uncertain')")
   .bind(verified?'verified':'uncertain',code,new Date().toISOString(),caseId,requestId).run();
  return this.get(caseId,requestId);
 }
}
