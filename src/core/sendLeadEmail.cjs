let _transporterPromise = null;

const fs = require("fs");
const path = require("path");
const {
  safeTrim,
  splitEmails,
  redactEmail,
  toInt,
  envBool,
  domainFromEmail,
} = require("./utils.cjs");

function buildMessageId(correlationId, fromEmail, siteSlug) {
  const id = safeTrim(correlationId);
  if (!id) return undefined;
  const d = domainFromEmail(fromEmail) || "local";
  const slug = safeTrim(siteSlug) || "lead";
  return `<${slug}-${id}@${d}>`;
}

async function getTransporter(env) {
  if (_transporterPromise) return _transporterPromise;

  _transporterPromise = (async () => {
    let nodemailer = null;
    try {
      nodemailer = require("nodemailer");
    } catch {
      throw new Error("Missing dependency: nodemailer");
    }

    const e = env || process.env;

    const host = safeTrim(e.SMTP_HOST);
    if (!host) throw new Error("Missing SMTP_HOST");

    const port = toInt(e.SMTP_PORT, 587);

    const secure =
      typeof e.SMTP_SECURE !== "undefined" && safeTrim(e.SMTP_SECURE) !== ""
        ? envBool(e.SMTP_SECURE)
        : port === 465;

    const user = safeTrim(e.SMTP_USER);
    const pass = safeTrim(e.SMTP_PASS);

    const rejectUnauthorized =
      typeof e.SMTP_TLS_REJECT_UNAUTHORIZED !== "undefined" &&
      safeTrim(e.SMTP_TLS_REJECT_UNAUTHORIZED) !== ""
        ? envBool(e.SMTP_TLS_REJECT_UNAUTHORIZED)
        : true;

    const connectionTimeout = toInt(e.SMTP_CONNECTION_TIMEOUT_MS, 8000);
    const greetingTimeout = toInt(e.SMTP_GREETING_TIMEOUT_MS, 8000);
    const socketTimeout = toInt(e.SMTP_SOCKET_TIMEOUT_MS, 15000);

    const auth = user || pass ? { user, pass } : undefined;

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
      pool: false,
      connectionTimeout,
      greetingTimeout,
      socketTimeout,
      tls: { rejectUnauthorized },
    });
  })();

  return _transporterPromise;
}

function tryReadFileCandidates(candidates) {
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        if (buf && buf.length > 0) return buf;
      }
    } catch {}
  }
  return null;
}

function tryReadInlineLogo(env) {
  const e = env || process.env;

  const enabled =
    typeof e.LEAD_EMAIL_INLINE_LOGO !== "undefined"
      ? envBool(e.LEAD_EMAIL_INLINE_LOGO)
      : true;

  if (!enabled) return null;

  const configured = safeTrim(e.LEAD_EMAIL_LOGO_PATH);
  const candidates = [];

  if (configured) {
    candidates.push(path.resolve(process.cwd(), configured));
    candidates.push(path.resolve(configured));
  } else {
    candidates.push(path.resolve(process.cwd(), "public/logo.png"));
    candidates.push(path.resolve(process.cwd(), "astro-build/public/logo.png"));
  }

  return tryReadFileCandidates(candidates);
}

function bestBusinessName(payload) {
  if (!payload || typeof payload !== "object") return "";
  const p = payload;
  const candidates = [
    p.businessName,
    p.companyName,
    p.business,
    p.company,
    p.name,
  ];
  for (const c of candidates) {
    const s = safeTrim(c);
    if (s) return s;
  }
  return "";
}

function bestReplyTo(payload) {
  if (!payload || typeof payload !== "object") return "";
  const s = safeTrim(payload.email || payload.contactEmail);
  return s;
}

function subjectFor({ payload, env, siteSlug }) {
  const e = env || process.env;

  const fixed = safeTrim(e.LEAD_EMAIL_SUBJECT);
  if (fixed) return fixed;

  const prefix =
    safeTrim(e.LEAD_EMAIL_SUBJECT_PREFIX) ||
    safeTrim(siteSlug).toUpperCase() ||
    "Lead";

  const name = bestBusinessName(payload);
  return name ? `${prefix} - ${name}` : `${prefix} Lead`;
}

async function sendLeadEmail({
  adapter,
  payload,
  pdfBytes,
  env,
  correlationId,
}) {
  const e = env || process.env;

  const to = splitEmails(e.LEAD_TO_EMAIL || e.LEAD_EMAIL_TO || e.ADMIN_EMAIL);
  const from = safeTrim(e.LEAD_FROM_EMAIL || e.FROM_EMAIL);

  if (to.length === 0)
    throw new Error("Missing LEAD_TO_EMAIL (or ADMIN_EMAIL)");
  if (!from) throw new Error("Missing LEAD_FROM_EMAIL");

  const replyTo = bestReplyTo(payload);

  const requirePdf = envBool(safeTrim(e.EMAIL_REQUIRE_PDF || "0"));
  const hasPdf =
    !!pdfBytes &&
    (Buffer.isBuffer(pdfBytes) || typeof pdfBytes.length === "number");

  if (requirePdf && !hasPdf)
    throw new Error("Missing pdfBytes for email attachment");

  const html = await Promise.resolve(
    adapter.renderLeadEmailHTML(payload || {}, e),
  );
  const text = await Promise.resolve(
    adapter.renderLeadEmailText(payload || {}, e),
  );

  const attachments = [];

  const logoBuf = tryReadInlineLogo(e);
  if (logoBuf) {
    attachments.push({
      filename: "logo.png",
      content: logoBuf,
      contentType: "image/png",
      cid: "logo@lead",
      contentDisposition: "inline",
    });
  }

  const pdfName =
    safeTrim(e.LEAD_PDF_FILENAME) ||
    `${safeTrim(adapter.siteSlug) || "lead"}-lead.pdf`;
  if (hasPdf) {
    attachments.push({
      filename: pdfName,
      content: Buffer.from(pdfBytes),
      contentType: "application/pdf",
    });
  }

  const transporter = await getTransporter(e);

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message: "leadkit.smtp.send.attempt",
      correlationId: safeTrim(correlationId),
      toCount: to.length,
      from,
      replyTo: replyTo ? redactEmail(replyTo) : "",
      smtpHost: safeTrim(e.SMTP_HOST),
      smtpPort: safeTrim(e.SMTP_PORT),
      secure: safeTrim(e.SMTP_SECURE),
      hasPdf,
      requirePdf,
      hasLogo: !!logoBuf,
      siteSlug: safeTrim(adapter.siteSlug),
    }),
  );

  try {
    if (envBool(safeTrim(e.SMTP_VERIFY || "0"))) await transporter.verify();

    const info = await transporter.sendMail({
      from,
      to: to.join(", "),
      subject: subjectFor({ payload, env: e, siteSlug: adapter.siteSlug }),
      text: safeTrim(text) || "",
      html: safeTrim(html) || undefined,
      replyTo: replyTo || undefined,
      messageId: buildMessageId(correlationId, from, adapter.siteSlug),
      headers: { "X-Correlation-Id": safeTrim(correlationId) },
      attachments,
    });

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        message: "leadkit.smtp.send.ok",
        correlationId: safeTrim(correlationId),
        messageId: info && info.messageId ? String(info.messageId) : "",
        accepted: Array.isArray(info && info.accepted)
          ? info.accepted.length
          : 0,
        rejected: Array.isArray(info && info.rejected)
          ? info.rejected.length
          : 0,
        response: info && info.response ? String(info.response) : "",
      }),
    );

    return {
      messageId: info && info.messageId ? String(info.messageId) : "",
      accepted: Array.isArray(info && info.accepted) ? info.accepted : [],
      rejected: Array.isArray(info && info.rejected) ? info.rejected : [],
    };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : "SMTP send failed";
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        message: "leadkit.smtp.send.failed",
        correlationId: safeTrim(correlationId),
        err: msg,
        stack: err && err.stack ? String(err.stack) : "",
      }),
    );
    throw new Error(
      safeTrim(correlationId) ? `${msg} (${safeTrim(correlationId)})` : msg,
    );
  }
}

module.exports = { sendLeadEmail };
