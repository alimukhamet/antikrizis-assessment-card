import {RepositoryError,type EvidenceRepository,type CaseRow} from './repository';
import {reviewFact,compatibleReviewExtraction,type StoredResult} from './review-service';
import type {Actor} from '../worker-session';

/** One deliberate employee confirmation, with the same per-fact checks and audit trail. */
export async function reviewBatch(repository:EvidenceRepository,record:CaseRow,raw:unknown,actor:Actor,day:string){
 if(!Array.isArray(raw)||!raw.length||raw.length>100)throw new RepositoryError('INVALID_REVIEW_BODY',400);
 const inputs=raw.map(body=>{
  if(!body||typeof body!=='object')throw new RepositoryError('INVALID_REVIEW_BODY',400);
  for(const key of ['documentId','extractionId','requestId','factKey','disposition','reason'])if(typeof body[key]!=='string')throw new RepositoryError('INVALID_REVIEW_BODY',400);
  if(!Number.isInteger(body.identityRevision)||!['confirmed','corrected'].includes(body.disposition))throw new RepositoryError('INVALID_REVIEW_BODY',400);
  return body as {documentId:string;extractionId:string;requestId:string;factKey:string;value:unknown;disposition:'confirmed'|'corrected';reason:string;identityRevision:number};
 });
 const targets=new Set<string>();
 for(const input of inputs){const key=JSON.stringify([input.documentId,input.extractionId,input.factKey]);if(targets.has(key))throw new RepositoryError('DUPLICATE_REVIEW_TARGET',400);targets.add(key);}
 async function load(input:typeof inputs[number]){
  const doc=await repository.document(record.id,input.documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE',404);
  const extraction=await repository.extraction(record.id,doc.id,input.extractionId);if(!extraction)throw new RepositoryError('EXTRACTION_NOT_IN_DOCUMENT',404);
  return {doc,extraction,compatibleExtractionId:await compatibleReviewExtraction(repository,record,doc,extraction),result:await repository.readResult(extraction) as StoredResult};
 }
 const loaded=new Map<string,ReturnType<typeof load>>();
 const outcomes:Array<{requestId:string;review?:{id:string};error?:string}>=new Array(inputs.length);let next=0;
 await Promise.all(Array.from({length:Math.min(4,inputs.length)},async()=>{
  while(next<inputs.length){const index=next++,input=inputs[index];
   try{
    const key=JSON.stringify([input.documentId,input.extractionId]);if(!loaded.has(key))loaded.set(key,load(input));
    const {doc,extraction,result,compatibleExtractionId}=await loaded.get(key)!;
    outcomes[index]={requestId:input.requestId,review:await reviewFact(repository,record,doc,extraction,result,input,actor,day,compatibleExtractionId)};
   }catch(error){if(!(error instanceof RepositoryError))throw error;outcomes[index]={requestId:input.requestId,error:error.code};}
  }
 }));
 return {ok:outcomes.every(row=>!row.error),outcomes};
}
