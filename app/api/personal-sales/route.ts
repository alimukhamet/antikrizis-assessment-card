import { GET as salesMetrics } from '../sales-metrics/route';
import { readSessionCookie, verifySession } from '../../../lib/worker-session';
import { PEOPLE, Person, plansFor, calculate, monthlyEarnings, todayAlmaty, monthRange, Totals, COMPENSATION_START_MONTH } from '../../../lib/personal-sales';
import {compensationRepository,storedPlan} from '../../../lib/sales-compensation';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'private, no-store' };
// Confirmed by the owner: full contract value on the date handed to lawyers.
const EARNINGS_BASIS_CONFIRMED = true;
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
  async function totals(from: string, to: string): Promise<Totals> {
    const query = new URLSearchParams({ managerId: PEOPLE[person].id, paymentType: 'all', period: 'custom', from, to });
    const response = await salesMetrics(new Request(new URL('/api/sales-metrics?' + query, request.url), { headers: request.headers }));
    if (!response.ok) throw new Error('Результаты временно недоступны. Попробуйте ещё раз.');
    const data = await response.json() as { handoffs: number; contractTotal: number; missingContractValues: number };
    return { count: data.handoffs, volume: data.contractTotal, missing: data.missingContractValues };
  }
  try {
    const repository=await compensationRepository();
    const [paymentRows,storedRows]=await Promise.all([repository.payments(person),repository.plans(person)]);
    const allPlans=[...plansFor(person),...storedRows.map(storedPlan)];
    const plans = allPlans.filter(p => (!params.has('month') || p.end.slice(0, 7) === month) && p.start <= today);
    const [monthly, periods] = await Promise.all([
      totals(range.start, range.end),
      Promise.all(plans.map(async plan => {
        const end = plan.end < today ? plan.end : today;
        const values = await totals(plan.start, end);
        return { ...plan, ...values, ...calculate(plan, values), ongoing: plan.end >= today };
      })),
    ]);
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
    const earningsMonths = monthKeys.map(key => {
      const item=monthlyEarnings(key,byMonth.get(key)||[],today),rows=paymentRows.filter(row=>row.month===key),paid=rows.length?rows.reduce((sum,row)=>sum+row.amount,0):null;
      return {...item,ongoing:key===today.slice(0,7),paid,owed:item.earned===null||paid===null?null:item.earned-paid};
    });
    const earned = !EARNINGS_BASIS_CONFIRMED || !earningsMonths.length || earningsMonths.some(item => item.earned === null) ? null : earningsMonths.reduce((sum, item) => sum + item.earned!, 0);
    const paid=earningsMonths.some(item=>item.paid===null)?null:earningsMonths.reduce((sum,item)=>sum+item.paid!,0),owed=earned===null||paid===null?null:earned-paid;
    return Response.json({ person, name: PEOPLE[person].name, canChoosePerson: actor.worker === 'ali', month, today, generatedAt: new Date().toISOString(), monthly, periods: visiblePeriods, futurePlans: allPlans.filter(p=>p.start>today), earningsMonths, payments: paymentRows, earned, paid, owed, uncoveredDays: uncovered, earningsBasisConfirmed: EARNINGS_BASIS_CONFIRMED }, { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Не удалось загрузить показатели.' }, { status: 502, headers });
  }
}
