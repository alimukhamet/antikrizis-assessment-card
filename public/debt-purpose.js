/* One purpose question for all debts. Keep prior per-loan answers in the draft. */
(()=>{
 const group=document.getElementById('debtPurposes'),other=document.getElementById('debtPurposeOther'),panel=document.getElementById('debtPurposeOtherField'),version=document.getElementById('debtPurposeVersion');
 const choices=[...group.querySelectorAll('input')];
 function refresh(){choices.forEach(c=>c.parentElement.classList.toggle('on',c.checked));panel.classList.toggle('hidden',!choices.some(c=>c.value==='Другое'&&c.checked));visibilityRules();window.AssessmentWorkflow?.refresh();}
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
