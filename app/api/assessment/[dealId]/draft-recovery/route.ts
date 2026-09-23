import {requireStaffRequest} from '../../../staff-access';
import {boundedJson,evidenceContext,evidenceError,operatingDay} from '../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../lib/documents/repository';
import {probeRecoveryTransport,DraftRecoveryRepository,createRecoveryCrm,inspectDraftRecovery,runDraftRecovery} from '../../../../../lib/questionnaire/draft-delivery-recovery';
export async function POST(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{
  const body=await boundedJson(request,4000);
  if(!['inspect','recover','reconcile','cancel','probe-transport'].includes(String(body.action)))throw new RepositoryError('INVALID_RECOVERY_ACTION',400);
  const {dealId}=await context.params,{record,repository,actor}=await evidenceContext(request,dealId);
  if(actor.worker!=='ali')throw new RepositoryError('OWNER_REQUIRED',403);
  const {env}=await import('cloudflare:workers');const db=(env as typeof env&{DB?:D1Database}).DB;if(!db)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
  const store=new DraftRecoveryRepository(db),webhook=process.env.BITRIX_WEBHOOK??'',crm=createRecoveryCrm(webhook);
  if(body.action==='probe-transport')return Response.json(await probeRecoveryTransport(webhook,dealId),{headers:{'cache-control':'private, no-store'}});
  if(body.action==='inspect'){
   const prior=await store.get(record.id);if(prior)return Response.json({state:prior.state,planHash:prior.plan_hash,finalAssessment:false},{headers:{'cache-control':'private, no-store'}});
   const {plan,planHash}=await inspectDraftRecovery(store,repository,record,crm,operatingDay());
   return Response.json({state:'proposed',planHash,sourceRevision:plan.sourceRevision,sourceActor:plan.sourceActor,originals:plan.files.batches.flat().length,fieldNames:Object.keys(plan.fields),remainingGates:plan.remainingGates,finalAssessment:false},{headers:{'cache-control':'private, no-store'}});
  }
  if(typeof body.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedHash))throw new RepositoryError('RECOVERY_HASH_REQUIRED',400);
  if(body.action==='cancel')return Response.json(await store.cancel(record.id,body.expectedHash),{headers:{'cache-control':'private, no-store'}});
  return Response.json(await runDraftRecovery(store,repository,record,actor,crm,webhook,String(body.action),body.expectedHash,operatingDay()),{headers:{'cache-control':'private, no-store'}});
 }catch(error){return evidenceError(error);}
}
