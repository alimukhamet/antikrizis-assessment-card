import {RepositoryError,sha256,type CaseRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import type {HandoffDestination,HandoffTitlePlan} from '../crm/lawyer-handoff';
export type HandoffPayload={destination:HandoffDestination;titlePlan?:HandoffTitlePlan;powerId:string;signedId:string;credentialRequestId:string;reviewIds:string[];signedConfirmed:true;confirmedAt:string};
export type HandoffRow={id:string;case_id:string;request_id:string;identity_revision:number;actor_id:string;payload_json:string;state:'prepared'|'writing'|'uncertain'|'verified'|'cancelled';outcome_code:string|null;created_at:string;updated_at:string};
export class HandoffRepository{
 constructor(private db:D1Database){}
 active(caseId:string){return this.db.prepare("SELECT * FROM assessment_handoffs WHERE case_id=? AND state<>'cancelled' ORDER BY rowid DESC LIMIT 1").bind(caseId).first<HandoffRow>();}
 get(caseId:string,requestId:string){return this.db.prepare('SELECT * FROM assessment_handoffs WHERE case_id=? AND request_id=?').bind(caseId,requestId).first<HandoffRow>();}
 async prepare(record:CaseRow,requestId:string,payload:HandoffPayload,actor:Actor){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId))throw new RepositoryError('INVALID_REQUEST_ID',400);
  const now=new Date().toISOString(),serialized=JSON.stringify(payload);
  await this.db.prepare("INSERT INTO assessment_handoffs (id,case_id,request_id,identity_revision,actor_id,authentication,payload_json,payload_hash,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'prepared',?,? WHERE EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) ON CONFLICT DO NOTHING").bind(crypto.randomUUID(),record.id,requestId,record.identity_revision,actor.id,actor.authentication,serialized,await sha256(serialized),now,now,record.id,record.identity_revision).run();
  const row=await this.get(record.id,requestId);if(!row||row.actor_id!==actor.id||row.identity_revision!==record.identity_revision||row.payload_json!==serialized)throw new RepositoryError('HANDOFF_ALREADY_PENDING');return row;
 }
 async claim(record:CaseRow,row:HandoffRow){
  const result=await this.db.prepare("UPDATE assessment_handoffs SET state='writing',updated_at=? WHERE id=? AND state='prepared' AND identity_revision=? AND EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) AND NOT EXISTS (SELECT 1 FROM json_each(assessment_handoffs.payload_json,'$.reviewIds') required WHERE NOT EXISTS (SELECT 1 FROM assessment_reviews r WHERE r.id=required.value AND r.case_id=assessment_handoffs.case_id AND r.identity_revision=assessment_handoffs.identity_revision AND r.disposition='confirmed' AND NOT EXISTS (SELECT 1 FROM assessment_reviews newer WHERE newer.case_id=r.case_id AND newer.document_id=r.document_id AND newer.extraction_id=r.extraction_id AND newer.identity_revision=r.identity_revision AND newer.fact_key=r.fact_key AND newer.rowid>r.rowid)))").bind(new Date().toISOString(),row.id,record.identity_revision,record.id,record.identity_revision).run();return result.meta.changes===1;
 }
 async finish(record:CaseRow,row:HandoffRow,state:'verified'|'uncertain'|'prepared',code:string){
  await this.db.prepare("UPDATE assessment_handoffs SET state=?,outcome_code=?,updated_at=? WHERE id=? AND case_id=? AND state IN ('writing','uncertain')").bind(state,code,new Date().toISOString(),row.id,record.id).run();return this.get(record.id,row.request_id);
 }
 async cancel(record:CaseRow,row:HandoffRow,actor:Actor){
  if(row.actor_id!==actor.id)throw new RepositoryError('HANDOFF_OWNED_BY_ANOTHER_WORKER');
  await this.db.prepare("UPDATE assessment_handoffs SET state='cancelled',updated_at=? WHERE id=? AND case_id=? AND state='prepared'").bind(new Date().toISOString(),row.id,record.id).run();
  const after=await this.get(record.id,row.request_id);if(after?.state!=='cancelled')throw new RepositoryError('HANDOFF_ALREADY_STARTED');return after;
 }
}
