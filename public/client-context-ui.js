window.ClientContextUI=(()=>{
 const $=id=>document.getElementById(id),make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const mode=new URLSearchParams(location.search).get('mode')==='handoff'?'handoff':'contract';document.body.dataset.uxMode=mode;
 const context=()=>HostedAssessment.getContext(),ready=()=>Boolean(context()&&ServerDrafts.canSwitch());
 const label=()=>{const c=context()?.client;return c?c.title+' · Сделка № '+c.external.dealId+(c.iin?' · ИИН '+c.iin:' · ИИН не указан'):'Клиент не выбран';};
 async function confirm(action,note){
  if(!ready()){afStatus('Сначала выберите клиента и дождитесь загрузки карточки.',true);return null;}
  return SubmissionDestination.confirm({title:'Проверьте клиента',action,note:note||'Продолжайте, только если это клиент, с которым вы сейчас работаете.'});
 }
 const wrap=document.querySelector('main.wrap'),bar=make('div',null,'ux-context'),home=make('a','← Инструменты');home.href='/';home.target='_top';
 const nav=make('nav',null,'ux-mode-nav');nav.setAttribute('aria-label','Работа со сделкой');
 for(const [key,text,path]of [['contract','Сформировать договор','/assessment-review'],['handoff','Передать юристам','/lawyer-handoff']]){const a=make('a',text);a.dataset.clientPath=path;a.href=path;a.target='_top';if(key===mode)a.setAttribute('aria-current','page');nav.append(a);}
 bar.append(home,nav);wrap.prepend(bar);bar.after(make('h1',mode==='handoff'?'Передать юристам':'Сформировать договор','ux-page-title'));
 const entry=make('section',null,'ux-client-entry');entry.id='uxClientEntry';const note=make('p','Найдите клиента по имени или номеру сделки. Документы и договор откроются только после выбора.');
 const choose=make('button','Выбрать клиента','btn btn-main');choose.type='button';choose.onclick=()=>ClientWorkspace.open();entry.append(make('h2','С кем работаем?'),note,choose);document.querySelector('.wf-header').before(entry);
 document.querySelector('.wf-client-copy').prepend(make('small','Сейчас работаем с','ux-client-label'));
 let lastState=null;
 function sync(){
  const c=context(),loaded=ready(),state=loaded?'ready':c?'loading':'empty';document.body.dataset.uxClientState=state;entry.hidden=Boolean(c);
  if(!c&&new URLSearchParams(location.search).has('dealId'))note.textContent=$('afStatus').textContent+' Выберите клиента, чтобы продолжить.';
  document.title=(c?c.client.title+' · № '+c.client.external.dealId+' — ':'')+(mode==='handoff'?'Передать юристам':'Сформировать договор');
  document.querySelectorAll('[data-client-path]').forEach(a=>{a.href=a.dataset.clientPath+(c?'?dealId='+encodeURIComponent(c.client.external.dealId):'');});
  document.querySelectorAll('[data-ux-client-content]').forEach(n=>{n.inert=!loaded;});document.querySelector('.draft-toolbar').inert=!c;
  $('openClients').textContent=c?'Сменить клиента':'Выбрать клиента';
  if(lastState!==state){lastState=state;document.dispatchEvent(new Event('assessment-client-readiness-changed'));}
 }
 document.querySelectorAll('.wf-steps,#documentStep,#documentReviewStep,#questionnaireStep,.wf-bottom-nav').forEach(n=>{n.dataset.uxClientContent='';});
 const previousSource=afSource;afSource=async source=>{
  if(!ready())return;const result=af.results.get(source.fileId);
  if(result?.server?.dealId&&result.server.dealId!==context().client.external.dealId){afStatus('Документ относится к другой сделке.',true);return;}
  const pending=previousSource(source);$('afSourceTitle').textContent=label()+' — '+$('afSourceTitle').textContent;return pending;
 };
 let downloading=false;
 document.addEventListener('click',async event=>{
  const link=event.target.closest?.('#afPreview a[download]');if(!link)return;event.preventDefault();if(downloading||!ready())return;
  downloading=true;const current=context(),url=new URL(link.href);
  try{
   if(url.origin!==location.origin||url.pathname.split('/')[3]!==current.client.external.dealId)throw Error('PDF относится к другой сделке. Скачивание остановлено.');
   if(!await confirm('Скачать PDF этого клиента'))return;
   if(context()!==current||link.href!==url.href)throw Error('Клиент или документ изменился. Скачивание остановлено.');
   const download=make('a');download.href=url.href;download.download=(current.client.title+' — сделка '+current.client.external.dealId+'.pdf').replace(/[\\/:*?"<>|]/g,'_');download.click();
  }catch(error){$('afQuote').textContent=error.message;}finally{downloading=false;}
 },true);
 for(const event of ['assessment-case-opened','assessment-draft-restored','assessment-analysis-complete','assessment-draft-saved'])document.addEventListener(event,()=>queueMicrotask(sync));
 new MutationObserver(sync).observe($('draftStatus'),{childList:true,subtree:true,characterData:true});new MutationObserver(sync).observe($('afStatus'),{childList:true,subtree:true,characterData:true});sync();
 return{mode,context,ready,label,confirm,sync,make};
})();
