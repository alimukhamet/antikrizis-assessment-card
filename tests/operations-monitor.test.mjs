import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const release = JSON.parse(
  fs.readFileSync("lib/assessment-release.json", "utf8"),
);
function load(path, deps = {}, extra = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in deps)) throw Error(name);
        return deps[name];
      },
      crypto: webcrypto,
      Date,
      console,
      ...extra,
    },
  );
  return exports;
}
const monitor = load("lib/operations-monitor.ts", {
  "./assessment-release.json": release,
});
const input = (extra = {}) =>
  monitor.validateOperationEvent({
    id: webcrypto.randomUUID(),
    dealId: "900001",
    action: "draft",
    code: "NETWORK_FAILURE",
    clientVersion: release.version,
    ...extra,
  });
function setup(t) {
  const sql = new DatabaseSync(":memory:");
  for (const file of fs
    .readdirSync("drizzle")
    .filter((p) => p.endsWith(".sql"))
    .sort())
    sql.exec(fs.readFileSync("drizzle/" + file, "utf8"));
  const db = {
    prepare(query) {
      const stmt = sql.prepare(query);
      const bind = (...args) => ({
        run: async () => ({ meta: { changes: stmt.run(...args).changes } }),
        first: async () => stmt.get(...args) || null,
        all: async () => ({ results: stmt.all(...args) }),
      });
      return { bind, ...bind() };
    },
  };
  t.after(() => sql.close());
  return { sql, db, repo: new monitor.OperationsRepository(db) };
}
test("diagnostic records persist, deduplicate and honor a durable per-actor budget", async (t) => {
  const { sql, db, repo } = setup(t),
    event = input(),
    now = "2026-09-23T00:00:00.000Z";
  assert.equal(await repo.record(event, "worker:ramazan", now), true);
  assert.equal(
    await new monitor.OperationsRepository(db).record(
      event,
      "worker:ramazan",
      now,
    ),
    false,
  );
  const results = await Promise.all(
    Array.from({ length: 130 }, () =>
      repo.record(input(), "worker:ramazan", now),
    ),
  );
  assert.equal(results.filter(Boolean).length, 119);
  assert.equal(await repo.record(input(), "worker:darkhan", now), true);
  assert.equal(
    await repo.record(input(), "worker:ramazan", "2026-09-23T01:00:01.000Z"),
    true,
  );
  assert.equal(
    sql.prepare("SELECT count(*) n FROM assessment_operations_events").get().n,
    122,
  );
});
test("payload validation discards sensitive extra data and rejects unsupported routes and codes", () => {
  const safe = input({
    message: "secret-name",
    stack: "secret-file",
    password: "secret-key",
    answers: ["secret-answer"],
  });
  assert.equal(JSON.stringify(safe).includes("secret"), false);
  for (const extra of [
    { id: "bad" },
    { dealId: "900001/credentials" },
    { action: "secret" },
    { code: "private-answer" },
    { clientVersion: "https://secret" },
    { asset: "/x.js?password=secret" },
    { line: -1 },
    { status: 600 },
  ])
    assert.throws(() => input(extra), /INVALID_OPERATION_EVENT/);
  assert.equal(monitor.operationRoute("/api/operations-monitor"), null);
  assert.equal(monitor.operationRoute("/api/session"), null);
  assert.equal(
    monitor.operationRoute("/api/assessment/900001/documents/id/analyze")
      .action,
    "analysis",
  );
});
test("summary finds unfinished external writes, excludes completed/recent/prepared operations and probes", async (t) => {
  const { sql, repo } = setup(t),
    now = "2026-09-23T12:00:00.000Z",
    old = "2026-09-23T11:00:00.000Z";
  for (const [index, state, history, stamp] of [
    [1, "writing", "pending", old],
    [2, "verified", "verified", old],
    [3, "prepared", "pending", old],
    [4, "uncertain", "pending", now],
    [5, "verified", "uncertain", old],
  ]) {
    sql
      .prepare(
        "INSERT INTO assessment_cases (id,external_system,external_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        "c" + index,
        "bitrix",
        String(900000 + index),
        "Synthetic",
        old,
        old,
      );
    sql
      .prepare(
        "INSERT INTO assessment_submissions (id,case_id,request_id,identity_revision,payload_json,payload_hash,actor_id,authentication,state,created_at,updated_at,history_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "s" + index,
        "c" + index,
        "r" + index,
        1,
        "{}",
        "hash",
        "worker:ali",
        "test",
        state,
        old,
        stamp,
        history,
      );
  }
  await repo.record(input(), "worker:ali", now);
  await repo.record(input({ code: "MONITOR_PROBE" }), "worker:ali", now);
  await repo.record(
    input({ code: "PAGE_OPEN", clientVersion: "assessment-old" }),
    "worker:ali",
    now,
  );
  await repo.record(input(), "worker:ali", "2026-09-21T01:00:00.000Z");
  const result = await repo.summary(now);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].occurrences, 1);
  assert.deepEqual(
    Array.from(result.stuck, (r) => r.operation_id),
    ["s1", "s5"],
  );
  assert.equal(result.staleClients.length, 1);
  assert.equal(result.activity.samples, 3);
  assert.equal(JSON.stringify(result).includes("payload_json"), false);
});
test("server diagnostics record failures only on protected assessment routes and absorb database errors", async (t) => {
  const { repo, db } = setup(t),
    actor = { id: "worker:ali" };
  await monitor.recordServerFailure(db, actor, "/api/session", 500);
  await monitor.recordServerFailure(
    db,
    actor,
    "/api/assessment/900001/draft",
    409,
  );
  assert.equal((await repo.summary()).events.length, 0);
  await monitor.recordServerFailure(
    db,
    actor,
    "/api/assessment/900001/draft",
    503,
  );
  assert.equal((await repo.summary()).events[0].code, "SERVER_HTTP_FAILURE");
  await monitor.recordServerFailure(
    {
      prepare() {
        throw Error("private-error");
      },
    },
    actor,
    "/api/assessment/900001/draft",
    500,
  );
});
test("API requires staff and same-origin writes, restricts owner reads/probes and returns storage failures visibly", async (t) => {
  const { repo } = setup(t);
  let actor = null,
    originAllowed = true,
    unavailable = false;
  class RepositoryError extends Error {
    constructor(code, status) {
      super(code);
      this.code = code;
      this.status = status;
    }
  }
  const route = load(
    "app/api/operations-monitor/route.ts",
    {
      "../staff-access": {
        requireStaffRequest: async () =>
          !actor
            ? Response.json({}, { status: 401 })
            : !originAllowed
              ? Response.json({}, { status: 403 })
              : null,
      },
      "../../../lib/worker-session": {
        readSessionCookie: () => "",
        verifySession: async () => actor,
      },
      "../../../lib/documents/request-context": {
        boundedJson: async (r) => {
          try {
            return await r.json();
          } catch {
            throw new RepositoryError("INVALID_JSON", 400);
          }
        },
      },
      "../../../lib/documents/repository": { RepositoryError },
      "../../../lib/operations-monitor": {
        ...monitor,
        operationsRepository: async () => {
          if (unavailable) throw Error("secret-database");
          return repo;
        },
      },
      "../../../lib/assessment-release.json": release,
    },
    { Request, Response, process: { env: {} } },
  );
  const req = (body = input()) =>
    new Request("https://synthetic.invalid/api/operations-monitor", {
      method: "POST",
      body: JSON.stringify(body),
    });
  assert.equal((await route.POST(req())).status, 401);
  actor = { id: "worker:ramazan", worker: "ramazan" };
  originAllowed = false;
  assert.equal((await route.POST(req())).status, 403);
  originAllowed = true;
  assert.equal((await route.GET(req())).status, 403);
  assert.equal(
    (await route.POST(req(input({ code: "MONITOR_PROBE" })))).status,
    403,
  );
  assert.equal((await (await route.POST(req())).json()).accepted, true);
  actor = { id: "worker:ali", worker: "ali" };
  assert.equal((await (await route.GET(req())).json()).events.length, 1);
  assert.equal(
    (
      await route.POST(
        new Request("https://synthetic.invalid", { method: "POST", body: "{" }),
      )
    ).status,
    400,
  );
  unavailable = true;
  const failed = await route.GET(req());
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error, "MONITOR_UNAVAILABLE");
});

function ui(t) {
  const dom = new JSDOM(
    `<body data-assessment-version="${release.version}"><input value="private-answer"><input type="password" value="private-key"></body>`,
    {
      url: "https://synthetic.invalid/questionnaire.html?dealId=900001",
      runScripts: "outside-only",
    },
  );
  const w = dom.window,
    calls = [],
    timers = new Map();
  let nextTimer = 0,
    response = new Response("{}"),
    failure = null,
    monitorFails = false,
    serverVersion = release.version;
  w.setTimeout = (fn, ms) => {
    timers.set(++nextTimer, { fn, ms });
    return nextTimer;
  };
  w.clearTimeout = (id) => timers.delete(id);
  w.setInterval = () => 0;
  w.fetch = async (path, options) => {
    if (path === "/api/operations-monitor") {
      calls.push(JSON.parse(options.body));
      if (monitorFails) throw Error("monitor offline");
      return { ok: true, json: async () => ({ ok: true, serverVersion }) };
    }
    if (failure) throw failure;
    return response;
  };
  vm.runInContext(
    fs.readFileSync("public/operations-monitor.js", "utf8"),
    dom.getInternalVMContext(),
  );
  t.after(() => w.close());
  return {
    w,
    calls,
    timers,
    setResponse: (r) => (response = r),
    setFailure: (e) => (failure = e),
    setMonitorFails: () => (monitorFails = true),
    setVersion: (v) => (serverVersion = v),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("browser records API failures without consuming responses, altering rejection or leaking client content", async (t) => {
  const s = ui(t);
  await tick();
  s.calls.length = 0;
  const original = new Response("private-body", { status: 503 });
  s.setResponse(original);
  assert.equal(
    await s.w.fetch("/api/assessment/900001/draft", { body: "private-answer" }),
    original,
  );
  assert.equal(await original.text(), "private-body");
  await tick();
  assert.equal(s.calls[0].action, "draft");
  assert.equal(s.calls[0].status, 503);
  const failure = new Error("private-key");
  s.setFailure(failure);
  await assert.rejects(
    s.w.fetch("/api/assessment/900001/credentials"),
    (e) => e === failure,
  );
  await tick();
  assert.equal(s.calls.at(-1).code, "NETWORK_FAILURE");
  assert.equal(JSON.stringify(s.calls).includes("private"), false);
  const count = s.calls.length;
  await assert.rejects(
    s.w.fetch("https://outside.invalid/api/assessment/900001/draft"),
  );
  await tick();
  assert.equal(s.calls.length, count);
  s.setMonitorFails();
  s.w.OperationsMonitor.record("JS_ERROR");
  await tick();
  assert.equal(
    s.calls.length,
    count + 1,
    "a monitoring failure does not recursively report itself",
  );
});
test("browser detects script errors/stalled work and preserves unsaved input when release changes", async (t) => {
  const s = ui(t);
  await tick();
  s.calls.length = 0;
  s.setVersion("assessment-next");
  s.w.dispatchEvent(
    new s.w.ErrorEvent("error", {
      message: "private-answer",
      filename: "https://synthetic.invalid/app.js?password=private-key",
      lineno: 19,
    }),
  );
  await tick();
  const event = s.calls.find((c) => c.code === "JS_ERROR");
  assert.equal(event.asset, "/app.js");
  assert.equal(event.line, 19);
  assert.equal(JSON.stringify(s.calls).includes("private"), false);
  assert.equal(s.w.document.querySelector("input").value, "private-answer");
  assert.equal(
    s.w.document.querySelector("#assessmentUpdateNotice a").target,
    "_blank",
  );
  s.w.document.dispatchEvent(
    new s.w.CustomEvent("assessment-submission-progress", {
      detail: { busy: true },
    }),
  );
  const stall = [...s.timers.entries()].find(([, t]) => t.ms === 180000);
  assert.ok(stall);
  s.timers.delete(stall[0]);
  stall[1].fn();
  await tick();
  assert.ok(
    s.calls.some((c) => c.code === "ACTION_STALLED" && c.action === "contract"),
  );
  s.w.document.dispatchEvent(
    new s.w.CustomEvent("assessment-submission-progress", {
      detail: { busy: true },
    }),
  );
  s.w.document.dispatchEvent(
    new s.w.CustomEvent("assessment-submission-progress", {
      detail: { busy: false },
    }),
  );
  assert.equal(
    [...s.timers.values()].filter((t) => t.ms === 180000).length,
    0,
    "completed work cancels the stall alarm",
  );
});
test("broken browser diagnostic capability never changes a successful business request", async (t) => {
  const s = ui(t);
  await tick();
  s.w.crypto.randomUUID = () => {
    throw Error("diagnostics unavailable");
  };
  const original = new Response("{}", { status: 503 });
  s.setResponse(original);
  assert.equal(await s.w.fetch("/api/assessment/900001/submission"), original);
});

test("production probe checks saved cases without modifying answers and never exports private data", async () => {
  const source = fs
    .readFileSync("scripts/monitor-production.mjs", "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll(
      "import.meta.url",
      "'file:///synthetic/scripts/monitor-production.mjs'",
    );
  for (const broken of [false, true]) {
    const output = {},
      calls = [],
      process = { env: { ASSESSMENT_TEST_PASSWORD: "private-password" } };
    const health = {
      version: release.version,
      events: [],
      stuck: [],
      staleClients: [],
      activeCases: [],
    };
    const fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push({ path, ...options });
      if (path === "/api/session")
        return new Response("{}", {
          headers: { "set-cookie": "session=private-cookie" },
        });
      if (path === "/api/status") return Response.json({ ok: true });
      if (path === "/api/operations-monitor")
        return broken
          ? Response.json({ error: "private-error" }, { status: 503 })
          : Response.json(
              options.method === "POST" ? { ok: true, accepted: true } : health,
            );
      if (path === "/questionnaire.html")
        return new Response(
          `<body data-assessment-version="${release.version}"><script src="/operations-monitor.js"></script>`,
        );
      if (path === "/api/assessment/12103")
        return Response.json({ client: { name: "private-name" } });
      if (path.endsWith("/draft"))
        return Response.json({
          draft: { revision: 4, payload: { answers: ["private-answer"] } },
        });
      if (path.endsWith("/check")) {
        assert.equal(
          JSON.parse(options.body).payload.answers[0],
          "private-answer",
        );
        return Response.json({
          readyToSubmit: false,
          issues: [{ code: "DOCUMENT_REQUIRED", message: "private-details" }],
          documents: { issues: [] },
        });
      }
      throw Error("Unexpected request");
    };
    await vm.runInNewContext("(async()=>{" + source + "})()", {
      URL,
      AbortSignal,
      process,
      fetch,
      console: { log: () => {} },
      randomUUID: () => webcrypto.randomUUID(),
      readFile: async () => JSON.stringify(release),
      writeFile: async (path, body) => (output[path] = body),
    });
    const report = JSON.parse(output["production-monitor.json"]);
    assert.equal(output["production-monitor.json"].includes("private-"), false);
    assert.equal(report.healthy, !broken);
    if (broken) {
      assert.equal(process.exitCode, 1);
      assert.equal(report.failure.code, "HTTP_FAILURE");
    } else {
      assert.equal(report.cases[0].ready, false);
      assert.equal(report.cases[0].missingLoans, null);
      assert.deepEqual(report.cases[0].blockerCodes, ["DOCUMENT_REQUIRED"]);
    }
    assert.ok(
      calls
        .filter((c) => c.method === "POST")
        .every((c) =>
          [
            "/api/session",
            "/api/operations-monitor",
            "/api/assessment/12103/check",
          ].includes(c.path),
        ),
    );
  }
});

test("scheduled retention removes only expired diagnostics and preserves recent incidents", async (t) => {
  const { repo, sql } = setup(t);
  await repo.record(input(), "worker:ali", "2026-08-01T00:00:00.000Z");
  await repo.record(input(), "worker:ali", "2026-09-23T00:00:00.000Z");
  await repo.prune("2026-09-23T12:00:00.000Z");
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM assessment_operations_events").get().n,
    1,
  );
  assert.equal(
    (await repo.summary("2026-09-23T12:00:00.000Z")).events.length,
    1,
  );
});
