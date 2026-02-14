import { safeTrim, readJsonSafe } from "./lead.mjs";

function header(res, name) {
  try {
    return safeTrim(res.headers.get(name) || "");
  } catch {
    return "";
  }
}

function extractCorrelationId(res, body) {
  const fromBody =
    body && typeof body === "object" && typeof body.correlationId === "string"
      ? safeTrim(body.correlationId)
      : "";

  if (fromBody) return fromBody;

  const h =
    header(res, "x-correlation-id") || header(res, "X-Correlation-Id") || "";

  return safeTrim(h);
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeTrim(email));
}

export function validatePhone(phone) {
  return /^[\d\s\-\+\(\)]{8,}$/.test(String(phone || "").replace(/\s/g, ""));
}

export async function submitLead(payload, opts = {}) {
  const endpoint = safeTrim(opts.endpoint || "/.netlify/functions/handle-lead");
  const timeoutMs = Number(opts.timeoutMs || 0);

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;

  const t =
    controller && timeoutMs > 0
      ? setTimeout(() => {
          try {
            controller.abort();
          } catch {}
        }, timeoutMs)
      : null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: controller ? controller.signal : undefined,
    });

    const body = await readJsonSafe(res);
    const correlationId = extractCorrelationId(res, body);
    const ok = res.status === 202 || res.status === 200;

    return {
      ok,
      status: res.status,
      correlationId: correlationId || undefined,
      body,
    };
  } finally {
    if (t) clearTimeout(t);
  }
}
