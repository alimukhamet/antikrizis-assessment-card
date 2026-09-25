import { bitrixHeaders } from './http-headers';
import { PROFILE_USER_FIELDS } from './profile-fields';

export class ProfileFieldSetupError extends Error { constructor(public code: string) { super(code); } }
export type ProfileFieldStatus = { fieldName: string; label: string; exists: boolean };

/** Admin-only, idempotent: creates the profile deal fields that do not exist yet. Never edits or deletes a field. */
export function createProfileFieldSetup(webhook: string, send: typeof fetch = fetch) {
  async function call(method: string, body: unknown) {
    if (!webhook) throw new ProfileFieldSetupError('BITRIX_NOT_CONFIGURED');
    const response = await send(webhook.replace(/\/?$/, '/') + method + '.json', {
      method: 'POST', headers: bitrixHeaders(webhook), body: JSON.stringify(body), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const json = await response.json().catch(() => ({})) as { result?: unknown; error?: string };
    if (!response.ok || json.error || json.result === undefined) throw new ProfileFieldSetupError(json.error === 'insufficient_scope' || json.error === 'ACCESS_DENIED' ? 'BITRIX_ADMIN_RIGHTS_REQUIRED' : 'BITRIX_REQUEST_FAILED');
    return json.result;
  }
  async function status(): Promise<ProfileFieldStatus[]> {
    return Promise.all(PROFILE_USER_FIELDS.map(async field => {
      const result = await call('crm.deal.userfield.list', { filter: { FIELD_NAME: 'UF_CRM_' + field.FIELD_NAME } });
      if (!Array.isArray(result)) throw new ProfileFieldSetupError('BITRIX_REQUEST_FAILED');
      return { fieldName: 'UF_CRM_' + field.FIELD_NAME, label: field.label, exists: result.some(row => row?.FIELD_NAME === 'UF_CRM_' + field.FIELD_NAME) };
    }));
  }
  async function ensure() {
    const before = await status(), created: string[] = [];
    for (const field of PROFILE_USER_FIELDS) {
      if (before.find(item => item.fieldName === 'UF_CRM_' + field.FIELD_NAME)?.exists) continue;
      const label = { ru: field.label, en: field.label };
      await call('crm.deal.userfield.add', { fields: {
        FIELD_NAME: field.FIELD_NAME, USER_TYPE_ID: 'string', MULTIPLE: 'N', MANDATORY: 'N', SHOW_FILTER: 'N', EDIT_IN_LIST: 'N',
        SETTINGS: { ROWS: field.rows }, EDIT_FORM_LABEL: label, LIST_COLUMN_LABEL: label, LIST_FILTER_LABEL: label,
      } });
      created.push('UF_CRM_' + field.FIELD_NAME);
    }
    return { created, fields: await status() };
  }
  return { status, ensure };
}
