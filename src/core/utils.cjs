function safeTrim(v) {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function stripTrailingSlash(s) {
  return String(s || "").replace(/\/$/, "");
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function redactEmail(s) {
  const v = safeTrim(s);
  const at = v.indexOf("@");
  if (at <= 1) return v ? "***" : "";
  return `${v.slice(0, 1)}***${v.slice(at)}`;
}

function splitEmails(s) {
  return String(s || "")
    .split(/[,;]+/g)
    .map((x) => String(x).trim())
    .filter(Boolean);
}

function domainFromEmail(email) {
  const v = safeTrim(email);
  const at = v.lastIndexOf("@");
  if (at === -1) return "";
  const d = v.slice(at + 1).trim();
  return d.includes(".") ? d : "";
}

function nowIso() {
  return new Date().toISOString();
}

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    safeTrim(v),
  );
}

module.exports = {
  safeTrim,
  stripTrailingSlash,
  toInt,
  envBool,
  redactEmail,
  splitEmails,
  domainFromEmail,
  nowIso,
  isUuid,
};
