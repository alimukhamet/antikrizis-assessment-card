import { requireStaffRequest } from "../staff-access";
import { readSessionCookie, verifySession } from "../../../lib/worker-session";
import { boundedJson } from "../../../lib/documents/request-context";
import { RepositoryError } from "../../../lib/documents/repository";
import {
  OperationsError,
  operationsRepository,
  validateOperationEvent,
} from "../../../lib/operations-monitor";
import release from "../../../lib/assessment-release.json";
export const dynamic = "force-dynamic";
const headers = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
const actorFor = (request: Request) =>
  verifySession(
    readSessionCookie(request.headers.get("cookie")),
    process.env.SITE_SESSION_TOKEN ?? "",
  );
const failure = (error: unknown) =>
  Response.json(
    {
      error:
        error instanceof OperationsError || error instanceof RepositoryError
          ? error.code
          : "MONITOR_UNAVAILABLE",
    },
    {
      status:
        error instanceof OperationsError || error instanceof RepositoryError
          ? error.status
          : 503,
      headers,
    },
  );
export async function POST(request: Request) {
  const denied = await requireStaffRequest(request);
  if (denied) return denied;
  try {
    const actor = await actorFor(request);
    if (!actor)
      return Response.json(
        { error: "SIGN_IN_REQUIRED" },
        { status: 401, headers },
      );
    const raw = await boundedJson(request, 3000),
      event = validateOperationEvent(raw);
    if (event.code === "MONITOR_PROBE" && actor.worker !== "ali")
      return Response.json({ error: "FORBIDDEN" }, { status: 403, headers });
    const repository = await operationsRepository();
    const accepted = await repository.record(event, actor.id);
    if (event.code === "MONITOR_PROBE") await repository.prune();
    return Response.json(
      { ok: true, accepted, serverVersion: release.version },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function GET(request: Request) {
  const denied = await requireStaffRequest(request);
  if (denied) return denied;
  try {
    const actor = await actorFor(request);
    if (actor?.worker !== "ali")
      return Response.json({ error: "FORBIDDEN" }, { status: 403, headers });
    return Response.json(await (await operationsRepository()).summary(), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}
