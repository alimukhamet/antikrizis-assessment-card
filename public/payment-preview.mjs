import {createPaymentSchedule,paymentScheduleText} from './payment-schedule.mjs';
const fields=['summa','months','payDay','grafType','contractDate'];
function render(){const values=Object.fromEntries(fields.map(id=>[id,document.getElementById(id).value]));const schedule=createPaymentSchedule(values),box=document.getElementById('schedule');box.replaceChildren();const title=document.createElement('h4');title.textContent='График платежей';box.append(title);if(!schedule){const note=document.createElement('p');note.className='hint';note.textContent='Укажите целую сумму контракта, 1–60 платежей, дату и вид оплаты.';box.append(note);return;}const text=document.createElement('pre');text.style='white-space:pre-wrap;font:inherit;margin:0';text.textContent=paymentScheduleText(schedule);box.append(text);}
fields.forEach(id=>{const field=document.getElementById(id);field.addEventListener('input',render);field.addEventListener('change',render);});
document.addEventListener('assessment-draft-restored',render);
render();
