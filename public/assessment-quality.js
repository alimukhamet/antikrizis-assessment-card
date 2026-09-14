/* Fact collection and manual evidence review. No network or browser storage. */
(function(root){
  const titles=['Клиент и ситуация','Сведения по делу','Проверка и договор'];
  const topics=[
    {id:'family',title:'Клиент и семья',keys:['fio','iin','marital','dependents','children','socialStatus']},
    {id:'income',title:'Доходы и расходы',keys:['works','incomeClientOff','incomeClientUnoff','incomeSpouseOff','incomeSpouseUnoff','spouseTurnover','spouseWorks','salaryOtherBank','ip','ipDetails'],extra:['livingCosts','loanPayments','incomeStability']},
    {id:'property',title:'Имущество и сделки',keys:['realEstate','realEstateDetails','spouseProperty','spouseCar','cars','carsDesc','carSale','carSaleSum'],extra:['assetTransfers','carSaleDetails']},
    {id:'debt',title:'Долги и кредиторы',keys:['debt','overdueDays','lastCreditDate','kaspiTurnover','kaspiTurnoverComment','spouseKaspiTurnover','spouseKaspiTurnoverComment','creditTypes','creditors','creditPurpose'],extra:['creditorDetails']},
    {id:'risk',title:'Риски и исполнительные производства',keys:['ludo','guarantors'],extra:['enforcementStatus','enforcementDetails','gamblingDetails']}
  ];
  const extras=[
    {id:'livingCosts',label:'Обязательные расходы семьи, ₸/мес',topic:'income',hint:'Жильё, питание, дети, лечение и другие обязательные расходы. Не включайте платежи по кредитам.',kind:'money'},
    {id:'loanPayments',label:'Текущие платежи по всем долгам, ₸/мес',topic:'income',hint:'Укажите общую сумму регулярных платежей отдельно от расходов семьи.',kind:'money'},
    {id:'incomeStability',label:'Источники и устойчивость дохода',topic:'income',hint:'Кто получает доход, из какого источника, за какой период рассчитан средний доход? Что менялось за последние месяцы?'},
    {id:'carSaleDetails',label:'Подробности продажи автомобиля',topic:'property',hint:'Дата, покупатель и связь с клиентом, цена и куда потрачены деньги. Если часть сведений неизвестна, перечислите её.',when:s=>s.carSale==='1'},
    {id:'assetTransfers',label:'Другие сделки с имуществом за последние 3 года',topic:'property',hint:'Продажа, дарение, переоформление недвижимости, долей и другого имущества: объект, дата, получатель, сумма, использование денег. Если не было — напишите «Не было». Это сбор фактов, а не правовая оценка срока.'},
    {id:'creditorDetails',label:'Подробности по каждому кредитору',topic:'debt',hint:'Один кредитор или договор на строку: название; остаток долга и дата остатка; ежемесячный платёж; просрочка; дата последнего платежа; залог; источник. Неизвестные значения так и обозначьте.'},
    {id:'enforcementStatus',label:'Есть исполнительные производства, аресты или удержания?',topic:'risk',options:[['','Выберите ответ'],['no','Нет, со слов клиента'],['yes','Да'],['unknown','Неизвестно — уточнить']]},
    {id:'enforcementDetails',label:'Подробности исполнительных производств',topic:'risk',hint:'Номер дела, ЧСИ, взыскатель, сумма, ограничения и удержания, известные сроки. Если часть неизвестна, укажите это.',when:s=>s.quality?.extra.enforcementStatus==='yes'},
    {id:'gamblingDetails',label:'Уточнение расходов на азартные игры',topic:'risk',hint:'Со слов клиента: когда были расходы, связаны ли с ними займы, продолжаются ли расходы сейчас? Не ставьте диагноз.',when:s=>s.ludo==='1'}
  ];
  const unknownAllowed=topics.flatMap(t=>t.keys).filter(k=>!['fio','iin','marital','debt','kaspiTurnoverComment','spouseKaspiTurnoverComment'].includes(k));
  const labels={};let step=0;let mounted=false;const fingerprints={};
  const $=id=>document.getElementById(id);
  const value=id=>$(id)?.value.trim()||'';
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const unknown=(s,key)=>(s.quality?.unknown||[]).includes(key);
  const money=v=>String(v??'').trim()===''?'Неизвестно — уточнить':`${Number(String(v).replace(/[ .\u00a0]/g,'')).toLocaleString('ru-RU')} ₸`;
  function applies(s,key){
    if(['incomeSpouseOff','incomeSpouseUnoff','spouseTurnover','spouseWorks','spouseProperty','spouseCar','spouseKaspiTurnover','spouseKaspiTurnoverComment'].includes(key))return s.marital==='В браке';
    if(key==='ipDetails')return s.ip==='1';
    if(key==='realEstateDetails')return s.realEstate==='1';
    if(key==='carsDesc')return s.cars==='1';
    if(key==='carSaleSum')return s.carSale==='1';
    return true;
  }
  function decorate(s){
    if(!mounted)return s;
    const rawUnknown=[...document.querySelectorAll('[data-unknown-toggle]:checked')].map(el=>el.dataset.unknownToggle);
    const q={version:1,unknown:[],extra:{},reviews:{},collector:value('qualityCollector'),collectedOn:value('qualityCollectedOn'),owner:value('qualityOwner'),due:value('qualityDue'),next:value('qualityNext')};
    const out={...s,quality:q};
    // Clear parents first so hidden follow-ups cannot leak stale answers.
    for(const key of rawUnknown)if(unknownAllowed.includes(key))out[key]='';
    q.unknown=rawUnknown.filter(key=>unknownAllowed.includes(key)?applies(out,key):extras.some(e=>e.id===key));
    for(const item of extras)q.extra[item.id]=q.unknown.includes(item.id)?'':value(item.id);
    for(const item of extras)if(item.when&&!item.when(out)){q.extra[item.id]='';q.unknown=q.unknown.filter(k=>k!==item.id);}
    for(const key of unknownAllowed)if(!applies(out,key))out[key]='';
    for(const topic of topics)q.reviews[topic.id]={status:value(`review-${topic.id}`)||'reported',source:value(`source-${topic.id}`),reviewer:value(`reviewer-${topic.id}`),date:value(`date-${topic.id}`),note:value(`note-${topic.id}`)};
    return out;
  }
  function topicUnknown(s,t){return [...t.keys,...(t.extra||[])].filter(k=>unknown(s,k)).length+(t.id==='risk'&&s.quality.extra.enforcementStatus==='unknown'?1:0);}
  function topicIncomplete(s,t){
    const optional=['kaspiTurnoverComment','spouseKaspiTurnoverComment'];
    return t.keys.some(k=>!optional.includes(k)&&applies(s,k)&&!unknown(s,k)&&(s[k]===undefined||s[k]===null||s[k]===''))||
      extras.some(e=>e.topic===t.id&&(!e.when||e.when(s))&&!unknown(s,e.id)&&!s.quality.extra[e.id]);
  }
  function issues(s){
    const q=s.quality;if(!q)return [];
    const errors=[];const add=(id,message)=>errors.push({id,message});
    if(!q.collector)add('qualityCollector','Кто собрал сведения');
    if(!q.collectedOn||q.collectedOn>today())add('qualityCollectedOn','Дата сбора сведений: не позже сегодняшней');
    for(const item of extras){
      if(item.when&&!item.when(s))continue;
      const v=q.extra[item.id];
      if(!v&&!unknown(s,item.id))add(item.id,item.label+' — ответ или «Неизвестно»');
      if(item.kind==='money'&&v&&!/^\d+(?:[ .\u00a0]\d{3})*$/.test(v))add(item.id,item.label+' — неотрицательная целая сумма');
    }
    for(const t of topics){
      const r=q.reviews[t.id];
      if(r.status==='matched'){
        if(topicUnknown(s,t))add(`review-${t.id}`,t.title+': сначала уточните неизвестные сведения');
        if(topicIncomplete(s,t))add(`review-${t.id}`,t.title+': сначала соберите сведения раздела');
        if(!r.source)add(`source-${t.id}`,t.title+': укажите документ, дату/период и место хранения');
        if(!r.reviewer)add(`reviewer-${t.id}`,t.title+': кто сверил сведения');
        if(!r.date||r.date>today())add(`date-${t.id}`,t.title+': дата сверки не позже сегодняшней');
      }
      if(r.status==='conflict'&&!r.note)add(`note-${t.id}`,t.title+': опишите расхождение');
    }
    if(topics.some(t=>q.reviews[t.id].status!=='matched'||topicUnknown(s,t))){
      if(!q.owner)add('qualityOwner','Ответственный за уточнение');
      if(!q.due||q.due<today())add('qualityDue','Срок уточнения: сегодня или позже');
      if(!q.next)add('qualityNext','Что уточнить и какое подтверждение получить');
    }
    return errors;
  }
  function statusText(s,t){
    const r=s.quality.reviews[t.id];
    if(r.status==='conflict')return 'Есть расхождение';
    if(topicUnknown(s,t))return 'Есть неизвестные сведения';
    if(topicIncomplete(s,t))return 'Сведения не собраны полностью';
    if(r.status==='matched')return r.source&&r.reviewer&&r.date&&r.date<=today()?'Сверено сотрудником по указанному источнику':'Отметка сверки не завершена';
    return 'Со слов клиента / не проверено';
  }
  function summary(s){
    const q=s.quality;if(!q)return [];
    const out=['','СБОР И ПРОВЕРКА СВЕДЕНИЙ','Ответы клиента не являются автоматически подтверждёнными фактами.',`Собрал(а): ${q.collector||'не указано'} · дата: ${q.collectedOn||'не указана'}`];
    for(const e of extras){if(e.when&&!e.when(s))continue;let v=q.extra[e.id];
      if(e.id==='enforcementStatus')v={yes:'Да',no:'Нет, со слов клиента',unknown:'Неизвестно — уточнить'}[v];
      else if(e.kind==='money'&&v)v=money(v);
      out.push(`• ${e.label}: ${unknown(s,e.id)?'Неизвестно — уточнить':v||'Не указано'}`);
    }
    if(q.unknown.length)out.push('Неизвестно — уточнить: '+q.unknown.map(k=>labels[k]||extras.find(e=>e.id===k)?.label||k).join('; '));
    for(const t of topics){const r=q.reviews[t.id];out.push(`${t.title}: ${statusText(s,t)}`);
      if(r.source)out.push('  Источник: '+r.source);
      if(r.reviewer||r.date)out.push(`  Сверил(а): ${r.reviewer||'не указан(а)'} · ${r.date||'дата не указана'}`);
      if(r.note)out.push('  Уточнение / расхождение: '+r.note);
    }
    if(q.owner||q.due||q.next)out.push(`Следующее действие: ${q.next||'не указано'}`,`Ответственный: ${q.owner||'не указан'} · срок: ${q.due||'не указан'}`);
    return out;
  }
  function enforcement(s){
    const q=s.quality;if(!q)return 'Неизвестно — уточнить';
    if(q.extra.enforcementStatus==='yes')return 'Да — '+(q.extra.enforcementDetails||'подробности уточняются');
    return q.extra.enforcementStatus==='no'?'Нет, со слов клиента':'Неизвестно — уточнить';
  }
  function fingerprint(s,t,dealId){
    return JSON.stringify([dealId,s.fio,s.iin,...t.keys.map(k=>s[k]),...(t.extra||[]).map(k=>s.quality.extra[k]),s.quality.unknown.filter(k=>[...t.keys,...(t.extra||[])].includes(k))]);
  }
  function go(index){
    step=Math.max(0,Math.min(2,index));
    document.querySelectorAll('[data-assessment-step]').forEach(el=>{el.hidden=Number(el.dataset.assessmentStep)!==step;});
    document.querySelectorAll('[data-step-button]').forEach(el=>el.setAttribute('aria-current',Number(el.dataset.stepButton)===step?'step':'false'));
    $('assessmentPrev').hidden=step===0;$('assessmentNext').hidden=step===2;
    $('assessmentStepLabel').textContent=`Шаг ${step+1} из 3 · ${titles[step]}`;
    if(mounted)document.querySelector('.assessment-steps')?.scrollIntoView({block:'start',behavior:'smooth'});
  }
  function reveal(key){
    const target=$(key)||document.querySelector(`[data-k="${key}"]`);
    const stage=target?.closest('[data-assessment-step]');if(stage)go(Number(stage.dataset.assessmentStep));
    const details=target?.closest('details');if(details)details.open=true;
    target?.scrollIntoView({block:'center',behavior:'smooth'});
    (target?.matches('input,select,textarea,button')?target:target?.querySelector('input,select,textarea,button'))?.focus();
  }
  function field({id,label,hint,kind,options}){
    const box=document.createElement('div');box.className='field full quality-field';box.dataset.k=id;
    const l=document.createElement('label');l.className='lbl';l.htmlFor=id;l.textContent=label;box.append(l);
    let input;
    if(options){input=document.createElement('select');for(const [v,text] of options){const o=document.createElement('option');o.value=v;o.textContent=text;input.append(o);}}
    else{input=document.createElement(kind==='date'||kind==='short'||kind==='money'?'input':'textarea');if(kind==='date')input.type='date';if(kind==='money')input.inputMode='numeric';}
    input.id=id;box.append(input);
    if(hint){const p=document.createElement('p');p.className='hint';p.id=id+'-hint';p.textContent=hint;input.setAttribute('aria-describedby',p.id);box.append(p);}
    return box;
  }
  function addUnknown(box,key){
    const l=document.createElement('label');l.className='quality-unknown';
    const c=document.createElement('input');c.type='checkbox';c.dataset.unknownToggle=key;
    c.addEventListener('change',()=>{box.querySelectorAll('input,select,textarea,button').forEach(el=>{if(el!==c)el.disabled=c.checked;});});
    l.append(c,document.createTextNode('Неизвестно — уточнить'));box.append(l);
  }
  function mount(){
    const intro=document.querySelector('.workflow-intro[data-flow="contract"]');
    intro.querySelector('p').textContent='Сначала запишите факты, затем укажите источники и вопросы для проверки. Заполнено не означает проверено.';
    const nav=document.createElement('nav');nav.className='assessment-steps';nav.setAttribute('aria-label','Этапы карточки');
    titles.forEach((title,index)=>{const b=document.createElement('button');b.type='button';b.dataset.stepButton=index;b.textContent=`${index+1}. ${title}`;b.onclick=()=>go(index);nav.append(b);});intro.append(nav);
    const cards=[...document.querySelectorAll('section.card[data-flow="contract"]')];
    cards.forEach((card,index)=>{card.dataset.assessmentStep=index===0?0:index<5?1:2;});
    // Keep the existing procedure field and Bitrix enum; collect the choice after facts.
    const procedure=document.querySelector('[data-k="procedure"]');cards[5].querySelector('.fields').prepend(procedure);
    const procedureHint=document.createElement('p');procedureHint.className='hint';procedureHint.textContent='Предлагаемый вид процедуры для договора. Отметки сверки не заменяют решение юриста.';procedure.append(procedureHint);
    const groupCards={income:cards[1],property:cards[2],debt:cards[3],risk:cards[4]};
    for(const item of extras){const box=field(item);groupCards[item.topic].querySelector('.fields').append(box);if(!item.options)addUnknown(box,item.id);}
    for(const key of unknownAllowed){const box=document.querySelector(`[data-k="${key}"]`);if(box){labels[key]=box.querySelector('.lbl')?.textContent.replace('*','').trim()||key;addUnknown(box,key);}}
    const gambling=document.querySelector('[data-k="ludo"] .lbl');gambling.textContent='Были расходы на азартные игры? *';
    const verify=document.createElement('section');verify.className='card quality-review';verify.dataset.flow='contract';verify.dataset.assessmentStep='2';
    const heading=document.createElement('h2');heading.className='card-title';heading.textContent='Проверка сведений';verify.append(heading);
    const note=document.createElement('p');note.className='hint';note.textContent='Файлы загружаются в отдельной задаче. Здесь сотрудник фиксирует уже выполненную сверку: какой документ, за какую дату или период, где он хранится и кто проверил. Загрузка файла сама по себе не подтверждает ответ.';verify.append(note);
    const counts=document.createElement('p');counts.id='qualitySummary';counts.setAttribute('role','status');verify.append(counts);
    const meta=document.createElement('div');meta.className='fields';meta.append(field({id:'qualityCollector',label:'Кто собрал сведения',kind:'short'}),field({id:'qualityCollectedOn',label:'Дата сбора сведений',kind:'date'}));verify.append(meta);
    for(const t of topics){
      const d=document.createElement('details');d.className='quality-topic';d.open=false;
      const title=document.createElement('summary');title.textContent=t.title+' · ';const status=document.createElement('span');status.id='status-'+t.id;title.append(status);d.append(title);
      const fields=document.createElement('div');fields.className='fields';
      fields.append(field({id:'review-'+t.id,label:'Результат проверки',options:[['reported','Со слов клиента / не проверено'],['matched','Сверено с источником'],['conflict','Есть расхождение']]}),
        field({id:'source-'+t.id,label:'Источник: документ, дата / период и место хранения',hint:'Например: название отчёта, дата, страница или раздел и файл в сделке. Не вставляйте пароли и ЭЦП.'}),
        field({id:'reviewer-'+t.id,label:'Кто выполнил сверку',kind:'short'}),field({id:'date-'+t.id,label:'Дата сверки',kind:'date'}),
        field({id:'note-'+t.id,label:'Что неизвестно или не совпадает',hint:'Какое утверждение клиента и какое значение в источнике требуют уточнения?'}));d.append(fields);verify.append(d);
    }
    const next=document.createElement('div');next.className='fields';next.append(field({id:'qualityNext',label:'Что уточнить и какое подтверждение получить',hint:'Перечислите действия по всем непроверенным разделам и неизвестным ответам.'}),field({id:'qualityOwner',label:'Ответственный за уточнение',kind:'short'}),field({id:'qualityDue',label:'Срок уточнения',kind:'date'}));verify.append(next);cards[5].before(verify);
    const footer=document.createElement('div');footer.className='assessment-navigation';footer.dataset.flow='contract';footer.innerHTML='<button type="button" id="assessmentPrev">← Предыдущий шаг</button><span id="assessmentStepLabel" role="status"></span><button type="button" id="assessmentNext">Следующий шаг →</button>';cards.at(-1).after(footer);
    $('assessmentPrev').onclick=()=>go(step-1);$('assessmentNext').onclick=()=>go(step+1);
    mounted=true;go(0);
  }
  function update(s){
    if(!mounted||!s.quality)return;
    for(const item of extras){const box=$(item.id).closest('.field');box.classList.toggle('hidden',!!item.when&&!item.when(s));}
    for(const key of ['incomeSpouseOff','incomeSpouseUnoff','spouseTurnover','spouseProperty'])$(key)?.closest('.field').classList.toggle('hidden',s.marital!=='В браке');
    for(const [key,id] of [['ipDetails','ipDetailsField'],['realEstateDetails','realEstateDetailsField'],['carsDesc','carsDescField'],['carSaleSum','carSaleField']])$(id)?.classList.toggle('hidden',!applies(s,key));
    let checked=0;
    for(const t of topics){
      const currentFingerprint=fingerprint(s,t,value('dealId'));
      const r=s.quality.reviews[t.id];
      if(fingerprints[t.id]&&fingerprints[t.id]!==currentFingerprint&&r.status==='matched'){
        $('review-'+t.id).value='reported';r.status='reported';$('date-'+t.id).value='';r.date='';
        $('note-'+t.id).value='Сведения изменены после сверки. Проверьте заново. '+r.note;
        r.note=$('note-'+t.id).value;
      }
      fingerprints[t.id]=currentFingerprint;
      const status=statusText(s,t);$('status-'+t.id).textContent=status;
      if(status==='Сверено сотрудником по указанному источнику')checked++;
    }
    $('qualitySummary').textContent=`Сверено сотрудником: ${checked} из ${topics.length} разделов. Неизвестных ответов: ${s.quality.unknown.length+(s.quality.extra.enforcementStatus==='unknown'?1:0)}. Это не юридическое заключение.`;
  }
  function reset(){
    for(const key of Object.keys(fingerprints))delete fingerprints[key];
    document.querySelectorAll('[data-flow="contract"] input,[data-flow="contract"] select,[data-flow="contract"] textarea,[data-flow="contract"] .seg button').forEach(el=>{el.disabled=false;});
    document.querySelectorAll('[id^="review-"]').forEach(el=>{el.value='reported';});go(0);
  }
  root.AssessmentQuality={mount,go,reveal,decorate,unknown,applies,issues,summary,enforcement,fingerprint,update,reset,topics,extras,statusText};
})(globalThis);
