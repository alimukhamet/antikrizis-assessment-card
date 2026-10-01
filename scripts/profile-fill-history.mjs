// Conservative deletion protection for an owner-triggered additive repair.
// Only source identifiers and field positions leave the private history read.
export function deriveProfileFillHistory(latest,previous){
 const protectedFields=new Map(),protect=p=>protectedFields.set(JSON.stringify(p),p);
 const used=a=>Boolean(a&&(a.sourceReplaced||(/^(?:unknown:|choice:|holding:)|^loanClaimIncluded$/.test(a.key)?a.checked:a.checked||String(a.value||'').trim())));
 const get=(row,key)=>row?.find(a=>a.key===key);
 const identity=row=>{const lender=get(row,'n8038')?.value?.trim(),number=get(row,'loanContractId')?.value?.trim();return lender&&number?JSON.stringify([lender,number]):null;};
 const loans=latest.groups.find(g=>g.id==='creditors'),rows=loans?.rows||[];let allowNewLoans=true;
 for(const old of previous){
  for(const answer of old.answers||[])if(used(answer)&&!used(get(latest.answers,answer.key)))protect({key:answer.key});
  const oldGroup=old.groups?.find(g=>g.id==='creditors');if(!oldGroup)continue;
  for(const [i,row]of oldGroup.rows.entries()){
   if(!row.some(a=>a.key!=='loanClaimIncluded'&&used(a)))continue;
   const key=oldGroup.rowKeys?.[i],id=identity(row);
   const matches=rows.map((r,j)=>(key&&key===loans.rowKeys?.[j]||id&&id===identity(r))?j:-1).filter(j=>j>=0);
   // Missing identifiers do not establish that an old row is a new obligation.
   // Keep new-row creation disabled if its continued identity cannot be proved.
   if(matches.length!==1){allowNewLoans=false;continue;}
   const j=matches[0];for(const answer of row)if(used(answer)&&!used(get(rows[j],answer.key)))protect({group:'creditors',row:j,key:answer.key});
  }
 }
 return {protectedFields:[...protectedFields.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),allowNewLoans};
}
