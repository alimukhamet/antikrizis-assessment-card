import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the assessment card shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Договор и карточка клиента<\/title>/i);
  assert.match(html, /assessment-card\.html/);
  assert.match(html, /Договор и карточка клиента/);
});

test("captures every fact needed to build the later document checklist", async () => {
  const card = await readFile(new URL("../public/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /id="seg-works"/);
  assert.match(card, /id="seg-children"/);
  assert.match(card, /id="seg-spouseWorks"/);
  assert.match(card, /id="seg-spouseCar"/);
  assert.match(card, /add\("Клиент работает официально"/);
  assert.match(card, /add\("Есть дети младше 18 лет"/);
  assert.match(card, /add\("Супруг\(а\) работает официально"/);
  assert.match(card, /add\("У супруга\(и\) есть автомобиль"/);
  assert.match(card, /id="creditors"/);
  assert.match(card, /Список кредиторов и банков/);
  assert.match(card, /"creditTypes","creditors","creditPurpose"/);
  assert.match(card, /add\("Список кредиторов и банков",s\.creditors\)/);
  assert.match(card, /creditors:\s*s\.creditors \|\| "не указано"/);
  assert.match(card, /card:\s*\{bx:"UF_CRM_AI_CARD"\}/);
  assert.match(card, /marital:\s*\{bx:"UF_CRM_AI_MARITAL"\}/);
});

test("keeps contract creation and document upload as separate tasks", async () => {
  const card = await readFile(new URL("../public/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /<body data-view="home">/);
  assert.match(card, /Создать договор и карточку/);
  assert.match(card, /Загрузить документы/);
  assert.match(card, /data-open-view="documents"/);
  assert.match(card, /id="docsBtn"/);
  assert.match(card, /Сохранить договор и карточку/);
  assert.match(card, /PRIMARY_DOCS_MULTI_FIELD = "UF_CRM_ANK_PRIMARY_DOCS"/);
  assert.match(card, /batch-preview/);
  assert.match(card, /openFilePreview/);
});

test("resolves a typed deal ID to the Bitrix deal title", async () => {
  const card = await readFile(new URL("../public/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /id="dealLookup"/);
  assert.match(card, /id="dealName"[^>]*aria-live="polite"/);
  assert.match(card, /function scheduleDealLookup/);
  assert.match(card, /const deal=await bxResult\("crm\.deal\.get",\{id:Number\(dealId\)\}\)/);
  assert.match(card, /deal\?\.TITLE/);
  assert.match(card, /Сделка: \$\{title\}/);
});

test("limits the public assessment proxy to the methods used by the card", async () => {
  const route = await readFile(
    new URL("../app/api/bitrix/[method]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /const ASSESSMENT_METHODS = new Set/);
  assert.match(route, /"crm\.deal\.get"/);
  assert.match(route, /"crm\.deal\.update"/);
  assert.match(route, /"crm\.item\.get"/);
  assert.match(route, /"crm\.item\.update"/);
  assert.match(route, /error: "METHOD_NOT_ALLOWED"/);
});
