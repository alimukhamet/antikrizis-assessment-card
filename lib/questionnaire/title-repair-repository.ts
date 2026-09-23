import {RepositoryError,type CaseRow} from '../documents/repository';
import type {TitleRepairTarget} from '../crm/title-repair';
import type {SubmissionRow} from './submission-repository';

export type TitleRepairIntent=TitleRepairTarget&{version:1;requestId:string;actorId:string;authentication:string;caseId:string;identityRevision:number;submissionId:string;submissionRequestId:string;submissionHash:string;proposalHash:string;createdAt:string};
export type TitleRepairRow=SubmissionRow&{title_repair_json:string|null;title_repair_state:'prepared'|'writing'|'uncertain'|'verified'|'cancelled'|null;title_repair_updated_at:string|null};
// This expression is used in both intent creation and claim. It serializes the
// separate title operation against newer or unfinished questionnaire writes.
const eligible=`state='verified' AND history_state='verified' AND history_comment_id IS NOT NULL
 AND id=(SELECT newest.id FROM assessment_submissions newest WHERE newest.case_id=assessment_submissions.case_id AND newest.state<>'cancelled' ORDER BY newest.created_at DESC,newest.rowid DESC LIMIT 1)
 AND NOT EXISTS (SELECT 1 FROM assessment_submissions pending WHERE pending.case_id=assessment_submissions.case_id AND pending.state<>'cancelled' AND (pending.state<>'verified' OR pending.history_state<>'verified'))
 AND EXISTS (SELECT 1 FROM assessment_cases c WHERE c.id=assessment_submissions.case_id AND c.identity_revision=assessment_submissions.identity_revision)`;
export class TitleRepairRepository{
 constructor(private db:D1Database){}
 get(caseId:string,submissionId:string){return this.db.prepare('SELECT * FROM assessment_submissions WHERE case_id=? AND id=?').bind(caseId,submissionId).first<TitleRepairRow>();}
 async eligible(record:CaseRow,submission:SubmissionRow){
  const row=await this.db.prepare(`SELECT * FROM assessment_submissions WHERE case_id=? AND id=? AND payload_hash=? AND identity_revision=? AND ${eligible}`).bind(record.id,submission.id,submission.payload_hash,record.identity_revision).first<TitleRepairRow>();
  if(!row||!/^[1-9]\d*$/.test(row.history_comment_id||''))throw new RepositoryError('TITLE_REPAIR_SUBMISSION_CHANGED');return row;
 }
 async prepare(record:CaseRow,submission:SubmissionRow,intent:TitleRepairIntent){
  const before=await this.eligible(record,submission),serialized=JSON.stringify(intent);
  if(before.title_repair_json){if(before.title_repair_json!==serialized)throw new RepositoryError('TITLE_REPAIR_ALREADY_PENDING');return before;}
  const result=await this.db.prepare(`UPDATE assessment_submissions SET title_repair_json=?,title_repair_state='prepared',title_repair_updated_at=? WHERE case_id=? AND id=? AND payload_hash=? AND identity_revision=? AND title_repair_json IS NULL AND title_repair_state IS NULL AND ${eligible}
   AND NOT EXISTS (SELECT 1 FROM assessment_submissions repair WHERE repair.case_id=assessment_submissions.case_id AND repair.title_repair_state IN ('prepared','writing','uncertain'))`).bind(serialized,intent.createdAt,record.id,submission.id,submission.payload_hash,record.identity_revision).run();
  const row=await this.get(record.id,submission.id);if(!row||!result.meta.changes&&row.title_repair_json!==serialized)throw new RepositoryError('TITLE_REPAIR_SUBMISSION_CHANGED');return row;
 }
 async claim(record:CaseRow,row:TitleRepairRow){
  const result=await this.db.prepare(`UPDATE assessment_submissions SET title_repair_state='writing',title_repair_updated_at=? WHERE case_id=? AND id=? AND payload_hash=? AND identity_revision=? AND title_repair_state='prepared' AND title_repair_json=? AND ${eligible}
   AND NOT EXISTS (SELECT 1 FROM assessment_submissions repair WHERE repair.case_id=assessment_submissions.case_id AND repair.id<>assessment_submissions.id AND repair.title_repair_state IN ('prepared','writing','uncertain'))`).bind(new Date().toISOString(),record.id,row.id,row.payload_hash,record.identity_revision,row.title_repair_json).run();return result.meta.changes===1;
 }
 async finish(record:CaseRow,row:TitleRepairRow,verified:boolean){
  await this.db.prepare("UPDATE assessment_submissions SET title_repair_state=?,title_repair_updated_at=? WHERE case_id=? AND id=? AND payload_hash=? AND title_repair_json=? AND title_repair_state IN ('writing','uncertain')").bind(verified?'verified':'uncertain',new Date().toISOString(),record.id,row.id,row.payload_hash,row.title_repair_json).run();return this.get(record.id,row.id);
 }
 /** Only the write claimant with adapter proof of zero writes may release. */
 async releaseUnsent(record:CaseRow,row:TitleRepairRow){
  await this.db.prepare("UPDATE assessment_submissions SET title_repair_state='prepared',title_repair_updated_at=? WHERE case_id=? AND id=? AND payload_hash=? AND title_repair_json=? AND title_repair_state='writing'").bind(new Date().toISOString(),record.id,row.id,row.payload_hash,row.title_repair_json).run();return this.get(record.id,row.id);
 }
 /** Prepared has not claimed a write. Writing may be cancelled only by its
  * claimant after the adapter explicitly proves no external write started. */
 async cancelUnsent(record:CaseRow,row:TitleRepairRow,claimedNotStarted=false){
  await this.db.prepare(`UPDATE assessment_submissions SET title_repair_state='cancelled',title_repair_updated_at=? WHERE case_id=? AND id=? AND payload_hash=? AND title_repair_json=? AND title_repair_state=?`).bind(new Date().toISOString(),record.id,row.id,row.payload_hash,row.title_repair_json,claimedNotStarted?'writing':'prepared').run();return this.get(record.id,row.id);
 }
}
