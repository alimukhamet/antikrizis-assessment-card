/** Period rules copied from the sales dashboard's 2026-09-10 confirmed rules. */
export const PEOPLE = { darkhan: { id: '7609', name: 'Дархан' }, ramazan: { id: '2093', name: 'Рамазан' }, nurdaulet: { id: '4351', name: 'Нурдаулет' } } as const;
export type Person = keyof typeof PEOPLE;
export type Plan = { id: string; start: string; end: string; target: number | null; metric: 'count' | 'volume'; tiers: [number, number][]; bonus?: number; leaderBonus?: number; note?: string };
export const MONTHLY_BASE_SALARY = 100000;
export const MONTHLY_CONTRACT_BONUS = 200000;
export const MONTHLY_CONTRACT_BONUS_AT = 19;
export const CONTRACT_BONUS_MONTH = '2026-06';
export const COMPENSATION_START_MONTH = '2026-06';
const COMMISSION_EXCLUSIONS=new Set([
  'ramazan|2026-06|НАЛЬТАЕВ РАШИД СЕЙТБЕКОВИЧ ВП',
]);
export function isCommissionExcluded(person:Person,date:string,title:string){
  const normalized=title.trim().replace(/\s+/g,' ').toLocaleUpperCase('ru-RU');
  return COMMISSION_EXCLUSIONS.has(`${person}|${date.slice(0,7)}|${normalized}`);
}
export function plansFor(person: Person): Plan[] {
  const p = (id: string, start: string, end: string, target: number | null, metric: Plan['metric'], tiers: Plan['tiers'], extra: Partial<Plan> = {}): Plan => ({ id, start: '2026-' + start, end: '2026-' + end, target, metric, tiers, ...extra });
  const base=(rate:number)=>person==='darkhan'?2:rate;
  const target=(at:number,rate:number):[number,number][]=>[[0,base(rate)],[at,2.3]];
  return [
    p('june', '06-15', '06-30', 19, 'count', target(19,2)),
    p('july-1', '07-01', '07-05', null, 'volume', [[0,base(2)]]),
    p('july-6', '07-06', '07-19', 15, 'count', target(15,person==='ramazan'?1.3:1.6)),
    p('july-20', '07-20', '07-26', null, 'volume', [[0,base(2)]]),
    p('july-27', '07-27', '07-31', null, 'volume', [[0,base(1.6)]], { note: person==='darkhan'?'Ставка новичка — 2%.':'Исходная цель не восстановлена. Итоговая ставка — 1,6%.' }),
    p('august-1', '08-01', '08-15', 15, 'count', target(15,1.7)),
    p('august-16', '08-16', '08-30', null, 'volume', [[0,base(2)]]),
    p('september', '09-01', '09-30', 10000000, 'volume', target(10000000,1.6), { leaderBonus: 100000 }),
  ];
}
export type Totals = { count: number; volume: number; missing: number };
export type CommissionDeal = { id?:string; contractValue:number|null; paymentType:string; stageId:string; outcomeId:string; firstPayment:number|null; paymentEvidence?:{status:'received'|'not_registered'|'review_required'} };
// Owner correction: original handoff commission remains payable without payment.
// An additional 6% applies retroactively after a registered receipt; retain historical plan rates.
export const FIRST_PAYMENT_CONTRACT_RATE = 6;
export function hasFirstPaymentContractRate(paymentType:string){return paymentType==='261'||paymentType==='423';}
const AFTER_DECISION_PAYABLE_STAGES=new Set(['C1:UC_R0NPNE','C1:UC_P1YJHC','C1:WON']);
export function commissionParts(deal:CommissionDeal,standardRate:number|null=2){
  const value=deal.contractValue;
  const standard=hasFirstPaymentContractRate(deal.paymentType)?(value===null||standardRate===null?null:value*standardRate/100):0;
  const receipt=hasFirstPaymentContractRate(deal.paymentType)?(value===null||deal.paymentEvidence?.status==='review_required'?null:deal.firstPayment!==null&&deal.firstPayment>0?value*FIRST_PAYMENT_CONTRACT_RATE/100:0):0;
  let other:number|null=0;
  if(!hasFirstPaymentContractRate(deal.paymentType)){
    if(value===null)other=null;
    else if(deal.paymentType==='263')other=deal.firstPayment===null||deal.firstPayment>value?null:deal.firstPayment*.15+(value-deal.firstPayment)*.04;
    else if(deal.paymentType==='461')other=deal.outcomeId==='311'&&AFTER_DECISION_PAYABLE_STAGES.has(deal.stageId)?value*.08:0;
    else other=null;
  }
  return {standard,receipt,other};
}
export function allocateCommissionForDeals(deals:CommissionDeal[],standardRate:number|null=2){
  const parts=deals.map(deal=>commissionParts(deal,standardRate));
  type Part=keyof typeof parts[number];
  const allocate=(keys:Part[])=>{
    const entries=parts.flatMap((part,index)=>keys.map(key=>({index,key,amount:part[key]})));
    const known=entries.filter((entry):entry is typeof entry&{amount:number}=>entry.amount!==null);
    const total=Math.round(known.reduce((sum,entry)=>sum+entry.amount,0));
    let remainder=total-known.reduce((sum,entry)=>sum+Math.floor(entry.amount),0);
    // Preserve the rounded period total, assigning its fractional remainders
    // to lines deterministically. IDs break ties independently of CRM row order.
    known.sort((a,b)=>(b.amount-Math.floor(b.amount))-(a.amount-Math.floor(a.amount))||
      (deals[a.index].id&&deals[b.index].id?deals[a.index].id!.localeCompare(deals[b.index].id!,'en',{numeric:true}):a.index-b.index)||a.key.localeCompare(b.key));
    for(const entry of known){
      const extra=remainder>0?1:0;
      parts[entry.index][entry.key]=Math.floor(entry.amount)+extra;
      remainder-=extra;
    }
    return known.length===entries.length?total:null;
  };
  // The original commission keeps its historical period rounding. The new
  // receipt commission is added afterwards and cannot alter that old total.
  const legacy=allocate(['standard','other']),receipt=allocate(['receipt']);
  const total=legacy===null||receipt===null?null:legacy+receipt;
  const amounts=parts.map(part=>Object.values(part).some(value=>value===null)?null:part.standard!+part.receipt!+part.other!);
  return {parts,amounts,legacy,receipt,total};
}
export function commissionForDeals(deals:CommissionDeal[],standardRate:number|null=2){
  return allocateCommissionForDeals(deals,standardRate).total;
}
export function calculate(plan: Plan, totals: Totals, commissionOverride?:number|null) {
  const value = plan.metric === 'count' ? totals.count : totals.volume;
  const rate = [...plan.tiers].reverse().find(([at]) => value >= at)?.[1] ?? null;
  const incomplete = totals.missing > 0;
  const commission = commissionOverride===undefined?(incomplete || rate === null ? null : Math.round(totals.volume * rate) / 100):commissionOverride;
  const bonus = plan.bonus ? (value >= (plan.target ?? Infinity) ? plan.bonus : 0) : 0;
  return { rate: incomplete && plan.metric === 'volume' ? null : rate, commission, bonus, earned: commission === null ? null : commission + bonus,
    progress: plan.target === null || (incomplete && plan.metric === 'volume') ? null : value / plan.target * 100,
    remaining: plan.target === null || (incomplete && plan.metric === 'volume') ? null : Math.max(0, plan.target - value) };
}
export type CalculatedPeriod = Plan & Totals & ReturnType<typeof calculate> & { ongoing: boolean };
export type MonthlyEarnings = Totals & {
  id: string;
  baseSalary: number;
  contractBonus: number;
  leaderBonus: number | null;
  performanceCommission: number | null;
  commission: number | null;
  earned: number | null;
  ongoing: boolean;
  periods: CalculatedPeriod[];
};
export function monthlyEarnings(month: string, periods: CalculatedPeriod[], today: string, additionalCommission:number|null=0, person?:Person, awardedLeaderBonus:number|null=0): MonthlyEarnings {
  const count = periods.reduce((sum, period) => sum + period.count, 0);
  const volume = periods.reduce((sum, period) => sum + period.volume, 0);
  const missing = periods.reduce((sum, period) => sum + period.missing, 0);
  const calculatedCommission = additionalCommission===null||periods.some(period => period.commission === null)
    ? null
    : periods.reduce((sum, period) => sum + period.commission!, additionalCommission);
  const [year, number] = month.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const monthEnded=today>=monthEnd;
  const commission=monthEnded?calculatedCommission:0;
  const baseSalary = month >= COMPENSATION_START_MONTH && monthEnded && !(person==='darkhan'&&month==='2026-06') ? MONTHLY_BASE_SALARY : 0;
  const contractBonus = month === CONTRACT_BONUS_MONTH && count >= MONTHLY_CONTRACT_BONUS_AT ? MONTHLY_CONTRACT_BONUS : 0;
  const leaderBonus=monthEnded?awardedLeaderBonus:0;
  return {
    id: month,
    count,
    volume,
    missing,
    baseSalary,
    contractBonus,
    leaderBonus,
    performanceCommission: calculatedCommission,
    commission,
    earned: commission === null || leaderBonus === null ? null : baseSalary + commission + contractBonus + leaderBonus,
    ongoing: periods.some(period => period.ongoing),
    periods,
  };
}
export function todayAlmaty() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function monthRange(month: string, today: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2020-01' || month > today.slice(0, 7)) throw new Error('Выберите месяц с января 2020 до текущего месяца.');
  const [year, number] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return { start: month + '-01', end: end < today ? end : today };
}
