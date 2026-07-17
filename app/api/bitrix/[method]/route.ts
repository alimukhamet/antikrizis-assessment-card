const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export async function POST(
  request: Request,
  context: { params: Promise<{ method: string }> },
) {
  const configuredWebhook = process.env.BITRIX_WEBHOOK;
  if (!configuredWebhook) {
    return Response.json(
      { error: "BITRIX_NOT_CONFIGURED", error_description: "Bitrix не настроен." },
      { status: 503, headers: JSON_HEADERS },
    );
  }

  const { method: rawMethod } = await context.params;
  const method = rawMethod.replace(/\.json$/i, "");
  if (!/^[a-z0-9_.]+$/i.test(method)) {
    return Response.json(
      { error: "INVALID_METHOD", error_description: "Некорректный метод Bitrix." },
      { status: 400, headers: JSON_HEADERS },
    );
  }

  const body = await request.text();
  const endpoint =
    configuredWebhook.replace(/\/?$/, "/") + method + ".json";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
