import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function fetchBuilt(path = "/", headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function render() {
  return fetchBuilt("/", { accept: "text/html" });
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

test("adds the owned GKB analyzer as the third sales task", async () => {
  const card = await readFile(new URL("../public/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /<span class="task-number">03<\/span>/);
  assert.match(card, /Проверить кредитный отчёт/);
  assert.match(card, /href="https:\/\/gkb-credit-analyzer-kz\.mukhamet-ali-ma\.chatgpt\.site"/);
  assert.match(card, /target="_blank" rel="noopener"/);
});

test("fits the three sales KPIs on the daily home screen with person and period buttons", async () => {
  const card = await readFile(new URL("../public/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /Результаты продаж/);
  assert.match(card, /data-sales-manager="7609"[^>]*>Дархан</);
  assert.match(card, /data-sales-manager="2093"[^>]*>Рамазан</);
  assert.match(card, /data-sales-manager="4351"[^>]*>Нурдаулет</);
  assert.match(card, /data-sales-period="today"[^>]*>Сегодня</);
  assert.match(card, /data-sales-period="current_week"[^>]*>Неделя</);
  assert.match(card, /data-sales-period="current_month"[^>]*>Месяц</);
  assert.match(card, /data-sales-period="custom"[^>]*>Даты</);
  assert.match(card, /id="salesDateFrom"[^>]*type="date"/);
  assert.match(card, /id="salesDateTo"[^>]*type="date"/);
  assert.match(card, /id="salesDateRange"/);
  assert.match(card, /query\.set\("from",salesSelection\.from\)/);
  assert.match(card, /query\.set\("to",salesSelection\.to\)/);
  assert.match(card, /Передано юристам/);
  assert.match(card, /Сумма договоров/);
  assert.match(card, /Средний договор/);
  assert.match(card, /fetch\(`\/api\/sales-metrics\?\$\{query\}`/);
});

test("exposes only aggregate sales metrics for the three approved managers", async () => {
  const route = await readFile(
    new URL("../app/api/sales-metrics/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /"7609": "Дархан"/);
  assert.match(route, /"2093": "Рамазан"/);
  assert.match(route, /"4351": "Нурдаулет"/);
  assert.match(route, /const PERIODS = new Set\(\["today", "current_week", "current_month", "custom"\]\)/);
  assert.match(route, /function resolveRequestedPeriod/);
  assert.match(route, /"<CREATED_TIME": period\.end/);
  assert.match(route, /end: new Date\(`\$\{addDays\(to, 1\)\}T00:00:00\$\{ALMATY_OFFSET\}`\)\.toISOString\(\)/);
  assert.match(route, /"crm\.stagehistory\.list"/);
  assert.match(route, /`crm\.deal\.get\?id=\$\{encodeURIComponent\(id\)\}`/);
  assert.match(route, /handoffs: selectedDeals\.length/);
  assert.match(route, /contractTotal/);
  assert.match(route, /contractAverage/);
  assert.match(route, /missingContractValues/);
  assert.match(route, /stale: false/);
  assert.match(route, /"cache-control": "no-store"/);
  assert.match(route, /\[deal\.ASSIGNED_BY_ID, deal\.MOVED_BY_ID, deal\.CREATED_BY_ID\]/);
  assert.doesNotMatch(route, /SALES_REPORT_BYPASS_TOKEN/);
  assert.doesNotMatch(route, /title:\s*deal\.title/);
});

test("rejects an invalid flexible sales date range before reading Bitrix", async () => {
  const response = await fetchBuilt(
    "/api/sales-metrics?managerId=7609&period=custom&from=2026-08-14&to=2026-08-01",
    { accept: "application/json" },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Дата начала не может быть позже даты окончания.",
  });
});

test("lets the salesperson show and hide the ECP password", async () => {
  const card = await readFile(new URL("../public/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /id="docEdsPassword" type="password"/);
  assert.match(card, /id="docEdsPasswordToggle"/);
  assert.match(card, /docEdsPassword\.type=show\?"text":"password"/);
  assert.match(card, /docEdsPasswordToggle\.textContent=show\?"Скрыть":"Показать"/);
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

test("requires a fresh deal-name confirmation before either Bitrix write", async () => {
  const card = await readFile(new URL("../public/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /id="targetConfirmModal"/);
  assert.match(card, /id="targetConfirmDealName"/);
  assert.match(card, /id="targetConfirmDealId"/);
  assert.match(card, /async function confirmDealTarget/);
  assert.match(card, /const deal=await bxResult\("crm\.deal\.get",\{id:Number\(dealId\)\}\)/);
  assert.match(card, /Да, сохранить в эту сделку/);
  assert.match(card, /Да, загрузить в эту сделку/);

  const contractConfirm = card.indexOf("const approved=await confirmDealTarget", card.indexOf("async function submitContractAndAssessment"));
  const contractWrite = card.indexOf("await saveAssessmentToBitrix", card.indexOf("async function submitContractAndAssessment"));
  const documentsConfirm = card.indexOf("const approved=await confirmDealTarget", card.indexOf("async function uploadDocuments"));
  const documentsWrite = card.indexOf('apiBase+"crm.item.update.json"', card.indexOf("async function uploadDocuments"));
  assert.ok(contractConfirm > 0 && contractConfirm < contractWrite);
  assert.ok(documentsConfirm > 0 && documentsConfirm < documentsWrite);
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
