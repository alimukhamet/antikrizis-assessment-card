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
  cases: [],
  failure: null,
};
async function request(path, body) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: { cookie, origin, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
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
  if (!Array.isArray(health.events) || !Array.isArray(health.stuck))
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
  // Keep a stable canary and rotate affected/recently opened cases so old incidents
  // cannot starve new employee work of checks.
  const candidates = [
    ...new Set(
      [
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
  report.healthy = true;
} catch (error) {
  report.failure = {
    code: [
      "MONITOR_CREDENTIAL_UNAVAILABLE",
      "MONITOR_WRITE_FAILED",
      "SERVICE_UNCONFIGURED",
      "MONITOR_RESPONSE_INVALID",
      "QUESTIONNAIRE_UNAVAILABLE",
      "CLIENT_RELEASE_MISMATCH",
      "HTTP_FAILURE",
    ].includes(error.message)
      ? error.message
      : "MONITOR_REQUEST_FAILED",
    status: error.status || null,
    route: error.path || null,
  };
  process.exitCode = 1;
}
await writeFile("production-monitor.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    healthy: report.healthy,
    checks: report.checks,
    events: report.incidents?.events.length,
    stuck: report.incidents?.stuck.length,
    stale: report.incidents?.staleClients.length,
    failure: report.failure,
  }),
);
