const { stripTrailingSlash } = require("./utils.cjs");

function getHeader(event, name) {
  const h = event && event.headers ? event.headers : {};
  const key = String(name || "").toLowerCase();
  for (const k of Object.keys(h)) {
    if (String(k).toLowerCase() === key) return String(h[k] ?? "");
  }
  return "";
}

function bodyText(event) {
  const b = event && event.body ? String(event.body) : "";
  if (!b) return "";
  if (event.isBase64Encoded) return Buffer.from(b, "base64").toString("utf8");
  return b;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRequestBody(event) {
  const ct = getHeader(event, "content-type");
  const text = bodyText(event);
  if (!text) return {};

  if (ct.includes("application/json")) {
    const v = parseJsonSafe(text);
    if (v && typeof v === "object") return v;
    throw new Error("Invalid JSON");
  }

  if (ct.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }

  const maybe = parseJsonSafe(text);
  if (maybe && typeof maybe === "object") return maybe;
  return {};
}

function json(statusCode, obj, extraHeaders) {
  const headers = Object.assign(
    { "content-type": "application/json" },
    extraHeaders || {},
  );
  return { statusCode, headers, body: JSON.stringify(obj ?? {}) };
}

function resolveOrigin(event, env) {
  const host =
    getHeader(event, "x-forwarded-host") ||
    getHeader(event, "host") ||
    getHeader(event, "Host") ||
    "";

  const proto =
    getHeader(event, "x-forwarded-proto") ||
    (String(host).includes("localhost") ? "http" : "https");

  const origin = stripTrailingSlash(
    (env && env.WEBSITE_URL ? String(env.WEBSITE_URL) : "") ||
      (host ? `${proto}://${host}` : ""),
  );

  return origin;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ms = Number(timeoutMs);
  const t = Number.isFinite(ms) && ms > 0 ? ms : 8000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), t);
  try {
    return await fetch(
      url,
      Object.assign({}, init || {}, { signal: controller.signal }),
    );
  } finally {
    clearTimeout(id);
  }
}

module.exports = {
  getHeader,
  parseRequestBody,
  json,
  resolveOrigin,
  fetchWithTimeout,
};
