import {analysisResponse,analysisVersion,type Analysis} from './analysis-service';
import {RepositoryError,type EvidenceRepository,type CaseRow} from './repository';
import {validIin} from './extract-native';
import type {ClientContext} from '../crm/bitrix';
import type {Actor} from '../worker-session';
import type {createDocumentIdentityAdapter} from '../crm/document-identity';

export async function confirmDocumentIdentity(repository:EvidenceRepository,record:CaseRow,client:ClientContext,actor:Actor,input:{documentId:string;extractionId:string;identityRevision:number;confirmed:boolean},adapter:ReturnType<typeof createDocumentIdentityAdapter>){
 if(!input.confirmed)throw new RepositoryError('IDENTITY_CONFIRMATION_REQUIRED',400);
 if(input.identityRevision!==record.identity_revision)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 const document=await repository.document(record.id,input.documentId);
 if(!document)throw new RepositoryError('DOCUMENT_NOT_IN_CASE',404);
 const extraction=await repository.extraction(record.id,document.id,input.extractionId);
 if(!extraction)throw new RepositoryError('EXTRACTION_NOT_IN_DOCUMENT',404);
 if(extraction.version!==analysisVersion)throw new RepositoryError('EXTRACTION_VERSION_CHANGED');
 const result=await repository.readResult(extraction) as Analysis,parsed=result.extraction;
 const iin=parsed.identity.iin;
 if(!validIin(iin)||!iin||!parsed.identity.name||!['gkb_full','gkb_short'].includes(parsed.kind))throw new RepositoryError('DOCUMENT_IDENTITY_UNVERIFIED');
 if(client.iin&&client.iin!==iin)throw new RepositoryError('IDENTITY_CONFLICT');
 const response=await analysisResponse(client,record,repository,{document,extraction,result},true);
 if(!response.eligibleForAutofill&&!response.eligibleForDraftAutofill)throw new RepositoryError('DOCUMENT_REQUIRES_VALIDATION');
 // Source bytes/result and the selected deal are server-owned; no caller-supplied IIN.
 await repository.claimDocumentIdentity(record,document,extraction,iin,actor);
 const fresh=await adapter.save(record.external_id,iin),current=await repository.syncCase(fresh);
 if(current.identity_revision!==record.identity_revision||current.client_iin!==iin)throw new RepositoryError('CASE_IDENTITY_CHANGED');
 return{client:fresh,caseId:current.id,identityRevision:current.identity_revision,actor,identitySource:{type:'document',documentId:document.id,extractionId:extraction.id},analysis:await analysisResponse(fresh,current,repository,{document,extraction,result},true)};
}
