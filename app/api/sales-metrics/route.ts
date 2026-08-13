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
type DashboardManager = { id: string; handoffs?: number };
type DashboardResponse = {
  runId?: string;
  generatedAt?: string;
  lastSyncAt?: string | null;
  period?: { label?: string };
  managers?: DashboardManager[];
  error?: string;
};
type DrilldownResponse = {
  deals?: Array<{ id?: string }>;
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
    const dashboard = await reportFetch<DashboardResponse>(
      `${reportUrl}/api/dashboard?period=current_month`,
      reportToken,
    );
    if (!isReportStale(dashboard.lastSyncAt)) {
      return Response.json(
        { refreshed: false, lastSyncAt: dashboard.lastSyncAt ?? null },
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
  const dashboard = await reportFetch<DashboardResponse>(
    `${reportUrl}/api/dashboard?period=${encodeURIComponent(period)}`,
    reportToken,
  );
  if (!dashboard.runId) throw new Error("Sales report returned no run ID");

  const manager = (dashboard.managers ?? []).find((item) => item.id === managerId);
  const handoffs = Math.max(0, Number(manager?.handoffs ?? 0));
  let dealIds: string[] = [];

  if (handoffs > 0) {
    const query = new URLSearchParams({
      runId: dashboard.runId,
      metric: "handoffs",
      managerId,
    });
    const drilldown = await reportFetch<DrilldownResponse>(
      `${reportUrl}/api/deals?${query}`,
      reportToken,
    );
    dealIds = [...new Set(
      (drilldown.deals ?? [])
        .map((deal) => String(deal.id ?? ""))
        .filter((id) => /^\d+$/.test(id)),
    )];
  }

  const amounts = await loadContractValues(dealIds);
  const contractTotal = amounts.reduce((sum, amount) => sum + amount, 0);
  const contractsWithValue = amounts.filter((amount) => amount > 0).length;
  const missingContractValues = Math.max(0, handoffs - contractsWithValue);

  return {
    managerId,
    managerName: MANAGERS[managerId],
    period,
    periodLabel: dashboard.period?.label ?? period,
    handoffs,
    contractTotal,
    contractAverage: contractsWithValue
      ? Math.round(contractTotal / contractsWithValue)
      : 0,
    contractsWithValue,
    missingContractValues,
    generatedAt: dashboard.generatedAt ?? new Date().toISOString(),
    lastSyncAt: dashboard.lastSyncAt ?? null,
    stale: isReportStale(dashboard.lastSyncAt),
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

async function loadContractValues(dealIds: string[]): Promise<number[]> {
  if (!dealIds.length) return [];
  const webhook = requiredEnv("BITRIX_WEBHOOK").replace(/\/?$/, "/");
  const values: number[] = [];

  for (let index = 0; index < dealIds.length; index += 10) {
    const group = dealIds.slice(index, index + 10);
    const deals = await Promise.all(
      group.map(async (id) => {
        const response = await fetch(`${webhook}crm.deal.get.json`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: Number(id) }),
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          result?: { OPPORTUNITY?: string | number | null };
          error?: string;
        };
        if (!response.ok || payload.error) return 0;
        return parseMoney(payload.result?.OPPORTUNITY);
      }),
    );
    values.push(...deals);
  }

  return values;
}

function parseMoney(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
