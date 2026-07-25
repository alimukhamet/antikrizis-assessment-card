export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(process.env.BITRIX_WEBHOOK);
  return Response.json(
    { ok: configured, source: configured ? "bitrix" : "unconfigured" },
    {
      status: configured ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
