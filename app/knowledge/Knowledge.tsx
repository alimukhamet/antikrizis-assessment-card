'use client';
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {MONTHS, normalizeSearch} from '../../lib/knowledge/model';
import type {KnowledgeData, KnowledgeRow} from '../../lib/knowledge/model';
import './knowledge.css';

const count = (n: number) => n.toLocaleString('ru-RU');
const percent = (n: number | null) => n === null ? 'Нет данных' : n.toLocaleString('ru-RU', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%';
const deltaText = (n: number) => Math.abs(n).toLocaleString('ru-RU', {maximumFractionDigits: 1});
const latest = (row: KnowledgeRow) => row.periods[3];
const shortPeriods = ['Янв–июн 2025', 'Июл–дек 2025', 'Янв–июн 2026', 'Июл–17 сен 2026'];
function Trend({row, monthly}: {row: KnowledgeRow; monthly: boolean}) {
  const [year,setYear]=useState(2026), [active,setActive]=useState<number|null>(null);
  const points=monthly?(year===2026?row.months2026:row.months2025):row.periods;
  const labels=monthly?MONTHS.slice(0,points.length):shortPeriods;
  const x=(i:number)=>40+i*580/(points.length-1), y=(rate:number)=>158-rate*1.3;
  const selected=active===null?null:points[active];
  return <div className="learn-trend">
    {monthly&&<div className="learn-year"><div className="learn-switch" aria-label="Год">{[2025,2026].map(n=><button key={n} type="button" aria-pressed={year===n} onClick={()=>{setYear(n);setActive(null);}}>{n}</button>)}</div><span>Нажмите на месяц — увидите процент и число решений</span></div>}
    <div className="learn-plot"><svg viewBox="0 0 660 180" preserveAspectRatio="none" role="img" aria-label={`Доля удовлетворений: ${points.map((p,i)=>`${labels[i]}: ${percent(p.rate)}, ${p.count} решений`).join('; ')}`}>
      {[0,25,50,75,100].map(n=><g key={n}><line x1="40" x2="620" y1={y(n)} y2={y(n)} stroke="#e9ede7" strokeDasharray={n===0?'0':'3 5'}/></g>)}
      {points.slice(1).map((p,i)=>p.rate!==null&&points[i].rate!==null?<line key={i} x1={x(i)} y1={y(points[i].rate!)} x2={x(i+1)} y2={y(p.rate)} stroke="#315941" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeDasharray={(!monthly&&i===2)||(monthly&&year===2026&&i===7)?'6 5':undefined}/>:null)}
      {points.map((p,i)=>p.rate===null?null:<circle key={i} cx={x(i)} cy={y(p.rate)} r={monthly?4:5} stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" fill="#315941"><title>{labels[i]}: {percent(p.rate)} · {count(p.count)} решений</title></circle>)}
    </svg><div className="learn-axis" aria-hidden="true">{[100,75,50,25,0].map(n=><span key={n} style={{top:`${y(n)/180*100}%`}}>{n}%</span>)}</div>
    {!monthly&&<div className="learn-plot-values" aria-hidden="true">{points.map((p,i)=><strong key={i} style={{left:`${6.06+i*87.88/3}%`,top:p.rate===null?'45%':`${(y(p.rate)-25)/180*100}%`}}>{p.rate===null?'—':percent(p.rate)}</strong>)}</div>}</div>
    <div className={`learn-point-labels ${monthly?'is-monthly':''}`} style={{gridTemplateColumns:`repeat(${points.length},minmax(0,1fr))`}}>{points.map((p,i)=><button key={i} type="button" aria-pressed={active===i} onClick={()=>setActive(i)}><span>{labels[i]}{monthly&&year===2026&&i===8?'*':''}</span>{!monthly&&<small>{count(p.count)} решений</small>}</button>)}</div>
    {selected&&<p className="learn-point-detail" role="status"><strong>{labels[active!]}{monthly?' '+year:''}: {percent(selected.rate)}</strong><span>{count(selected.count)} решений по существу</span></p>}
    <p className="learn-chart-note">{monthly&&year===2026?'* Сентябрь — 1–17 число. ':!monthly?'Последний период — 1 июля–17 сентября, неполный. ':''}Пропуск на графике — нет датированных решений.</p>
  </div>;
}
export default function Knowledge(){
  const [data,setData]=useState<KnowledgeData|null>(null), [error,setError]=useState(''), [attempt,setAttempt]=useState(0);
  const [selectedId,setSelectedId]=useState('total'),[query,setQuery]=useState(''),[showAll,setShowAll]=useState(false),[mode,setMode]=useState<'overview'|'months'>('overview');
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{let active=true;const controller=new AbortController();fetch('/api/knowledge',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(async r=>{if(r.status===401){window.location.replace('/login?returnTo=%2Fknowledge');return null;}if(!r.ok)throw Error();return await r.json() as KnowledgeData;}).then(value=>{if(active&&value)setData(value);}).catch(e=>{if(active&&e.name!=='AbortError')setError('Не удалось загрузить данные. Попробуйте ещё раз.');});return()=>{active=false;controller.abort();};},[attempt]);
  const all=data?[data.total,...data.regions,...data.courts]:[];
  const selected=all.find(r=>r.id===selectedId)??data?.total;
  const region=selected?.kind==='court'?data?.regions.find(r=>r.name===selected.region):selected?.kind==='region'?selected:undefined;
  const terms=normalizeSearch(query).split(' ').filter(Boolean);
  const matches=terms.length?all.filter(r=>r.kind!=='total'&&terms.every(word=>normalizeSearch(r.name+' '+r.region).includes(word))):[];
  const courts=data&&region?data.courts.filter(r=>r.region===region.name).sort((a,b)=>latest(b).count-latest(a).count):[];
  function choose(id:string,focusTrend=true){setSelectedId(id);setQuery('');setMode('overview');setShowAll(false);if(focusTrend)requestAnimationFrame(()=>heading.current?.focus());}
  const p=selected?latest(selected):null;
  const name=selected?.kind==='total'?'Все регионы в выборке':selected?.name;
  return <main className="learn-page"><header className="learn-header"><Link href="/" className="learn-back">← Инструменты</Link><span className="learn-product">Практика судов <i>/</i> ВПС</span><details className="learn-source"><summary>Данные на 17.09.2026 <span aria-hidden="true">ⓘ</span></summary><div><strong>Фиксированный срез</strong><p>Перенесено из вашей таблицы 22.09.2026. Изменения в Google Sheets не появляются здесь автоматически.</p><p>Полнота национальной базы и уникальность судебных дел не подтверждены. 109 решений без даты не входят в периоды; в общем итоге они учтены.</p><p>Возвраты и текущие дела исключены. Записи без рассмотрения показаны отдельно. Неизвестные названия судов сохранены из источника.</p><a href="https://docs.google.com/spreadsheets/d/1vQg24SZsKQ2IPoPvdNs6PtWRQjPHKZtbJENt3rbeI44/edit?gid=91826103#gid=91826103" target="_blank" rel="noreferrer">Открыть источник ↗</a></div></details></header>
    <div className="learn-layout"><aside className="learn-sidebar"><div className="learn-sidebar-title"><strong>Судебная практика</strong><span>Регион → районный суд → динамика</span></div><label className="learn-search"><span className="learn-search-icon" aria-hidden="true">⌕</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Регион или районный суд" aria-label="Найти регион или суд"/>{query&&<button type="button" aria-label="Очистить поиск" onClick={()=>setQuery('')}>×</button>}</label>
      <div className="learn-court-picker">
        <label>Регион<select aria-label="Выбрать регион" value={region?.id??'total'} disabled={!data} onChange={e=>choose(e.target.value,false)}><option value="total">Все регионы</option>{data?.regions.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
        <label>Суд<select aria-label="Выбрать суд" value={selected?.kind==='court'?selected.id:region?.id??''} disabled={!region} onChange={e=>choose(e.target.value)}><option value={region?.id??''}>{region?'Все суды региона':'Сначала выберите регион'}</option>{courts.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
      </div>
      {query.trim()?<div className="learn-search-results"><p>Найдено: {matches.length}</p>{matches.slice(0,showAll?matches.length:12).map(r=><button key={r.id} onClick={()=>choose(r.id)}><strong>{r.name}</strong><small>{r.kind==='region'?'Регион':r.region}</small></button>)}{matches.length>12&&!showAll&&<button onClick={()=>setShowAll(true)}>Показать остальные</button>}{!matches.length&&<p>Попробуйте часть названия.</p>}</div>:<>
        <nav className="learn-region-list" aria-label={region?'Суды региона':'Регионы'}>{region?<>
          <button className="learn-nav-back" onClick={()=>choose('total')}>← Все регионы</button>
          <button onClick={()=>choose(region.id)} aria-current={selectedId===region.id?'page':undefined}><span>{region.name}</span><span>{percent(latest(region).rate)}</span></button>
          <span className="learn-nav-label">Суды региона · последний период</span>
          {courts.map(r=><button key={r.id} onClick={()=>choose(r.id)} aria-current={selectedId===r.id?'page':undefined}><span>{r.name}</span><span>{latest(r).rate===null?'—':percent(latest(r).rate)}</span></button>)}
        </>:<><button onClick={()=>choose('total')} aria-current={selectedId==='total'?'page':undefined}><span>Все регионы</span><span>{data?percent(latest(data.total).rate):'—'}</span></button><span className="learn-nav-label">Регионы · последний период</span>{data?.regions.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(r=><button key={r.id} onClick={()=>choose(r.id)}><span>{r.name}</span><span>{latest(r).rate===null?'—':percent(latest(r).rate)}</span></button>)}</>}</nav>
      </>}
    </aside><div className="learn-main">{error?<div className="learn-error" role="alert"><p>{error}</p><button onClick={()=>{setError('');setAttempt(attempt+1);}}>Повторить</button></div>:!data||!selected||!p?<p role="status">Загружаем судебную практику…</p>:<>
      <div className="learn-breadcrumb"><button onClick={()=>choose('total')}>Практика ВПС</button>{region&&<><span>/</span><button onClick={()=>choose(region.id)}>{region.name}</button></>}{selected.kind==='court'&&<><span>/</span><span>Суд</span></>}</div>
      <div className="learn-title"><h1 ref={heading} tabIndex={-1}>{name}</h1><p>{selected.kind==='total'?'20 регионов · 222 суда · 2025–2026':selected.kind==='region'?`${courts.length} судов · выберите нужный в списке «Суд»`:selected.region}</p></div>
      {selected.name.includes('не найдено')&&<p className="learn-warning">Название суда не расшифровано в источнике. Не используйте его для выбора конкретного суда.</p>}
      <section className="learn-summary" aria-label="Последний период"><div className="learn-main-stat"><span>Удовлетворено, включая частично</span><strong>{percent(p.rate)}</strong><p>1 июля–17 сентября 2026</p></div><div className="learn-secondary-stat"><strong>{count(p.count)}</strong><span>решений по существу</span>{p.count>0&&p.count<30?<small>Малая выборка</small>:<small>Записи из источника</small>}</div><div className="learn-change"><span>К первому полугодию 2026</span><strong>{selected.delta2026===null?'—':`${selected.delta2026>0?'+':selected.delta2026<0?'−':''}${deltaText(selected.delta2026)} п.п.`}</strong><small>Последний период неполный</small></div></section>
      <div className="learn-chart-panel"><div className="learn-section-head"><h2>Доля удовлетворений</h2><div className="learn-switch" aria-label="Подробность"><button onClick={()=>setMode('overview')} aria-pressed={mode==='overview'}>По полугодиям</button><button onClick={()=>setMode('months')} aria-pressed={mode==='months'}>По месяцам</button></div></div><Trend key={selected.id+mode} row={selected} monthly={mode==='months'}/></div>
      {selected.kind!=='court'&&region&&<section className="learn-courts mobile-only"><div className="learn-section-head"><h2>Суды этого региона</h2><span>{courts.length}</span></div><p className="learn-caption">Откройте суд, чтобы увидеть его динамику. Сначала — больше решений в последнем периоде.</p><div className="learn-court-list">{courts.slice(0,showAll?courts.length:6).map(c=><button key={c.id} onClick={()=>choose(c.id)}><span><strong>{c.name}</strong><small>{count(latest(c).count)} решений{latest(c).count<30?' · мало данных':''}</small></span><b>{latest(c).rate===null?'—':percent(latest(c).rate)}<i aria-hidden="true">→</i></b></button>)}</div>{courts.length>6&&!showAll&&<button className="learn-more" onClick={()=>setShowAll(true)}>Показать все {courts.length} судов</button>}</section>}

      <details className="learn-all-years"><summary>Все годы и записи без даты</summary><div className="learn-all-grid"><p><strong>{count(selected.granted)}</strong>Удовлетворено</p><p><strong>{count(selected.refused)}</strong>Отказано по существу</p><p><strong>{count(selected.withoutConsideration)}</strong>Без рассмотрения</p><p><strong>{count(selected.undated)}</strong>Решений без даты</p></div><p>Доля удовлетворений за все годы: {percent(selected.decided?selected.granted/selected.decided*100:null)}. В расчёте {count(selected.decided)} решений по существу, включая записи без даты. В график по периодам записи без даты не попадают.</p></details>
      <footer className="learn-footer"><span>Срез 17.09.2026 · Последний период неполный · Удовлетворено ÷ решения по существу</span><a href={`${data.sourceUrl}?gid=1360871258#gid=1360871258&range=A${selected.sourceRow}:F${selected.sourceRow}`} target="_blank" rel="noreferrer">Строка в источнике ↗</a></footer>
    </>}</div></div></main>;
}
