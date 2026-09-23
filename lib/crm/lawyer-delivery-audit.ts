import { bitrixHeaders } from "./http-headers";
import { readFileField } from "./document-upload";

export class LawyerDeliveryAuditError extends Error {
  constructor(public code: string, public status = 503) {
    super(code);
  }
}

const categoryId = "1", stageId = "C1:NEW", entityId = "DEAL_STAGE_1";
const mandatoryFields = {
  clientName: "UF_CRM_1773669702495",
  procedure: "UF_CRM_1773655613972",
  contractNumber: "UF_CRM_AI_DOGNUM",
  contractDate: "UF_CRM_1778499926844",
  card: "UF_CRM_AI_CARD",
} as const;
const selectedFields = [
  "ID", "TITLE", "CATEGORY_ID", "STAGE_ID", "UF_CRM_AI_IIN",
  ...Object.values(mandatoryFields), "UF_CRM_ANK_PRIMARY_DOCS",
];
type MissingField = keyof typeof mandatoryFields;
export type LawyerDeliveryCase = {
  dealId: string;
  title: string;
  clientName: string;
  procedure: string;
  hasIin: boolean;
  missingFields: MissingField[];
  fileCount: number;
  intakeStyleTitle: boolean;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function scalar(value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  if (typeof value !== "string" && typeof value !== "number")
    throw new LawyerDeliveryAuditError("LAWYER_AUDIT_RESPONSE_UNVERIFIED");
  return String(value).trim();
}

/** Read-only cohort discovery. Titles are signals, never delivery receipts. */
export async function auditLawyerDelivery(webhook: string, send: typeof fetch = fetch) {
  if (!webhook) throw new LawyerDeliveryAuditError("BITRIX_NOT_CONFIGURED");
  async function call(method: "crm.status.list" | "crm.deal.list", body: unknown) {
    try {
      const response = await send(webhook.replace(/\/?$/, "/") + method + ".json", {
        method: "POST", headers: bitrixHeaders(webhook), body: JSON.stringify(body),
        redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_CRM_UNAVAILABLE");
      }
      // Cards are selected for presence only, but may be large. Bound the CRM
      // response and never include raw response contents in errors or output.
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let text = "", size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024 * 1024) {
          await reader.cancel();
          throw new LawyerDeliveryAuditError("LAWYER_AUDIT_RESPONSE_TOO_LARGE");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      const json: unknown = JSON.parse(text);
      if (!isRecord(json) || json.error || !Array.isArray(json.result))
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_RESPONSE_UNVERIFIED");
      return json as Record<string, unknown> & { result: unknown[] };
    } catch (error) {
      if (error instanceof LawyerDeliveryAuditError) throw error;
      throw new LawyerDeliveryAuditError("LAWYER_AUDIT_CRM_UNAVAILABLE");
    }
  }
  const stages = await call("crm.status.list", { filter: { ENTITY_ID: entityId } });
  if (!stages.result.every(isRecord))
    throw new LawyerDeliveryAuditError("LAWYER_AUDIT_STAGE_UNVERIFIED");
  const matching = stages.result.filter((stage) => stage.STATUS_ID === stageId);
  const target = matching[0];
  if (matching.length !== 1 || target.ENTITY_ID !== entityId ||
      typeof target.NAME !== "string" || target.NAME.trim().replace(/\s+/g, " ").toLowerCase() !== "в ожидании")
    throw new LawyerDeliveryAuditError("LAWYER_AUDIT_STAGE_UNVERIFIED");

  const cases: LawyerDeliveryCase[] = [], seen = new Set<string>();
  let start = 0, expectedTotal: number | undefined;
  for (let page = 0; page < 10; page++) {
    const json = await call("crm.deal.list", {
      filter: { CATEGORY_ID: categoryId, STAGE_ID: stageId },
      order: { ID: "ASC" }, select: selectedFields, start,
    });
    if (json.result.length > 50)
      throw new LawyerDeliveryAuditError("LAWYER_AUDIT_PAGINATION_UNVERIFIED");
    if (json.total !== undefined) {
      if (!Number.isInteger(json.total) || Number(json.total) < 0)
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_PAGINATION_UNVERIFIED");
      if (Number(json.total) > 500)
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_COHORT_LIMIT_EXCEEDED");
      if (expectedTotal !== undefined && json.total !== expectedTotal)
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_COHORT_CHANGED");
      expectedTotal = Number(json.total);
    }
    for (const raw of json.result) {
      if (!isRecord(raw) || !/^[1-9]\d*$/.test(String(raw.ID)) ||
          String(raw.CATEGORY_ID) !== categoryId || raw.STAGE_ID !== stageId)
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_RESPONSE_UNVERIFIED");
      const dealId = String(raw.ID);
      if (seen.has(dealId) || (cases.length && BigInt(dealId) <= BigInt(cases[cases.length - 1].dealId)))
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_PAGINATION_UNVERIFIED");
      seen.add(dealId);
      let fileCount: number;
      try {
        fileCount = readFileField({ UF_CRM_ANK_PRIMARY_DOCS: raw.UF_CRM_ANK_PRIMARY_DOCS ?? null }).refs.length;
      } catch {
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_FILE_COUNT_UNVERIFIED");
      }
      const title = scalar(raw.TITLE);
      cases.push({
        dealId, title, clientName: scalar(raw[mandatoryFields.clientName]),
        procedure: scalar(raw[mandatoryFields.procedure]),
        hasIin: /^\d{12}$/.test(scalar(raw.UF_CRM_AI_IIN)),
        missingFields: (Object.keys(mandatoryFields) as MissingField[])
          .filter((field) => !scalar(raw[mandatoryFields[field]])),
        fileCount, intakeStyleTitle: /\[whatcrm\]/i.test(title),
      });
    }
    if (json.next === undefined || json.next === null) {
      if (expectedTotal !== undefined && expectedTotal !== cases.length)
        throw new LawyerDeliveryAuditError("LAWYER_AUDIT_COHORT_INCOMPLETE");
      return {
        checkedAt: new Date().toISOString(), categoryId, stageId, stageName: target.NAME,
        complete: true, count: cases.length, cases,
      };
    }
    if (!Number.isInteger(json.next) || Number(json.next) !== start + 50 || json.result.length !== 50)
      throw new LawyerDeliveryAuditError("LAWYER_AUDIT_PAGINATION_UNVERIFIED");
    start = Number(json.next);
  }
  throw new LawyerDeliveryAuditError("LAWYER_AUDIT_COHORT_LIMIT_EXCEEDED");
}
