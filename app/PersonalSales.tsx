'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Plan, Totals, calculate } from '../lib/personal-sales';
type Period = Plan & Totals & ReturnType<typeof calculate> & { ongoing: boolean };
type Report = { person: string; canChoosePerson: boolean; name: string; periods: Period[]; noPlan?: boolean; generatedAt: string };
const number = (n: number) => new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(n);
const money = (n: number | null) => n === null ? 'Не рассчитано' : number(n) + ' ₸';
const date = (s: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(s + 'T12:00:00+05:00'));
const range = (p: Plan) => date(p.start) + ' — ' + date(p.end);
const outcome = (p: Period) => p.target === null ? (p.note ? 'Цель неизвестна' : 'Без плана') : p.progress === null ? 'Неполные данные' : p.progress >= 100 ? 'Выполнен' : p.ongoing ? 'В работе' : 'Не выполнен';
export default function PersonalSales({ mode }: { mode: 'results' | 'earnings' }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [person, setPerson] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeMode, setActiveMode] = useState(mode);
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
  const current = periods.find(p => p.ongoing);
  const history = periods.filter(p => !p.ongoing);
  function result(p: Period) { return p.metric === 'count' ? number(p.count) + ' / ' + number(p.target!) + ' договоров' : money(p.volume) + ' / ' + money(p.target); }
  function details(p: Period) { return <details className="ps-details"><summary>Подробнее</summary><div><p>{p.count} договоров на {money(p.volume)}</p><p>Ставка: {p.rate === null ? 'не рассчитана' : p.rate + '%'} · Комиссия: {money(p.commission)}</p>{(p.bonus ?? 0) > 0 && <p>Бонус за план: {money(p.bonus ?? 0)}</p>}{p.leaderBonus && <p>Бонус лидеру {money(p.leaderBonus)} пока не включён.</p>}{p.note && <p>{p.note}</p>}{p.missing > 0 && <p>Не указана сумма у {p.missing} договоров. Расчёт неполный.</p>}</div></details>; }
  return <main className="personal-page"><div className="ps-wrap">
    <Link className="ps-back" href="/">← Назад</Link>
    <header className="ps-header"><div><h1>{report?.canChoosePerson ? 'Отдел продаж' : earnings ? 'Мой заработок' : 'Мои результаты'}</h1><p>{report?.canChoosePerson ? <>Ali <span className="rop-role">РОП</span></> : report?.name || 'Ваши показатели'}</p></div></header>
    <nav className="rop-nav" aria-label="Показатели"><button aria-pressed={!earnings} onClick={() => setActiveMode('results')}>Результаты</button><button aria-pressed={earnings} onClick={() => setActiveMode('earnings')}>Заработок</button></nav>
    {report?.canChoosePerson && <div className="rop-people" aria-label="Сотрудник">{Object.entries({darkhan:'Дархан',ramazan:'Рамазан',nurdaulet:'Нурдаулет'}).map(([id,name]) => <button key={id} aria-pressed={(person || report.person) === id} onClick={() => { if ((person || report.person) !== id) { setBusy(true); setError(''); setPerson(id); } }}>{name}</button>)}</div>}
    <section aria-live="polite">
      {error ? <div className="ps-empty" role="alert"><p>{error}</p><button onClick={() => { setError(''); setRetry(retry + 1); }}>Повторить</button></div> : !report || busy ? <p className="ps-empty" role="status">Загружаем вашу историю…</p> : report.noPlan ? <div className="ps-empty"><h2>Для вашего профиля план продаж не задан</h2><p>Вы вошли как {report.name}. Здесь показываются только личные результаты.</p></div> : <>
        {report.canChoosePerson && <h2 className="rop-selected">{report.name}</h2>}
        {current && <article className="ps-current"><div className="ps-period"><h2>{range(current)}</h2><span>Текущий период</span></div>
          {earnings ? <><div className="ps-amount">{money(current.earned)}</div><p className="ps-sub">Начислено на сегодня · ставка {current.rate === null ? 'не рассчитана' : current.rate + '%'}</p>{details(current)}<div className="rop-payments"><div>Выплачено<strong>Не подтверждено</strong></div><div>Остаток<strong>Не рассчитан</strong></div></div></> : <><div className="ps-result"><strong>{current.metric === 'count' ? number(current.count) : money(current.volume)}</strong><span>из {current.metric === 'count' ? number(current.target!) + ' договоров' : money(current.target)}</span><b>{current.progress === null ? '—' : Math.round(current.progress) + '%'}</b></div>{current.progress !== null && <progress max={100} value={Math.min(100,current.progress)} aria-label="Выполнение текущего плана" />}<p className="ps-sub">{current.remaining === 0 ? 'План выполнен' : current.remaining === null ? 'Не хватает данных для расчёта' : 'Осталось ' + (current.metric === 'count' ? number(current.remaining) + ' договоров' : money(current.remaining))}{current.metric === 'volume' ? ' · ' + current.count + ' договоров' : ''}</p></>}
        </article>}
        <div className="ps-history-heading"><h2>{earnings ? 'История заработка' : 'История планов'}</h2><span>2026</span></div>
        {!history.length ? <p className="ps-empty">Завершённых периодов пока нет.</p> : <div className="ps-history">{history.map(p => <article className="ps-row" key={p.id}><div className="ps-row-top"><h3>{range(p)}</h3><span className={p.progress !== null && p.progress >= 100 ? 'ps-done' : 'ps-status'}>{earnings ? money(p.earned) : outcome(p)}</span></div>{earnings ? <><p className="ps-row-sub">Ставка {p.rate === null ? 'не рассчитана' : p.rate + '%'} · {p.count} договоров</p>{details(p)}</> : <><div className="ps-row-result"><span>{p.target === null ? p.count + ' договоров · ' + money(p.volume) : result(p)}</span>{p.progress !== null && <strong>{Math.round(p.progress)}%</strong>}</div>{p.progress !== null && <progress max={100} value={Math.min(100,p.progress)} aria-label={'Выполнение плана ' + range(p)} />}{p.note && <p className="ps-row-sub">{p.note}</p>}{p.missing > 0 && <p className="ps-row-sub">Суммы указаны не у всех договоров.</p>}</>}</article>)}</div>}
        <details className="ps-source"><summary>{earnings ? 'Что учтено в заработке' : 'Как считаются результаты'}</summary><p>Полная сумма договоров по дате передачи юристам, по текущему ответственному в Bitrix. Переназначение сделки может изменить историю.</p>{earnings && <p>Показаны начисления, а не полученные выплаты. Подтверждённых выплат пока нет. Для 1–14 июня и 31 августа условия не указаны; эти дни не включены. Текущий период ещё идёт, его ставка и начисление могут измениться.</p>}<p>Обновлено {new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Almaty',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(report.generatedAt))}</p></details>
      </>}
    </section>
  </div></main>;
}
