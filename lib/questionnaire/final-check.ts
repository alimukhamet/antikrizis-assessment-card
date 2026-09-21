import type {EvidenceRepository,CaseRow} from '../documents/repository';
import {validateDraft} from './draft';
import {checkAnswers} from './check-answers';
import {compileAssessment} from './compile-assessment';
import {parseReviewBindings,checkReviewBindings} from './review-bindings';
import {checkDocumentPackage} from '../documents/package-check';
import {contractData} from './contract-data';
export const FINAL_VALIDATION_VERSION='assessment-final-10';
/** Shared by preview, preparation and commit; none trusts a client readiness flag. */
export async function finalCheck(repository:EvidenceRepository,record:CaseRow,raw:unknown,rawBindings:unknown,day:string){
 const payload=validateDraft(raw),bindings=parseReviewBindings(rawBindings);
 const checked=checkAnswers(payload,record.client_iin,day);
 const [documents,evidence]=await Promise.all([checkDocumentPackage(repository,record,payload,day),checkReviewBindings(repository,record,payload,checked.displayAnswers,bindings,day)]);
 evidence.approved.push(...documents.gkbEvidence||[]);
 for(const loan of documents.loanCoverage?.rows||[])if(loan.status!=='present')checked.issues.push({key:'loanContractId',group:'creditors',row:loan.rows[0]??0,code:loan.status==='missing'?'ACTIVE_LOAN_MISSING':'ACTIVE_LOAN_DUPLICATE',label:`${loan.creditor} · № ${loan.contractNumber}: ${loan.status==='missing'?'добавьте активный кредит из полного ГКБ, стр. '+loan.page:'в анкете несколько записей; оставьте одну после сверки'}`});
 checked.answersComplete=checked.issues.length===0;
 const compiled=checked.answersComplete?compileAssessment(payload,record.client_iin,evidence.approved,day):null;
 const contract=compiled?contractData(payload,record.client_iin,evidence.approved,day):null;
 const remainingGates=[...(!checked.answersComplete?['answers']:[]),...(!documents.packageReady?['document-validation']:[]),...(evidence.issues.length?['fact-review']:[])];
 return {payload,compiled,reviewIds:[...new Set([...evidence.approved.map(e=>e.reviewId),...documents.manuallyReviewed.map(r=>r.reviewId)])],publicResult:{...checked,evidence,documents,preview:compiled?{lawyerCard:compiled.lawyerCard,fullCard:compiled.fullCard,contractData:contract}:null,identityRevision:record.identity_revision,readyToSubmit:remainingGates.length===0,remainingGates}};
}
