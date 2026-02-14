const { pick, label, money, yn } = require("./emailHelpers.cjs");

function safeIso(v) {
  const s = pick(v);
  if (!s) return "";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString();
}

module.exports = { pick, label, money, yn, safeIso };
