// Owner-only, read-only format discovery. Client names and titles are compared
// in memory and never written to the artifact or logs. No repair is performed.
import { writeFile } from "node:fs/promises";

const origin = "https://assessment.anti-krizis.kz";
const prefixes = { "199": "ВП", "201": "СБ", "203": "ВСБ", "205": "График" };
const allowedMissing = new Set(["clientName", "procedure", "contractNumber", "contractDate", "card"]);
const normalize = (text) => text.trim().replace(/\s+/gu, " ");
const fold = (text) => text.toLocaleLowerCase("ru");
const report = {
  checkedAt: new Date().toISOString(), authenticated: false, complete: false,
  count: 0, cases: [], formatCounts: [], failure: null,
};
let cookie = "";
async function request(path, body) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET", redirect: "manual",
    headers: { cookie, origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Object.assign(Error("LAWYER_NAMES_HTTP_FAILURE"), { status: response.status });
  if (path === "/api/session") cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  return response.json();
}
try {
  if (!process.env.ASSESSMENT_TEST_PASSWORD) throw Error("LAWYER_NAMES_CREDENTIAL_UNAVAILABLE");
  await request("/api/session", { worker: "ali", password: process.env.ASSESSMENT_TEST_PASSWORD });
  report.authenticated = true;
  const cohort = await request("/api/lawyer-delivery-audit");
  if (!cohort || cohort.complete !== true || cohort.categoryId !== "1" || cohort.stageId !== "C1:NEW" ||
      typeof cohort.checkedAt !== "string" || !Number.isFinite(Date.parse(cohort.checkedAt)) ||
      !Number.isInteger(cohort.count) || cohort.count < 0 || cohort.count > 500 ||
      !Array.isArray(cohort.cases) || cohort.cases.length !== cohort.count)
    throw Error("LAWYER_NAMES_COHORT_UNVERIFIED");
  const seen = new Set();
  const cases = cohort.cases.map((row) => {
    if (!row || typeof row.dealId !== "string" || !/^[1-9]\d{0,19}$/.test(row.dealId) || seen.has(row.dealId) ||
        typeof row.title !== "string" || typeof row.clientName !== "string" || typeof row.procedure !== "string" ||
        typeof row.intakeStyleTitle !== "boolean" || !Number.isInteger(row.fileCount) || row.fileCount < 0 ||
        !Array.isArray(row.missingFields) || !row.missingFields.every((field) => allowedMissing.has(field)) ||
        new Set(row.missingFields).size !== row.missingFields.length)
      throw Error("LAWYER_NAMES_COHORT_UNVERIFIED");
    seen.add(row.dealId);
    const title = normalize(row.title), name = normalize(row.clientName);
    // Unknown enum contents are not exported, even if the CRM field unexpectedly
    // contains free text. Prefix labels always come from this fixed map.
    const procedure = Object.hasOwn(prefixes, row.procedure) ? row.procedure : row.procedure === "" ? "" : "unmapped";
    const prefixLabel = prefixes[procedure] ?? null;
    const prefixed = prefixLabel && name ? prefixLabel + " " + name : null;
    return {
      dealId: row.dealId, procedure, prefixLabel, hasClientName: Boolean(name),
      intakeStyleTitle: row.intakeStyleTitle, missingFields: row.missingFields, fileCount: row.fileCount,
      namingMatch: {
        fioExact: Boolean(name) && title === name,
        fioCaseInsensitive: Boolean(name) && fold(title) === fold(name),
        procedurePrefixExact: prefixed !== null && title === prefixed,
        procedurePrefixCaseInsensitive: prefixed !== null && fold(title) === fold(prefixed),
      },
    };
  });
  const formatCounts = new Map();
  for (const row of cases) {
    const count = formatCounts.get(row.procedure) ?? {
      procedure: row.procedure, prefixLabel: row.prefixLabel, total: 0, withClientName: 0, intakeStyleTitles: 0,
      fioExact: 0, fioCaseInsensitive: 0, procedurePrefixExact: 0, procedurePrefixCaseInsensitive: 0, unmatched: 0,
    };
    count.total++;
    count.withClientName += Number(row.hasClientName);
    count.intakeStyleTitles += Number(row.intakeStyleTitle);
    for (const [format, matches] of Object.entries(row.namingMatch)) count[format] += Number(matches);
    if (!row.namingMatch.fioCaseInsensitive && !row.namingMatch.procedurePrefixCaseInsensitive) count.unmatched++;
    formatCounts.set(row.procedure, count);
  }
  Object.assign(report, {
    sourceCheckedAt: new Date(cohort.checkedAt).toISOString(), complete: true,
    count: cohort.count, cases, formatCounts: [...formatCounts.values()],
  });
} catch (error) {
  report.failure = {
    code: ["LAWYER_NAMES_CREDENTIAL_UNAVAILABLE", "LAWYER_NAMES_HTTP_FAILURE", "LAWYER_NAMES_COHORT_UNVERIFIED"].includes(error.message)
      ? error.message : "LAWYER_NAMES_REQUEST_FAILED",
    status: Number.isInteger(error.status) ? error.status : null,
  };
  process.exitCode = 1;
}
await writeFile("lawyer-names-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ complete: report.complete, count: report.count, formatCounts: report.formatCounts, failure: report.failure }));
