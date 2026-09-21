/** Add the split answers only to older payloads. Never infer an unanswered new field. */
export function normalizeIntake(payload) {
 const answers=payload.answers.map(answer=>({...answer}));
 const get=key=>answers.find(answer=>answer.key===key);
 const put=(key,value,checked=false)=>{const old=get(key);if(old)Object.assign(old,{value,checked});else answers.push({key,value,checked});};
 for(const owner of ['client','partner']){
  const prefix=`holding:${owner}:`;
  if(get(prefix+'businessNone'))continue;
  const selected=answers.filter(a=>a.key.startsWith(prefix)&&a.checked).map(a=>a.key.slice(prefix.length));
  const answered=selected.length>0&&!selected.includes('unknown');
  const property=selected.some(k=>['real','car','other'].includes(k));
  const business=selected.some(k=>['ip','too','kh'].includes(k));
  // A contradictory legacy "none" is left contradictory for the validator.
  if(answered&&!property&&!selected.includes('none'))put(prefix+'none','none',true);
  put(prefix+'businessNone','businessNone',answered&&!business);
 }
 if(!get('enforcementStatus')){
  const old=get('enforcementDetails')?.value.trim()||'';
  const unknown=get('unknown:enforcementDetails')?.checked;
  put('enforcementStatus',unknown?'':/^нет[.!]?$/iu.test(old)?'no':old?'legacy':'');
 }
 return {...payload,answers};
}

/** Enforcement describes collection on an obligation; it never adds to the loan total. */
export function enforcementSummary(payload){
 const p=normalizeIntake(payload),value=key=>p.answers.find(a=>a.key===key)?.value.trim()||'';
 const status=value('enforcementStatus'),notes=value('enforcementDetails');
 if(status==='no')return 'Нет';
 if(status==='legacy')return notes;
 const rows=p.groups.find(g=>g.id==='enforcements')?.rows||[];
 const records=rows.map((row,index)=>{
  const v=key=>row.find(a=>a.key===key)?.value.trim()||'';
  return `${index+1}. ${v('enforcementCreditor')} — ${v('enforcementAmount')} ₸${v('enforcementNote')?'; '+v('enforcementNote'):''}`;
 });
 if(notes&&!/^нет[.!]?$/iu.test(notes))records.push('Прежние сведения: '+notes);
 return records.join('; ');
}
