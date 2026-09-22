'use client';
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {filterRows, MONTHS, PERIODS, periodFor} from '../../lib/knowledge/model';
import type {KnowledgeData, KnowledgeRow, Period} from '../../lib/knowledge/model';
import './knowledge.css';

const number = (n: number) => n.toLocaleString('ru-RU');
const percentage = (p: Period) => p.rate === null ? '—' : p.rate.toLocaleString('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%';
const quiz = [
  {question: 'Удовлетворено 8, отказано по существу 2, без рассмотрения 5. Какая доля удовлетворений?', answers: ['53,3%', '80%', '100%'], correct: 1, explanation: '8 ÷ (8 + 2) = 80%. Пять записей без рассмотрения не входят в знаменатель.'},
  {question: 'У суда 100% по четырём решениям. Что можно сказать клиенту?', answers: ['Результат практически гарантирован', 'Все 4 записи удовлетворены, но данных мало для вывода о новом деле', 'Этот суд обязательно лучше остальных'], correct: 1, explanation: 'Четыре решения описывают только эту выборку. Процент не учитывает обстоятельства нового клиента.'},
  {question: 'В месяце стоит «—». Что это значит?', answers: ['Все получили отказ', 'В источнике нет датированных решений по существу за этот месяц', 'Суд не работает'], correct: 1, explanation: '«—» означает отсутствие данных для процента. 0,0% означает, что решения есть, но удовлетворений среди них нет.'}
];
function Learning() {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  return <div className="kb-learn">
    <div className="kb-section-title"><span className="kb-eyebrow">3 минуты на основы</span><h2>Как использовать статистику в разговоре</h2><p>Сначала факты клиента, затем контекст судебной практики.</p></div>
    <div className="kb-lessons">
      <article><span className="kb-step">01</span><h3>Найдите нужный суд</h3><p>Откройте регион и найдите суд по названию. Проверьте регион: похожие названия могут встречаться в разных местах.</p><p>Таблица не определяет, в какой суд можно обращаться. Этот вопрос уточняется отдельно с юристом.</p></article>
      <article><span className="kb-step">02</span><h3>Читайте процент вместе с объёмом</h3><p>Доля удовлетворений = удовлетворено, включая частично, ÷ решения по существу. Отказы входят в расчёт; без рассмотрения, возвраты и текущие дела — нет.</p><p>100% по 4 записям и 100% по 100 записям — разные объёмы наблюдений. Порог 30 — только фильтр объёма.</p></article>
      <article><span className="kb-step">03</span><h3>Объясните границы цифры</h3><p>Срез заканчивается 17 сентября 2026. Последний период короче полугодия; месяцы сгруппированы по дате решения, а не подачи.</p><p>Доля в прошлой выборке не является вероятностью успеха конкретного клиента. Нужны его документы и оценка юриста.</p></article>
    </div>
    <section className="kb-example"><h3>Как объяснить клиенту</h3><p>«В нашей выборке по этому суду за указанный период такая доля удовлетворённых заявлений. Это ориентир по прошлым решениям. Ваш результат зависит от обстоятельств и документов — их отдельно проверит юрист».</p><a href="#reference">Найти цифры для своего суда →</a></section>
    <section className="kb-quiz"><div className="kb-section-title"><h2>Проверьте себя</h2><p>Три ситуации из обычной консультации. Ответы остаются только на этой странице.</p></div>
      {quiz.map((q, i) => <fieldset key={q.question}><legend><span>{i + 1} / 3</span>{q.question}</legend><div className="kb-answers">{q.answers.map((answer, a) => <button key={answer} type="button" aria-pressed={answers[i] === a} onClick={() => setAnswers({...answers, [i]: a})}>{answer}</button>)}</div>{answers[i] !== undefined && <p className="kb-feedback" role="status"><strong>{answers[i] === q.correct ? 'Верно. ' : 'Попробуйте ещё. '}</strong>{q.explanation}</p>}</fieldset>)}
      {Object.keys(answers).length === 3 && <p className="kb-quiz-result" role="status">Правильных ответов: {quiz.filter((q, i) => answers[i] === q.correct).length} из 3.</p>}
    </section>
  </div>;
}
function Detail({row, data, period, close}: {row: KnowledgeRow; data: KnowledgeData; period: number; close: () => void}) {
  const [year, setYear] = useState(2026), [copied, setCopied] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {heading.current?.focus();}, [row.id]);
  const current = periodFor(row, period), months = year === 2026 ? row.months2026 : row.months2025;
  const delta = row.delta2026;
  const phrase = current.count ? `По данным нашей выборки: ${row.name}, ${PERIODS[period].toLowerCase()}. Доля удовлетворений, включая частичные: ${percentage(current)} из ${number(current.count)} записей с решениями по существу. Срез на 17.09.2026. Это статистика прошлых решений, а не прогноз по вашему делу; необходима отдельная оценка документов юристом.` : `По ${row.name} за период «${PERIODS[period]}» в этой выборке нет решений по существу для расчёта процента. Это не означает отсутствие судебной практики.`;
  async function copy() {try {await navigator.clipboard.writeText(phrase); setCopied('Скопировано');} catch {setCopied('Выделите и скопируйте текст ниже');}}
  return <section className="kb-detail" aria-labelledby="court-heading">
    <div className="kb-detail-head"><div><p className="kb-eyebrow">{row.kind === 'region' ? 'Регион · сводные данные' : row.region}</p><h2 id="court-heading" ref={heading} tabIndex={-1}>{row.name}</h2></div><button className="kb-close" onClick={close} aria-label="Закрыть сведения">×</button></div>
    {row.name.includes('не найдено') && <p className="kb-caution">В источнике не расшифровано название этого суда. Оно сохранено без предположений.</p>}
    <div className="kb-focus-stat"><div><span>{PERIODS[period]}</span><strong>{percentage(current)}</strong><span>доля удовлетворений</span></div><div><strong>{number(current.count)}</strong><span>решений по существу в выборке</span></div></div>
    {current.count < 30 && <p className="kb-caution">{current.count === 0 ? 'Нет данных для процента за этот период. Это не 0%.' : 'Малая выборка: меньше 30 решений. Несколько исходов заметно меняют процент.'}</p>}
    <h3>Как менялась доля удовлетворений</h3><div className="kb-period-grid">{row.periods.map((p, i) => <div key={i}><span>{PERIODS[i + 1]}</span><strong>{percentage(p)}</strong><small>{number(p.count)} решений</small></div>)}</div>
    <p className="kb-note">{delta === null ? 'Для сравнения периодов 2026 года недостаточно данных.' : `Изменение в 2026 году: ${delta > 0 ? '+' : ''}${delta.toLocaleString('ru-RU', {maximumFractionDigits: 1})} п.п.`} Январь–июнь: 181 день; июль–17 сентября: 79 дней. Изменение не объясняет причины исходов.</p>
    <div className="kb-month-heading"><h3>По месяцам решения</h3><div className="kb-segment" aria-label="Год">{[2025, 2026].map(y => <button type="button" key={y} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}</div></div>
    <div className="kb-months">{months.map((p, i) => <div className="kb-month" key={i}><span>{MONTHS[i]}{year === 2026 && i === 8 ? ' 1–17*' : ''}</span><div className="kb-track" aria-hidden="true"><div style={{width: `${p.rate ?? 0}%`}} /></div><strong>{percentage(p)}</strong><small>{number(p.count)} реш.</small></div>)}</div>
    <p className="kb-note">«—» — нет датированных решений; 0,0% — решения есть, удовлетворений нет. {year === 2026 ? '* Сентябрь — только 1–17 число.' : ''}</p>
    <details className="kb-source-detail"><summary>Все годы и записи без даты</summary><dl><div><dt>Удовлетворено, включая частично</dt><dd>{number(row.granted)}</dd></div><div><dt>Отказано по существу</dt><dd>{number(row.refused)}</dd></div><div><dt>Решено по существу</dt><dd>{number(row.decided)}</dd></div><div><dt>Без рассмотрения · отдельно</dt><dd>{number(row.withoutConsideration)}</dd></div><div><dt>Из решений по существу — без даты</dt><dd>{number(row.undated)}</dd></div></dl><p className="kb-note">Итог за все годы включает записи без даты решения. В периоды и месяцы они не распределяются.</p></details>
    <div className="kb-say"><div><h3>Формулировка для разговора</h3><button type="button" onClick={copy}>Копировать</button></div><p>{phrase}</p><span role="status">{copied}</span></div>
    <a className="kb-source-link" href={`${data.sourceUrl}?gid=1360871258#gid=1360871258&range=A${row.sourceRow}:F${row.sourceRow}`} target="_blank" rel="noreferrer">Открыть эту строку в источнике ↗</a>
  </section>;
}
export default function Knowledge() {
  const [data, setData] = useState<KnowledgeData | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(''), [region, setRegion] = useState(''), [view, setView] = useState<'region' | 'court'>('region');
  const [period, setPeriod] = useState(4), [minCount, setMinCount] = useState(0), [sort, setSort] = useState('name');
  const [selected, setSelected] = useState<KnowledgeRow | null>(null);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    fetch('/api/knowledge', {cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])}).then(async r => {
      if (r.status === 401) {window.location.replace('/login?returnTo=%2Fknowledge'); return null;}
      if (!r.ok) throw Error(); return await r.json() as KnowledgeData;
    }).then(d => {if (active && d) setData(d);}).catch(e => {if (active && e.name !== 'AbortError') setError('Не удалось загрузить базу знаний. Повторите попытку.');});
    return () => {active = false; controller.abort();};
  }, [attempt]);
  function choose(row: KnowledgeRow) {setSelected(row);}
  const effectiveView = query.trim() || region ? 'court' : view;
  const rows = data ? filterRows(effectiveView === 'court' ? data.courts : data.regions, region, query, period, minCount, sort) : [];
  function reset() {setQuery(''); setRegion(''); setMinCount(0); setSort('name'); setView('region');}
  return <main className="kb-page"><div className="kb-wrap">
    <header className="kb-top"><Link href="/">← Инструменты</Link><span>АНТИКРИЗИС <span className="kb-divider">/</span> КОМАНДЕ ПРОДАЖ</span></header>
    <div className="kb-hero"><div><p className="kb-eyebrow">Знать. Объяснять. Помогать.</p><h1>База знаний</h1><p>Судебная практика по ВПС — под рукой во время консультации.</p></div><div className="kb-snapshot"><span>Срез данных</span><strong>17 сентября 2026</strong><small>Обновляется вручную</small></div></div>
    <nav className="kb-nav" aria-label="Разделы базы знаний"><a href="#reference">Найти регион или суд</a><a href="#learn">Как объяснять клиенту</a><a href="#about">Об источнике</a></nav>
    {error ? <div className="kb-load" role="alert"><p>{error}</p><button onClick={() => {setError(''); setAttempt(attempt + 1);}}>Повторить</button></div> : !data ? <p className="kb-load" role="status">Загружаем справочник…</p> : <>
    <section id="reference" className="kb-reference"><div className="kb-section-title"><span className="kb-eyebrow">Во время консультации</span><h2>Найдите свой регион или суд</h2><p>{data.regions.length} регионов · {data.courts.length} суда с отображаемыми исходами · поиск по названию</p></div>
      <div className="kb-filters"><label className="kb-search">Поиск<input value={query} onChange={e => {setQuery(e.target.value); setSelected(null);}} placeholder="Например: Талгар, Семей, Алматы" type="search" /></label><label>Регион<select value={region} onChange={e => {setRegion(e.target.value); setSelected(null);}}><option value="">Все регионы</option>{[...data.regions].sort((a,b) => a.name.localeCompare(b.name, 'ru')).map(r => <option key={r.id} value={r.name}>{r.name}</option>)}</select></label><label>Период<select value={period} onChange={e => setPeriod(Number(e.target.value))}>{PERIODS.map((p, i) => <option key={p} value={i}>{p}</option>)}</select></label></div>
      <div className="kb-toolbar"><div className="kb-segment" aria-label="Показать"><button aria-pressed={effectiveView === 'region'} onClick={() => {reset(); setSelected(null);}}>Регионы</button><button aria-pressed={effectiveView === 'court'} onClick={() => {setView('court'); setSelected(null);}}>Суды</button></div><label>Объём<select value={minCount} onChange={e => setMinCount(Number(e.target.value))}><option value={0}>Любой</option><option value={10}>От 10 решений</option><option value={30}>От 30 решений</option><option value={100}>От 100 решений</option></select></label><label>Порядок<select value={sort} onChange={e => setSort(e.target.value)}><option value="name">По названию</option><option value="count">Больше решений</option><option value="rate">Выше доля удовлетворений</option></select></label></div>
      <p className="kb-context">{period === 4 ? 'Последний период неполный: 1 июля–17 сентября 2026. ' : ''}Процент описывает прошлые записи в выборке. Это не прогноз результата клиента.</p>
      {selected ? <Detail key={selected.id} row={selected} data={data} period={period} close={() => setSelected(null)} /> : <>
        <div className="kb-results-heading"><span role="status">{effectiveView === 'court' ? 'Судов' : 'Регионов'}: {rows.length}</span><span>{PERIODS[period]}</span></div>
        <div className="kb-list"><div className="kb-list-head" aria-hidden="true"><span>{effectiveView === 'court' ? 'Суд / регион' : 'Регион'}</span><span>Удовлетворено</span><span>Решений</span><span /></div>{rows.map(row => {const p = periodFor(row, period); return <div className="kb-result" key={row.id}><button className="kb-row" onClick={() => choose(row)} aria-label={`${row.name}, ${row.region}, ${percentage(p)}, ${p.count} решений. Открыть сведения`}><span className="kb-name"><strong>{row.name}</strong>{row.kind === 'court' && <small>{row.region}</small>}<small className="kb-sample">{p.count === 0 ? 'Нет данных за период' : p.count < 30 ? 'Малая выборка' : `${number(p.count)} записей по существу`}</small></span><span className="kb-rate">{percentage(p)}</span><span className="kb-count">{number(p.count)}</span><span className="kb-arrow" aria-hidden="true">↗</span></button>{row.kind === 'region' && <button className="kb-region-action" onClick={() => {setRegion(row.name); setSelected(null);}}>Суды региона →</button>}</div>;})}</div>
        {!rows.length && <div className="kb-empty"><h3>По этим условиям ничего не найдено</h3><p>Попробуйте часть названия или уменьшите минимальное число решений.</p><button onClick={reset}>Сбросить фильтры</button></div>}
      </>}
    </section>
    <section id="learn"><Learning /></section>
    <section id="about" className="kb-about"><span className="kb-eyebrow">Источник и границы данных</span><h2>Откуда эти цифры</h2><p>Перенесено из вашей проверенной таблицы ВПС 22.09.2026. Это фиксированный срез на 17.09.2026; изменения в Google Sheets не загружаются автоматически.</p><div className="kb-about-stats"><div><strong>{number(data.total.decided)}</strong><span>решено по существу · все годы</span></div><div><strong>{number(data.total.withoutConsideration)}</strong><span>без рассмотрения · отдельно</span></div><div><strong>{number(data.total.undated)}</strong><span>решений без даты</span></div></div>
    <details><summary>Методика и ограничения</summary><ul><li>В исходной выгрузке 23 064 строки; после удаления точных повторов — 20 431 запись. Наличие уникальных номеров дел и полнота национальной базы не подтверждены.</li><li>Доля удовлетворений включает частичные удовлетворения. В знаменателе только удовлетворения и отказы по существу.</li><li>Возвраты и текущие дела не показаны. Оставленные без рассмотрения показаны отдельно.</li><li>109 решений без даты: 2 удовлетворения и 107 отказов. Они входят в общий итог, но не в периоды. Пропуски могут смещать процент датированных решений.</li><li>В источнике 241 пара «регион + суд»; здесь 222 с отображаемыми исходами. Названия и принадлежность к регионам сохранены из источника; неизвестные названия не расшифровывались.</li><li>Не усредняйте проценты разных судов. Региональные итоги рассчитаны по числу исходов.</li><li>Малая выборка и различия обстоятельств дел ограничивают сравнение судов. Ни высокий процент, ни порог в 30 решений не подтверждают будущий результат.</li></ul></details>
    <div className="kb-source-links"><a href={data.sourceUrl + '?gid=91826103#gid=91826103'} target="_blank" rel="noreferrer">Таблица и контроль данных ↗</a><a href="https://tazalau.qoldau.kz/ru/list/bankruptcy/recovery" target="_blank" rel="noreferrer">Публичный источник ↗</a></div></section>
    </>}
    <footer className="kb-footer"><span>Антикризис · База знаний отдела продаж</span><a href="#">Наверх ↑</a></footer>
  </div></main>;
}
