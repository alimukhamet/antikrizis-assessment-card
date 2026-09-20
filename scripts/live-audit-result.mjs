// Business validation gates are expected; transport, authentication and storage
// failures must make the audit fail even when other routes remain available.
export function auditFailures(report, expectedCaseIds) {
 const failures=[];
 if(report.error)failures.push('audit: '+report.error);
 if(report.authenticated!==true)failures.push('authentication not verified');
 if(report.status?.ok!==true)failures.push('service status not healthy');
 for(const id of expectedCaseIds){
  const item=report.cases.find(item=>item.dealId===id);
  if(!item){failures.push('case '+id+': not inspected');continue;}
  if(!Number.isInteger(item.identityRevision))failures.push('case '+id+': context unavailable');
  for(const [key,value] of Object.entries(item))if(key.endsWith('Error')&&value)failures.push('case '+id+' '+key+': '+value);
  const stageError=item.handoff?.stageError;
  if(stageError&&!['HANDOFF_NOT_IN_SALES','HANDOFF_ALREADY_COMPLETED','CASE_IDENTITY_CHANGED'].includes(stageError))failures.push('case '+id+' handoff stage unavailable: '+stageError);
  if(item.draft?.present&&!item.check)failures.push('case '+id+': saved draft not checked');
  if(item.savedContract&&item.savedContract.available!==true)failures.push('case '+id+': saved contract unavailable');
  if(item.analysisRefresh){
   if(item.draftUnchanged!==true)failures.push('case '+id+': draft preservation not verified');
   for(const result of item.analysisRefresh)if(result.error||result.sameDocument!==true||result.sameIdentity!==true||!(result.pages>0))failures.push('case '+id+': stored analysis recovery failed');
  }
 }
 return failures;
}
