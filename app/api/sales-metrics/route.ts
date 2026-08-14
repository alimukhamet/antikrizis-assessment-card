export const dynamic = "force-dynamic";

const MANAGERS = {
  "7609": "Дархан",
  "2093": "Рамазан",
  "4351": "Нурдаулет",
} as const;

const PERIODS = new Set(["today", "current_week", "current_month", "custom"]);
const CACHE_TTL_MS = 60_000;
const ALMATY_OFFSET = "+05:00";

type ManagerId = keyof typeof MANAGERS;
type Period = {
  key: string;
  label: string;
  start: string;
  end: string;
};
type StageEvent = {
  ID?: string | number;
  OWNER_ID?: string | number;
  CREATED_TIME?: string;
  CATEGORY_ID?: string | number;
  STAGE_ID?: string;
};
type Deal = {
  ID?: string;
  CREATED_BY_ID?: string;
  ASSIGNED_BY_ID?: string;
  MOVED_BY_ID?: string;
  OPPORTUNITY?: string | number | null;
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
  lastSyncAt: string;
  stale: false;
};

const cache = new Map<string, { expiresAt: number; payload: SalesMetricPayload }>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const managerId = searchParams.get("managerId") as ManagerId | null;
  const periodKey = searchParams.get("period") ?? "current_month";

  if (!managerId || !(managerId in MANAGERS) || !PERIODS.has(periodKey)) {
    return Response.json(
      { error: "Выберите сотрудника и период из предложенного списка." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let period: Period;
  try {
    period = resolveRequestedPeriod(
      periodKey,
      searchParams.get("from"),
      searchParams.get("to"),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Проверьте выбранные даты.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const cacheKey = `${managerId}:${period.key}:${period.start}:${period.end}`;
  const cached = cache.get(cacheKey);
  if (!searchParams.has("fresh") && cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: responseHeaders() });
  }

  try {
    const payload = await buildSalesMetrics(managerId, period);
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return Response.json(payload, { headers: responseHeaders() });
  } catch (error) {
    console.error(
      "Sales metrics failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      { error: "Результаты продаж временно недоступны. Обновите страницу через минуту." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

async function buildSalesMetrics(
  managerId: ManagerId,
  period: Period,
): Promise<SalesMetricPayload> {
  const events = await loadHandoffEvents(period);
  const firstHandoffByDeal = new Map<string, StageEvent>();
  for (const event of events) {
    if (String(event.STAGE_ID ?? "") !== "C13:WON") continue;
    const dealId = String(event.OWNER_ID ?? "");
    if (!/^\d+$/.test(dealId) || firstHandoffByDeal.has(dealId)) continue;
    firstHandoffByDeal.set(dealId, event);
  }

  const deals = await loadDeals([...firstHandoffByDeal.keys()]);
  const selectedDeals = deals.filter((deal) => salesOwner(deal) === managerId);
  const contractValues = selectedDeals
    .map((deal) => parseMoney(deal.OPPORTUNITY))
    .filter((value) => value > 0);
  const contractTotal = contractValues.reduce((sum, value) => sum + value, 0);
  const now = new Date().toISOString();

  return {
    managerId,
    managerName: MANAGERS[managerId],
    period: period.key,
    periodLabel: period.label,
    handoffs: selectedDeals.length,
    contractTotal,
    contractAverage: contractValues.length
      ? Math.round(contractTotal / contractValues.length)
      : 0,
    contractsWithValue: contractValues.length,
    missingContractValues: Math.max(0, selectedDeals.length - contractValues.length),
    generatedAt: now,
    lastSyncAt: now,
    stale: false,
  };
}

async function loadHandoffEvents(period: Period): Promise<StageEvent[]> {
  const events: StageEvent[] = [];
  let start = 0;

  for (let page = 0; page < 20; page += 1) {
    const payload = await bitrixCall<{
      result?: { items?: StageEvent[] };
      next?: number;
    }>("crm.stagehistory.list", {
      entityTypeId: 2,
      order: { ID: "ASC" },
      filter: {
        CATEGORY_ID: 13,
        STAGE_ID: "C13:WON",
        ">=CREATED_TIME": period.start,
        "<CREATED_TIME": period.end,
      },
      start,
    });
    const items = payload.result?.items ?? [];
    events.push(...items);
    if (typeof payload.next !== "number") break;
    start = payload.next;
  }

  return events.filter((event) => {
    const at = new Date(String(event.CREATED_TIME ?? "")).getTime();
    return (
      Number(event.CATEGORY_ID) === 13 &&
      String(event.STAGE_ID ?? "") === "C13:WON" &&
      at >= new Date(period.start).getTime() &&
      at < new Date(period.end).getTime()
    );
  });
}

async function loadDeals(dealIds: string[]): Promise<Deal[]> {
  if (!dealIds.length) return [];
  const webhook = requiredWebhook();
  const deals: Deal[] = [];

  for (let index = 0; index < dealIds.length; index += 50) {
    const group = dealIds.slice(index, index + 50);
    const body = new URLSearchParams();
    body.set("halt", "0");
    group.forEach((id, position) => {
      body.set(`cmd[d${position}]`, `crm.deal.get?id=${encodeURIComponent(id)}`);
    });
    const response = await fetch(`${webhook}batch.json`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      result?: { result?: Record<string, Deal> };
      error?: string;
      error_description?: string;
    };
    if (!response.ok || payload.error) {
      throw new Error(payload.error_description ?? payload.error ?? `Bitrix batch HTTP ${response.status}`);
    }
    deals.push(...Object.values(payload.result?.result ?? {}));
  }

  return deals;
}

async function bitrixCall<T>(method: string, params: Record<string, unknown>) {
  const response = await fetch(`${requiredWebhook()}${method}.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
  });
  const payload = (await response.json()) as T & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description ?? payload.error ?? `Bitrix HTTP ${response.status}`);
  }
  return payload;
}

function salesOwner(deal: Deal): string | null {
  const candidates = [deal.ASSIGNED_BY_ID, deal.MOVED_BY_ID, deal.CREATED_BY_ID]
    .map((value) => String(value ?? ""));
  return candidates.find((value) => value in MANAGERS) ?? null;
}

function parseMoney(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolvePeriod(key: string): Period {
  const today = almatyDate();
  let startDate = today;
  let label = "Сегодня";

  if (key === "current_week") {
    startDate = addDays(today, -(weekday(today) - 1));
    label = "Текущая неделя";
  } else if (key === "current_month") {
    startDate = `${today.slice(0, 7)}-01`;
    label = "Текущий месяц";
  }

  return {
    key,
    label,
    start: new Date(`${startDate}T00:00:00${ALMATY_OFFSET}`).toISOString(),
    end: new Date(`${addDays(today, 1)}T00:00:00${ALMATY_OFFSET}`).toISOString(),
  };
}

function resolveRequestedPeriod(
  key: string,
  from: string | null,
  to: string | null,
): Period {
  if (key !== "custom") return resolvePeriod(key);
  if (!isDateInput(from) || !isDateInput(to)) {
    throw new Error("Укажите дату начала и дату окончания периода.");
  }
  if (from > to) {
    throw new Error("Дата начала не может быть позже даты окончания.");
  }
  if (to > almatyDate()) {
    throw new Error("Дата окончания не может быть позже сегодняшнего дня.");
  }
  const days = Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() -
      new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (days > 366) {
    throw new Error("Выберите период не более 367 дней.");
  }

  return {
    key,
    label: `${formatPeriodDate(from)} — ${formatPeriodDate(to)}`,
    start: new Date(`${from}T00:00:00${ALMATY_OFFSET}`).toISOString(),
    end: new Date(`${addDays(to, 1)}T00:00:00${ALMATY_OFFSET}`).toISOString(),
  };
}

function isDateInput(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatPeriodDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function almatyDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function weekday(date: string): number {
  const day = new Date(`${date}T12:00:00${ALMATY_OFFSET}`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function requiredWebhook(): string {
  const webhook = process.env.BITRIX_WEBHOOK;
  if (!webhook) throw new Error("BITRIX_WEBHOOK is not configured");
  return webhook.replace(/\/?$/, "/");
}

function responseHeaders() {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  };
}
