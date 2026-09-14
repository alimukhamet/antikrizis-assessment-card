/** Shared browser/server schedule rules, preserved from the canonical assessment tool. */
export const PAYMENT_TYPES=Object.freeze({'261':'После определения','263':'До определения','423':'50/50'});
export function createPaymentSchedule(input){
 const raw=String(input.summa??'').replace(/\s/g,'');
 if(!/^\d+$/.test(raw))return null;
 const total=Number(raw),count=Number(input.months),payDay=Number(input.payDay),type=String(input.grafType??'');
 if(!Number.isSafeInteger(total)||total<=0||!Number.isInteger(count)||count<1||count>60||!Number.isInteger(payDay)||payDay<1||payDay>31||!PAYMENT_TYPES[type])return null;
 const dateText=String(input.contractDate??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(dateText))return null;
 const contract=new Date(dateText+'T00:00:00Z');if(!Number.isFinite(contract.getTime())||contract.toISOString().slice(0,10)!==dateText)return null;
 const ordinary=payDay>=contract.getUTCDate()?0:1,offset=ordinary+(type==='261'||type==='423'?2:0);
 const due=(monthOffset)=>{const year=contract.getUTCFullYear(),month=contract.getUTCMonth()+monthOffset;const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();return new Date(Date.UTC(year,month,Math.min(payDay,last))).toISOString().slice(0,10);};
 let base=Math.round(total/count/1000)*1000;if(base<=0||total-base*(count-1)<=0)base=Math.floor(total/count);
 const rows=Array.from({length:count},(_,i)=>({index:i+1,amount:i===count-1?total-base*(count-1):base,date:due(offset+i)}));
 if(rows.some(r=>r.amount<=0))return null;
 return {total,rows,firstPaymentDate:rows[0].date,paymentType:type};
}
export function paymentScheduleText(schedule){return schedule? schedule.rows.map(r=>`${r.index}. ${r.date.slice(8)}.${r.date.slice(5,7)}.${r.date.slice(0,4)} — ${r.amount.toLocaleString('ru-RU')} ₸`).join('\n')+`\nИтого: ${schedule.total.toLocaleString('ru-RU')} ₸`:'';}
