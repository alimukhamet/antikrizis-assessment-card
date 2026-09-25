import { validateDraft, type DraftPayload } from './draft';
import { checkAnswers, SALES_ONLY_KEYS, type DisplayAnswer } from './check-answers';
import { displayAnswer, groupNames } from './compile-assessment';
import { RepositoryError } from '../documents/repository';
import type { ProfileValues } from '../crm/profile-fields';

export const PROFILE_SCHEMA = 'antikrizis.profile.v1';
/** Bitrix string fields are stored as text; keep a wide margin below practical limits. */
const MAX_FIELD_BYTES = 60000;

export type ProfileAuthor = { name: string; at: string };
export type CompiledProfile = {
  values: ProfileValues;
  card: string;
  json: ProfileJson;
  unresolved: DisplayAnswer[];
  debtComplete: boolean;
};
export type ProfileJson = {
  schema: typeof PROFILE_SCHEMA; dealId: string; iin: string; savedAt: string; savedBy: string;
  totalDebt: string; debtComplete: boolean;
  answers: Array<{ key: string; label: string; value: string; group?: string; row?: number }>;
  unresolved: Array<{ key: string; label: string; group?: string; row?: number }>;
};

const clean = (label: string) => label.replace(/\*/g, '').trim();
const FACT_ADDRESS: Record<string, string> = { same: 'По адресу прописки', other: 'По другому адресу' };
const show = (a: DisplayAnswer) => a.key === 'factAddressSame' ? FACT_ADDRESS[a.value] || displayAnswer(a) : displayAnswer(a);

/** Sum only amounts that are known. Unknown amounts are listed separately, never guessed. */
function knownDebt(payload: DraftPayload) {
  let cents = BigInt(0), complete = true;
  for (const row of payload.groups.find(g => g.id === 'creditors')?.rows || []) {
    const value = row.find(a => a.key === 'n8040')?.value.trim() || '';
    if (!/^\d+(\.\d{1,2})?$/.test(value)) { complete = false; continue; }
    const [whole, fraction = ''] = value.split('.');
    cents += BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  }
  return { total: `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, '0')}`, complete };
}

/** Builds the profile text and structured data. Performs no write and approves no evidence. */
export function compileProfile(raw: DraftPayload, trustedIin: string | null, dealId: string, author: ProfileAuthor, assessmentDay?: string): CompiledProfile {
  const payload = validateDraft(raw);
  if (!trustedIin) throw new RepositoryError('DEAL_IDENTITY_UNVERIFIED', 409);
  const checked = checkAnswers(payload, trustedIin, assessmentDay, { profile: true });
  if (!checked.answersComplete) throw new RepositoryError('ANSWERS_INCOMPLETE', 400);
  const answers = checked.displayAnswers.filter(a => !SALES_ONLY_KEYS.has(a.key));
  const value = (key: string) => answers.find(a => !a.group && a.key === key)?.value.trim() || '';
  const debt = knownDebt(payload);

  const lines = [
    'ПРОФИЛЬ КЛИЕНТА',
    `Дозаполнено документологом: ${author.name} · ${author.at}`,
    'Ответы профиля. Подлинность документов этим не подтверждается.',
  ];
  const append = (a: DisplayAnswer) => { if (a.value) lines.push(`• ${clean(a.label)}: ${show(a)}`); };
  lines.push('', 'ОБЩИЕ СВЕДЕНИЯ');
  answers.filter(a => !a.group).forEach(append);
  for (const group of payload.groups) {
    for (let row = 0; row < group.rows.length; row++) {
      const rowAnswers = answers.filter(a => a.group === group.id && a.row === row);
      if (!rowAnswers.length) continue;
      lines.push('', `${groupNames[group.id] || group.id} ${row + 1}`);
      rowAnswers.forEach(append);
    }
  }
  lines.push('', `Общий долг по указанным обязательствам: ${debt.total} ₸${debt.complete ? '' : ' (без обязательств с неизвестной суммой)'}`);
  if (checked.unresolved.length) {
    lines.push('', 'ТРЕБУЕТ УТОЧНЕНИЯ');
    for (const item of checked.unresolved) {
      const where = item.group ? `${groupNames[item.group] || item.group} ${item.row! + 1} · ` : '';
      lines.push(`• ${where}${clean(item.label)}`);
    }
  }
  const card = lines.join('\n');

  const json: ProfileJson = {
    schema: PROFILE_SCHEMA, dealId, iin: trustedIin, savedAt: author.at, savedBy: author.name,
    totalDebt: debt.total, debtComplete: debt.complete,
    answers: answers.filter(a => a.value).map(a => ({ key: a.key, label: clean(a.label), value: show(a), ...(a.group ? { group: a.group, row: a.row } : {}) })),
    unresolved: checked.unresolved.map(a => ({ key: a.key, label: clean(a.label), ...(a.group ? { group: a.group, row: a.row } : {}) })),
  };
  const jsonText = JSON.stringify(json);
  // Bitrix stores string fields in a 64 KB text column; Cyrillic takes 2 bytes per character.
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  if (bytes(card) > MAX_FIELD_BYTES || bytes(jsonText) > MAX_FIELD_BYTES) throw new RepositoryError('PROFILE_TOO_LARGE', 413);

  const values: ProfileValues = {
    fio: value('fio'), marital: value('marital'), debt: debt.total,
    profileCard: card, profileJson: jsonText, profileAt: `${author.at} · ${author.name}`,
  };
  return { values, card, json, unresolved: checked.unresolved, debtComplete: debt.complete };
}
