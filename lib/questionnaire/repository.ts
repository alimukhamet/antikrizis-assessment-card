import {RepositoryError,sha256,type CaseRow}from'../documents/repository';
import type{Actor}from'../worker-session';import type{DraftPayload}from'./draft';
export type DraftRow={id:string;case_id:string;revision:number;identity_revision:number;request_id:string;payload_json:string;payload_hash:string;actor_id:string;created_at:string};
export class DraftRepository{
 constructor(private db:D1Database){}
 latest(caseId:string){return this.db.prepare('SELECT * FROM assessment_draft_versions WHERE case_id=? ORDER BY revision DESC LIMIT 1').bind(caseId).first<DraftRow>();}
 async recent(){
  const result=await this.db.prepare("SELECT c.external_id AS dealId,c.title,d.revision,d.created_at AS updatedAt,json_array_length(d.payload_json,'$.documents') AS fileCount FROM assessment_cases c JOIN assessment_draft_versions d ON d.case_id=c.id WHERE c.external_system='bitrix' AND d.revision=(SELECT MAX(v.revision) FROM assessment_draft_versions v WHERE v.case_id=c.id) ORDER BY d.created_at DESC LIMIT 30").all<{dealId:string;title:string;revision:number;updatedAt:string;fileCount:number}>();
  return result.results;
 }
 async save(record:CaseRow,payload:DraftPayload,expectedRevision:number,requestId:string,actor:Actor){
  if(!Number.isInteger(expectedRevision)||expectedRevision<0||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId))throw new RepositoryError('INVALID_DRAFT_REQUEST',400);
  const serialized=JSON.stringify(payload);if(new TextEncoder().encode(serialized).length>240000)throw new RepositoryError('DRAFT_TOO_LARGE',413);
  const hash=await sha256(JSON.stringify({payload,expectedRevision,identityRevision:record.identity_revision,actorId:actor.id}));
  const old=await this.db.prepare('SELECT * FROM assessment_draft_versions WHERE case_id=? AND request_id=?').bind(record.id,requestId).first<DraftRow>();
  if(old){if(old.payload_hash!==hash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');return old;}
  await this.db.prepare('INSERT INTO assessment_draft_versions (id,case_id,revision,identity_revision,request_id,payload_json,payload_hash,actor_id,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) AND COALESCE((SELECT MAX(revision) FROM assessment_draft_versions WHERE case_id=?),0)=? ON CONFLICT DO NOTHING').bind(crypto.randomUUID(),record.id,expectedRevision+1,record.identity_revision,requestId,serialized,hash,actor.id,new Date().toISOString(),record.id,record.identity_revision,record.id,expectedRevision).run();
  const saved=await this.db.prepare('SELECT * FROM assessment_draft_versions WHERE case_id=? AND request_id=?').bind(record.id,requestId).first<DraftRow>();if(!saved)throw new RepositoryError('DRAFT_CHANGED');if(saved.payload_hash!==hash)throw new RepositoryError('IDEMPOTENCY_KEY_REUSED');return saved;
 }
}
export async function draftRepository(){const {env}=await import('cloudflare:workers');const db=(env as typeof env&{DB?:D1Database}).DB;if(!db)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);return new DraftRepository(db);}
