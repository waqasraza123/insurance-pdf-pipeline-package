export function safeTrim(v) {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

export async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function saveLeadId(leadId, opts = {}) {
  const id = safeTrim(leadId);
  if (!id) return;

  const key = safeTrim(opts.storageKey || "lead:lastLeadId");
  const where = safeTrim(opts.storage || "session");

  try {
    if (typeof window === "undefined") return;
    const s = where === "local" ? window.localStorage : window.sessionStorage;
    s.setItem(key, id);
  } catch {}
}

export function readLeadIdFromUrl(opts = {}) {
  const href = opts.href;
  const param = safeTrim(opts.param || "leadId") || "leadId";

  try {
    if (typeof window === "undefined" && !href) return null;
    const u = new URL(href || window.location.href);
    const qp = safeTrim(u.searchParams.get(param) || "");
    return qp || null;
  } catch {
    return null;
  }
}

export function readLeadIdFromStorage(opts = {}) {
  const key = safeTrim(opts.storageKey || "lead:lastLeadId");
  const where = safeTrim(opts.storage || "session");

  try {
    if (typeof window === "undefined") return null;
    const s = where === "local" ? window.localStorage : window.sessionStorage;
    const v = safeTrim(s.getItem(key) || "");
    return v || null;
  } catch {
    return null;
  }
}

export function getLeadId(opts = {}) {
  return (
    readLeadIdFromUrl({ href: opts.href, param: opts.param }) ||
    readLeadIdFromStorage({
      storageKey: opts.storageKey,
      storage: opts.storage || "session",
    }) ||
    readLeadIdFromStorage({
      storageKey: opts.storageKeyLocal || opts.storageKey,
      storage: "local",
    })
  );
}

export function extractLeadIdFromBody(body) {
  if (!body || typeof body !== "object") return "";
  const candidates = [
    body.leadId,
    body.cid,
    body.correlationId,
    body.id,
    body.jobId,
  ];
  for (const c of candidates) {
    const s = safeTrim(c);
    if (s) return s;
  }
  return "";
}

export function buildThankYouUrl(leadId, opts = {}) {
  const id = safeTrim(leadId);
  const path = safeTrim(opts.path || "/thank-you") || "/thank-you";
  const param = safeTrim(opts.param || "leadId") || "leadId";
  return id ? `${path}?${param}=${encodeURIComponent(id)}` : path;
}
