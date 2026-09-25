import {bitrixHeaders} from '../../../../lib/crm/http-headers'; import { requireStaffRequest } from '../../staff-access';
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const ASSESSMENT_METHODS = new Set([
  "crm.deal.get",
  "crm.item.get",
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ method: string }> },
) {
  const denied = await requireStaffRequest(request);
  if (denied) return denied;

  const { method: rawMethod } = await context.params;
  const method = rawMethod.replace(/\.json$/i, "");
  if (!/^[a-z0-9_.]+$/i.test(method)) {
    return Response.json(
      { error: "INVALID_METHOD", error_description: "Некорректный метод Bitrix." },
      { status: 400, headers: JSON_HEADERS },
    );
  }
  if (["crm.deal.update", "crm.timeline.comment.add", "crm.item.update"].includes(method.toLowerCase())) {
    return Response.json({
      error: "OLD_TOOL_RETIRED",
      error_description: "Инструменты 01 и 02 закрыты. Откройте «Подготовить договор» или «Передать юристам». Сохранённые данные остаются в Bitrix.",
      replacement: "/assessment-review",
    }, { status: 410, headers: JSON_HEADERS });
  }
  if (!ASSESSMENT_METHODS.has(method.toLowerCase())) {
    return Response.json(
      {
        error: "METHOD_NOT_ALLOWED",
        error_description: "Этот метод Bitrix недоступен из карточки оценки.",
      },
      { status: 403, headers: JSON_HEADERS },
    );
  }

  const configuredWebhook = process.env.BITRIX_WEBHOOK;
  if (!configuredWebhook) {
    return Response.json(
      { error: "BITRIX_NOT_CONFIGURED", error_description: "Bitrix не настроен." },
      { status: 503, headers: JSON_HEADERS },
    );
  }

  const body = await request.text();
  const endpoint =
    configuredWebhook.replace(/\/?$/, "/") + method + ".json";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: bitrixHeaders(configuredWebhook),
      body,
      cache: "no-store",
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: JSON_HEADERS,
    });
  } catch {
    return Response.json(
      {
        error: "BITRIX_UNAVAILABLE",
        error_description: "Bitrix временно недоступен. Повторите попытку.",
      },
      { status: 502, headers: JSON_HEADERS },
    );
  }
}
