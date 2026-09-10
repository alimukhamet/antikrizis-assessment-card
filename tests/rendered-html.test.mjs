import {TEST_SECRET,testCookie} from './session-helper.mjs';
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function fetchBuilt(path = "/", headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: {cookie:await testCookie(),...headers} }),
    { SITE_SESSION_TOKEN:TEST_SECRET, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
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
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

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
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

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
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /<span class="task-number">03<\/span>/);
  assert.match(card, /Проверить кредитный отчёт/);
  assert.match(card, /href="https:\/\/gkb-credit-analyzer-kz\.mukhamet-ali-ma\.chatgpt\.site"/);
  assert.match(card, /target="_blank" rel="noopener"/);
});

test("shows team rankings with average contracts and shared filters", async () => {
  const card=await readFile(new URL("../templates/assessment-card.html",import.meta.url),"utf8");
  for(const label of ["Результаты продаж","Менеджер","Договоры","Средний договор","Сумма договоров","salesDateRange"])assert.ok(card.includes(label));
  for(const period of ["today","current_week","current_month","custom"])assert.ok(card.includes(`data-sales-period="${period}"`));
  for(const type of ["all","261","263","423"])assert.ok(card.includes(`data-sales-payment="${type}"`));
  assert.ok(!card.includes('data-sales-manager='));
  assert.ok(!card.includes('previousRank:'));
  assert.match(card,/function salesPreviousQuery/);
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
  assert.match(route, /const PAYMENT_TYPES =/);
  assert.match(route, /"423": "50\/50"/);
  assert.match(route, /"261": "После определения"/);
  assert.match(route, /"263": "До определения"/);
  assert.match(route, /const HANDOFF_DATE_FIELD = "UF_CRM_1777554129345"/);
  assert.match(route, /const PAYMENT_TYPE_FIELD = "UF_CRM_1781335943568"/);
  assert.match(route, /const cacheKey = `\$\{period\.key\}:\$\{period\.startDate\}:\$\{period\.endDate\}`/);
  assert.match(route, /`>=\$\{HANDOFF_DATE_FIELD\}`\]: period\.startDate/);
  assert.match(route, /`<=\$\{HANDOFF_DATE_FIELD\}`\]: period\.endDate/);
  assert.match(route, /"crm\.deal\.list"/);
  assert.match(route, /select: \["ID", "ASSIGNED_BY_ID", "OPPORTUNITY", PAYMENT_TYPE_FIELD\]/);
  assert.match(route, /String\(deal\.ASSIGNED_BY_ID \?\? ""\) !== managerId/);
  assert.match(route, /String\(deal\[PAYMENT_TYPE_FIELD\] \?\? ""\) === paymentType/);
  assert.match(route, /relatedMetrics/);
  assert.match(route, /handoffs: deals\.length/);
  assert.match(route, /contractTotal/);
  assert.match(route, /contractAverage/);
  assert.match(route, /missingContractValues/);
  assert.match(route, /stale: false/);
  assert.match(route, /"cache-control": "no-store"/);
  assert.doesNotMatch(route, /crm\.stagehistory\.list/);
  assert.doesNotMatch(route, /SALES_REPORT_BYPASS_TOKEN/);
  assert.doesNotMatch(route, /title:\s*deal\.title/);
});

test("saves all three payment types to the existing Bitrix field", async () => {
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /Какой вид оплаты\?/);
  assert.match(card, /<option value="423">50\/50<\/option>/);
  assert.match(card, /<option value="261">После определения<\/option>/);
  assert.match(card, /<option value="263">До определения<\/option>/);
  assert.match(card, /grafType:\s*\{bx:"UF_CRM_1781335943568", enum:true\}/);
  assert.match(card, /add\("Вид оплаты",s\.grafTypeText\)/);
});

test("verifies every invoice-critical contract field after Bitrix saves it", async () => {
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /const saved=await bxResult\("crm\.deal\.get"/);
  assert.match(card, /for\(const \[name,wanted\] of Object\.entries\(fields\)\)/);
  assert.match(card, /\[MAP\.months\.bx\]:"Количество платежей"/);
  assert.match(card, /\[MAP\.payDay\.bx\]:"Число оплаты"/);
  assert.match(card, /\[MAP\.grafType\.bx\]:"Вид оплаты"/);
  assert.match(card, /\[MAP\.grafText\.bx\]:"Полный график платежей"/);
  assert.match(card, /\[MAP\.card\.bx\]:"Карточка договора"/);
  assert.match(card, /Договор не скачан; данные нужно проверить/);
});

test("uses the usual after-decision document schedule for 50/50", async () => {
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /const afterDecision=grafType==="261"\|\|grafType==="423"/);
  assert.match(card, /ordinaryOffset\+\(afterDecision\?2:0\)/);
  assert.match(card, /const total=num\(s\.summa\), months=Number\(s\.months\)/);
  assert.match(card, /payments:\(sch\?\.rows\|\|\[\]\)\.map/);
  assert.doesNotMatch(card, /Платёж 1 — 50%/);
  assert.doesNotMatch(card, /isFiftyFifty\?2/);
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
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /id="docEdsPassword" type="password"/);
  assert.match(card, /id="docEdsPasswordToggle"/);
  assert.match(card, /docEdsPassword\.type=show\?"text":"password"/);
  assert.match(card, /docEdsPasswordToggle\.textContent=show\?"Скрыть":"Показать"/);
});

test("resolves a typed deal ID to the Bitrix deal title", async () => {
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /id="dealLookup"/);
  assert.match(card, /id="dealName"[^>]*aria-live="polite"/);
  assert.match(card, /function scheduleDealLookup/);
  assert.match(card, /const deal=await bxResult\("crm\.deal\.get",\{id:Number\(dealId\)\}\)/);
  assert.match(card, /deal\?\.TITLE/);
  assert.match(card, /Сделка: \$\{title\}/);
});

test("requires a fresh deal-name confirmation before either Bitrix write", async () => {
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

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

test("adds the completed questionnaire to the Bitrix deal history", async () => {
  const card = await readFile(new URL("../templates/assessment-card.html", import.meta.url), "utf8");

  assert.match(card, /async function addAssessmentToDealHistory/);
  assert.match(card, /bxResult\("crm\.timeline\.comment\.add",\{/);
  assert.match(card, /ENTITY_ID:Number\(dealId\)/);
  assert.match(card, /ENTITY_TYPE:"deal"/);
  assert.match(card, /COMMENT:lawyerCard\(s\)/);

  const save = card.indexOf("await saveAssessmentToBitrix", card.indexOf("async function submitContractAndAssessment"));
  const comment = card.indexOf("await addAssessmentToDealHistory", card.indexOf("async function submitContractAndAssessment"));
  const download = card.indexOf("downloadBlob(blob,filename)", card.indexOf("async function submitContractAndAssessment"));
  assert.ok(save > 0 && save < comment);
  assert.ok(comment < download);
});

test("limits the public assessment proxy to the methods used by the card", async () => {
  const route = await readFile(
    new URL("../app/api/bitrix/[method]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /const ASSESSMENT_METHODS = new Set/);
  assert.match(route, /"crm\.deal\.get"/);
  assert.match(route, /"crm\.deal\.update"/);
  assert.match(route, /"crm\.timeline\.comment\.add"/);
  assert.match(route, /"crm\.item\.get"/);
  assert.match(route, /"crm\.item\.update"/);
  assert.match(route, /error: "METHOD_NOT_ALLOWED"/);
});
