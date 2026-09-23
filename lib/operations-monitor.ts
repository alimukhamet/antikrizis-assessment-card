import release from "./assessment-release.json";
import type { Actor } from "./worker-session";

export const operationsActions = [
  "page",
  "open_case",
  "draft",
  "analysis",
  "review",
  "check",
  "contract",
  "upload",
  "credentials",
  "handoff",
  "intake",
] as const;
export const clientCodes = [
  "PAGE_OPEN",
  "MONITOR_PROBE",
  "JS_ERROR",
  "UNHANDLED_REJECTION",
  "ASSET_LOAD_FAILED",
  "NETWORK_FAILURE",
  "REQUEST_TIMEOUT",
  "API_HTTP_FAILURE",
  "ACTION_STALLED",
  "EXTRACTION_VERSION_CHANGED",
  "DRAFT_CHANGED",
  "CONTRACT_OPERATION_TIMEOUT",
  "INVALID_SERVER_RESPONSE",
  "SERVER_UNAVAILABLE",
  "CRM_INTAKE_FAILED",
] as const;
export type OperationEvent = {
  id: string;
  dealId: string | null;
  action: (typeof operationsActions)[number];
  code: string;
  clientVersion: string;
  status: number;
  asset: string | null;
  line: number | null;
};
export class OperationsError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export function validateOperationEvent(
  raw: Record<string, unknown>,
): OperationEvent {
  const id = raw.id,
    dealId = raw.dealId ?? null,
    action = raw.action,
    code = raw.code,
    clientVersion = raw.clientVersion,
    status = raw.status ?? 0,
    asset = raw.asset ?? null,
    line = raw.line ?? null;
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) ||
    (dealId !== null &&
      (typeof dealId !== "string" || !/^\d{1,20}$/.test(dealId))) ||
    !operationsActions.includes(action as OperationEvent["action"]) ||
    !clientCodes.includes(code as (typeof clientCodes)[number]) ||
    typeof clientVersion !== "string" ||
    !/^assessment-[a-zA-Z0-9.-]{1,65}$/.test(clientVersion) ||
    !Number.isInteger(status) ||
    Number(status) < 0 ||
    Number(status) > 599 ||
    (asset !== null &&
      (typeof asset !== "string" ||
        !/^\/[a-zA-Z0-9/_.-]{1,180}\.(?:m?js|css)$/.test(asset))) ||
    (line !== null &&
      (!Number.isInteger(line) || Number(line) < 0 || Number(line) > 1000000))
  )
    throw new OperationsError("INVALID_OPERATION_EVENT");
  return {
    id,
    dealId: dealId as string | null,
    action: action as OperationEvent["action"],
    code: String(code),
    clientVersion,
    status: Number(status),
    asset: asset as string | null,
    line: line as number | null,
  };
}
export function operationRoute(
  path: string,
): { dealId: string | null; action: OperationEvent["action"] } | null {
  const match = /^\/api\/assessment\/(\d{1,20})(?:\/([^/?]+))?/.exec(path);
  if (!match) return null;
  const actions: Record<string, OperationEvent["action"]> = {
    draft: "draft",
    documents: "analysis",
    "document-reviews": "review",
    reviews: "review",
    "review-batch": "review",
    "gkb-reviews": "review",
    check: "check",
    submission: "contract",
    uploads: "upload",
    credentials: "credentials",
    handoff: "handoff",
    "crm-intake": "intake",
    "crm-documents": "upload",
  };
  return { dealId: match[1], action: actions[match[2]] || "open_case" };
}
export class OperationsRepository {
  constructor(private db: D1Database) {}
  async prune(now = new Date().toISOString()) {
    const before = new Date(Date.parse(now) - 30 * 86400000).toISOString();
    await this.db
      .prepare("DELETE FROM assessment_operations_events WHERE created_at<?")
      .bind(before)
      .run();
  }
  async record(
    event: OperationEvent,
    actorId: string,
    now = new Date().toISOString(),
  ) {
    const since = new Date(Date.parse(now) - 3600000).toISOString();
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO assessment_operations_events
   (id,actor_id,deal_id,action,code,client_version,server_version,status,asset,line,created_at)
   SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM assessment_operations_events WHERE actor_id=? AND created_at>=?)<120`,
      )
      .bind(
        event.id,
        actorId,
        event.dealId,
        event.action,
        event.code,
        event.clientVersion,
        release.version,
        event.status,
        event.asset,
        event.line,
        now,
        actorId,
        since,
      )
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }
  async summary(now = new Date().toISOString()) {
    const since = new Date(Date.parse(now) - 86400000).toISOString(),
      stuckBefore = new Date(Date.parse(now) - 15 * 60000).toISOString();
    const events = await this.db
      .prepare(
        `SELECT deal_id,action,code,client_version,server_version,status,asset,line,COUNT(*) AS occurrences,MIN(created_at) AS first_seen,MAX(created_at) AS last_seen
   FROM assessment_operations_events WHERE created_at>=? AND code NOT IN ('MONITOR_PROBE','PAGE_OPEN')
   GROUP BY deal_id,action,code,client_version,server_version,status,asset,line ORDER BY last_seen DESC LIMIT 200`,
      )
      .bind(since)
      .all();
    const stale = await this.db
      .prepare(
        `SELECT deal_id,client_version,MAX(created_at) AS last_seen FROM assessment_operations_events WHERE created_at>=? AND code='PAGE_OPEN' AND client_version<>server_version GROUP BY deal_id,client_version ORDER BY last_seen DESC LIMIT 100`,
      )
      .bind(since)
      .all();
    const activeCases = await this.db
      .prepare(
        `SELECT deal_id,MAX(created_at) AS last_seen FROM assessment_operations_events WHERE created_at>=? AND deal_id IS NOT NULL AND code='PAGE_OPEN' GROUP BY deal_id ORDER BY last_seen DESC LIMIT 100`,
      )
      .bind(since)
      .all();
    const stuck = [];
    for (const [table, action] of [
      ["assessment_submissions", "contract"],
      ["assessment_upload_manifests", "upload"],
      ["assessment_handoffs", "handoff"],
    ] as const) {
      const extra =
        table === "assessment_submissions"
          ? " OR s.state='prepared' OR (s.state='verified' AND s.history_state NOT IN ('verified','cancelled'))"
          : "";
      const rows = await this.db
        .prepare(
          `SELECT c.external_id AS deal_id,s.id AS operation_id,s.state,s.outcome_code,s.updated_at${table === "assessment_submissions" ? ",s.history_state,s.history_outcome_code" : ""}
    FROM ${table} s JOIN assessment_cases c ON c.id=s.case_id WHERE s.updated_at<? AND (s.state IN ('writing','uncertain')${extra}) ORDER BY s.updated_at LIMIT 100`,
        )
        .bind(stuckBefore)
        .all();
      stuck.push(...rows.results.map((row) => ({ ...row, action })));
    }
    // A verified stage change proves only the handoff itself. Missing assessment
    // delivery remains actionable until both receipts exist for the current
    // identity, even when nobody has opened the case in the last 24 hours.
    const deliveryGaps = await this.db
      .prepare(
        `SELECT c.external_id AS deal_id,h.id AS operation_id,h.state,h.updated_at,
      'handoff' AS action,'HANDOFF_ASSESSMENT_NOT_DELIVERED' AS code
    FROM assessment_handoffs h JOIN assessment_cases c ON c.id=h.case_id
    WHERE h.state='verified' AND NOT EXISTS (
      SELECT 1 FROM assessment_submissions s WHERE s.case_id=c.id
      AND s.identity_revision=c.identity_revision AND s.state='verified' AND s.history_state='verified'
    ) ORDER BY h.updated_at,h.id LIMIT 200`,
      )
      .all();
    const activity = await this.db
      .prepare(
        "SELECT MAX(created_at) AS last_seen,COUNT(*) AS samples FROM assessment_operations_events WHERE created_at>=?",
      )
      .bind(since)
      .first();
    return {
      version: release.version,
      checkedAt: now,
      windowHours: 24,
      events: events.results,
      staleClients: stale.results,
      activeCases: activeCases.results,
      stuck,
      deliveryGaps: deliveryGaps.results,
      activity,
    };
  }
}
export async function operationsRepository() {
  const { env } = await import("cloudflare:workers");
  const db = (env as typeof env & { DB?: D1Database }).DB;
  if (!db) throw new OperationsError("MONITOR_UNAVAILABLE", 503);
  return new OperationsRepository(db);
}

/** Diagnostics never consume request bodies, change business responses, or emit raw exception messages. */
export async function recordServerFailure(
  db: D1Database,
  actor: Actor,
  path: string,
  status: number,
) {
  const route = operationRoute(path);
  if (!route || status < 500) return;
  try {
    await new OperationsRepository(db).record(
      {
        id: crypto.randomUUID(),
        ...route,
        code: "SERVER_HTTP_FAILURE",
        clientVersion: release.version,
        status,
        asset: null,
        line: null,
      },
      actor.id,
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "OPERATIONS_RECORD_FAILED",
        action: route.action,
        status,
      }),
    );
  }
}
