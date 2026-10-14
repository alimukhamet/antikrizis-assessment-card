/** Canonical storage is ISO; a retained month never implies day 01. */
export function loanDatePrecision(value) {
 const text=String(value||''),year=Number(text.slice(0,4));
 if(year<1900||year>2200)return null;
 if(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(text))return 'month';
 if(!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(text))return null;
 const date=new Date(text+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===text?'day':null;
}
export function formatLoanDate(value) {
 const text=String(value||''),precision=loanDatePrecision(text);
 return precision==='day'?text.split('-').reverse().join('.'):precision==='month'?text.slice(5)+'.'+text.slice(0,4)+' (день не указан)':text;
}
/** Prefer precise, separately reviewable facts; keep old month facts in immutable evidence. */
export function loanAutofillFacts(credit) {
 const start=credit.contractStartDate,issuance=credit.disbursementDate;
 const issuanceOnly=Boolean(issuance)||credit.facts.some(f=>f.key==='startedAtMonth'&&/Несиенің\s+нақты\s+берілген\s+күні/u.test(f.source));
 return [...credit.facts.filter(f=>f.key!=='startedAtMonth'||!start&&!issuanceOnly),...(start?[start]:[]),...(issuance?[issuance]:[])];
}
