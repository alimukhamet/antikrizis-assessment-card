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
export const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_TITLES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
function sourceDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw Error('Invalid source date');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > lastDay) throw Error('Invalid source date');
  return {year, month, day, lastDay};
}
export function formatSourceDate(value: string) {
  const {year, month, day} = sourceDate(value);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}
export function snapshotLabels(snapshotDate: string) {
  const {year, month, day, lastDay} = sourceDate(snapshotDate);
  if (year !== 2026 || month < 7) throw Error('Invalid source cutoff');
  const latestPeriod = `1 июля–${day} ${MONTH_NAMES[month - 1]} ${year}`;
  const partialMonth = day < lastDay;
  return {
    date: formatSourceDate(snapshotDate),
    latestPeriod,
    latestPeriodShort: `Июл–${day} ${MONTHS[month - 1].toLocaleLowerCase('ru')} ${year}`,
    latestPeriodIncomplete: month < 12 || partialMonth,
    partialMonthIndex: partialMonth ? month - 1 : null,
    partialMonthNote: partialMonth ? `* ${MONTH_TITLES[month - 1]} — 1–${day} ${MONTH_NAMES[month - 1]}. ` : ''
  };
}
export function periodFor(row: KnowledgeRow, period: number): Period {
  return period === 0 ? {rate: row.decided ? row.granted / row.decided * 100 : null, count: row.decided} : row.periods[period - 1];
}
export function normalizeSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function sortByLatestRate(rows: KnowledgeRow[], direction: 'asc' | 'desc' = 'asc') {
  return rows.slice().sort((a, b) => {
    const ar = a.periods[3].rate, br = b.periods[3].rate;
    if (ar === null && br !== null) return 1;
    if (br === null && ar !== null) return -1;
    return ((ar ?? 0) - (br ?? 0)) * (direction === 'asc' ? 1 : -1) || a.name.localeCompare(b.name, 'ru') || a.region.localeCompare(b.region, 'ru');
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
