'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Plan, Totals, calculate, MonthlyEarnings } from '../lib/personal-sales';
type Period = Plan & Totals & ReturnType<typeof calculate> & { ongoing: boolean };
type EarningsMonth = Omit<MonthlyEarnings, 'periods'> & { periods: Period[]; paid: number | null; owed: number | null };
type Payment = { id: string; month: string; amount: number; paidAt: string; note: string };
type FuturePlan = Plan;
type Report = { person: string; canChoosePerson: boolean; name: string; periods: Period[]; futurePlans: FuturePlan[]; earningsMonths: EarningsMonth[]; payments: Payment[]; earned: number | null; paid: number | null; owed: number | null; today: string; noPlan?: boolean; generatedAt: string };
const number = (n: number) => new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(n);
const money = (n: number | null) => n === null ? 'Не рассчитано' : number(n) + ' ₸';
const paidMoney = (n: number | null) => n === null ? 'Не подтверждено' : money(n);
const date = (s: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(s + 'T12:00:00+05:00'));
const range = (p: Plan) => date(p.start) + ' — ' + date(p.end);
const nextDay = (day:string) => { const value=new Date(day+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+1);return value.toISOString().slice(0,10); };
const monthName = (s: string) => {
  const value = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(s + '-15T12:00:00+05:00'));
  return value.charAt(0).toUpperCase() + value.slice(1);
};
const outcome = (p: Period) => p.target === null ? (p.note ? 'Цель неизвестна' : 'Без плана') : p.progress === null ? 'Неполные данные' : p.progress >= 100 ? 'Выполнен' : p.ongoing ? 'В работе' : 'Не выполнен';
export default function PersonalSales({ mode }: { mode: 'results' | 'earnings' }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeMode, setActiveMode] = useState(mode);
  const [panel, setPanel] = useState<'payment'|'plan'|''>('');
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState('');
  const earnings = activeMode === 'earnings';
  useEffect(() => {
    const controller = new AbortController();
    const timer=setTimeout(()=>{controller.abort();setError('Сервер не ответил вовремя. Повторите загрузку.');setBusy(false);},30000);
    fetch('/api/personal-sales' + (person ? '?person=' + encodeURIComponent(person) : ''), { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if(controller.signal.aborted)return;
      if (response.status === 401) {
        // Drop the previous employee's in-memory report before reauthentication.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/login?returnTo=' + encodeURIComponent(window.location.pathname)); return;
      }
      const data = await response.json() as Report & { error?: string };
      if (!response.ok) throw Error(data.error || 'Не удалось загрузить результаты.');
      if (!controller.signal.aborted) { setReport(data); setError(''); setBusy(false); }
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setBusy(false); } }).finally(()=>clearTimeout(timer));
    return () => {clearTimeout(timer);controller.abort();};
  }, [retry, person]);
  const periods = [...(report?.periods || [])].sort((a, b) => b.end.localeCompare(a.end));
  const earningsMonths = [...(report?.earningsMonths || [])].sort((a, b) => b.id.localeCompare(a.id));
  const current = earnings ? earningsMonths.find(p => p.ongoing) : periods.find(p => p.ongoing);
  const history = earnings ? earningsMonths.filter(p => !p.ongoing) : periods.filter(p => !p.ongoing);
  const selectedPerson=person||report?.person||'';
  const openPanel=(kind:'payment'|'plan')=>{setPanel(kind);setActionError('');setRequestId(crypto.randomUUID());};
  async function saveCompensation(event:FormEvent<HTMLFormElement>,kind:'payment'|'plan'){
    event.preventDefault();if(!report||!selectedPerson||saving)return;
    const data=new FormData(event.currentTarget),value=(key:string)=>String(data.get(key)||''),numeric=(key:string)=>Number(value(key));
    const body=kind==='payment'?{kind,requestId,person:selectedPerson,month:value('month'),amount:numeric('amount'),paidAt:value('paidAt'),note:value('note')}:
      {kind,requestId,person:selectedPerson,start:value('start'),end:value('end'),metric:value('metric'),target:numeric('target'),baseRate:numeric('baseRate'),targetRate:numeric('targetRate')};
    setSaving(true);setActionError('');
    try{const response=await fetch('/api/sales-compensation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error==='PLAN_OVERLAPS_EXISTING'?'Период уже занят.':result.error||'Не удалось сохранить.');setPanel('');setRetry(value=>value+1);}catch(error){setActionError(error instanceof Error?error.message:'Не удалось сохранить.');}finally{setSaving(false);}
  }
  function result(p: Period) { return p.metric === 'count' ? number(p.count) + ' / ' + number(p.target!) + ' договоров' : money(p.volume) + ' / ' + money(p.target); }
  function earningsDetails(p: EarningsMonth,settlement=true) {
    const included = [p.baseSalary ? 'Оклад ' + money(p.baseSalary) : '', p.contractBonus ? 'Бонус ' + money(p.contractBonus) : ''].filter(Boolean);
    const rates = [...new Set(p.periods.map(period => period.rate).filter(rate => rate !== null))];
    return <details className="ps-details"><summary>Подробнее</summary><div>{included.length > 0 && <p>{included.join(' + ')}</p>}<p>{p.count} договоров · {money(p.volume)}{rates.length > 0 && ' · ' + rates.join(' / ') + '%'}</p>{settlement&&<p>Выплачено {paidMoney(p.paid)} · Остаток {money(p.owed)}</p>}{p.missing > 0 && <p>Неполные суммы: {p.missing}</p>}</div></details>;
  }
  return <main className="personal-page"><div className="ps-wrap">
    <Link className="ps-back" href="/">← Назад</Link>
    <header className="ps-header"><div><h1>{report?.canChoosePerson ? 'Отдел продаж' : earnings ? 'Мой заработок' : 'Мои результаты'}</h1><p>{report?.canChoosePerson ? <>Ali <span className="rop-role">РОП</span></> : report?.name || 'Ваши показатели'}</p></div></header>
    <nav className="rop-nav" aria-label="Показатели"><button aria-pressed={!earnings} onClick={() => {setActiveMode('results');setPanel('');}}>Результаты</button><button aria-pressed={earnings} onClick={() => {setActiveMode('earnings');setPanel('');}}>Заработок</button></nav>
    {report?.canChoosePerson && <div className="rop-people" aria-label="Сотрудник">{Object.entries({darkhan:'Дархан',ramazan:'Рамазан',nurdaulet:'Нурдаулет'}).map(([id,name]) => <button key={id} aria-pressed={(person || report.person) === id} onClick={() => { if ((person || report.person) !== id) { setBusy(true); setError(''); setPerson(id); } }}>{name}</button>)}</div>}
    <section aria-live="polite">
      {error ? <div className="ps-empty" role="alert"><p>{error}</p><button onClick={() => { setError(''); setRetry(retry + 1); }}>Повторить</button></div> : !report || busy ? <p className="ps-empty" role="status">Загружаем вашу историю…</p> : report.noPlan ? <div className="ps-empty"><h2>Для вашего профиля план продаж не задан</h2><p>Вы вошли как {report.name}. Здесь показываются только личные результаты.</p></div> : <>
        {report.canChoosePerson && <div className="rop-selected-row"><h2 className="rop-selected">{report.name}</h2><button className="ps-action" onClick={()=>openPanel(earnings?'payment':'plan')}>{earnings?'+ Выплата':'+ План'}</button></div>}
        {panel==='payment'&&<form className="ps-entry" onSubmit={event=>saveCompensation(event,'payment')}><h3>Выплата · {report.name}</h3><div className="ps-entry-grid"><label>Месяц<input name="month" type="month" min="2026-06" max={report.today.slice(0,7)} defaultValue={report.today.slice(0,7)} required/></label><label>Сумма<input name="amount" type="number" min="0" max="100000000" step="1" inputMode="numeric" required/></label><label>Дата<input name="paidAt" type="date" max={report.today} defaultValue={report.today} required/></label><label>Заметка<input name="note" maxLength={200}/></label></div><div className="ps-entry-actions"><button type="button" onClick={()=>setPanel('')}>Отмена</button><button disabled={saving}>{saving?'Сохраняем…':'Сохранить'}</button></div>{actionError&&<p role="alert">{actionError}</p>}</form>}
        {panel==='plan'&&<form className="ps-entry" onSubmit={event=>saveCompensation(event,'plan')}><h3>Новый план · {report.name}</h3><div className="ps-entry-grid"><label>Начало<input name="start" type="date" min={nextDay(report.today)} required/></label><label>Конец<input name="end" type="date" min={nextDay(report.today)} required/></label><label>Цель<select name="metric"><option value="volume">Сумма</option><option value="count">Договоры</option></select></label><label>Значение<input name="target" type="number" min="1" max="1000000000" step="1" required/></label><label>Ставка, %<input name="baseRate" type="number" min="0" max="100" step="0.01" required/></label><label>При цели, %<input name="targetRate" type="number" min="0" max="100" step="0.01" required/></label></div><div className="ps-entry-actions"><button type="button" onClick={()=>setPanel('')}>Отмена</button><button disabled={saving}>{saving?'Сохраняем…':'Сохранить'}</button></div>{actionError&&<p role="alert">{actionError}</p>}</form>}
        {earnings&&<div className="ps-overall"><div>Начислено<strong>{money(report.earned)}</strong></div><div>Выплачено<strong>{paidMoney(report.paid)}</strong></div><div>Остаток<strong>{money(report.owed)}</strong></div></div>}
        {!earnings&&report.futurePlans.length>0&&<div className="ps-future"><h3>Будущие планы</h3>{report.futurePlans.map(plan=><p key={plan.id}><strong>{range(plan)}</strong><span>{plan.metric==='count'?number(plan.target!)+' договоров':money(plan.target)}</span></p>)}</div>}
        {current && <article className="ps-current"><div className="ps-period"><h2>{earnings ? monthName(current.id) : range(current)}</h2><span>Текущий период</span></div>
          {earnings ? <><div className="ps-amount">{money(current.earned)}</div><p className="ps-sub">{current.baseSalary?'За месяц':'Комиссия'}</p>{earningsDetails(current as EarningsMonth,false)}<div className="rop-payments"><div>Выплачено<strong>{paidMoney(current.paid)}</strong></div><div>Остаток<strong>{money(current.owed)}</strong></div></div></> : <><div className="ps-result"><strong>{current.metric === 'count' ? number(current.count) : money(current.volume)}</strong><span>из {current.metric === 'count' ? number(current.target!) + ' договоров' : money(current.target)}</span><b>{current.progress === null ? '—' : Math.round(current.progress) + '%'}</b></div>{current.progress !== null && <progress max={100} value={Math.min(100,current.progress)} aria-label="Выполнение текущего плана" />}<p className="ps-sub">{current.remaining === 0 ? 'План выполнен' : current.remaining === null ? 'Не хватает данных для расчёта' : 'Осталось ' + (current.metric === 'count' ? number(current.remaining) + ' договоров' : money(current.remaining))}{current.metric === 'volume' ? ' · ' + current.count + ' договоров' : ''}</p></>}
        </article>}
        <div className="ps-history-heading"><h2>{earnings ? 'История заработка' : 'История планов'}</h2><span>2026</span></div>
        {!history.length ? <p className="ps-empty">Завершённых периодов пока нет.</p> : <div className="ps-history">{history.map(p => <article className="ps-row" key={p.id}><div className="ps-row-top"><h3>{earnings ? monthName(p.id) : range(p)}</h3><span className={!earnings && p.progress !== null && p.progress >= 100 ? 'ps-done' : 'ps-status'}>{earnings ? money(p.earned) : outcome(p as Period)}</span></div>{earnings ? <><p className="ps-row-sub">{p.count} договоров</p>{earningsDetails(p as EarningsMonth)}</> : <><div className="ps-row-result"><span>{p.target === null ? p.count + ' договоров · ' + money(p.volume) : result(p as Period)}</span>{p.progress !== null && <strong>{Math.round(p.progress)}%</strong>}</div>{p.progress !== null && <progress max={100} value={Math.min(100,p.progress)} aria-label={'Выполнение плана ' + range(p as Period)} />}{p.note && <p className="ps-row-sub">{p.note}</p>}{p.missing > 0 && <p className="ps-row-sub">Суммы указаны не у всех договоров.</p>}</>}</article>)}</div>}
        <details className="ps-source"><summary>Источник</summary><p>Договоры по передаче юристам · обновлено {new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Almaty',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(report.generatedAt))}</p></details>
      </>}
    </section>
  </div></main>;
}
