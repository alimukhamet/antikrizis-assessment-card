import {participantRoles,parseParticipants,formatParticipants} from './loan-participants.mjs';

const root=document.getElementById('questionnaireStep');
function mount(input){
 if(input.nextElementSibling?.matches('loan-participants'))return;
 const host=document.createElement('loan-participants'),shadow=host.attachShadow({mode:'open'});
 host.setAttribute('role','group');host.setAttribute('aria-label','Созаёмщик, гарант, поручитель или залогодатель');
 shadow.innerHTML=`<style>
 :host{display:block;min-width:0}*{box-sizing:border-box}[hidden]{display:none!important}
 select,input,button{font:inherit;color:#21392c;background:#fff;border:1px solid #cfdad2;border-radius:7px;min-height:40px;padding:8px 10px;min-width:0}
 select{width:100%}button{cursor:pointer;font-size:13px;color:#365a41}button:hover{background:#f1f6ef}
 .person{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(130px,1fr) auto;gap:8px;margin-top:10px;align-items:end}
 label{font-size:13px;display:grid;gap:5px}input{width:100%;font-size:16px}.add{margin-top:10px}.legacy{font-size:13px;color:#79571e;white-space:pre-wrap}
 :focus-visible{outline:2px solid #a27725;outline-offset:2px}@media(max-width:460px){.person{grid-template-columns:minmax(0,1fr) auto}.person label:first-child{grid-column:1/-1}}
 </style><select aria-label="Есть созаёмщик, гарант, поручитель или залогодатель по этому кредиту?"><option value="">Выберите ответ</option><option value="none">Нет</option><option value="some">Есть</option></select><p class="legacy" hidden></p><div class="people" hidden></div><button class="add" type="button" hidden>+ Участник</button>`;
 const choice=shadow.querySelector('select'),list=shadow.querySelector('.people'),add=shadow.querySelector('.add'),legacy=shadow.querySelector('.legacy');
 let editing=false;
 input.after(host);input.tabIndex=-1;input.setAttribute('aria-hidden','true');
 Object.assign(input.style,{position:'absolute',width:'1px',height:'1px',padding:'0',border:'0',clipPath:'inset(50%)'});
 function people(){return [...list.children].map(row=>({name:row.querySelector('input').value,role:row.querySelector('select').value}));}
 function validity(){input.setCustomValidity(parseParticipants(input.value).valid?'':'Выберите «Нет» или укажите ФИО и роль каждого участника.');}
 function commit(){editing=true;input.value=formatParticipants(choice.value,people());validity();input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));editing=false;}
 function addPerson(person={name:'',role:''}){
  const row=document.createElement('div');row.className='person';
  const nameLabel=document.createElement('label');nameLabel.textContent='ФИО';const name=document.createElement('input');name.maxLength=200;name.value=person.name;name.autocomplete='off';nameLabel.append(name);
  const roleLabel=document.createElement('label');roleLabel.textContent='Роль';const role=document.createElement('select');role.add(new Option('Выберите роль',''));participantRoles.forEach(v=>role.add(new Option(v,v)));role.value=person.role;roleLabel.append(role);
  const remove=document.createElement('button');remove.type='button';remove.textContent='Убрать';remove.setAttribute('aria-label','Убрать участника');remove.onclick=()=>{row.remove();if(!list.children.length)addPerson();commit();list.querySelector('input').focus();};
  name.addEventListener('input',commit);role.addEventListener('change',commit);row.append(nameLabel,roleLabel,remove);list.append(row);return name;
 }
 function sync(){if(editing)return;const parsed=parseParticipants(input.value);choice.value=parsed.choice;list.replaceChildren();parsed.people.forEach(addPerson);if(parsed.choice==='some'&&!list.children.length)addPerson();legacy.hidden=!parsed.legacy;legacy.textContent=parsed.legacy?'Прежний ответ: '+parsed.legacy+'\nВыберите ответ и роли участников.':'';list.hidden=add.hidden=choice.value!=='some';input.disabled=false;validity();}
 choice.addEventListener('change',()=>{list.hidden=add.hidden=choice.value!=='some';legacy.hidden=true;if(choice.value==='some'&&!list.children.length)addPerson();commit();});
 add.onclick=()=>{if(list.children.length>=20)return;addPerson().focus();commit();};
 input.addEventListener('change',sync);
 input.addEventListener('focus',()=>{const incomplete=[...list.children].find(row=>!row.querySelector('input').value.trim()||!row.querySelector('select').value);if(choice.value==='some'&&incomplete){const name=incomplete.querySelector('input');(name.value.trim()?incomplete.querySelector('select'):name).focus();}else choice.focus();});
 sync();
}
if(root){const scan=()=>root.querySelectorAll('textarea[id="loanParticipants"],textarea[id^="loanParticipants_r"]').forEach(mount);scan();new MutationObserver(scan).observe(root,{childList:true,subtree:true});}
