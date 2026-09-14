/* Keep ISO month values in drafts and evidence; localize only the editor. */
(()=>{
 const root=document.getElementById('questionnaireStep');if(!root)return;
 const months=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
 const editors=new WeakMap();
 function currentMonth(){
  const day=window.HostedAssessment?.getContext()?.assessmentDay;if(day)return day.slice(0,7);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
 }
 function mount(input){
  if(editors.has(input)){editors.get(input)();return;}
  const host=document.createElement('assessment-month');
  host.setAttribute('role','group');host.setAttribute('aria-label',input.closest('.field')?.querySelector('label.lbl')?.textContent.replace(/\*/g,'').trim()||'Месяц и год');
  // Shadow controls do not become extra questionnaire answers or draft fields.
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML='<style>:host{display:block;min-width:0}.editor{display:flex;gap:8px}select,input{box-sizing:border-box;min-width:0;height:44px;border:1px solid #cfdad2;border-radius:8px;background:#fff;color:#173c29;font:inherit;padding:8px 10px}select{flex:1}input{width:92px}select:focus,input:focus{outline:2px solid #a97a20;outline-offset:2px}:host([data-invalid]) select,:host([data-invalid]) input{border-color:#b3261e}.error{color:#b3261e;font-size:13px;margin-top:6px}</style><div class="editor"><select aria-label="Месяц" aria-describedby="error"><option value="">Месяц</option></select><input aria-label="Год" aria-describedby="error" inputmode="numeric" maxlength="4" placeholder="Год"></div><div class="error" id="error" role="status" hidden></div>';
  const month=shadow.querySelector('select'),year=shadow.querySelector('input');
  months.forEach((name,index)=>month.add(new Option(name,String(index+1).padStart(2,'0'))));
  input.after(host);input.tabIndex=-1;input.setAttribute('aria-hidden','true');
  Object.assign(input.style,{position:'absolute',width:'1px',height:'1px',padding:'0',border:'0',clipPath:'inset(50%)'});
  let editing=false;
  const validate=()=>{
   if(!/^n8038Start(?:_r\d+)?$/.test(input.id))return;
   input.max=currentMonth();
   const message=input.value&&input.value>input.max?'Дата получения кредита не может быть в будущем.':'';
   input.setCustomValidity(message);year.setCustomValidity(message);host.toggleAttribute('data-invalid',Boolean(message));
   const error=shadow.getElementById('error');error.hidden=!message;error.textContent=message;
  };
  const sync=()=>{if(!editing){const value=/^(\d{4})-(\d{2})$/.exec(input.value);year.value=value?.[1]||'';month.value=value?.[2]||'';month.disabled=year.disabled=input.disabled;}validate();};
  const edit=event=>{
   event.stopPropagation();editing=true;
   input.value=month.value&&/^\d{4}$/.test(year.value)&&Number(year.value)>0?year.value+'-'+month.value:'';
   validate();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));editing=false;
  };
  month.addEventListener('change',edit);year.addEventListener('input',edit);
  // The canonical input remains focusable for required-field and source shortcuts.
  input.addEventListener('focus',()=>month.focus());input.addEventListener('input',sync);input.addEventListener('change',sync);editors.set(input,sync);sync();
 }
 const scan=()=>root.querySelectorAll('input[type="month"]').forEach(mount);
 scan();new MutationObserver(scan).observe(root,{childList:true,subtree:true});
 for(const event of ['assessment-case-opened','assessment-draft-restored'])document.addEventListener(event,scan);
})();
