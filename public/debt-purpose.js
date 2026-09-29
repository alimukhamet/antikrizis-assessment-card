/* One purpose question for all debts. Keep prior per-loan answers in the draft. */
(()=>{
 const group=document.getElementById('debtPurposes'),other=document.getElementById('debtPurposeOther'),panel=document.getElementById('debtPurposeOtherField'),version=document.getElementById('debtPurposeVersion');
 const choices=[...group.querySelectorAll('input')];
 const profile=new URLSearchParams(location.search).get('mode')==='profile';
 const explanationFields=[];
 if(profile){
  const rules=window.ProfileExplanationRules;
  for(const [key,question] of Object.entries(rules.PROFILE_EXPLANATIONS)){
   const input=document.getElementById(key),field=input.closest('.field'),label=field.querySelector('label.lbl');
   label.textContent=question.label;const required=document.createElement('span');required.className='req';required.textContent='*';label.append(required);
   input.rows=4;input.minLength=rules.PROFILE_EXPLANATION_MIN;
   const hint=document.createElement('div');hint.className='hint';hint.id=key+'Prompt';hint.textContent=question.prompt+' Минимум '+rules.PROFILE_EXPLANATION_MIN+' символов.';
   const counter=document.createElement('div');counter.className='hint';counter.id=key+'Count';counter.setAttribute('role','status');counter.setAttribute('aria-live','polite');
   input.before(hint);input.after(counter);input.setAttribute('aria-describedby',hint.id+' '+counter.id);
   const update=()=>{
    const active=key!=='n12008'||!!document.getElementById('hardshipReason').value&&document.getElementById('hardshipReason').value!=='Платежи вношу, трудностей нет';
    const count=rules.explanationLength(input.value),error=active?rules.explanationError(input.value):null;
    counter.textContent=count+' / '+rules.PROFILE_EXPLANATION_MIN+' символов минимум'+(count<rules.PROFILE_EXPLANATION_MIN?' · ещё '+(rules.PROFILE_EXPLANATION_MIN-count):error?' · уточните факты у клиента':'');
    counter.style.color=error?'#7a5a17':'#286448';
    input.setCustomValidity(error||'');input.setAttribute('aria-invalid',String(!!error&&!!input.value));
   };
   input.addEventListener('input',update);explanationFields.push(update);
  }
  document.getElementById('hardshipReason').addEventListener('change',()=>explanationFields.forEach(update=>update()));
 }
 function refresh(){choices.forEach(c=>c.parentElement.classList.toggle('on',c.checked));panel.classList.toggle('hidden',!profile&&!choices.some(c=>c.value==='Другое'&&c.checked));visibilityRules();explanationFields.forEach(update=>update());window.AssessmentWorkflow?.refresh();}
 function restore(){
  if(version.value!=='1'){
   if(!choices.some(c=>c.checked)){
    const notes=[];
    for(const row of document.querySelectorAll('#creditors > .repeat-rows > .repeat-item')){
     const purpose=row.querySelector('[data-purpose]')?.value,choice=choices.find(c=>c.value===purpose);if(choice)choice.checked=true;
     const note=row.querySelector('[data-purpose-explanation]')?.value.trim();if(purpose==='Другое'&&note)notes.push(note);
    }
    if(!other.value.trim())other.value=[...new Set(notes)].join('\n');
   }
   version.value='1';
  }
  refresh();
 }
 group.addEventListener('change',refresh);
 document.addEventListener('assessment-draft-restored',restore);
 restore();
})();
