/* Collect documents first; every answer stays in the original draft/validation root. */
window.AssessmentWorkflow=(()=>{
 const $=id=>document.getElementById(id);
 const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
 const action=(text,fn,primary=false)=>{const node=make('button',text,'btn '+(primary?'btn-main':'btn-ghost'));node.type='button';node.onclick=fn;return node;};
 const details=(title,cls)=>{const node=make('details',null,cls);node.append(make('summary',title));return node;};
 const step=(node,name)=>{node.dataset.assessmentStep=name;return node;};
 const root=$('questionnaireStep'),documentStep=$('documentStep'),intro=document.querySelector('.workflow-intro');
 if(!root||!documentStep||!intro)return null;
 let active='documents',lastCheck=null;
 const socialLabel=$('socialStatusChips').closest('.field').querySelector('label.lbl');
 socialLabel.removeAttribute('for');socialLabel.id='workflowSocialStatusLabel';
 $('socialStatusChips').setAttribute('role','group');$('socialStatusChips').setAttribute('aria-labelledby',socialLabel.id);
 $('procedure').closest('.field').querySelector('label.lbl').htmlFor='procedure';

 // Keep saved drafts easy to reach; occasional exports and reset share one menu.
 intro.hidden=true;
 const top=make('header',null,'wf-header'),toolbar=document.querySelector('.draft-toolbar');
 intro.before(top);top.append(toolbar);
 const more=details('Действия','wf-more'),moreContent=make('div',null,'wf-more-content');more.append(moreContent);
 for(const button of [...toolbar.querySelectorAll('button')])if(button.id!=='loadDraft')moreContent.append(button);
 moreContent.append($('afExport'));toolbar.append(more);
 document.addEventListener('click',event=>{if(more.open&&!more.contains(event.target))more.open=false;});
 more.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();more.open=false;more.querySelector('summary').focus();}});
 const draftStatus=$('draftStatus');draftStatus.setAttribute('role','status');toolbar.prepend(draftStatus);
 const originalDraftStatus=showDraftStatus;
 showDraftStatus=function(text){
  const safeSaved=/^Черновик (сохранён|загружен)/.test(text)&&!/не (сохранены|загруженные)|не удалось/i.test(text);
  const compact=safeSaved?'Черновик сохранён':text==='Есть несохранённые изменения…'?'Сохраняем…':text==='Ответы будут сохраняться автоматически.'?'Сохраняется автоматически':text==='Сохраняем черновик…'?'Сохраняем…':text==='Открываем черновик клиента…'?'Загрузка…':text;
  originalDraftStatus(compact);draftStatus.title=text;draftStatus.classList.toggle('wf-status-detail',compact===text&&text.length>35);
 };
 draftStatus.textContent='Черновик';

 // Client identity is always visible. Changing deals is a separate, deliberate action.
 const workspace=$('afWorkspace'),caseControls=$('hostLoadDeal').closest('.af-actions');
 const picker=details('Выбрать сделку','wf-case-picker'),client=make('div',null,'wf-client-copy');
 const clientName=make('strong','Выберите клиента'),clientMeta=make('span');
 client.append(clientName,clientMeta);picker.append(caseControls,$('afDate').closest('label'));
 const identity=$('afIdentity'),status=$('afStatus'),progress=$('afProgress');
 const metrics=workspace.querySelector('.af-metrics'),answerActions=$('afNext').closest('.af-actions');
 const analysisActions=$('afAnalyze').closest('.af-actions');
 const fileResults=$('afFiles'),questions=$('afQuestions'),conflicts=$('afConflicts'),oldName=$('hostDealName');
 workspace.replaceChildren(client,status,identity,oldName);workspace.className='wf-client';oldName.hidden=true;top.prepend(workspace);moreContent.append(picker);
 picker.open=false;picker.hidden=true;
 const draftNote=make('p','Черновик в инструменте. В Bitrix — при скачивании договора.','wf-draft-note');top.append(draftNote);

 const nav=make('nav',null,'wf-steps');nav.setAttribute('aria-label','Этапы оценки');top.after(nav);
 const stages=[['documents','Документы','Добавьте файлы клиента'],['answers','Ответы','Проверьте и дополните'],['contract','Договор','Проверьте и сохраните']];
 const tabs=new Map();
 stages.forEach(([name,title,caption],index)=>{
  const button=action('',()=>show(name));button.className='wf-step';button.dataset.goStep=name;
  const copy=make('span',null,'wf-step-copy'),heading=make('strong',title),note=make('span',caption);
  copy.append(heading,note);button.append(make('span',String(index+1),'wf-step-number'),copy);nav.append(button);tabs.set(name,{button,note});
 });

 // One batch chooser, followed by the existing exact document list and inspection controls.
 step(documentStep,'documents');step($('documentReviewStep'),'documents');
 const headings=documentStep.querySelectorAll(':scope > .card-title');
 headings[0].textContent='Файлы';headings[1].remove();
 const packageList=details('Обязательный пакет документов','wf-package');
 packageList.id='workflowRequiredDocuments';
 packageList.append(documentStep.querySelector('.required-documents'),$('requiredDocumentsStatus'));
 const conditions=documentStep.querySelector(':scope > .fields');conditions.classList.add('wf-document-conditions');
 const credential=make('section',null,'wf-credential');credential.append(make('h3','ЭЦП'),$('previewEdsPassword').closest('.field'));const keyRow=packageList.querySelector('[data-required-document="ЭЦП файл"]');if(keyRow)credential.querySelector('h3').after(keyRow);
 for(const note of credential.querySelectorAll('.field > .hint:not([role])'))note.textContent='Пароль не сохраняется в черновике.';
 const oldBatch=documentStep.querySelector('.batch-upload');
 // Keep the actual file input and its handlers. No second visible batch picker.
 const fileInput=$('previewDocuments');fileInput.classList.add('wf-file-input');documentStep.append(fileInput);oldBatch.remove();
 documentStep.append(analysisActions);
 $('afChoose').textContent='Добавить файлы';$('afChoose').className='btn btn-main';$('afChoose').title='PDF до 35 МБ. Сохраняются в черновике.';
 $('afAnalyze').className='btn btn-ghost';
 analysisActions.classList.add('wf-upload-actions');
 const uploadBox=make('div',null,'wf-upload-box'),documentTools=details('Ещё','wf-document-tools'),toolsBody=make('div',null,'wf-tools-content');documentTools.id='workflowDocumentTools';
 $('afAnalyze').textContent='Распознать повторно';documentTools.append(toolsBody);toolsBody.append($('afAnalyze'));
 analysisActions.prepend(headings[0]);analysisActions.append(documentTools);uploadBox.append(analysisActions,progress);
 const fileAssignments=details('Тип и владелец','wf-file-assignments');fileAssignments.append(make('p','По умолчанию — документы клиента. Здесь можно выбрать другого владельца.','hint'),$('selectedDocuments'),$('documentsStatus'));toolsBody.append(fileAssignments,packageList);documentStep.prepend(uploadBox);uploadBox.after(fileResults,conditions,credential);
 const collectionNotice=make('div',null,'wf-collection-notice');collectionNotice.id='workflowCollection';collectionNotice.setAttribute('role','status');collectionNotice.tabIndex=-1;uploadBox.after(collectionNotice);
 $('needsSocialDoc').closest('.field').querySelector('label').firstChild.textContent='Пенсия или пособия? ';
 $('needsSalaryDoc').closest('.field').querySelector('label').firstChild.textContent='Зарплатный банк ';
 fileResults.open=true;
 // Replace the former implementation explanation with a short, accurate worker instruction.
 for(const note of [...documentStep.querySelectorAll(':scope > p.hint')])if(note.id!=='documentsStatus')note.remove();
 fileResults.querySelector('summary').textContent='Файлы';
 const docsCheck=$('documentReviewStep');docsCheck.classList.add('wf-document-check');
 docsCheck.querySelector('h2').remove();
 $('checkDocuments').className='btn btn-ghost';
 const next=$('continueToAnswers');next.textContent='Далее: ответы →';next.className='btn btn-main';
 const reviewDetails=details('Проверка документов','wf-review-details');for(const child of [...docsCheck.children])if(child!==next)reviewDetails.append(child);next.hidden=true;docsCheck.replaceChildren(reviewDetails,next);$('documentCheckStatus').textContent='';

 // Keep contract fields within #questionnaireStep so capture and restore are unchanged.
 const cards=[...root.querySelectorAll(':scope > section.card')],contractCard=$('summa').closest('section.card');
 const answerSections=[];
 cards.forEach(card=>{
  step(card,card===contractCard?'contract':'answers');if(card===contractCard)return;
  const heading=card.querySelector('.card-title'),originalTitle=heading?.textContent.trim()||'Ответы';
  const title=({'Доходы и занятость':'Доходы','Долги и кредитная история':'Долги','Риски и квалификация':'Риски','Комментарий для юристов / стратегия':'Комментарий юристу'})[originalTitle]||originalTitle,fold=details(title,'wf-answer-section');
  heading?.remove();for(const child of [...card.children])fold.append(child);card.append(fold);answerSections.push({card,fold,title});
 });
 const answerIntro=step(make('section',null,'wf-answer-intro'),'answers');
 answerIntro.id='workflowAnswers';
 const conflictDetails=details('Расхождения','wf-conflicts');conflictDetails.append(conflicts);
 answerIntro.append(answerActions,conflictDetails,metrics);moreContent.append(questions);questions.open=false;metrics.hidden=true;
 root.prepend(answerIntro);
 const answerNotice=make('p',null,'wf-answer-notice');answerNotice.setAttribute('role','status');answerNotice.hidden=true;answerIntro.append(answerNotice);
 $('afNext').textContent='Заполнить';$('afNextReview').textContent='Проверить';questions.querySelector('summary').textContent='Список вопросов';
 const answerFooter=step(make('div',null,'wf-stage-footer'),'answers');
 answerFooter.append(action('← Документы',()=>show('documents')),action('Далее: договор →',()=>show('contract'),true));contractCard.before(answerFooter);
 const contractIntro=step(make('div',null,'wf-contract-intro'),'contract');contractIntro.id='workflowContract';
 contractIntro.append(make('h2','Договор'));
 contractCard.before(contractIntro);
 const finalActions=step(root.querySelector('.preview-check'),'contract');finalActions.classList.add('wf-final-actions');
 $('checkQuestions').textContent='Проверить';$('checkQuestions').className='btn btn-ghost';
 const finalHelp=make('p','Карточка и документы сохранятся в Bitrix. Договор скачается.','hint');$('checkQuestions').before(finalHelp);
 const reviewLink=action('Вернуться к документам',()=>show('documents'));reviewLink.hidden=true;reviewLink.id='workflowDocumentIssues';finalActions.append(reviewLink);

 const floating=make('nav',null,'wf-bottom-nav');floating.setAttribute('aria-label','Переход между этапами');
 const previous=action('← Назад',()=>show(active==='contract'?'answers':'documents'));
 const nextStep=action('Далее: ответы →',()=>{if(active==='documents')show('answers');else if(active==='answers')show('contract');else $('saveAssessment').click();},true);
 const stepCaption=make('span','Документы','wf-bottom-caption');floating.append(previous,stepCaption,nextStep);document.body.append(floating);
 // Participants are scoped to each obligation. Keep the old shared answer for reference only.
 function compactLoans(){
  for(const row of $('creditors').querySelector(':scope > .repeat-rows').children){
   let fold=row.querySelector(':scope > details.wf-loan');
   if(!fold){fold=details('Кредит','wf-loan');for(const child of [...row.children])fold.append(child);row.append(fold);}
   const get=key=>[...row.querySelectorAll('input,select')].find(e=>e.id.replace(/_r\d+$/,'')===key)?.value||'';
   const missing=[...row.querySelectorAll('input,select,textarea')].filter(e=>!e.closest('.af-source')&&afLogicalVisible(e)&&!e.hasAttribute('data-optional')&&!['checkbox','file'].includes(e.type)&&(!e.value.trim()||!e.checkValidity())).length;
   const summary=fold.querySelector('summary'),amount=get('n8040'),title=get('n8038')||'Новый кредит';
   summary.textContent=title+(amount?' · '+Number(amount).toLocaleString('ru-RU')+' ₸':'')+(missing?' · заполнить: '+missing:'');
  }
 }

 function debtTotal(){
  const amounts=[...$('creditors').querySelectorAll('.repeat-rows input')].filter(input=>input.id.replace(/_r\d+$/,'')==='n8040');
  const known=amounts.filter(input=>input.value.trim()&&Number.isFinite(Number(input.value))&&Number(input.value)>=0);
  if(!known.length)return {text:'—',hint:'Укажите текущую задолженность по кредитам.'};
  const total=known.reduce((sum,input)=>sum+Math.round(Number(input.value)*100),0)/100,partial=known.length<amounts.length;
  return {text:(partial?'от ':'')+total.toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₸',hint:partial?'Сумма заполненных задолженностей. По части кредитов сумма ещё не указана.':'Общая текущая задолженность по всем кредитам в анкете.'};
 }

 function show(name,{focus=true,remember=true}={}){
  if(!tabs.has(name))return false;
  const blocked=name!=='documents'&&!collection().ready;
  if(blocked){name='documents';remember=false;}
  active=name;document.body.dataset.assessmentWorkflow=name;previous.hidden=name==='documents';stepCaption.textContent=name==='documents'?'1 из 3':name==='answers'?'2 из 3':'3 из 3';nextStep.textContent=name==='documents'?'Далее: ответы →':name==='answers'?'Далее: договор →':'Скачать договор';
  if(remember&&HostedAssessment.ready())try{sessionStorage.setItem('assessment-step:'+HostedAssessment.getContext().client.external.dealId,name);}catch{/* Navigation still works when browser storage is unavailable. */}
  for(const node of document.querySelectorAll('[data-assessment-step]')){
   const current=node.dataset.assessmentStep===name;node.dataset.stepCurrent=String(current);node.setAttribute('aria-hidden',String(!current));
  }
  for(const [key,{button}]of tabs){if(key===name)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
  if(name==='answers')openNextSection();
  if(focus){const target=blocked?collectionNotice:name==='documents'?documentStep:name==='answers'?answerIntro:contractIntro;target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
  collectionStatus();return !blocked;
 }
 function openNextSection(){
  if(answerSections.some(({fold})=>fold.open))return;
  const incomplete=[...afMissing(),...afMissingGroups()];
  const pending=afPending().map(([id])=>$(id));
  const target=answerSections.find(({card})=>incomplete.some(node=>card.contains(node)))||answerSections.find(({card})=>pending.some(node=>node&&card.contains(node)))||answerSections[0];
  if(target)target.fold.open=true;
 }
 function reveal(node){
  const parent=node?.closest('[data-assessment-step]');if(parent&&show(parent.dataset.assessmentStep,{focus:false})===false){collectionNotice.focus();collectionNotice.scrollIntoView({block:'center'});return false;}
  for(let ancestor=node?.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS')ancestor.open=true;
  return true;
 }
 function collection(){
  const deal=HostedAssessment.ready()?HostedAssessment.getContext().client.external.dealId:null;
  const missing=requiredDocumentLabels().filter(type=>{
   if(type==='ЭЦП файл')return !window.CredentialUpload?.collected();
   return !selectedFiles.some(item=>{const source=af.results.get(item.id)?.server;return item.type===type&&item.person==='Клиент'&&Boolean(source?source.dealId===deal&&source.documentId:item.storedDocumentId);});
  });
  const context=['needsSocialDoc','needsSalaryDoc'].filter(id=>!$(id).value);
  return {missing,context,ready:Boolean(deal&&!af.busy&&!missing.length&&!context.length)};
 }
 function collectionStatus(){
  const state=collection();
  collectionNotice.hidden=state.ready;collectionNotice.replaceChildren();
  if(!state.ready){
   collectionNotice.append(make('span',af.busy?'Сохраняем и читаем документы…':state.context.length&&!state.missing.length?'Уточните список документов':'Сначала соберите документы','wf-collection-title'));
   const links=make('div',null,'wf-collection-links');
   for(const id of state.context)links.append(action(id==='needsSocialDoc'?'Пенсия / пособия':'Зарплатный банк',()=>{$(id).focus();$(id).scrollIntoView({block:'center'});}));
   for(const type of state.missing){
    const short=({'ГКБ — краткий отчёт':'ГКБ краткий','ГКБ — полный отчёт':'ГКБ полный','Ф6 об отсутствии имущества':'Ф6','Удостоверение личности':'Удостоверение','Справка по выплатам пенсии и пособий':'Соц. выплаты','ЭЦП файл':'ЭЦП и пароль'})[type]||type;
    links.append(action(short,()=>{if(type==='ЭЦП файл'){credential.scrollIntoView({block:'center'});$('previewEdsPassword').focus();return;}const picker=[...document.querySelectorAll('[data-required-picker]')].find(input=>input.dataset.requiredPicker===type);picker?.click();}));
   }
   collectionNotice.append(links);
  }
  for(const [name,{button}]of tabs)if(name!=='documents'){button.setAttribute('aria-disabled',String(!state.ready));button.title=state.ready?'':'Сначала соберите обязательные документы';}
  nextStep.setAttribute('aria-disabled',String(active==='documents'&&!state.ready));
  if(active==='documents')nextStep.textContent=state.ready?'Далее: ответы →':af.busy?'Читаем документы…':'Сначала документы';
  if(active!=='documents'&&!state.ready)show('documents',{focus:false,remember:false});
 }
 function refresh(){
  const legacy=$('legacyLoanParticipants');legacy.hidden=!$('guarantors').value&&!legacy.querySelector('[data-legacy-unknown]').checked;legacy.querySelector('[data-legacy-unknown]').disabled=true;
  compactLoans();
  for(const hint of root.querySelectorAll('.field > .hint')){
   if(hint.querySelector('input,select,textarea,button')||!hint.textContent.trim())continue;
   // Keep answer definitions and calculation periods beside their fields.
   const fieldId=hint.closest('.field').querySelector('input,select,textarea')?.id.replace(/_r\d+$/,'');
   if(!['count-clientjobs','count-partnerjobs','clientCarCount','partnerCarCount','proofDetails','grafType'].includes(fieldId))continue;
   const help=details('?','wf-help');help.querySelector('summary').setAttribute('aria-label','Подсказка: '+(hint.closest('.field').querySelector('label.lbl')?.textContent.trim()||'Поле'));hint.before(help);help.append(hint);
  }
  const emptyAnswers=afMissing(),emptyGroups=afMissingGroups();
  for(const {card,fold,title}of answerSections){
   const count=emptyAnswers.filter(node=>card.contains(node)).length+emptyGroups.filter(node=>card.contains(node)).length;
   const summary=fold.querySelector('summary'),label=make('span',title),remaining=make('span',count?String(count):'','wf-section-count');remaining.hidden=!count;remaining.title='Осталось заполнить';remaining.setAttribute('aria-label','Осталось заполнить: '+count);
   if(card.contains($('creditors'))){const total=debtTotal(),amount=make('span',' · '+total.text,'wf-debt-total');amount.title=total.hint;label.append(amount);}
   summary.replaceChildren(label,remaining);
   if(card.contains($('creditors'))&&window.GkbComparison)remaining.before(GkbComparison.statusButton());
  }
  conflictDetails.hidden=!af.conflicts.length;conflictDetails.querySelector('summary').textContent='Расхождения · '+af.conflicts.length;
  const required=requiredDocumentLabels(),provided=required.filter(type=>(type==='ЭЦП файл'&&window.CredentialUpload?.verified())||selectedFiles.some(item=>item.type===type&&item.person==='Клиент')).length;
  packageList.querySelector('summary').textContent=`Нужные документы · ${provided} из ${required.length}`;
  headings[0].textContent='Файлы'+(selectedFiles.length?' · '+selectedFiles.length:'');
  const missing=emptyAnswers.filter(node=>node.closest('[data-assessment-step]')?.dataset.assessmentStep==='answers').length+emptyGroups.length;
  const pending=afPending().length;
  $('afMissing').textContent=missing;
  for(const tab of tabs.values())tab.note.textContent='';
  $('afNext').textContent='Заполнить'+(missing?' · '+missing:'');$('afNextReview').textContent='Проверить'+(pending?' · '+pending:'');
  reviewDetails.querySelector('summary').textContent='Проверка документов'+(lastCheck?.documents?.issues.length?' · '+lastCheck.documents.issues.length:'');
  reviewLink.hidden=!(lastCheck?.documents?.issues.length);
  const issues=lastCheck?.checkMode==='answers'?lastCheck.issues||[]:[];
  answerNotice.hidden=!issues.length;answerNotice.textContent=issues.length?'Уточните ответы: '+issues.slice(0,5).map(issue=>issue.label).join('; ')+'.':'';
  const filled=$('afFilled').textContent;
  if(!af.busy)$('afAnalyze').disabled=selectedFiles.length===0;
  $('afReview').closest('span').classList.toggle('wf-needs-review',pending>0);
  metrics.setAttribute('aria-label',`Из документов: ${filled}. Проверить: ${pending}. Пустых ответов: ${missing}.`);
  collectionStatus();
 }
 function updateCase(){
  const context=HostedAssessment.getContext();if(!context)return;
  clientName.textContent=context.client.title;clientMeta.textContent='Сделка № '+context.client.external.dealId+(context.client.iin?' · ИИН '+context.client.iin:' · ИИН не указан');clientMeta.title=context.client.iin?'ИИН '+context.client.iin:'ИИН не указан';
  picker.querySelector('summary').textContent='Другая сделка';picker.open=false;refresh();
 }
 document.addEventListener('assessment-case-opened',()=>{lastCheck=null;for(const {fold}of answerSections)fold.open=false;updateCase();show('documents',{focus:false,remember:false});});
 document.addEventListener('assessment-checked',event=>{lastCheck=event.detail;refresh();});
 for(const name of ['input','change'])document.addEventListener(name,event=>{if(!event.target.closest?.('[data-document-review]'))lastCheck=null;queueMicrotask(refresh);});
 document.addEventListener('assessment-draft-restored',()=>{lastCheck=null;refresh();try{const saved=sessionStorage.getItem('assessment-step:'+HostedAssessment.getContext().client.external.dealId);if(saved)show(saved,{focus:false});}catch{/* Keep the document step when storage is unavailable. */}});
 document.addEventListener('assessment-analysis-complete',()=>{lastCheck=null;fileResults.open=true;refresh();});
 document.addEventListener('assessment-credentials-changed',()=>queueMicrotask(refresh));
 const previousRender=renderDocuments;renderDocuments=function(){previousRender();lastCheck=null;refresh();};
 show(active,{focus:false});updateCase();refresh();visibilityRules();
 return{show,reveal,refresh,collection};
})();
