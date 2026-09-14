import type {Actor} from './worker-session';
import release from './assessment-release.json';

export class FeedbackError extends Error {
  constructor(public code:string, public status=400){super(code);}
}
export type FeedbackInput = {
  requestId:string; message:string; dealId:string|null;
  step:'documents'|'answers'|'contract'; fieldId:string|null; fieldLabel:string|null;
  clientVersion:string;
};
export type FeedbackRow = {
  sequence:number; id:string; request_id:string; schema_version:number;
  actor_id:string; actor_name:string; authentication:string;
  deal_id:string|null; step:FeedbackInput['step']; field_id:string|null; field_label:string|null;
  message:string; client_version:string; server_version:string; created_at:string;
};
export function validateFeedback(raw:Record<string,unknown>):FeedbackInput {
  const text=(key:string,max:number)=>{
    if(typeof raw[key]!=='string'||raw[key].length>max)throw new FeedbackError('INVALID_FEEDBACK');
    return raw[key].trim();
  };
  const requestId=text('requestId',36),message=text('message',3000),clientVersion=text('clientVersion',80);
  const dealId=raw.dealId==null?null:text('dealId',20);
  let fieldId=raw.fieldId==null?null:text('fieldId',100),fieldLabel=raw.fieldLabel==null?null:text('fieldLabel',300);
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)||message.length<5||
    !/^assessment-[a-zA-Z0-9.-]+$/.test(clientVersion)||dealId!==null&&!/^[1-9]\d{0,19}$/.test(dealId)||
    !['documents','answers','contract'].includes(String(raw.step))||
    fieldId!==null&&!/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(fieldId))throw new FeedbackError('INVALID_FEEDBACK');
  // Credential controls never become automatic diagnostic context.
  if(fieldId&&/eds|password|credential|secret|token/i.test(fieldId)){fieldId=null;fieldLabel=null;}
  if(!fieldId)fieldLabel=null;
  return {requestId,message,dealId,step:raw.step as FeedbackInput['step'],fieldId,fieldLabel,clientVersion};
}
const columns='rowid AS sequence,id,request_id,schema_version,actor_id,actor_name,authentication,deal_id,step,field_id,field_label,message,client_version,server_version,created_at';

/** Append-only reports. Reporting remains available when Bitrix or document analysis is down. */
export class FeedbackRepository {
  constructor(private db:D1Database){}
  async create(input:FeedbackInput,actor:Actor,now=new Date().toISOString()){
    const serialized=JSON.stringify(input);
    const existing=()=>this.db.prepare('SELECT id,payload_json FROM assessment_tool_feedback WHERE actor_id=? AND request_id=?').bind(actor.id,input.requestId).first<{id:string;payload_json:string}>();
    const check=(row:{id:string;payload_json:string})=>{
      if(row.payload_json!==serialized)throw new FeedbackError('FEEDBACK_REQUEST_REUSED',409);
      return {id:row.id};
    };
    const previous=await existing();if(previous)return check(previous);
    const since=new Date(new Date(now).getTime()-3600000).toISOString();
    await this.db.prepare(`INSERT INTO assessment_tool_feedback
      (id,request_id,schema_version,actor_id,actor_name,authentication,deal_id,step,field_id,field_label,message,client_version,server_version,payload_json,created_at)
      SELECT ?,?,1,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM assessment_tool_feedback WHERE actor_id=? AND created_at>=?)<30
      ON CONFLICT(actor_id,request_id) DO NOTHING`).bind(
      crypto.randomUUID(),input.requestId,actor.id,actor.displayName,actor.authentication,
      input.dealId,input.step,input.fieldId,input.fieldLabel,input.message,input.clientVersion,release.version,serialized,now,actor.id,since
    ).run();
    const row=await existing();if(!row)throw new FeedbackError('FEEDBACK_RATE_LIMIT',429);
    return check(row);
  }
  async page(actor:Actor,before=Number.MAX_SAFE_INTEGER,limit=50){
    const scope=actor.worker==='ali'?null:actor.id;
    const rows=await this.db.prepare(`SELECT ${columns} FROM assessment_tool_feedback
      WHERE (? IS NULL OR actor_id=?) AND rowid<? ORDER BY rowid DESC LIMIT ?`)
      .bind(scope,scope,before,limit).all<FeedbackRow>();
    return rows.results;
  }
}
export async function feedbackRepository(){
  const {env}=await import('cloudflare:workers');
  const db=(env as typeof env&{DB?:D1Database}).DB;
  if(!db)throw new FeedbackError('FEEDBACK_UNAVAILABLE',503);
  return new FeedbackRepository(db);
}
