/* Keep the original questionnaire out of view until the complete working UI is ready. */
(()=>{
 let failed=false,finished=false;
 const fail=()=>{if(finished)return;failed=true;const text=document.getElementById('appBootMessage');if(text)text.textContent='Не удалось открыть карточку. Обновите страницу; сохранённые данные останутся на месте.';const retry=document.getElementById('appBootRetry');if(retry)retry.hidden=false;};
 window.addEventListener('error',event=>{if(event.target?.tagName==='SCRIPT'||event instanceof ErrorEvent)fail();},true);
 const timer=setTimeout(fail,20000);
 document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('appBootRetry').onclick=()=>location.reload();
  if(failed||!window.AssessmentWorkflow||!window.AssessmentCheck||!window.ClientContextUI||!window.FileSelectionControls||!window.GkbComparison||(new URLSearchParams(location.search).get('mode')==='handoff'&&!window.HandoffFiles)){fail();return;}
  finished=true;clearTimeout(timer);document.documentElement.removeAttribute('data-app-boot');document.getElementById('appBoot').remove();
 },{once:true});
})();
