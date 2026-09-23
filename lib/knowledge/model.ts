export type Period = { rate: number | null; count: number };
export type KnowledgeRow = {
  id: string; kind: 'total' | 'region' | 'court'; name: string; region: string;
  sourceRow: number; granted: number; refused: number; decided: number;
  withoutConsideration: number; undated: number; delta2026: number | null; periods: Period[];
  months2025: Period[]; months2026: Period[];
};
export type KnowledgeData = {
  snapshotDate: string; importedAt: string; sourceUrl: string;
  regions: KnowledgeRow[]; courts: KnowledgeRow[]; total: KnowledgeRow;
};
export const PERIODS = ['Все годы в источнике', 'Январь–июнь 2025', 'Июль–декабрь 2025', 'Январь–июнь 2026', '1 июля–17 сентября 2026'];
export const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
export function periodFor(row: KnowledgeRow, period: number): Period {
  return period === 0 ? {rate: row.decided ? row.granted / row.decided * 100 : null, count: row.decided} : row.periods[period - 1];
}
export function normalizeSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function sortByLatestRateAscending(rows: KnowledgeRow[]) {
  return rows.slice().sort((a, b) => {
    const ar = a.periods[3].rate, br = b.periods[3].rate;
    if (ar === null && br !== null) return 1;
    if (br === null && ar !== null) return -1;
    return (ar ?? 0) - (br ?? 0) || a.name.localeCompare(b.name, 'ru') || a.region.localeCompare(b.region, 'ru');
  });
}
export function filterRows(rows: KnowledgeRow[], region: string, query: string, period: number, minCount: number, sort: string) {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  return rows.filter(row => (!region || row.region === region) && words.every(word => normalizeSearch(row.region + ' ' + row.name).includes(word)) && periodFor(row, period).count >= minCount).sort((a, b) => {
    const ap = periodFor(a, period), bp = periodFor(b, period);
    const diff = sort === 'rate' ? (bp.rate ?? -1) - (ap.rate ?? -1) : sort === 'count' ? bp.count - ap.count : 0;
    return diff || a.name.localeCompare(b.name, 'ru') || a.region.localeCompare(b.region, 'ru');
  });
}
