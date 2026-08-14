export const dynamic = "force-dynamic";

const MANAGERS = {
  "7609": "Дархан",
  "2093": "Рамазан",
  "4351": "Нурдаулет",
} as const;

const PERIODS = new Set(["today", "current_week", "current_month"]);
const CACHE_TTL_MS = 120_000;
const REPORT_STALE_AFTER_MS = 4 * 60 * 60 * 1000;

type ManagerId = keyof typeof MANAGERS;
type AssessmentSummaryResponse = {
  managerId?: string;
  period?: string;
  periodLabel?: string;
  handoffs?: number;
  contractTotal?: number;
  contractAverage?: number;
  contractsWithValue?: number;
  missingContractValues?: number;
  generatedAt?: string;
  lastSyncAt?: string | null;
  error?: string;
};
type SalesMetricPayload = {
  managerId: ManagerId;
  managerName: string;
  period: string;
  periodLabel: string;
  handoffs: number;
  contractTotal: number;
  contractAverage: number;
  contractsWithValue: number;
  missingContractValues: number;
  generatedAt: string;
  lastSyncAt: string | null;
  stale: boolean;
};

const cache = new Map<string, { expiresAt: number; payload: SalesMetricPayload }>();
let refreshPromise: Promise<string | null> | null = null;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const managerId = searchParams.get("managerId") as ManagerId | null;
  const period = searchParams.get("period") ?? "current_month";

  if (!managerId || !(managerId in MANAGERS) || !PERIODS.has(period)) {
    return Response.json(
      { error: "Выберите сотрудника и период из предложенного списка." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const cacheKey = `${managerId}:${period}`;
  const cached = cache.get(cacheKey);
  if (!searchParams.has("fresh") && cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: responseHeaders() });
  }

  try {
    const payload = await buildSalesMetrics(managerId, period);
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return Response.json(payload, { headers: responseHeaders() });
  } catch (error) {
    console.error("Sales metrics failed", error);
    return Response.json(
      { error: "Результаты продаж временно недоступны. Обновите страницу через минуту." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST() {
  try {
    const reportUrl = requiredEnv("SALES_REPORT_URL").replace(/\/$/, "");
    const reportToken = requiredEnv("SALES_REPORT_BYPASS_TOKEN");
    const summary = await reportFetch<AssessmentSummaryResponse>(
      `${reportUrl}/api/assessment-summary?managerId=7609&period=current_month`,
      reportToken,
    );
    if (!isReportStale(summary.lastSyncAt)) {
      return Response.json(
        { refreshed: false, lastSyncAt: summary.lastSyncAt ?? null },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (!refreshPromise) {
      refreshPromise = refreshSalesReport(reportUrl, reportToken).finally(() => {
        refreshPromise = null;
      });
    }
    const lastSyncAt = await refreshPromise;
    cache.clear();
    return Response.json(
      { refreshed: true, lastSyncAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Sales metrics refresh failed", error);
    return Response.json(
      { error: "Не удалось обновить данные из Bitrix. Последний сохранённый отчёт остаётся доступен." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

async function buildSalesMetrics(
  managerId: ManagerId,
  period: string,
): Promise<SalesMetricPayload> {
  const reportUrl = requiredEnv("SALES_REPORT_URL").replace(/\/$/, "");
  const reportToken = requiredEnv("SALES_REPORT_BYPASS_TOKEN");
  const query = new URLSearchParams({ managerId, period });
  const summary = await reportFetch<AssessmentSummaryResponse>(
    `${reportUrl}/api/assessment-summary?${query}`,
    reportToken,
  );
  const handoffs = Math.max(0, Number(summary.handoffs ?? 0));

  return {
    managerId,
    managerName: MANAGERS[managerId],
    period,
    periodLabel: summary.periodLabel ?? period,
    handoffs,
    contractTotal: Math.max(0, Number(summary.contractTotal ?? 0)),
    contractAverage: Math.max(0, Number(summary.contractAverage ?? 0)),
    contractsWithValue: Math.max(0, Number(summary.contractsWithValue ?? 0)),
    missingContractValues: Math.max(0, Number(summary.missingContractValues ?? 0)),
    generatedAt: summary.generatedAt ?? new Date().toISOString(),
    lastSyncAt: summary.lastSyncAt ?? null,
    stale: isReportStale(summary.lastSyncAt),
  };
}

async function refreshSalesReport(reportUrl: string, token: string) {
  const response = await fetch(`${reportUrl}/api/sync`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "OAI-Sites-Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ mode: "incremental" }),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    status?: string;
    finishedAt?: string;
    error?: string;
  };
  if (!response.ok || payload.error || payload.status !== "success") {
    throw new Error(payload.error ?? `Sales sync HTTP ${response.status}`);
  }
  return payload.finishedAt ?? null;
}

async function reportFetch<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "OAI-Sites-Authorization": `Bearer ${token}`,
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Sales report HTTP ${response.status}`);
  }
  return payload;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function isReportStale(lastSyncAt: string | null | undefined) {
  if (!lastSyncAt) return true;
  const syncedAt = new Date(lastSyncAt).getTime();
  return !Number.isFinite(syncedAt) || Date.now() - syncedAt > REPORT_STALE_AFTER_MS;
}

function responseHeaders() {
  return {
    "cache-control": "public, max-age=60, stale-while-revalidate=120",
    "content-type": "application/json; charset=utf-8",
  };
}
