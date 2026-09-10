import { GET as salesMetrics } from '../sales-metrics/route';
import { readSessionCookie, verifySession } from '../../../lib/worker-session';
import { PEOPLE, Person, plansFor, calculate, todayAlmaty, monthRange, Totals } from '../../../lib/personal-sales';
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
    const plans = plansFor(person).filter(p => (!params.has('month') || p.end.slice(0, 7) === month) && p.start <= today);
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
    const earned = !EARNINGS_BASIS_CONFIRMED || !periods.length || periods.some(p => p.earned === null) ? null : periods.reduce((sum, p) => sum + p.earned!, 0);
    return Response.json({ person, name: PEOPLE[person].name, canChoosePerson: actor.worker === 'ali', month, today, generatedAt: new Date().toISOString(), monthly, periods: periods.map(p => ({ ...p, earned: EARNINGS_BASIS_CONFIRMED ? p.earned : null, commission: EARNINGS_BASIS_CONFIRMED ? p.commission : null })), earned, paid: null, owed: null, uncoveredDays: uncovered, earningsBasisConfirmed: EARNINGS_BASIS_CONFIRMED }, { headers });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Не удалось загрузить показатели.' }, { status: 502, headers });
  }
}
