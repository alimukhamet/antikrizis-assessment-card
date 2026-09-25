import { RepositoryError, sha256, type CaseRow } from '../documents/repository';
import type { Actor } from '../worker-session';
import type { ProfileBaseline, ProfileValues } from '../crm/profile-fields';
import type { DraftPayload } from './draft';

export type ProfileSavePayload = {
  schemaVersion: 1; dealId: string; draft: DraftPayload;
  /** Bitrix values read immediately before the write — the recovery point. */
  baseline: ProfileBaseline; values: ProfileValues; unresolvedCount: number;
};
export type ProfileSaveState = 'writing' | 'uncertain' | 'verified' | 'failed';
export type ProfileSaveRow = {
  id: string; case_id: string; request_id: string; identity_revision: number; actor_id: string;
  payload_json: string; state: ProfileSaveState; outcome_code: string | null; history_comment_id: string | null;
  created_at: string; updated_at: string;
};

const requestPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class ProfileSaveRepository {
  constructor(private db: D1Database) {}
  get(caseId: string, requestId: string) {
    return this.db.prepare('SELECT * FROM assessment_profile_saves WHERE case_id=? AND request_id=?').bind(caseId, requestId).first<ProfileSaveRow>();
  }
  active(caseId: string) {
    return this.db.prepare("SELECT * FROM assessment_profile_saves WHERE case_id=? AND state IN ('writing','uncertain') LIMIT 1").bind(caseId).first<ProfileSaveRow>();
  }
  latestVerified(caseId: string) {
    return this.db.prepare("SELECT * FROM assessment_profile_saves WHERE case_id=? AND state='verified' ORDER BY rowid DESC LIMIT 1").bind(caseId).first<ProfileSaveRow>();
  }
  /** Deal ID → «time · worker» of the latest verified profile save per deal (the queue's «done» marker). */
  async savedByDeal(names: Record<string, string>) {
    const { results } = await this.db.prepare("SELECT c.external_id AS deal_id, s.actor_id, s.updated_at FROM assessment_profile_saves s JOIN assessment_cases c ON c.id=s.case_id WHERE s.state='verified' AND c.external_system='bitrix' ORDER BY s.updated_at")
      .all<{ deal_id: string; actor_id: string; updated_at: string }>();
    return new Map(results.map(row => [row.deal_id, `${row.updated_at} · ${names[row.actor_id.replace(/^worker:/, '')] || row.actor_id}`]));
  }
  /** Claims the single in-flight write for this case before Bitrix is touched. */
  async begin(record: CaseRow, requestId: string, payload: ProfileSavePayload, actor: Actor) {
    if (!requestPattern.test(requestId)) throw new RepositoryError('INVALID_REQUEST_ID', 400);
    const now = new Date().toISOString(), serialized = JSON.stringify(payload);
    await this.db.prepare("INSERT INTO assessment_profile_saves (id,case_id,request_id,identity_revision,actor_id,authentication,payload_json,payload_hash,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'writing',?,? WHERE EXISTS (SELECT 1 FROM assessment_cases WHERE id=? AND identity_revision=?) ON CONFLICT DO NOTHING")
      .bind(crypto.randomUUID(), record.id, requestId, record.identity_revision, actor.id, actor.authentication, serialized, await sha256(serialized), now, now, record.id, record.identity_revision).run();
    const row = await this.get(record.id, requestId);
    if (!row || row.actor_id !== actor.id || row.identity_revision !== record.identity_revision) throw new RepositoryError('PROFILE_SAVE_PENDING');
    return row;
  }
  async finish(record: CaseRow, row: ProfileSaveRow, state: ProfileSaveState, code: string) {
    await this.db.prepare("UPDATE assessment_profile_saves SET state=?,outcome_code=?,updated_at=? WHERE id=? AND case_id=? AND state IN ('writing','uncertain')")
      .bind(state, code, new Date().toISOString(), row.id, record.id).run();
    return (await this.get(record.id, row.request_id))!;
  }
  async history(record: CaseRow, row: ProfileSaveRow, commentId: string) {
    await this.db.prepare('UPDATE assessment_profile_saves SET history_comment_id=?,updated_at=? WHERE id=? AND case_id=?')
      .bind(commentId, new Date().toISOString(), row.id, record.id).run();
    return (await this.get(record.id, row.request_id))!;
  }
}
