/* Require an explicit handoff choice; preserve an existing note when switching it off. */
(()=>{
 const choice=document.getElementById('lawyerNotesStatus'),note=document.getElementById('comment'),details=document.getElementById('lawyerNotesDetails');
 function refresh(){details.classList.toggle('hidden',choice.value!=='yes');visibilityRules();window.AssessmentWorkflow?.refresh();}
 function restore(){if(!choice.value&&note.value.trim())choice.value='yes';refresh();}
 choice.addEventListener('change',refresh);
 document.addEventListener('assessment-draft-restored',restore);
 restore();
})();
