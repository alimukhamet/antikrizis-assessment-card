import { requireStaffRequest } from "../staff-access";
import { readSessionCookie, verifySession } from "../../../lib/worker-session";
import { auditLawyerDelivery, LawyerDeliveryAuditError } from "../../../lib/crm/lawyer-delivery-audit";

export const dynamic = "force-dynamic";
const headers = {
  "cache-control": "private, no-store",
  "content-type": "application/json",
  "x-content-type-options": "nosniff",
};
export async function GET(request: Request) {
  const denied = await requireStaffRequest(request);
  if (denied) return new Response(denied.body, { status: denied.status, headers });
  try {
    const actor = await verifySession(
      readSessionCookie(request.headers.get("cookie")),
      process.env.SITE_SESSION_TOKEN ?? "",
    );
    if (actor?.worker !== "ali")
      return Response.json({ error: "FORBIDDEN" }, { status: 403, headers });
    return Response.json(await auditLawyerDelivery(process.env.BITRIX_WEBHOOK ?? ""), { headers });
  } catch (error) {
    return Response.json({
      error: error instanceof LawyerDeliveryAuditError ? error.code : "LAWYER_AUDIT_UNAVAILABLE",
      ...(error instanceof LawyerDeliveryAuditError && error.upstream ? { upstream: error.upstream } : {}),
    }, { status: error instanceof LawyerDeliveryAuditError ? error.status : 503, headers });
  }
}
