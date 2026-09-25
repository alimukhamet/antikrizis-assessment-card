import { readSessionCookie, verifySession } from '../../../lib/worker-session';
import { PEOPLE, Person, plansFor, calculate, commissionForDeals, monthlyEarnings, todayAlmaty, monthRange, Totals, COMPENSATION_START_MONTH, isCommissionExcluded } from '../../../lib/personal-sales';
import {compensationRepository,storedPlan} from '../../../lib/sales-compensation';
import {loadCompensationDeals,type CompensationDeal} from '../../../lib/crm/personal-compensation';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store' };
// Owner-confirmed payment-type rules are applied from live deal and invoice data.
const EARNINGS_BASIS_CONFIRMED = true;
const PAYMENT_LABELS:Record<string,string>={'261':'После определения','263':'До определения','423':'50/50','461':'После решения'};
function commissionBreakdown(deals:CompensationDeal[],rate:number|null){
  return deals.map(deal=>{
    const amount=commissionForDeals([deal],rate),value=deal.contractValue,first=deal.firstPayment;
    let formula='Нет данных для расчёта';
    if(value!==null){
      if(deal.paymentType==='263'&&first!==null)formula=`${first} × 15% + ${value-first} × 4%`;
      else if(deal.paymentType==='461')formula=deal.outcomeId==='311'?`${value} × 8%`:'0';
      else if(rate!==null)formula=`${value} × ${rate}%`;
    }
    return {id:deal.id,title:deal.title,date:deal.paymentType==='263'?deal.commissionDate:deal.handoffDate,paymentType:PAYMENT_LABELS[deal.paymentType]||'Не указан',formula,amount};
  });
}
export async function GET(request: Request) {
  const actor = await verifySession(readSessionCookie(request.headers.get('cookie')), process.env.SITE_SESSION_TOKEN ?? '');
  if (!actor) return Response.json({ error: 'SIGN_IN_REQUIRED' }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const selected = params.get('person');
  if (actor.worker !== 'ali' && selected && selected !== actor.worker) return Response.json({ error: 'Доступны только ваши показатели.' }, { status: 403, headers });
  const person = (actor.worker === 'ali' ? selected || 'darkhan' : actor.worker) as Person;
  if (!Object.hasOwn(PEOPLE, person)) return Response.json({ error: 'Неизвестный сотрудник.' }, { status: 400, headers });
  const today = todayAlmaty(), month = params.get('month') || today.slice(0, 7);
  let range;
  try { range = monthRange(month, today); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400, headers }); }
  try {
    const repository=await compensationRepository();
    const dealStart=params.has('month')?range.start:COMPENSATION_START_MONTH+'-01';
    const [paymentRows,storedRows,deals]=await Promise.all([repository.payments(person),repository.plans(person),loadCompensationDeals(process.env.BITRIX_WEBHOOK??'',PEOPLE[person].id,dealStart,range.end)]);
    const inRange=(from:string,to:string)=>deals.filter(deal=>deal.handoffDate>=from&&deal.handoffDate<=to);
    const commissionInRange=(from:string,to:string)=>deals.filter(deal=>{const date=deal.paymentType==='263'?deal.commissionDate:deal.handoffDate;return date>=from&&date<=to&&!isCommissionExcluded(person,date,deal.title)});
    const totals=(items:CompensationDeal[]):Totals=>({count:items.length,volume:items.reduce((sum,item)=>sum+(item.contractValue??0),0),missing:items.filter(item=>item.contractValue===null).length});
    const allPlans=[...plansFor(person),...storedRows.map(storedPlan)];
    const plans = allPlans.filter(p => (!params.has('month') || p.end.slice(0, 7) === month) && p.start <= today);
    const monthly=totals(inRange(range.start,range.end));
    const periods=plans.map(plan=>{
      const end=plan.end<today?plan.end:today,items=inRange(plan.start,end),commissionItems=commissionInRange(plan.start,end),values=totals(items),base=calculate(plan,values),commission=commissionForDeals(commissionItems,base.rate);
      return {...plan,...values,...calculate(plan,values,commission),commissionDeals:commissionBreakdown(commissionItems,base.rate),ongoing:plan.end>=today};
    });
    const coveredDays = new Set(periods.flatMap(p => {
      const days = []; for (let d = p.start; d <= (p.end < today ? p.end : today);) { days.push(d); const date = new Date(d + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1); d = date.toISOString().slice(0, 10); } return days;
    }));
    const uncovered = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1 - [...coveredDays].filter(day => day >= range.start && day <= range.end).length;
    const visiblePeriods = periods.map(p => ({ ...p, earned: EARNINGS_BASIS_CONFIRMED ? p.earned : null, commission: EARNINGS_BASIS_CONFIRMED ? p.commission : null }));
    const byMonth = new Map<string, typeof visiblePeriods>();
    for (const period of visiblePeriods) {
      const key = period.start.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) || []), period]);
    }
    const monthKeys:string[]=[];
    if(params.has('month'))monthKeys.push(month);else for(let key=COMPENSATION_START_MONTH;key<=today.slice(0,7);){monthKeys.push(key);const [year,value]=key.split('-').map(Number),next=new Date(Date.UTC(year,value,1));key=next.toISOString().slice(0,7);}
    const paymentEvidence=paymentRows.length>0;
    let unappliedPayments=paymentRows.reduce((sum,row)=>sum+row.amount,0);
    const earningsMonths = monthKeys.map(key => {
      const monthEnd=monthRange(key,today).end,periodsForMonth=byMonth.get(key)||[];
      const outsidePeriods=deals.filter(deal=>deal.paymentType==='263'&&deal.commissionDate>=key+'-01'&&deal.commissionDate<=monthEnd&&!periodsForMonth.some(period=>deal.commissionDate>=period.start&&deal.commissionDate<=(period.end<today?period.end:today)));
      const extraCommission=outsidePeriods.length?commissionForDeals(outsidePeriods,null):0;
      const item=monthlyEarnings(key,periodsForMonth,today,extraCommission,person),rows=paymentRows.filter(row=>row.month===key);
      const paid=params.has('month')?(rows.length?rows.reduce((sum,row)=>sum+row.amount,0):null):!paymentEvidence||item.earned===null?null:Math.min(Math.max(item.earned,0),unappliedPayments);
      if(!params.has('month')&&paid!==null)unappliedPayments-=paid;
      const commissionDeals=[...periodsForMonth.flatMap(period=>period.commissionDeals),...commissionBreakdown(outsidePeriods,null)].sort((a,b)=>a.date.localeCompare(b.date)||Number(a.id)-Number(b.id));
      return {...item,commissionDeals,ongoing:key===today.slice(0,7),paid,owed:item.earned===null||paid===null?null:item.earned-paid};
    });
    const earned = !EARNINGS_BASIS_CONFIRMED || !earningsMonths.length || earningsMonths.some(item => item.earned === null) ? null : earningsMonths.reduce((sum, item) => sum + item.earned!, 0);
    const paid=params.has('month')?(earningsMonths.some(item=>item.paid===null)?null:earningsMonths.reduce((sum,item)=>sum+item.paid!,0)):(paymentEvidence?paymentRows.reduce((sum,row)=>sum+row.amount,0):null),owed=earned===null||paid===null?null:earned-paid;
    return Response.json({ person, name: PEOPLE[person].name, canChoosePerson: actor.worker === 'ali', month, today, generatedAt: new Date().toISOString(), monthly, periods: visiblePeriods, futurePlans: allPlans.filter(p=>p.start>today), earningsMonths, payments: paymentRows, earned, paid, owed, uncoveredDays: uncovered, earningsBasisConfirmed: EARNINGS_BASIS_CONFIRMED }, { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Не удалось загрузить показатели.' }, { status: 502, headers });
  }
}
