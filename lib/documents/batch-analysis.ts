import {storedAnalysis} from './analysis-service';
import {RepositoryError,type EvidenceRepository,type CaseRow} from './repository';
import type {ClientContext} from '../crm/bitrix';
import type {Actor} from '../worker-session';

/** A bounded cache read shares one freshly authenticated CRM identity. */
export async function cachedAnalyses(body:Record<string,unknown>,context:{record:CaseRow;client:ClientContext;repository:EvidenceRepository;actor:Actor}){
 const {record,client,repository,actor}=context,ids=body.documentIds;
 if(body.identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 if(!Array.isArray(ids)||!ids.length||ids.length>8||ids.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(ids).size!==ids.length)throw new RepositoryError('INVALID_DOCUMENT_IDS',400);
 const results=Array<{documentId:string;analysis?:unknown;error?:string}>(ids.length);let next=0;
 await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{while(next<ids.length){const index=next++,documentId=ids[index];
  try{
   const document=await repository.document(record.id,documentId);if(!document)throw new RepositoryError('DOCUMENT_NOT_IN_CASE',404);
   results[index]={documentId,analysis:await storedAnalysis(client,record,repository,document,actor,true)};
  }catch(error){results[index]={documentId,error:error instanceof RepositoryError?error.code:'EVIDENCE_REQUEST_FAILED'};}
 }}));
 const current=await repository.findCaseByExternal(client.external.system,client.external.dealId);
 if(!current||current.identity_revision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 return {results};
}
