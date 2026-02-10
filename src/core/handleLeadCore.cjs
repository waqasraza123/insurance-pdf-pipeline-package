const { randomUUID } = require("crypto");
const { safeTrim, envBool } = require("./utils.cjs");
const { renderPdf } = require("./renderPdf.cjs");
const { sendLeadEmail } = require("./sendLeadEmail.cjs");

class LeadProcessingError extends Error {
  constructor(stage, message) {
    super(message);
    this.stage = stage;
  }
}

function normalizeStageCallback(opts) {
  const o = opts || {};
  const onStage = typeof o.onStage === "function" ? o.onStage : null;
  const onStep = typeof o.onStep === "function" ? o.onStep : null;

  if (!onStage && !onStep) return null;

  return async (stage, meta) => {
    const m = meta && typeof meta === "object" ? meta : {};

    if (onStage) {
      await Promise.resolve(onStage(stage, m));
    }

    if (onStep) {
      if (onStep.length >= 2) {
        await Promise.resolve(onStep(stage, m));
      } else {
        await Promise.resolve(onStep({ stage, extra: m }));
      }
    }
  };
}

async function handleLeadCore(adapter, payload, env, opts) {
  const e = env || process.env;
  const o = opts || {};

  const correlationId = safeTrim(o.correlationId) || randomUUID();
  const emit = normalizeStageCallback(o);

  const needPdf = Boolean(o.returnPdf || o.alsoEmail);
  if (emit) await emit("plan", { needPdf });

  let pdfBytes = null;
  let emailResult = null;

  if (needPdf) {
    if (emit) await emit("pdf_start", {});
    try {
      const model = await Promise.resolve(adapter.buildPdfModel(payload));
      pdfBytes = await renderPdf({
        templatePath: adapter.templatePath,
        model,
        env: e,
        correlationId,
      });
      if (emit)
        await emit("pdf_ok", {
          pdfBytes:
            pdfBytes && typeof pdfBytes.length === "number"
              ? pdfBytes.length
              : 0,
        });
    } catch (err) {
      const msg =
        err && err.message ? String(err.message) : "PDF render failed";
      if (emit) await emit("pdf_failed", { error: msg });

      const allowEmailWithoutPdf =
        typeof e.EMAIL_ALLOW_WITHOUT_PDF !== "undefined"
          ? envBool(e.EMAIL_ALLOW_WITHOUT_PDF)
          : true;

      if (!(o.alsoEmail && allowEmailWithoutPdf))
        throw new LeadProcessingError("pdf", msg);
    }
  }

  if (o.alsoEmail) {
    if (emit) await emit("email_start", {});
    try {
      emailResult = await sendLeadEmail({
        adapter,
        payload,
        pdfBytes,
        env: e,
        correlationId,
      });
      if (emit)
        await emit("email_ok", {
          hasPdf: !!pdfBytes,
          messageId:
            emailResult && emailResult.messageId
              ? String(emailResult.messageId)
              : "",
        });
    } catch (err) {
      const msg = err && err.message ? String(err.message) : "Email failed";
      if (emit) await emit("email_failed", { error: msg });
      throw new LeadProcessingError("email", msg);
    }
  }

  if (emit) await emit("done", { hasPdf: !!pdfBytes });

  return { correlationId, pdfBytes, emailResult };
}

module.exports = { handleLeadCore, LeadProcessingError };
