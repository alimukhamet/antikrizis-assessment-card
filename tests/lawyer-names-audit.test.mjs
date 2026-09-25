import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("scripts/audit-lawyer-names.mjs", "utf8").replace(/^import .*;\n/gm, "");
const row = (id, procedure, clientName, title, extra = {}) => ({
  dealId: String(900000 + id), procedure, clientName, title,
  intakeStyleTitle: /\[whatcrm\]/i.test(title), missingFields: clientName ? [] : ["clientName"], fileCount: 3,
  rawIin: "private-iin", card: "private-card", filename: "private-key", ...extra,
});
const cohort = (cases) => ({
  checkedAt: "2026-09-23T12:00:00.000Z", categoryId: "1", stageId: "C1:NEW", complete: true, count: cases.length, cases,
});
async function run(response, options = {}) {
  const outputs = {}, calls = [], logs = [], process = { env: options.noPassword ? {} : { ASSESSMENT_TEST_PASSWORD: "private-password" } };
  await vm.runInNewContext("(async()=>{" + source + "})()", {
    process, AbortSignal,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method });
      assert.equal(init.redirect, "manual");
      if (path === "/api/session") {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { worker: "ali", password: "private-password" });
        return Response.json({}, { headers: { "set-cookie": "session=private-cookie" } });
      }
      assert.equal(path, "/api/lawyer-delivery-audit", "only the cohort read is allowed after login");
      assert.equal(init.method, "GET");
      if (options.failure) throw Error("private-network-details");
      return Response.json(response, { status: options.status ?? 200 });
    },
    writeFile: async (path, text) => { outputs[path] = text; },
    console: { log: (text) => logs.push(text) },
  });
  const serialized = outputs["lawyer-names-audit.json"];
  assert.ok(serialized);
  assert.equal(/private-/i.test(serialized + logs.join("")), false, "no client values, credentials or raw errors reach outputs");
  return { report: JSON.parse(serialized), calls, logs, process };
}

test("naming audit compares all cohort rows against only fixed formats, redacts names and aggregates per procedure", async () => {
  const name = "PRIVATE-CLIENT Әли";
  const cases = [
    row(1, "199", " " + name + "\n", "PRIVATE-CLIENT   Әли"),
    row(2, "199", name, name.toLocaleLowerCase("ru")),
    row(3, "199", name, " ВП\t " + name),
    row(4, "201", name, "сб " + name.toLocaleLowerCase("ru")),
    row(5, "203", name, "ВСБ " + name),
    row(6, "205", name, "График " + name),
    row(7, "199", name, "ВП - " + name),
    row(8, "199", name, name + " - [whatcrm] line #21"),
    row(9, "", "", ""),
    row(10, "private-enum", name, name),
    row(11, "199", name, "ВП " + name + " private-suffix"),
    row(12, "205", name, name),
    row(13, "201", name, "СБ " + name),
  ];
  const { report, calls, process } = await run(cohort(cases));
  assert.equal(report.complete, true);
  assert.equal(report.count, 13);
  assert.equal(report.cases.length, 13);
  assert.equal(process.exitCode, undefined);
  assert.deepEqual(calls, [{ path: "/api/session", method: "POST" }, { path: "/api/lawyer-delivery-audit", method: "GET" }]);
  assert.deepEqual(report.cases[0].namingMatch, { fioExact: true, fioCaseInsensitive: true, procedurePrefixExact: false, procedurePrefixCaseInsensitive: false });
  assert.equal(report.cases[1].namingMatch.fioExact, false);
  assert.equal(report.cases[1].namingMatch.fioCaseInsensitive, true);
  assert.equal(report.cases[2].namingMatch.procedurePrefixExact, true);
  assert.equal(report.cases[3].namingMatch.procedurePrefixExact, false);
  assert.equal(report.cases[3].namingMatch.procedurePrefixCaseInsensitive, true);
  assert.equal(report.cases[4].prefixLabel, "ВСБ");
  assert.equal(report.cases[4].namingMatch.procedurePrefixExact, true);
  assert.equal(report.cases[5].prefixLabel, "График");
  assert.equal(report.cases[5].namingMatch.procedurePrefixExact, true);
  assert.ok(Object.values(report.cases[6].namingMatch).every((match) => match === false));
  assert.equal(report.cases[7].intakeStyleTitle, true);
  assert.equal(report.cases[8].hasClientName, false);
  assert.ok(Object.values(report.cases[8].namingMatch).every((match) => match === false), "empty name/title is never a match");
  assert.equal(report.cases[9].procedure, "unmapped");
  assert.equal(report.cases[9].prefixLabel, null);
  assert.deepEqual(report.formatCounts.find((entry) => entry.procedure === "199"), {
    procedure: "199", prefixLabel: "ВП", total: 6, withClientName: 6, intakeStyleTitles: 1,
    fioExact: 1, fioCaseInsensitive: 2, procedurePrefixExact: 1, procedurePrefixCaseInsensitive: 1, unmatched: 3,
  });
  assert.deepEqual(Object.keys(report.cases[0]).sort(), ["dealId", "procedure", "prefixLabel", "hasClientName", "intakeStyleTitle", "missingFields", "fileCount", "namingMatch"].sort());
});

test("incomplete or invalid naming cohorts fail closed without exporting partial rows", async () => {
  const base = cohort([row(1, "199", "private-client", "private-client")]);
  for (const invalid of [
    { ...base, complete: false }, { ...base, count: 501 }, { ...base, count: 2 },
    { ...base, stageId: "C1:OTHER" }, { ...base, categoryId: "13" },
    { ...base, checkedAt: "private-date" },
    { ...base, cases: [{ ...base.cases[0], missingFields: ["private-card-value"] }] },
    { ...base, cases: [{ ...base.cases[0], fileCount: -1 }] },
    { ...base, cases: [{ ...base.cases[0], clientName: { value: "private-name" } }] },
    { ...base, count: 2, cases: [base.cases[0], base.cases[0]] },
  ]) {
    const { report, process } = await run(invalid);
    assert.equal(report.complete, false);
    assert.equal(report.failure.code, "LAWYER_NAMES_COHORT_UNVERIFIED");
    assert.equal(process.exitCode, 1);
    assert.deepEqual(report.cases, []);
    assert.deepEqual(report.formatCounts, []);
  }
});

test("failed access and network errors remain sanitized and never trigger business writes", async () => {
  for (const [options, code] of [
    [{ noPassword: true }, "LAWYER_NAMES_CREDENTIAL_UNAVAILABLE"],
    [{ status: 503 }, "LAWYER_NAMES_HTTP_FAILURE"],
    [{ failure: true }, "LAWYER_NAMES_REQUEST_FAILED"],
  ]) {
    const { report, calls, process } = await run({ error: "private-upstream" }, options);
    assert.equal(report.failure.code, code);
    assert.equal(report.complete, false);
    assert.equal(process.exitCode, 1);
    assert.ok(calls.every((call) => call.method === "GET" || call.path === "/api/session"));
  }
});

test("optional workflow naming mode skips normal audit and recovery and retains only one-day diagnostic artifacts", () => {
  const workflow = fs.readFileSync(".github/workflows/audit-live-tools.yml", "utf8");
  assert.match(workflow, /audit_lawyer_names:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: false/);
  assert.match(workflow, /if: inputs\.audit_lawyer_names == true[\s\S]*?run: node scripts\/audit-lawyer-names\.mjs/);
  assert.match(workflow, /name: Recover an explicitly selected saved submission\n\s+if: inputs\.audit_lawyer_names != true && inputs\.repair_title_deal_id == '' && inputs\.recover_request_id != ''/);
  assert.match(workflow, /name: Inspect existing cases and optionally refresh derived document analysis\n\s+if: inputs\.audit_lawyer_names != true/);
  assert.match(workflow, /name: lawyer-names-audit\n\s+path: lawyer-names-audit\.json\n\s+retention-days: 1/);
});
