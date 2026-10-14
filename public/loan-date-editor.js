/* One canonical answer; shadow editor displays Russian dates without changing stored precision. */
(()=>{
 const root=document.getElementById('questionnaireStep');if(!root||!window.LoanDates)return;
 const {loanDatePrecision}=window.LoanDates,editors=new WeakMap();
 function today(){return window.HostedAssessment?.getContext()?.assessmentDay||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
 function mount(input,force=false){
  if(editors.has(input)){editors.get(input)(force);return;}
  const host=document.createElement('assessment-loan-date'),shadow=host.attachShadow({mode:'open'});
  const label=input.closest('.field')?.querySelector('label.lbl')?.textContent.replace(/\*/g,'').trim()||'Дата кредита';
  shadow.innerHTML='<style>:host{display:block}input{box-sizing:border-box;width:100%;height:44px;border:1px solid #cfdad2;border-radius:8px;padding:8px 10px;font:inherit}input:focus{outline:2px solid #a97a20}:host([data-invalid]) input{border-color:#b3261e}.note{font-size:13px;margin-top:6px}</style><input type="text" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" aria-describedby="note"><div class="note" id="note" role="status"></div>';
  const editor=shadow.querySelector('input'),note=shadow.querySelector('.note');editor.setAttribute('aria-label',label);
  input.after(host);input.tabIndex=-1;input.setAttribute('aria-hidden','true');Object.assign(input.style,{position:'absolute',width:'1px',height:'1px',padding:'0',border:'0',clipPath:'inset(50%)'});
  let editing=false,lastValue=input.value;
  const validate=()=>{
   if(/^n8038Start(?:_r\d+)?$/.test(input.id)){const issued=input.closest('.repeat-item')?.querySelector('input[id^=loanDisbursementDate]');input.required=loanDatePrecision(issued?.value)!=='day';}
   const value=input.value,precision=loanDatePrecision(value),legacy=precision==='month'&&/^n8038Start(?:_r\d+)?$/.test(input.id);
   const message=value&&!precision?'Введите существующую дату: ДД.ММ.ГГГГ.':precision==='month'&&!legacy?'Укажите полную дату: ДД.ММ.ГГГГ.':value>(legacy?today().slice(0,7):today())?'Дата кредита не может быть в будущем.':'';
   input.setCustomValidity(message);editor.setCustomValidity(message);host.toggleAttribute('data-invalid',Boolean(message));note.textContent=message||(legacy?'Сохранён только месяц; день не указан.':'');
  };
  const sync=(force=false)=>{if(!editing){if(force===true||input.value!==lastValue){const precision=loanDatePrecision(input.value);editor.value=precision==='day'?input.value.split('-').reverse().join('.'):precision==='month'?input.value.slice(5)+'.'+input.value.slice(0,4):input.value;lastValue=input.value;}editor.disabled=input.disabled;}validate();};
  editor.addEventListener('input',event=>{
   event.stopPropagation();editing=true;const value=editor.value.trim(),match=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
   input.value=match?match[3]+'-'+match[2]+'-'+match[1]:value;lastValue=input.value;validate();
   input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));editing=false;
  });
  input.addEventListener('focus',()=>editor.focus());input.addEventListener('input',()=>sync(true));input.addEventListener('change',()=>sync(true));editors.set(input,sync);sync(true);
 }
 const scan=(force=false)=>root.querySelectorAll('input[data-loan-date]').forEach(input=>mount(input,force));
 scan();new MutationObserver(()=>scan()).observe(root,{childList:true,subtree:true});
 root.addEventListener('change',()=>scan());
 for(const event of ['assessment-case-opened','assessment-draft-restored'])document.addEventListener(event,()=>scan(true));
})();
