import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { httpHeaders } from "./bitrix-headers-helper.mjs";

function load(file, dependencies = {}, extra = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, require: (name) => {
      if (!(name in dependencies)) throw Error("Unexpected import: " + name);
      return dependencies[name];
    }, AbortSignal, TextDecoder, Request, Response, ...extra,
  });
  return exports;
}
const upload = load("lib/crm/document-upload.ts", {
  "./http-headers": httpHeaders, "../documents/repository": {},
});
const audit = load("lib/crm/lawyer-delivery-audit.ts", {
  "./http-headers": httpHeaders, "./document-upload": upload,
});
const stages = [{ STATUS_ID: "C1:NEW", ENTITY_ID: "DEAL_STAGE_1", NAME: " В  ОЖИДАНИИ \n" }];
const deal = (id, extra = {}) => ({
  ID: String(id), TITLE: "Synthetic - [whatcrm] line #21", CATEGORY_ID: "1", STAGE_ID: "C1:NEW",
  UF_CRM_1773669702495: "Synthetic Client", UF_CRM_AI_IIN: "000000000010",
  UF_CRM_1773655613972: "199", UF_CRM_AI_DOGNUM: "TEST-ONLY", UF_CRM_1778499926844: "2026-09-23",
  UF_CRM_AI_CARD: "private-card", UF_CRM_ANK_PRIMARY_DOCS: [{ id: 45, filename: "private-key", urlMachine: "private-url" }],
  unselected: "private-unselected", ...extra,
});
function transport({ stageRows = stages, page = () => ({ result: [] }) } = {}) {
  const calls = [];
  const send = async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1), body = JSON.parse(options.body);
    calls.push({ method, body });
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    if (method === "crm.status.list.json") {
      assert.deepEqual(body, { filter: { ENTITY_ID: "DEAL_STAGE_1" } });
      return Response.json({ result: stageRows });
    }
    assert.equal(method, "crm.deal.list.json", "only read-only Bitrix methods are permitted");
    assert.deepEqual(body.filter, { CATEGORY_ID: "1", STAGE_ID: "C1:NEW" });
    assert.deepEqual(body.order, { ID: "ASC" });
    assert.deepEqual(body.select.slice().sort(), [
      "ID", "TITLE", "CATEGORY_ID", "STAGE_ID", "UF_CRM_AI_IIN", "UF_CRM_1773669702495",
      "UF_CRM_1773655613972", "UF_CRM_AI_DOGNUM", "UF_CRM_1778499926844", "UF_CRM_AI_CARD", "UF_CRM_ANK_PRIMARY_DOCS",
    ].sort());
    return Response.json(page(body.start));
  };
  return { send, calls };
}
const run = (options) => {
  const fixture = transport(options);
  return { ...fixture, result: audit.auditLawyerDelivery("https://synthetic.invalid/rest/test/", fixture.send) };
};

test("lawyer audit verifies the exact waiting stage, reads every page and exposes only approved case metadata", async () => {
  const rows = Array.from({ length: 52 }, (_, i) => deal(900001 + i));
  rows[51] = deal(900052, {
    TITLE: "Existing approved name", UF_CRM_1773669702495: "", UF_CRM_1773655613972: null,
    UF_CRM_AI_DOGNUM: " ", UF_CRM_1778499926844: false, UF_CRM_AI_CARD: null,
    UF_CRM_AI_IIN: "", UF_CRM_ANK_PRIMARY_DOCS: [],
  });
  const fixture = run({ page: (start) => ({ result: rows.slice(start, start + 50), total: 52, ...(start === 0 ? { next: 50 } : {}) }) });
  const result = JSON.parse(JSON.stringify(await fixture.result));
  assert.equal(result.complete, true);
  assert.equal(result.count, 52);
  assert.equal(result.stageId, "C1:NEW");
  assert.equal(result.categoryId, "1");
  assert.deepEqual(fixture.calls.filter((c) => c.method === "crm.deal.list.json").map((c) => c.body.start), [0, 50]);
  assert.deepEqual(result.cases[0], {
    dealId: "900001", title: rows[0].TITLE, clientName: "Synthetic Client", procedure: "199",
    hasIin: true, missingFields: [], fileCount: 1, intakeStyleTitle: true,
  });
  assert.deepEqual(result.cases[51].missingFields, ["clientName", "procedure", "contractNumber", "contractDate", "card"]);
  assert.equal(result.cases[51].hasIin, false);
  assert.equal(result.cases[51].fileCount, 0);
  assert.equal(result.cases[51].intakeStyleTitle, false);
  assert.equal(JSON.stringify(result).includes("private-"), false);
  assert.equal(JSON.stringify(result).includes("000000000010"), false);
});

test("stage ambiguity, renamed target and similarly named alternate stage never select another cohort", async () => {
  for (const stageRows of [
    [], [stages[0], stages[0]], [{ ...stages[0], ENTITY_ID: "DEAL_STAGE_13" }],
    [{ ...stages[0], NAME: "Другая стадия" }],
    [{ ...stages[0], STATUS_ID: "C1:OTHER" }],
    [{ ...stages[0], NAME: "Другая стадия" }, { ...stages[0], STATUS_ID: "C1:OTHER" }],
  ]) {
    const fixture = run({ stageRows });
    await assert.rejects(fixture.result, /LAWYER_AUDIT_STAGE_UNVERIFIED/);
    assert.equal(fixture.calls.length, 1);
  }
});

test("cohort pagination fails visibly for truncation, duplicates, changing totals and unexpected cases", async () => {
  const firstPage = Array.from({ length: 50 }, (_, i) => deal(900001 + i));
  for (const [page, code] of [
    [() => ({ result: firstPage, total: 501, next: 50 }), "LAWYER_AUDIT_COHORT_LIMIT_EXCEEDED"],
    [() => ({ result: firstPage, total: 51 }), "LAWYER_AUDIT_COHORT_INCOMPLETE"],
    [() => ({ result: firstPage, next: 0 }), "LAWYER_AUDIT_PAGINATION_UNVERIFIED"],
    [(start) => start ? { result: [deal(900050)], total: 51 } : { result: firstPage, total: 51, next: 50 }, "LAWYER_AUDIT_PAGINATION_UNVERIFIED"],
    [(start) => start ? { result: [deal(900051)], total: 52 } : { result: firstPage, total: 51, next: 50 }, "LAWYER_AUDIT_COHORT_CHANGED"],
    [() => ({ result: [deal(900001, { STAGE_ID: "C1:OTHER" })] }), "LAWYER_AUDIT_RESPONSE_UNVERIFIED"],
    [() => ({ result: [deal(900001, { CATEGORY_ID: "13" })] }), "LAWYER_AUDIT_RESPONSE_UNVERIFIED"],
    [() => ({ result: [deal(900001, { UF_CRM_ANK_PRIMARY_DOCS: [{ filename: "private-key" }] })] }), "LAWYER_AUDIT_FILE_COUNT_UNVERIFIED"],
  ]) await assert.rejects(run({ page }).result, new RegExp(code));
  const page = (start, more) => ({
    result: Array.from({ length: 50 }, (_, i) => deal(900001 + start + i)),
    ...(more || start < 450 ? { next: start + 50 } : {}),
  });
  await assert.rejects(run({ page: (start) => page(start, true) }).result, /LAWYER_AUDIT_COHORT_LIMIT_EXCEEDED/);
  const complete = await run({ page: (start) => ({ ...page(start, false), total: 500 }) }).result;
  assert.equal(complete.count, 500);
  assert.equal(complete.complete, true);
});

test("CRM failures expose stable codes without credentials or upstream response content", async () => {
  await assert.rejects(audit.auditLawyerDelivery("", () => { throw Error("must not call"); }), /BITRIX_NOT_CONFIGURED/);
  for (const send of [
    async () => { throw Error("private-webhook"); },
    async () => new Response("private-server-body", { status: 503 }),
    async () => Response.json({ error: "private-upstream-error" }),
  ]) {
    await assert.rejects(audit.auditLawyerDelivery("https://synthetic.invalid/rest/private-webhook/", send), (error) => {
      assert.equal(error.message.includes("private"), false);
      return error instanceof audit.LawyerDeliveryAuditError;
    });
  }
});

test("owner cohort endpoint rejects unauthenticated, cross-origin and non-owner requests before reading CRM", async () => {
  let actor = null, deniedOrigin = false, reads = 0, failure;
  const route = load("app/api/lawyer-delivery-audit/route.ts", {
    "../staff-access": { requireStaffRequest: async () => !actor
      ? Response.json({ error: "SIGN_IN_REQUIRED" }, { status: 401 })
      : deniedOrigin ? Response.json({ error: "INVALID_REQUEST_ORIGIN" }, { status: 403 }) : null },
    "../../../lib/worker-session": { readSessionCookie: () => "cookie", verifySession: async () => actor },
    "../../../lib/crm/lawyer-delivery-audit": {
      ...audit, auditLawyerDelivery: async (webhook) => {
        reads++;
        assert.equal(webhook, "private-webhook");
        if (failure) throw failure;
        return { complete: true, count: 0, cases: [] };
      },
    },
  }, { process: { env: { SITE_SESSION_TOKEN: "private-token", BITRIX_WEBHOOK: "private-webhook" } } });
  const request = () => new Request("https://synthetic.invalid/api/lawyer-delivery-audit");
  let response = await route.GET(request());
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  actor = { worker: "ramazan" };
  assert.equal((await route.GET(request())).status, 403);
  actor = { worker: "ali" }; deniedOrigin = true;
  assert.equal((await route.GET(request())).status, 403);
  assert.equal(reads, 0);
  deniedOrigin = false;
  response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).complete, true);
  failure = new audit.LawyerDeliveryAuditError("LAWYER_AUDIT_COHORT_INCOMPLETE");
  response = await route.GET(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "LAWYER_AUDIT_COHORT_INCOMPLETE");
  failure = Error("private-webhook");
  response = await route.GET(request());
  assert.equal((await response.json()).error, "LAWYER_AUDIT_UNAVAILABLE");
  assert.equal(route.POST, undefined);
});
