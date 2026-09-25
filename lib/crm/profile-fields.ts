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

/** Fields the backfill writes. Contract, payment, procedure and the legacy card are never written. */
export const PROFILE_FIELDS = {
  fio: 'UF_CRM_1773669702495',
  marital: 'UF_CRM_AI_MARITAL',
  debt: 'UF_CRM_AI_DEBT',
  profileCard: 'UF_CRM_ANK_PROFILE_CARD',
  profileJson: 'UF_CRM_ANK_PROFILE_JSON',
  profileAt: 'UF_CRM_ANK_PROFILE_AT',
} as const;
export type ProfileField = keyof typeof PROFILE_FIELDS;
export type ProfileValues = Record<ProfileField, string>;
export type ProfileBaseline = Record<ProfileField, unknown>;

/** New deal user fields. Created once by scripts/ensure-profile-fields.mjs. */
export const PROFILE_USER_FIELDS = [
  { FIELD_NAME: 'ANK_PROFILE_CARD', label: 'Профиль клиента (текст)', rows: 20 },
  { FIELD_NAME: 'ANK_PROFILE_JSON', label: 'Профиль клиента (данные для платформы)', rows: 5 },
  { FIELD_NAME: 'ANK_PROFILE_AT', label: 'Профиль клиента заполнен', rows: 1 },
] as const;
