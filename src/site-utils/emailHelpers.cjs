function pick(v) {
  return String(v ?? "").trim();
}

function esc(v = "") {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function originFromEnv(env) {
  const e = env || {};
  return String(
    e.WEBSITE_URL || e.URL || e.DEPLOY_PRIME_URL || e.SITE_URL || "",
  )
    .trim()
    .replace(/\/$/, "");
}

function label(map, raw, fallback = "") {
  const key = pick(raw);
  return key ? map[key] || key : fallback;
}

function money(v, opts) {
  const s = pick(v);
  if (!s) return "";
  const n = Number(s.replace(/[, ]+/g, ""));
  if (!Number.isFinite(n)) return "";
  const o = opts || {};
  const locale = String(o.locale || "en-NZ");
  const currency = String(o.currency || "NZD");
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    n,
  );
}

function yn(v) {
  const s = pick(v).toLowerCase();
  if (s === "yes") return "Yes";
  if (s === "no") return "No";
  return "";
}

module.exports = { pick, esc, originFromEnv, label, money, yn };
