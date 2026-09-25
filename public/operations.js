(()=>{
 const {make,mode}=ClientContextUI,$=id=>document.getElementById(id),wrap=document.querySelector('main.wrap');
 const handoff=make('section',null,'ux-handoff-area');handoff.id='uxHandoff';handoff.dataset.uxClientContent='';
 const delivery=make('p','Проверяем анкету и документы в Bitrix…','ux-handoff-note');delivery.id='handoffDelivery';delivery.setAttribute('role','status');
 const assessmentLink=make('a','Открыть договор и завершить сохранение','btn btn-ghost');assessmentLink.id='handoffAssessmentLink';assessmentLink.dataset.clientPath='/assessment-review';assessmentLink.href='/assessment-review';assessmentLink.target='_top';assessmentLink.hidden=true;handoff.append(delivery,assessmentLink);
 const grid=make('div',null,'ux-handoff-grid');handoff.append(grid);
 function card(title,description,id){const box=make('section',null,'ux-handoff-card'),head=make('header'),copy=make('div'),state=make('span','Не добавлен','ux-handoff-state');state.id=id;copy.append(make('h2',title));if(description)copy.append(make('p',description));head.append(copy,state);box.append(head);grid.append(box);return box;}
 card('1. ЭЦП клиента','','handoffKeyState').append(document.querySelector('.wf-credential'));
 const power=card('2. Доверенность','','handoffPowerState');power.append($('require-power'));
 const powerStatus=make('p',null,'hint');powerStatus.id='handoffPowerStatus';power.append(powerStatus);
 const inspect=make('button','Проверить','btn btn-ghost');inspect.id='handoffPowerCheck';inspect.type='button';power.append(inspect);
 const view=make('button','Открыть PDF','btn btn-ghost');view.id='handoffPowerOpen';view.type='button';power.append(view);
 const review=make('div');review.id='handoffPowerReview';power.append(review);
 const signed=card('3. Подписанный договор','PDF из TrustMe с подписью и QR.','handoffSignedState');
 const name=make('p','Файл не выбран','ux-file-name');name.id='handoffSignedName';
 const picker=make('label','Выбрать PDF','btn btn-ghost ux-file-label'),input=make('input');input.id='handoffSignedFile';input.type='file';input.accept='.pdf,application/pdf';input.setAttribute('aria-label','Подписанный договор TrustMe');picker.append(input);
 const open=make('button','Открыть PDF','btn btn-ghost');open.id='handoffSignedOpen';open.type='button';signed.append(name,picker,open);
 const confirmation=make('label',null,'ux-confirm'),agree=make('input');agree.type='checkbox';agree.id='handoffSignedConfirmed';confirmation.append(agree,make('span','Клиент, подпись и QR проверены. Договор окончательный.'));signed.append(confirmation);
 const help=make('details',null,'ux-handoff-help');help.append(make('summary','Что проверяется?'),make('p','Вы подтверждаете владельца ЭЦП, клиента, подпись и QR. Их подлинность автоматически не проверяется. После передачи сработает робот Bitrix.'));handoff.append(help);
 const footer=make('div',null,'ux-handoff-footer'),summary=make('div'),count=make('strong','Пакет: 0 из 3'),reason=make('p','Выберите клиента.');count.id='handoffCount';reason.id='handoffReason';reason.setAttribute('role','status');summary.append(count,reason);
 const send=make('button','Передать юристам →','btn btn-main');send.id='handoffSend';send.type='button';send.disabled=true;footer.append(summary,send);handoff.append(footer);
 const stage=make('p',null,'ux-handoff-note');stage.id='handoffStage';stage.setAttribute('role','status');handoff.append(stage);
 const refresh=make('button','Проверить состояние','btn btn-ghost');refresh.id='handoffRefresh';refresh.type='button';
 const cancel=make('button','Отменить подготовку','btn btn-ghost');cancel.id='handoffCancel';cancel.type='button';cancel.hidden=true;handoff.append(refresh,cancel);wrap.append(handoff);
 if(mode==='contract'){
  const next=make('details',null,'ux-signing-next');next.append(make('summary','После скачивания договора'),make('p','Подпишите договор в TrustMe, затем передайте подписанный PDF юристам.'));
  const link=make('a','Договор уже подписан → Передать юристам','btn btn-ghost');link.dataset.clientPath='/lawyer-handoff';link.href='/lawyer-handoff';link.target='_top';next.append(link);document.querySelector('.wf-final-actions').append(next);
 }
 ClientContextUI.sync();
})();
