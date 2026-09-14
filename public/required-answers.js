/* Old draft versions retain the original unknown answer; the current form needs an answer. */
window.RequiredAnswers={restore(){
 const root=document.getElementById('questionnaireStep');
 for(const flag of root.querySelectorAll('[data-legacy-unknown]')){
  if(!flag.checked||flag.dataset.legacyUnknown==='guarantors')continue;
  const scope=flag.closest('.repeat-item')||root;
  const target=[...scope.querySelectorAll('input[id],select[id],textarea[id]')].find(e=>e.id.replace(/_r\d+$/,'')===flag.dataset.legacyUnknown);
  if(target&&flag.dataset.legacyUnknown!=='loanParticipants'){target.value='';target.disabled=false;}
  flag.checked=false;
 }
 for(const flag of root.querySelectorAll('[data-holding="unknown"]'))flag.checked=false;
 for(const control of root.querySelectorAll('select'))if(['unknown','Не знаю'].includes(control.value))control.value='';
}};
