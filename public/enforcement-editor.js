(function(){
 const status=document.getElementById('enforcementStatus');
 if(!status)return;
 function sync(){
  const notes=document.getElementById('enforcementDetails'),legacy=status.querySelector('option[value="legacy"]');
  legacy.hidden=!notes.value.trim()||/^нет[.!]?$/iu.test(notes.value.trim());
  document.getElementById('enforcementRecords').classList.toggle('hidden',status.value!=='yes');
  document.getElementById('enforcementLegacy').hidden=legacy.hidden&&status.value!=='legacy';
  if(status.value==='yes'){
   const group=document.getElementById('enforcements');
   if(!group.querySelector('.repeat-rows').children.length)add(group);
  }
 }
 status.addEventListener('change',sync);
 document.addEventListener('assessment-draft-restored',sync);
 sync();
})();
