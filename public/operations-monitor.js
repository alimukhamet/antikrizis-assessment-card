/* Operational metadata only: never collect form values, messages, stacks, files or keys. */
(() => {
  const originalFetch = window.fetch.bind(window),
    queue = [],
    seen = new Map();
  let flushing = false,
    lastPulse = 0,
    stallTimer = null;
  const version = () =>
    document.body?.dataset.assessmentVersion || "assessment-unknown";
  const deal = () => {
    const value = new URLSearchParams(location.search).get("dealId");
    return /^\d{1,20}$/.test(value || "") ? value : null;
  };
  function route(input) {
    try {
      const url = new URL(
        typeof input === "string" ? input : input.url,
        location.href,
      );
      if (url.origin !== location.origin) return null;
      const match = /^\/api\/assessment\/(\d{1,20})(?:\/([^/?]+))?/.exec(
        url.pathname,
      );
      if (!match) return null;
      const actions = {
        draft: "draft",
        documents: "analysis",
        "document-reviews": "review",
        reviews: "review",
        "review-batch": "review",
        "gkb-reviews": "review",
        check: "check",
        submission: "contract",
        uploads: "upload",
        credentials: "credentials",
        handoff: "handoff",
        "crm-intake": "intake",
        "crm-documents": "upload",
      };
      return { dealId: match[1], action: actions[match[2]] || "open_case" };
    } catch {
      return null;
    }
  }
  function staleNotice(serverVersion) {
    if (
      !serverVersion ||
      serverVersion === version() ||
      document.getElementById("assessmentUpdateNotice")
    )
      return;
    const notice = document.createElement("aside");
    notice.id = "assessmentUpdateNotice";
    notice.className = "af-workspace";
    notice.setAttribute("role", "status");
    const text = document.createElement("p");
    text.textContent =
      "Доступна новая версия. Эта вкладка и введённые ответы останутся открытыми.";
    const link = document.createElement("a");
    link.className = "btn btn-ghost";
    link.textContent = "Открыть свежую карточку";
    link.target = "_blank";
    link.rel = "noopener";
    link.href =
      "/assessment-review" +
      (deal() ? "?dealId=" + encodeURIComponent(deal()) : "");
    notice.append(text, link);
    document.body.prepend(notice);
  }
  async function flush() {
    if (flushing || !queue.length || navigator.onLine === false) return;
    flushing = true;
    try {
      while (queue.length) {
        const item = queue[0],
          controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 10000);
        let response;
        try {
          response = await originalFetch("/api/operations-monitor", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(item),
            signal: controller.signal,
            keepalive: true,
          });
          if (!response.ok) {
            if (response.status === 400 || response.status === 403)
              queue.shift();
            break;
          }
          const data = await response.json();
          if (!data.ok) break;
          queue.shift();
          staleNotice(data.serverVersion);
        } finally {
          clearTimeout(timer);
        }
      }
    } catch {
      /* Monitoring failure must never block employee work. */
    } finally {
      flushing = false;
    }
  }
  function record(code, context = {}) {
    try {
      const allowed = [
        "PAGE_OPEN",
        "MONITOR_PROBE",
        "JS_ERROR",
        "UNHANDLED_REJECTION",
        "ASSET_LOAD_FAILED",
        "NETWORK_FAILURE",
        "REQUEST_TIMEOUT",
        "API_HTTP_FAILURE",
        "ACTION_STALLED",
        "EXTRACTION_VERSION_CHANGED",
        "DRAFT_CHANGED",
        "CONTRACT_OPERATION_TIMEOUT",
        "INVALID_SERVER_RESPONSE",
        "SERVER_UNAVAILABLE",
        "CRM_INTAKE_FAILED",
      ];
      if (!allowed.includes(code)) return;
      const item = {
        id: crypto.randomUUID(),
        dealId: context.dealId ?? deal(),
        action: context.action || "page",
        code,
        clientVersion: version(),
        status: Number.isInteger(context.status) ? context.status : 0,
        asset: context.asset || null,
        line: Number.isInteger(context.line) ? context.line : null,
      };
      const key = JSON.stringify([
        item.dealId,
        item.action,
        item.code,
        item.status,
        item.asset,
        item.line,
      ]);
      if (Date.now() - (seen.get(key) || 0) < 60000) return;
      seen.set(key, Date.now());
      if (seen.size > 200) seen.delete(seen.keys().next().value);
      if (queue.length < 40) queue.push(item);
      void flush();
    } catch {
      /* Diagnostics must preserve the original business response even if unavailable. */
    }
  }
  window.OperationsMonitor = {
    record,
    requestFailure: (url, code) => {
      const context = route(url);
      if (context) record(code, context);
    },
  };
  window.fetch = async function (input, options) {
    const context = route(input);
    try {
      const response = await originalFetch(input, options);
      if (context && response.status >= 500)
        record("API_HTTP_FAILURE", { ...context, status: response.status });
      return response;
    } catch (error) {
      if (context)
        record(
          error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "NETWORK_FAILURE",
          context,
        );
      throw error;
    }
  };
  window.addEventListener(
    "error",
    (event) => {
      let asset = null;
      try {
        const path = new URL(
          event.filename || event.target?.src || event.target?.href || "",
          location.href,
        ).pathname;
        if (/^\/[a-zA-Z0-9/_.-]{1,180}\.(?:m?js|css)$/.test(path)) asset = path;
      } catch {}
      record(
        event.target?.tagName === "SCRIPT" || event.target?.tagName === "LINK"
          ? "ASSET_LOAD_FAILED"
          : "JS_ERROR",
        { asset, line: event.lineno || null },
      );
    },
    true,
  );
  window.addEventListener("unhandledrejection", () =>
    record("UNHANDLED_REJECTION"),
  );
  document.addEventListener("assessment-submission-progress", (event) => {
    if (!event.detail?.busy) {
      clearTimeout(stallTimer);
      stallTimer = null;
      return;
    }
    if (stallTimer) return;
    const context = { dealId: deal(), action: "contract" };
    stallTimer = setTimeout(() => {
      stallTimer = null;
      record("ACTION_STALLED", context);
    }, 180000);
  });
  document.addEventListener("assessment-case-opened", () => {
    clearTimeout(stallTimer);
    stallTimer = null;
    record("PAGE_OPEN");
  });
  const pulse = () => {
    if (
      document.visibilityState === "hidden" ||
      Date.now() - lastPulse < 300000
    )
      return;
    lastPulse = Date.now();
    record("PAGE_OPEN");
  };
  document.addEventListener("DOMContentLoaded", pulse, { once: true });
  window.addEventListener("focus", pulse);
  window.addEventListener("online", () => void flush());
  setInterval(() => {
    pulse();
    void flush();
  }, 60000);
})();
