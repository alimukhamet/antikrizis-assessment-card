import type {EvidenceRepository,CaseRow} from '../documents/repository';
import {validateDraft} from './draft';
import {checkAnswers} from './check-answers';
import {compileAssessment} from './compile-assessment';
import {parseReviewBindings,checkReviewBindings} from './review-bindings';
import {checkDocumentPackage} from '../documents/package-check';
import {contractData} from './contract-data';
export const FINAL_VALIDATION_VERSION='assessment-final-5';
/** Shared by preview, preparation and commit; none trusts a client readiness flag. */
export async function finalCheck(repository:EvidenceRepository,record:CaseRow,raw:unknown,rawBindings:unknown,day:string){
 const payload=validateDraft(raw),bindings=parseReviewBindings(rawBindings);
 const checked=checkAnswers(payload,record.client_iin,day);
 const documents=await checkDocumentPackage(repository,record,payload,day);
 const evidence=await checkReviewBindings(repository,record,payload,checked.displayAnswers,bindings,day);
 const compiled=checked.answersComplete?compileAssessment(payload,record.client_iin,evidence.approved,day):null;
 const contract=compiled?contractData(payload,record.client_iin,evidence.approved,day):null;
 const remainingGates=[...(!checked.answersComplete?['answers']:[]),...(!documents.packageReady?['document-validation']:[]),...(evidence.issues.length?['fact-review']:[])];
 return {payload,compiled,reviewIds:[...evidence.approved.map(e=>e.reviewId),...documents.manuallyReviewed.map(r=>r.reviewId)],publicResult:{...checked,evidence,documents,preview:compiled?{lawyerCard:compiled.lawyerCard,fullCard:compiled.fullCard,contractData:contract}:null,identityRevision:record.identity_revision,readyToSubmit:remainingGates.length===0,remainingGates}};
}
