/** Period rules copied from the sales dashboard's 2026-09-10 confirmed rules. */
export const PEOPLE = { darkhan: { id: '7609', name: 'Дархан' }, ramazan: { id: '2093', name: 'Рамазан' }, nurdaulet: { id: '4351', name: 'Нурдаулет' } } as const;
export type Person = keyof typeof PEOPLE;
export type Plan = { id: string; start: string; end: string; target: number | null; metric: 'count' | 'volume'; tiers: [number, number][]; bonus?: number; leaderBonus?: number; note?: string };
export function plansFor(person: Person): Plan[] {
  const p = (id: string, start: string, end: string, target: number | null, metric: Plan['metric'], tiers: Plan['tiers'], extra: Partial<Plan> = {}): Plan => ({ id, start: '2026-' + start, end: '2026-' + end, target, metric, tiers, ...extra });
  return [
    p('june', '06-15', '06-30', 20, 'count', [[0, 2]], { bonus: 200000 }),
    p('july-1', '07-01', '07-05', null, 'volume', [[0, 2]]),
    p('july-6', '07-06', '07-19', 15, 'count', [[0, person === 'ramazan' ? 1.3 : 1.6], [15, 2]]),
    p('july-20', '07-20', '07-26', null, 'volume', [[0, 2]]),
    p('july-27', '07-27', '07-31', null, 'volume', [[0, 1.6]], { note: 'Исходная цель не восстановлена. Итоговая ставка — 1,6%.' }),
    p('august-1', '08-01', '08-15', 15, 'count', [[0, 1.7], [15, 2]]),
    p('august-16', '08-16', '08-30', null, 'volume', [[0, 2]]),
    p('september', '09-01', '09-30', 11000000, 'volume', [[0, 1.6], [11000000, 2]], { leaderBonus: 100000 }),
  ];
}
export type Totals = { count: number; volume: number; missing: number };
export function calculate(plan: Plan, totals: Totals) {
  const value = plan.metric === 'count' ? totals.count : totals.volume;
  const rate = [...plan.tiers].reverse().find(([at]) => value >= at)?.[1] ?? null;
  const incomplete = totals.missing > 0;
  const commission = incomplete || rate === null ? null : Math.round(totals.volume * rate) / 100;
  const bonus = plan.bonus ? (value >= (plan.target ?? Infinity) ? plan.bonus : 0) : 0;
  return { rate: incomplete && plan.metric === 'volume' ? null : rate, commission, bonus, earned: commission === null ? null : commission + bonus,
    progress: plan.target === null || (incomplete && plan.metric === 'volume') ? null : value / plan.target * 100,
    remaining: plan.target === null || (incomplete && plan.metric === 'volume') ? null : Math.max(0, plan.target - value) };
}
export function todayAlmaty() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function monthRange(month: string, today: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2020-01' || month > today.slice(0, 7)) throw new Error('Выберите месяц с января 2020 до текущего месяца.');
  const [year, number] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return { start: month + '-01', end: end < today ? end : today };
}
