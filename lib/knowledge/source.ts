import snapshot from '../../data/vps-sheet-snapshot.json';
import type {KnowledgeData, KnowledgeRow, Period} from './model';

type SourceRow = (string | null)[];
const sheets = snapshot.sheets as Record<string, { values: SourceRow[] }>;
function integer(value: string | null | undefined): number {
  const normalized = (value ?? '').replace(/[,\s]/g, '');
  if (!/^\d+$/.test(normalized)) throw Error('Invalid source count');
  return Number(normalized);
}
function rate(value: string | null | undefined): number | null {
  if (value === '—') return null;
  if (!value || !/^\d+(\.\d+)?%$/.test(value)) throw Error('Invalid source percentage');
  const n = Number(value.slice(0, -1));
  if (n > 100) throw Error('Percentage outside bounds');
  return n;
}
function monthly(value: string | null | undefined): Period {
  if (value === '—') return {rate: null, count: 0};
  const match = /^(\d+(?:\.\d+)?%) \((\d+)\)$/.exec(value ?? '');
  if (!match) throw Error('Invalid source month');
  return {rate: rate(match[1]), count: integer(match[2])};
}
function keyedRows(name: string) {
  const result = new Map<string, {row: SourceRow; index: number; kind: KnowledgeRow['kind']; region: string}>();
  let region = '';
  sheets[name].values.forEach((row, index) => {
    if (index < 5 || !row[0] || !row[1] || row.length < 6) return;
    const court = /^\s{2}/.test(row[0]), total = row[0].startsWith('ИТОГО');
    if (!court && !total) region = row[0];
    const key = total ? 'total' : court ? region + '|' + row[0].trim() : region;
    if (result.has(key)) throw Error('Duplicate region/court key');
    result.set(key, {row, index, kind: total ? 'total' : court ? 'court' : 'region', region: total ? '' : region});
  });
  return result;
}
export function buildKnowledgeData(): KnowledgeData {
  const totals = keyedRows('Регионы и суды'), trends = keyedRows('Тренды 2025–2026');
  const m25 = keyedRows('По месяцам 2025'), m26 = keyedRows('По месяцам 2026');
  if (![trends, m25, m26].every(rows => rows.size === totals.size)) throw Error('Source row coverage mismatch');
  const rows = [...totals].map(([key, info]) => {
    const t = trends.get(key)?.row, a = m25.get(key)?.row, b = m26.get(key)?.row;
    if (!t || !a || !b) throw Error('Source court/region mismatch');
    const row = info.row;
    const item: KnowledgeRow = {
      id: key, kind: info.kind, name: row[0]!.trim(), region: info.region, sourceRow: info.index + 1,
      granted: integer(row[1]), refused: integer(row[2]), decided: integer(row[3]), withoutConsideration: integer(row[5]), undated: integer(t[11]), delta2026: t[9] === '—' ? null : Number(t[9]),
      periods: [1, 3, 5, 7].map(i => ({rate: rate(t[i]), count: integer(t[i + 1])})),
      months2025: a.slice(1, 13).map(monthly), months2026: b.slice(1, 10).map(monthly)
    };
    if (item.granted + item.refused !== item.decided || item.months2025.length !== 12 || item.months2026.length !== 9) throw Error('Source arithmetic mismatch');
    const months = [item.months2025.slice(0, 6), item.months2025.slice(6), item.months2026.slice(0, 6), item.months2026.slice(6)];
    item.periods.forEach((p, i) => {
      if ((p.rate === null) !== (p.count === 0) || months[i].reduce((s, v) => s + v.count, 0) !== p.count) throw Error('Source period mismatch');
    });
    return item;
  });
  const total = rows.find(r => r.kind === 'total');
  if (!total) throw Error('Missing total');
  return {snapshotDate: snapshot.snapshotDate, importedAt: snapshot.importedAt, sourceUrl: 'https://docs.google.com/spreadsheets/d/' + snapshot.spreadsheetId + '/edit', total, regions: rows.filter(r => r.kind === 'region'), courts: rows.filter(r => r.kind === 'court')};
}
