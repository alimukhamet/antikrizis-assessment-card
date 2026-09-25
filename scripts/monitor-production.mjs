// Bounded read-only production checks. No answers, names, document contents,
// credentials, response bodies or raw exception strings enter logs/artifacts.
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const release = JSON.parse(
  await readFile(
    new URL("../lib/assessment-release.json", import.meta.url),
    "utf8",
  ),
);
const origin = "https://assessment.anti-krizis.kz";
let cookie = "";
const report = {
  checkedAt: new Date().toISOString(),
  healthy: false,
  checks: [],
  incidents: null,
  lawyerWaiting: null,
  cases: [],
  failure: null,
  failures: [],
};
// Only this bounded vocabulary may leave the owner endpoint. Never export raw
// response bodies, exception messages, URLs or arbitrary diagnostic properties.
async function auditFailure(response) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  try {
    let text = "", bytes = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 4096) return {};
      text += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(text + decoder.decode());
    const codes = ["BITRIX_NOT_CONFIGURED", "LAWYER_AUDIT_UNAVAILABLE", "LAWYER_AUDIT_CRM_UNAVAILABLE",
      "LAWYER_AUDIT_RESPONSE_UNVERIFIED", "LAWYER_AUDIT_RESPONSE_TOO_LARGE", "LAWYER_AUDIT_STAGE_UNVERIFIED",
      "LAWYER_AUDIT_PAGINATION_UNVERIFIED", "LAWYER_AUDIT_COHORT_LIMIT_EXCEEDED", "LAWYER_AUDIT_COHORT_CHANGED",
      "LAWYER_AUDIT_FILE_COUNT_UNVERIFIED", "LAWYER_AUDIT_COHORT_INCOMPLETE"];
    if (!codes.includes(data?.error)) return {};
    const detail = { cause: data.error }, upstream = data.upstream;
    if (["crm.status.list", "crm.deal.list"].includes(upstream?.method) &&
        ["timeout", "transport", "http", "invalid_response"].includes(upstream?.reason)) {
      detail.upstream = { method: upstream.method, reason: upstream.reason };
      if (Number.isInteger(upstream.status) && upstream.status >= 100 && upstream.status <= 599)
        detail.upstream.status = upstream.status;
    }
    return detail;
  } catch { return {}; }
  finally { await reader.cancel().catch(() => {}); }
}
function recordFailure(error) {
  const failure = {
    code: ["MONITOR_CREDENTIAL_UNAVAILABLE", "MONITOR_WRITE_FAILED", "SERVICE_UNCONFIGURED",
      "MONITOR_RESPONSE_INVALID", "QUESTIONNAIRE_UNAVAILABLE", "CLIENT_RELEASE_MISMATCH",
      "HTTP_FAILURE", "LAWYER_WAITING_MONITOR_FAILED"].includes(error.message)
      ? error.message : "MONITOR_REQUEST_FAILED",
    status: error.status || null,
    route: error.path || null,
    ...(error.scope === "monitoring" ? { scope: "monitoring" } : {}),
    ...(error.auditDetail || {}),
  };
  report.failures.push(failure);
  report.failure ??= failure;
  process.exitCode = 1;
}
async function request(path, body, timeoutMs = 20000) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: { cookie, origin, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (path === "/api/session" && body)
    cookie = response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
  if (!response.ok)
    throw Object.assign(Error("HTTP_FAILURE"), {
      status: response.status,
      path: path.replace(/\/\d+(?=\/|$)/g, "/:deal"),
      ...(path === "/api/lawyer-delivery-audit" ? { auditDetail: await auditFailure(response) } : {}),
    });
  return response.json();
}
try {
  if (!process.env.ASSESSMENT_TEST_PASSWORD)
    throw Error("MONITOR_CREDENTIAL_UNAVAILABLE");
  await request("/api/session", {
    worker: "ali",
    password: process.env.ASSESSMENT_TEST_PASSWORD,
  });
  report.checks.push("staff_login");
  const status = await request("/api/status");
  if (!status.ok) throw Error("SERVICE_UNCONFIGURED");
  report.checks.push("service_configuration");
  const probe = await request("/api/operations-monitor", {
    id: randomUUID(),
    dealId: null,
    action: "page",
    code: "MONITOR_PROBE",
    clientVersion: release.version,
  });
  if (!probe.ok || !probe.accepted) throw Error("MONITOR_WRITE_FAILED");
  report.checks.push("diagnostic_write");
  const health = await request("/api/operations-monitor");
  if (
    !Array.isArray(health.events) ||
    !Array.isArray(health.stuck) ||
    !Array.isArray(health.deliveryGaps)
  )
    throw Error("MONITOR_RESPONSE_INVALID");
  report.incidents = health;
  report.checks.push("operations_storage");
  const response = await fetch(origin + "/questionnaire.html", {
    headers: { cookie },
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error("QUESTIONNAIRE_UNAVAILABLE");
  const html = await response.text();
  if (
    !html.includes("/operations-monitor.js") ||
    !html.includes('data-assessment-version="' + health.version + '"')
  )
    throw Error("CLIENT_RELEASE_MISMATCH");
  report.checks.push("client_release");
  try {
    const cohort = await request("/api/lawyer-delivery-audit", undefined, 60000);
    const missingFields = new Set(["clientName", "procedure", "contractNumber", "contractDate", "card"]);
    if (!cohort || cohort.complete !== true || cohort.categoryId !== "1" || cohort.stageId !== "C1:NEW" ||
        typeof cohort.checkedAt !== "string" || !Number.isFinite(Date.parse(cohort.checkedAt)) ||
        !Number.isInteger(cohort.count) || cohort.count < 0 || cohort.count > 500 ||
        !Array.isArray(cohort.cases) || cohort.cases.length !== cohort.count)
      throw Error("LAWYER_WAITING_RESPONSE_INVALID");
    const seen = new Set();
    const cases = cohort.cases.map((row) => {
      if (!row || typeof row.dealId !== "string" || !/^[1-9]\d{0,19}$/.test(row.dealId) || seen.has(row.dealId) ||
          typeof row.intakeStyleTitle !== "boolean" || typeof row.hasIin !== "boolean" ||
          !Number.isInteger(row.fileCount) || row.fileCount < 0 ||
          !Array.isArray(row.missingFields) || !row.missingFields.every((field) => missingFields.has(field)) ||
          new Set(row.missingFields).size !== row.missingFields.length)
        throw Error("LAWYER_WAITING_RESPONSE_INVALID");
      seen.add(row.dealId);
      // Never spread owner endpoint rows: names, titles and CRM values stay out
      // of both artifacts and workflow logs. These are discovery signals only.
      return {
        dealId: row.dealId, intakeStyleTitle: row.intakeStyleTitle,
        missingFields: row.missingFields, fileCount: row.fileCount, hasIin: row.hasIin,
      };
    }).filter((row) => row.intakeStyleTitle || row.missingFields.length > 0);
    report.lawyerWaiting = {
      checkedAt: new Date(cohort.checkedAt).toISOString(), count: cohort.count, complete: true,
      classification: "discovery_signals", cases,
    };
    report.checks.push("lawyer_waiting_cohort");
  } catch (error) {
    recordFailure(Object.assign(Error("LAWYER_WAITING_MONITOR_FAILED"), {
      scope: "monitoring", status: error.status || null, path: "/api/lawyer-delivery-audit",
      auditDetail: error.auditDetail,
    }));
  }
  // Keep a stable canary and rotate affected/recently opened cases so old incidents
  // cannot starve new employee work of checks.
  const candidates = [
    ...new Set(
      [
        ...health.deliveryGaps.map((v) => v.deal_id),
        ...(report.lawyerWaiting?.cases || []).map((v) => v.dealId),
        ...health.stuck.map((v) => v.deal_id),
        ...health.events.map((v) => v.deal_id),
        ...(health.activeCases || []).map((v) => v.deal_id),
      ].filter((v) => /^\d{1,20}$/.test(v || "")),
    ),
  ];
  const offset = candidates.length
    ? Math.floor(Date.now() / 900000) % candidates.length
    : 0;
  const ids = [
    ...new Set(
      [
        "12103",
        ...candidates.slice(offset),
        ...candidates.slice(0, offset),
      ].filter((v) => /^\d{1,20}$/.test(v || "")),
    ),
  ].slice(0, 3);
  for (const id of ids) {
    const root = "/api/assessment/" + id;
    try {
      await request(root);
    } catch (error) {
      if (error.status === 404 && id !== "12103") {
        report.cases.push({ dealId: id, unavailable: true });
        continue;
      }
      throw error;
    }
    const { draft } = await request(root + "/draft");
    const result = { dealId: id, draftPresent: !!draft };
    if (draft) {
      const checked = await request(root + "/check", {
        payload: draft.payload,
        bindings: [],
      });
      Object.assign(result, {
        revision: draft.revision,
        ready: checked.readyToSubmit,
        answerIssues: checked.issues?.length ?? null,
        documentIssues: checked.documents?.issues?.length ?? null,
        missingLoans: checked.documents?.loanCoverage?.missing ?? null,
        duplicateLoans: checked.documents?.loanCoverage?.duplicates ?? null,
        blockerCodes: [
          ...new Set(
            [
              ...(checked.issues || []),
              ...(checked.documents?.issues || []),
              ...(checked.evidence?.issues || []),
            ]
              .map((v) => v.code)
              .filter(
                (v) => typeof v === "string" && /^[A-Z_0-9]{1,80}$/.test(v),
              ),
          ),
        ],
      });
    }
    report.cases.push(result);
  }
  report.checks.push("bitrix_and_saved_cases");
  // Availability and unfinished delivery are separate. Delivery gaps remain in
  // incidents even outside the bounded sample; business readiness is not uptime.
  report.healthy = report.failures.length === 0;
} catch (error) {
  recordFailure(error);
}
await writeFile("production-monitor.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    healthy: report.healthy,
    checks: report.checks,
    events: report.incidents?.events.length,
    stuck: report.incidents?.stuck.length,
    deliveryGaps: report.incidents?.deliveryGaps.length,
    lawyerWaitingSignals: report.lawyerWaiting?.cases.length,
    stale: report.incidents?.staleClients.length,
    failure: report.failure,
  }),
);
