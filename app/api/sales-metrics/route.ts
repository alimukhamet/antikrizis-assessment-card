export const dynamic = "force-dynamic";

const MANAGERS = {
  "7609": "Дархан",
  "2093": "Рамазан",
  "4351": "Нурдаулет",
} as const;

const PAYMENT_TYPES = {
  all: "Все",
  "423": "50/50",
  "261": "После определения",
  "263": "До определения",
} as const;

const PERIODS = new Set(["today", "current_week", "current_month", "custom"]);
const CACHE_TTL_MS = 60_000;
const ALMATY_OFFSET = "+05:00";
const HANDOFF_DATE_FIELD = "UF_CRM_1777554129345";
const PAYMENT_TYPE_FIELD = "UF_CRM_1781335943568";

type ManagerId = keyof typeof MANAGERS;
type PaymentType = keyof typeof PAYMENT_TYPES;
type Period = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
};
type Deal = {
  ID?: string;
  OPPORTUNITY?: string | number | null;
};
type SalesMetricPayload = {
  managerId: ManagerId;
  managerName: string;
  paymentType: PaymentType;
  paymentTypeLabel: string;
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
const inFlight = new Map<string, Promise<SalesMetricPayload>>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const managerId = searchParams.get("managerId") as ManagerId | null;
  const paymentType = (searchParams.get("paymentType") ?? "261") as PaymentType;
  const periodKey = searchParams.get("period") ?? "current_month";

  if (
    !managerId ||
    !Object.hasOwn(MANAGERS, managerId) ||
    !Object.hasOwn(PAYMENT_TYPES, paymentType) ||
    !PERIODS.has(periodKey)
  ) {
    return Response.json(
      { error: "Выберите сотрудника, вид оплаты и период из предложенного списка." },
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

  const cacheKey = `${managerId}:${paymentType}:${period.key}:${period.startDate}:${period.endDate}`;
  const cached = cache.get(cacheKey);
  if (!searchParams.has("fresh") && cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: responseHeaders() });
  }

  try {
    let pending = inFlight.get(cacheKey);
    if (!pending) {
      pending = buildSalesMetrics(managerId, paymentType, period).then((payload) => {
        for (const [key, entry] of cache) {
          if (entry.expiresAt <= Date.now()) cache.delete(key);
        }
        if (cache.size >= 300) cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
        return payload;
      }).finally(() => inFlight.delete(cacheKey));
      inFlight.set(cacheKey, pending);
    }
    const payload = await pending;
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
  paymentType: PaymentType,
  period: Period,
): Promise<SalesMetricPayload> {
  const deals = await loadHandoffDeals(managerId, paymentType, period);
  const contractValues = deals
    .map((deal) => parseMoney(deal.OPPORTUNITY))
    .filter((value) => value > 0);
  const contractTotal = contractValues.reduce((sum, value) => sum + value, 0);
  const now = new Date().toISOString();

  return {
    managerId,
    managerName: MANAGERS[managerId],
    paymentType,
    paymentTypeLabel: PAYMENT_TYPES[paymentType],
    period: period.key,
    periodLabel: period.label,
    handoffs: deals.length,
    contractTotal,
    contractAverage: contractValues.length
      ? Math.round(contractTotal / contractValues.length)
      : 0,
    contractsWithValue: contractValues.length,
    missingContractValues: Math.max(0, deals.length - contractValues.length),
    generatedAt: now,
    lastSyncAt: now,
    stale: false,
  };
}

async function loadHandoffDeals(
  managerId: ManagerId,
  paymentType: PaymentType,
  period: Period,
): Promise<Deal[]> {
  const deals: Deal[] = [];
  let lastId = 0;
  const signal = AbortSignal.timeout(30_000);

  for (let page = 0; page < 100; page += 1) {
    const filter: Record<string, string> = {
      ASSIGNED_BY_ID: managerId,
      [`>=${HANDOFF_DATE_FIELD}`]: period.startDate,
      [`<=${HANDOFF_DATE_FIELD}`]: period.endDate,
    };
    if (paymentType !== "all") filter[PAYMENT_TYPE_FIELD] = paymentType;
    if (lastId) filter[">ID"] = String(lastId);

    const payload = await bitrixCall<{
      result?: Deal[];
    }>("crm.deal.list", {
      order: { ID: "ASC" },
      filter,
      select: ["ID", "OPPORTUNITY"],
      // Skip Bitrix's redundant COUNT query; count the actual rows below.
      start: -1,
    }, signal);
    if (!Array.isArray(payload.result)) throw new Error("Invalid Bitrix deal list");
    const rows = payload.result;
    for (const deal of rows) {
      const id = Number(deal.ID);
      if (!Number.isSafeInteger(id) || id <= lastId) {
        throw new Error("Bitrix returned an invalid pagination cursor");
      }
      lastId = id;
    }
    deals.push(...rows);
    if (rows.length < 50) return deals;
  }
  throw new Error("Bitrix result exceeds the safe pagination limit");
}

async function bitrixCall<T>(method: string, params: Record<string, unknown>, signal: AbortSignal) {
  const response = await fetch(`${requiredWebhook()}${method}.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
    signal,
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
    startDate,
    endDate: today,
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
    startDate: from,
    endDate: to,
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
