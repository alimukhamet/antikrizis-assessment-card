/** Bitrix field IDs used by the one-time profile backfill. Keep every ID here. */
export const PROFILE_CATEGORY_ID = '1';
/** Stage names are matched case-insensitively; «ЗВИ» may be part of a longer stage name. */
export function isProfileBackfillStage(name: string) {
  const text = name.trim().toLocaleLowerCase('ru-RU');
  return text === 'в ожидании' || text.includes('зви');
}
export const ZVI_DATE_FIELD = 'UF_CRM_1778066504937';
export const PROCEDURE_FIELD = 'UF_CRM_1773655613972';
export const LEGACY_CARD_FIELD = 'UF_CRM_AI_CARD';
export const IIN_FIELD = 'UF_CRM_AI_IIN';

/** The only Bitrix fields the backfill writes — all existing. No new Bitrix fields are created:
 * the full profile is kept in the tool database and posted to the deal timeline. */
export const PROFILE_FIELDS = {
  fio: 'UF_CRM_1773669702495',
  marital: 'UF_CRM_AI_MARITAL',
  debt: 'UF_CRM_AI_DEBT',
} as const;
export type ProfileField = keyof typeof PROFILE_FIELDS;
/** Bitrix values plus the compiled profile, which stays in the tool (D1) and the timeline comment. */
export type ProfileValues = Record<ProfileField, string> & { profileCard: string; profileJson: string; profileAt: string };
export type ProfileBaseline = Record<ProfileField, unknown>;
