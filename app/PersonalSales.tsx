'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Plan, Totals, calculate } from '../lib/personal-sales';
type Period = Plan & Totals & ReturnType<typeof calculate> & { ongoing: boolean };
type Report = { person: string; name: string; canChoosePerson: boolean; month: string; today: string; generatedAt: string; monthly: Totals; periods: Period[]; earned: number | null; paid: number | null; owed: number | null; uncoveredDays: number; earningsBasisConfirmed: boolean };
const money = (value: number | null) => value === null ? 'Нет данных' : new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(value) + ' ₸';
const date = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(value + 'T12:00:00+05:00'));
const nowMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit' }).format(new Date());
export default function PersonalSales({ mode }: { mode: 'results' | 'earnings' }) {
  const [month, setMonth] = useState(nowMonth);
  const [person, setPerson] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const earnings = mode === 'earnings';
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ month }); if (person) query.set('person', person);
    fetch('/api/personal-sales?' + query, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (response.status === 401) { window.location.assign('/login?returnTo=' + encodeURIComponent(window.location.pathname)); return; }
      const data = await response.json() as Report & { error?: string }; if (!response.ok) throw new Error(data.error || 'Не удалось загрузить показатели.');
      setReport(data); setError('');
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message); setReport(null); } }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [month, person, retry]);
  function chooseMonth(value: string) { if (!value) return; setBusy(true); setError(''); setMonth(value); }
  return <main className="personal-page"><div className="personal-wrap">
    <Link className="personal-back" href="/">← К инструментам продаж</Link>
    <header className="personal-head"><div><div className="personal-brand">Антикризис</div><h1>{earnings ? 'Мой заработок' : 'Мои результаты'}</h1><p>{report?.name || 'Личные показатели'}</p></div><Link className="personal-switch" href={earnings ? '/my-results' : '/my-earnings'}>{earnings ? 'Мои результаты' : 'Мой заработок'} →</Link></header>
    <div className="personal-filters"><label>Месяц<input type="month" value={month} min="2020-01" max={nowMonth()} onChange={e => chooseMonth(e.target.value)} /></label>{report?.canChoosePerson && <label>Сотрудник<select value={person || report.person} onChange={e => { setBusy(true); setError(''); setPerson(e.target.value); }}><option value="darkhan">Дархан</option><option value="ramazan">Рамазан</option><option value="nurdaulet">Нурдаулет</option></select></label>}</div>
    <section aria-live="polite" aria-busy={busy}>
      {busy ? <div className="personal-card personal-empty" role="status">Загружаем показатели…</div> : error ? <div className="personal-card personal-error" role="alert"><p>{error}</p><button onClick={() => { setBusy(true); setRetry(retry + 1); }}>Повторить</button></div> : report && <>
        <div className="personal-stats">{(earnings ? [['Начислено', money(report.earned)], ['Выплачено', money(report.paid)], ['Осталось выплатить', money(report.owed)]] : [['Договоры', String(report.monthly.count)], ['Сумма договоров', money(report.monthly.volume)], ['Средний договор', report.monthly.count - report.monthly.missing > 0 ? money(report.monthly.volume / (report.monthly.count - report.monthly.missing)) : 'Нет данных']]).map(([label, value]) => <div className="personal-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        {!earnings && <p className="personal-note">Сделки, переданные юристам в выбранном месяце. Все виды оплаты. Сумма договоров — не поступления от клиентов.</p>}
        {earnings && <p className="personal-note">{report.earningsBasisConfirmed ? 'Начислено по известным условиям периодов ниже.' : 'База начисления ожидает подтверждения руководителя.'} Выплаты сотрудникам пока не подтверждены, поэтому остаток не рассчитан.</p>}
        {report.monthly.missing > 0 && <p className="personal-warning">У {report.monthly.missing} договоров не указана сумма. Итог по сумме неполный.</p>}
        {earnings && report.uncoveredDays > 0 && <p className="personal-warning">Для {report.uncoveredDays} дн. этого месяца нет подтверждённых условий. {report.earned !== null ? 'Начислено показано только за известные периоды.' : 'Полный заработок за месяц пока неизвестен.'}</p>}
        {report.periods.some(p => p.ongoing) && <p className="personal-note">Текущий период ещё идёт. Результат и ставка могут измениться.</p>}
        <h2>{earnings ? 'Начисления по периодам' : 'Планы и результаты по периодам'}</h2>
        {!report.periods.length && <div className="personal-card personal-empty">Для этого месяца условия плана не указаны.{!earnings && ' Результаты продаж показаны выше.'}</div>}
        <div className="personal-periods">{report.periods.map(p => <article className="personal-card personal-period" key={p.id}>
          <div className="personal-period-head"><h3>{date(p.start)} — {date(p.end)}</h3><span>{p.ongoing ? 'В работе' : 'Период завершён'}</span></div>
          <div className="personal-period-values"><div><span>{earnings ? 'Начислено' : p.metric === 'count' ? 'Договоры' : 'Сумма договоров'}</span><strong>{earnings ? money(p.earned) : p.metric === 'count' ? p.count : money(p.volume)}</strong></div><p>{p.count} договоров · {money(p.volume)}</p></div>
          {p.target !== null ? <><div className="personal-progress-label"><span>План: {p.metric === 'count' ? p.target + ' договоров' : money(p.target)}</span><strong>{p.progress === null ? 'Нет данных' : Math.round(p.progress) + '%'}</strong></div>{p.progress !== null && <progress aria-label={'Выполнение плана ' + date(p.start)} max={100} value={Math.min(100, p.progress)} />}<p className="personal-note">{p.remaining === null ? 'Для расчёта не хватает сумм договоров.' : p.remaining === 0 ? 'План выполнен' : 'До плана: ' + (p.metric === 'count' ? p.remaining + ' договоров' : money(p.remaining))}</p></> : <p className="personal-note">{p.note || 'План на этот период не задан.'}</p>}
          {earnings && <><div className="personal-calculation"><span>Ставка: {p.rate === null ? 'Нет данных' : p.rate + '%'}</span><span>Комиссия: {money(p.commission)}</span>{p.bonus !== undefined && p.bonus > 0 && <span>Бонус: {money(p.bonus)}</span>}</div>{p.leaderBonus && <p className="personal-note">Бонус лидеру {money(p.leaderBonus)} в начисление не включён: победителя подтверждает руководитель.</p>}<details><summary>Условия расчёта</summary><p>{p.tiers.map(([at, rate]) => `${at === 0 ? 'Базовая ставка' : 'От ' + (p.metric === 'count' ? at + ' договоров' : money(at))}: ${rate}%`).join(' · ')}</p>{p.id === 'june' && <p>Бонус 200 000 ₸ при выполнении плана 20 договоров.</p>}</details></>}
        </article>)}</div>
        <footer className="personal-note">По текущему ответственному в Bitrix. После переназначения сделки история может измениться.<br />Обновлено: {new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(report.generatedAt))}</footer>
      </>}
    </section>
  </div></main>;
}
