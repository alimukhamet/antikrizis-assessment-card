import {RepositoryError,sha256,type CaseRow} from '../documents/repository';
import {TitleRepairError,type createTitleRepairAdapter} from '../crm/title-repair';
import type {Actor} from '../worker-session';
import type {SubmissionPayload,SubmissionRow} from './submission-repository';
import {TitleRepairRepository,type TitleRepairIntent,type TitleRepairRow} from './title-repair-repository';

type Dependencies={repository:TitleRepairRepository;crm:ReturnType<typeof createTitleRepairAdapter>;verifyDelivery:()=>Promise<{requestId:string;payloadHash:string}>};
const terminalPreflight=(error:unknown)=>error instanceof RepositoryError&&['CASE_IDENTITY_CHANGED','TITLE_REPAIR_SCOPE_CHANGED','TITLE_REPAIR_FIO_CHANGED','TITLE_REPAIR_TITLE_CONFLICT','TITLE_REPAIR_POLICY_UNSUPPORTED','TITLE_REPAIR_SUBMISSION_CHANGED','HANDOFF_ASSESSMENT_CHANGED','HANDOFF_ASSESSMENT_PENDING','HANDOFF_ASSESSMENT_REQUIRED','HANDOFF_ORIGINALS_REQUIRED','HANDOFF_ORIGINAL_REMOVED','HANDOFF_ORIGINAL_CHANGED'].includes(error.code);
function requireSubmission(record:CaseRow,submission:SubmissionRow|null){
 if(!submission||submission.case_id!==record.id||submission.identity_revision!==record.identity_revision||submission.state!=='verified'||submission.history_state!=='verified'||!/^[1-9]\d*$/.test(submission.history_comment_id||''))throw new RepositoryError('TITLE_REPAIR_SUBMISSION_CHANGED');
 let payload:SubmissionPayload;try{payload=JSON.parse(submission.payload_json);}catch{throw new RepositoryError('TITLE_REPAIR_SUBMISSION_CHANGED');}
 if(!record.client_iin||payload.values?.iin!==record.client_iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(payload.values.procedure!=='199')throw new RepositoryError('TITLE_REPAIR_POLICY_UNSUPPORTED');
 if(typeof payload.values.fio!=='string'||!payload.values.fio.trim())throw new RepositoryError('TITLE_REPAIR_FIO_CHANGED');return {submission,fio:payload.values.fio};
}
async function verifiedDelivery(deps:Dependencies,submission:SubmissionRow){
 const proof=await deps.verifyDelivery();if(proof.requestId!==submission.request_id||proof.payloadHash!==submission.payload_hash)throw new RepositoryError('TITLE_REPAIR_SUBMISSION_CHANGED');
}
function savedIntent(row:TitleRepairRow,record:CaseRow){
 let intent:TitleRepairIntent;try{intent=JSON.parse(row.title_repair_json||'null');}catch{throw new RepositoryError('TITLE_REPAIR_INTENT_INVALID');}
 if(!intent||intent.version!==1||intent.policy!=='VP_FIO_1'||intent.caseId!==record.id||intent.identityRevision!==record.identity_revision||intent.submissionId!==row.id||intent.submissionRequestId!==row.request_id||intent.submissionHash!==row.payload_hash||intent.before?.dealId!==record.external_id||intent.before.iin!==record.client_iin)throw new RepositoryError('TITLE_REPAIR_INTENT_INVALID');return intent;
}
function receipt(row:TitleRepairRow|null,record:CaseRow){
 if(!row||!row.title_repair_state)throw new RepositoryError('TITLE_REPAIR_NOT_FOUND');const intent=savedIntent(row,record);
 return {status:row.title_repair_state.toUpperCase(),proposalHash:intent.proposalHash,beforeTitle:intent.before.title,desiredTitle:intent.desiredTitle,requestId:intent.requestId};
}
export async function inspectTitleRepair(deps:Dependencies,record:CaseRow,submission:SubmissionRow|null){
 const saved=requireSubmission(record,submission),row=await deps.repository.eligible(record,saved.submission);await verifiedDelivery(deps,saved.submission);
 if(row.title_repair_json)return receipt(row,record);
 const proposal=await deps.crm.inspect(record.external_id,record.client_iin!,saved.fio);
 const proposalHash=await sha256(JSON.stringify({version:1,caseId:record.id,identityRevision:record.identity_revision,submissionId:row.id,submissionHash:row.payload_hash,policy:proposal.policy,before:proposal.before,desiredTitle:proposal.desiredTitle}));
 return {status:proposal.noop?'NOOP':'PROPOSED',proposalHash,beforeTitle:proposal.before.title,desiredTitle:proposal.desiredTitle,requestId:null};
}
export async function runTitleRepair(deps:Dependencies,record:CaseRow,submission:SubmissionRow|null,actor:Actor,input:{action:'repair'|'reconcile';requestId:string;expectedProposalHash:string}){
 if(actor.worker!=='ali'||actor.id!=='worker:ali')throw new RepositoryError('OWNER_REQUIRED',403);
 if(!['repair','reconcile'].includes(input.action)||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.requestId)||!/^[a-f0-9]{64}$/.test(input.expectedProposalHash))throw new RepositoryError('INVALID_TITLE_REPAIR',400);
 let row=submission?.case_id===record.id?await deps.repository.get(record.id,submission.id):null;if(!row)throw new RepositoryError('TITLE_REPAIR_SUBMISSION_CHANGED');
 let saved;
 try{saved=requireSubmission(record,submission);}catch(error){
  // An exact owner retry may retire a never-claimed intent whose case identity
  // or submission has since changed. Original intent and assessment stay intact.
  let intent:TitleRepairIntent|null=null;try{intent=JSON.parse(row.title_repair_json||'null');}catch{/* Invalid intent cannot be cancelled by this request. */}
  if(terminalPreflight(error)&&row.title_repair_state==='prepared'&&intent?.requestId===input.requestId&&intent.proposalHash===input.expectedProposalHash&&intent.actorId===actor.id&&intent.authentication===actor.authentication)await deps.repository.cancelUnsent(record,row);
  throw error;
 }
 if(!row.title_repair_json){
  if(input.action!=='repair')throw new RepositoryError('TITLE_REPAIR_NOT_FOUND');
  const inspection=await inspectTitleRepair(deps,record,saved.submission);if(inspection.proposalHash!==input.expectedProposalHash)throw new RepositoryError('TITLE_REPAIR_PROPOSAL_CHANGED');if(inspection.status==='NOOP')return inspection;
  // Re-read before persisting the exact immutable destination. A changed title,
  // identity, pipeline, FIO or procedure invalidates the earlier owner preview.
  const target=await deps.crm.inspect(record.external_id,record.client_iin!,saved.fio);
  if(target.before.title!==inspection.beforeTitle||target.desiredTitle!==inspection.desiredTitle)throw new RepositoryError('TITLE_REPAIR_PROPOSAL_CHANGED');
  const currentHash=await sha256(JSON.stringify({version:1,caseId:record.id,identityRevision:record.identity_revision,submissionId:row.id,submissionHash:row.payload_hash,policy:target.policy,before:target.before,desiredTitle:target.desiredTitle}));
  if(currentHash!==input.expectedProposalHash)throw new RepositoryError('TITLE_REPAIR_PROPOSAL_CHANGED');
  row=await deps.repository.prepare(record,saved.submission,{policy:target.policy,before:target.before,desiredTitle:target.desiredTitle,version:1,requestId:input.requestId,actorId:actor.id,authentication:actor.authentication,caseId:record.id,identityRevision:record.identity_revision,submissionId:row.id,submissionRequestId:row.request_id,submissionHash:row.payload_hash,proposalHash:currentHash,createdAt:new Date().toISOString()});
 }
 const intent=savedIntent(row,record);
 if(intent.requestId!==input.requestId||intent.proposalHash!==input.expectedProposalHash||intent.actorId!==actor.id||intent.authentication!==actor.authentication)throw new RepositoryError('TITLE_REPAIR_PROPOSAL_CHANGED');
 if(row.title_repair_state==='verified')return receipt(row,record);
 if(row.title_repair_state==='cancelled')throw new RepositoryError('TITLE_REPAIR_CANCELLED');
 const reconcile=async()=>{
  let verified=false;try{await deps.repository.eligible(record,saved.submission);verified=await deps.crm.reconcile(intent);if(verified)await verifiedDelivery(deps,saved.submission);}catch{verified=false;}
  return receipt(await deps.repository.finish(record,row!,verified),record);
 };
 if(row.title_repair_state==='writing'||row.title_repair_state==='uncertain')return reconcile();
 if(row.title_repair_state!=='prepared')throw new RepositoryError('TITLE_REPAIR_INTENT_INVALID');
 if(input.action==='reconcile')return receipt(row,record);
 try{await deps.repository.eligible(record,saved.submission);await verifiedDelivery(deps,saved.submission);}catch(error){if(terminalPreflight(error))await deps.repository.cancelUnsent(record,row);throw error;}
 if(!await deps.repository.claim(record,row))return receipt(await deps.repository.get(record.id,row.id),record);
 let verified=false;
 try{verified=await deps.crm.repair(intent);if(verified)await verifiedDelivery(deps,saved.submission);}
 catch(error){if(error instanceof TitleRepairError&&error.notStarted){if(terminalPreflight(error))await deps.repository.cancelUnsent(record,row,true);else await deps.repository.releaseUnsent(record,row);throw error;}verified=false;}
 return receipt(await deps.repository.finish(record,row,verified),record);
}
