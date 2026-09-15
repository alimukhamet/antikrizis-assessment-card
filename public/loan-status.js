window.LoanStatus=(()=>{
 const SCHEDULED='Платится по графику',DEFAULTED='В просрочке — требуют полную сумму';
 const base=id=>id.replace(/_r\d+$/,'');
 const control=(row,id)=>[...row.querySelectorAll('input,select,textarea')].find(node=>base(node.id)===id);
 const required=()=>{const mark=document.createElement('span');mark.className='req';mark.textContent='*';return mark;};
 const label=(id,text,isRequired=false)=>{const node=document.createElement('label');node.className='lbl';node.htmlFor=id;node.append(text);if(isRequired)node.append(required());return node;};
 function install(row){
  if(control(row,'loanStatus'))return;
  const creditor=control(row,'n8038')?.closest('.field'),type=control(row,'n8039')?.closest('.field'),debt=control(row,'n8040'),monthly=control(row,'n8041');
  if(!creditor||!type||!debt||!monthly)return;
  const contractField=document.createElement('div');contractField.className='field';const contract=document.createElement('input');contract.id='loanContractId';contract.type='text';contract.dataset.optional='true';contractField.append(label(contract.id,'Номер договора / идентификатор'),contract);creditor.after(contractField);
  const statusField=document.createElement('div');statusField.className='field';const status=document.createElement('select');status.id='loanStatus';status.required=true;for(const [text,value]of[['—',''],[SCHEDULED,SCHEDULED],[DEFAULTED,DEFAULTED]])status.add(new Option(text,value));const hint=document.createElement('div');hint.className='hint';hint.textContent='При просрочке банк требует полную сумму. Ежемесячный платёж указывается только для кредита по графику.';statusField.append(label(status.id,'Статус кредита',true),status,hint);type.after(statusField);
  const debtLabel=debt.closest('.field').querySelector('label.lbl');if(debtLabel?.firstChild)debtLabel.firstChild.textContent='Сумма задолженности к погашению, ₸';
  const monthlyField=monthly.closest('.field');monthlyField.classList.add('loan-scheduled','hidden');const monthlyLabel=monthlyField.querySelector('label.lbl');if(monthlyLabel?.firstChild)monthlyLabel.firstChild.textContent='Ежемесячный платёж по графику, ₸/мес';
 }
 function sync(row){
  install(row);const status=control(row,'loanStatus'),overdue=control(row,'n8042'),monthly=control(row,'n8041');if(!status||!monthly)return;
  if(!status.value&&/^\d+$/.test(overdue?.value||''))status.value=Number(overdue.value)>0?DEFAULTED:SCHEDULED;
  const scheduled=status.value===SCHEDULED,field=monthly.closest('.field');field.classList.toggle('hidden',!scheduled);monthly.required=scheduled;
 }
 function rows(){return [...document.querySelectorAll('#creditors > .repeat-rows > .repeat-item')];}
 const group=document.getElementById('creditors');if(group){const template=group.querySelector('template');if(template)install(template.content.querySelector('.repeat-item'));rows().forEach(sync);}
 for(const event of ['input','change'])document.addEventListener(event,e=>{const row=e.target.closest?.('#creditors .repeat-item');if(row)sync(row);});
 document.addEventListener('click',e=>{if(e.target.closest?.('#creditors .add-row'))queueMicrotask(()=>rows().forEach(sync));});
 return{SCHEDULED,DEFAULTED,sync,rows};
})();
