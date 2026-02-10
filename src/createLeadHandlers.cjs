const { randomUUID } = require("crypto");
const { createLeadStore } = require("./core/leadStore.cjs");
const { formatIssues } = require("./core/zod.cjs");
const {
  parseRequestBody,
  json,
  resolveOrigin,
  fetchWithTimeout,
  getHeader,
} = require("./core/http.cjs");
const { handleLeadCore } = require("./core/handleLeadCore.cjs");
const { safeTrim, nowIso, isUuid, toInt } = require("./core/utils.cjs");

function log(level, message, extra) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...(extra || {}),
    }),
  );
}

function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== "object")
    throw new Error("Missing adapter");
  if (!safeTrim(adapter.siteSlug)) throw new Error("adapter.siteSlug required");
  if (!safeTrim(adapter.templatePath))
    throw new Error("adapter.templatePath required");
  if (typeof adapter.getSchema !== "function")
    throw new Error("adapter.getSchema() required");
  if (typeof adapter.buildPdfModel !== "function")
    throw new Error("adapter.buildPdfModel() required");
  if (typeof adapter.renderLeadEmailHTML !== "function")
    throw new Error("adapter.renderLeadEmailHTML() required");
  if (typeof adapter.renderLeadEmailText !== "function")
    throw new Error("adapter.renderLeadEmailText() required");
}

function extractLeadIdFromAny(input) {
  const obj = input && typeof input === "object" ? input : {};
  const candidates = [
    obj.leadId,
    obj.cid,
    obj.correlationId,
    obj.lead,
    obj.id,
    obj.jobId,
  ];
  for (const c of candidates) {
    const s = safeTrim(c);
    if (s) return s;
  }
  return "";
}

function extractLeadIdFromEvent(event) {
  const qs = (event && event.queryStringParameters) || {};
  const candidates = [
    qs.leadId,
    qs.cid,
    qs.correlationId,
    qs.lead,
    qs.id,
    getHeader(event, "x-correlation-id"),
  ];
  for (const c of candidates) {
    const s = safeTrim(c);
    if (s) return s;
  }
  return "";
}

function eventMessage(adapter, suffix) {
  const slug = safeTrim(adapter && adapter.siteSlug) || "leadkit";
  return `${slug}.${suffix}`;
}

function storeNameFor(adapter, env) {
  const e = env || process.env;
  const explicit = safeTrim(e.LEAD_STORE_NAME);
  if (explicit) return explicit;
  const adapterName = safeTrim(adapter.leadStoreName || adapter.storeName);
  if (adapterName) return adapterName;
  return `lead-kit-${safeTrim(adapter.siteSlug)}`;
}

function backgroundPath(adapter, env) {
  const e = env || process.env;
  const fromEnv = safeTrim(e.LEAD_BACKGROUND_PATH);
  if (fromEnv) return fromEnv;
  const fromAdapter = safeTrim(adapter.backgroundPath);
  if (fromAdapter) return fromAdapter;
  return "/.netlify/functions/handle-lead-background";
}

function maxAttempts(env) {
  const e = env || process.env;
  return toInt(e.LEAD_MAX_ATTEMPTS, 3);
}

function enqueueTimeoutMs(env) {
  const e = env || process.env;
  const ms =
    safeTrim(e.LEAD_ENQUEUE_TIMEOUT_MS) || safeTrim(e.BG_ENQUEUE_TIMEOUT_MS);
  return toInt(ms, 8000);
}

async function getPayloadSchema(adapter) {
  const mod = await Promise.resolve(adapter.getSchema());
  const schema = mod && mod.payloadSchema ? mod.payloadSchema : null;
  if (!schema || typeof schema.safeParse !== "function")
    throw new Error("adapter.getSchema() must return { payloadSchema }");
  return schema;
}

function leadForUi(leadId, lead) {
  const attempt = Number(lead && lead.attempts ? lead.attempts : 0);
  const emailResult =
    (lead && lead.emailResult) || (lead && lead.result) || null;

  const error =
    lead && lead.error
      ? {
          stage: safeTrim(lead.stage) || "unknown",
          message: safeTrim(lead.error.message) || "Failed",
        }
      : undefined;

  return {
    leadId,
    correlationId: safeTrim(lead && lead.correlationId) || leadId,
    status: safeTrim(lead && lead.status) || "unknown",
    stage: safeTrim(lead && lead.stage) || "unknown",
    createdAt: safeTrim(lead && lead.createdAt) || "",
    updatedAt: safeTrim(lead && lead.updatedAt) || "",
    doneAt: safeTrim(lead && lead.doneAt) || "",
    attempts: attempt,
    attempt,
    error,
    result: emailResult || undefined,
  };
}

function leadStatusPayload(leadId, lead) {
  const emailResult =
    (lead && lead.emailResult) || (lead && lead.result) || null;

  return {
    apiStatus: "ok",
    lead: leadForUi(leadId, lead),

    leadId,
    correlationId: safeTrim(lead && lead.correlationId) || leadId,
    status: safeTrim(lead && lead.status) || "unknown",
    stage: safeTrim(lead && lead.stage) || "unknown",
    attempts: Number(lead && lead.attempts ? lead.attempts : 0),
    updatedAt: safeTrim(lead && lead.updatedAt) || "",
    doneAt: safeTrim(lead && lead.doneAt) || "",
    error:
      lead && lead.error
        ? { message: safeTrim(lead.error.message) || "Failed" }
        : null,
    pdfError:
      lead && lead.pdfError
        ? { message: safeTrim(lead.pdfError.message) || "PDF failed" }
        : null,
    emailResult,
  };
}

function createLeadHandlers(adapter) {
  assertAdapter(adapter);

  const store = createLeadStore(storeNameFor(adapter, process.env));
  let schemaPromise = null;

  async function schema() {
    if (!schemaPromise) schemaPromise = getPayloadSchema(adapter);
    return await schemaPromise;
  }

  async function handleLead(event) {
    if (event.httpMethod !== "POST")
      return { statusCode: 405, body: "POST only" };

    const started = Date.now();
    const leadId = randomUUID();
    const correlationId = leadId;

    log("info", eventMessage(adapter, "fg.start"), {
      siteSlug: safeTrim(adapter.siteSlug),
      leadId,
      path: safeTrim(event.path),
      ct: safeTrim(getHeader(event, "content-type")),
    });

    let payload = {};
    try {
      payload = parseRequestBody(event);
    } catch {
      log("error", eventMessage(adapter, "fg.body_invalid"), { leadId });
      return json(400, { status: "error", message: "Invalid request body" });
    }

    const payloadSchema = await schema();
    const parsed = payloadSchema.safeParse(payload);

    if (!parsed.success) {
      log("info", eventMessage(adapter, "fg.schema_invalid"), { leadId });
      return json(400, {
        status: "invalid",
        errors: formatIssues(parsed.error.issues),
      });
    }

    const data = parsed.data;

    await store.setLead(event, leadId, {
      leadId,
      correlationId,
      siteSlug: safeTrim(adapter.siteSlug),
      status: "queued",
      stage: "enqueue",
      attempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      payload: data,
      error: null,
      pdfError: null,
      emailResult: null,
      result: null,
    });

    const origin = resolveOrigin(event, process.env);
    if (!origin) {
      await store.failLead(
        event,
        leadId,
        new Error("Missing WEBSITE_URL"),
        "enqueue",
      );
      return json(500, { status: "error", message: "Missing WEBSITE_URL" });
    }

    let enqueueOk = false;
    try {
      const res = await fetchWithTimeout(
        `${origin}${backgroundPath(adapter, process.env)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify({ leadId: correlationId }),
        },
        enqueueTimeoutMs(process.env),
      );
      enqueueOk = res.status === 202 || res.status === 200;
    } catch {
      enqueueOk = false;
    }

    if (!enqueueOk) {
      await store.failLead(
        event,
        leadId,
        new Error("Background enqueue failed"),
        "enqueue",
      );
      log("error", eventMessage(adapter, "fg.enqueue_failed"), {
        leadId,
        durMs: Date.now() - started,
      });
      return json(500, {
        status: "error",
        message: "Background enqueue failed",
        leadId,
      });
    }

    log("info", eventMessage(adapter, "fg.queued"), {
      leadId,
      durMs: Date.now() - started,
    });

    return json(202, {
      status: "queued",
      leadId,
      correlationId,
      cid: correlationId,
    });
  }

  async function handleLeadBackground(event) {
    if (event.httpMethod !== "POST")
      return { statusCode: 405, body: "POST only" };

    const started = Date.now();

    let body = {};
    try {
      body = parseRequestBody(event);
    } catch {
      return json(400, { status: "error", message: "Invalid request body" });
    }

    const leadId = safeTrim(
      extractLeadIdFromAny(body) || getHeader(event, "x-correlation-id"),
    );
    if (!leadId)
      return json(400, { status: "error", message: "Missing leadId" });
    if (!isUuid(leadId))
      return json(400, { status: "error", message: "Invalid leadId" });

    log("info", eventMessage(adapter, "bg.start"), {
      leadId,
      siteSlug: safeTrim(adapter.siteSlug),
      durMs: 0,
    });

    const existing = await store.getLead(event, leadId);
    if (!existing || !existing.payload) {
      await store.failLead(
        event,
        leadId,
        new Error("Missing stored payload"),
        "enqueue",
      );
      return json(404, { status: "error", message: "Lead not found" });
    }

    const payloadSchema = await schema();
    const parsed = payloadSchema.safeParse(existing.payload);

    if (!parsed.success) {
      await store.failLead(
        event,
        leadId,
        new Error("Stored payload invalid"),
        "enqueue",
      );
      return json(400, {
        status: "invalid",
        errors: formatIssues(parsed.error.issues),
      });
    }

    const attempt = Number(existing.attempts || 0) + 1;

    await store.patchLead(event, leadId, {
      status: "processing",
      stage: "plan",
      attempts: attempt,
      startedAt: nowIso(),
      error: null,
      result: null,
    });

    let lastStage = "plan";

    const onStage = async (stage, meta) => {
      const s = safeTrim(stage) || "unknown";
      lastStage = s;

      const m = meta && typeof meta === "object" ? meta : {};
      const patch = { stage: s };

      if (s === "pdf_failed") {
        const errMsg = safeTrim(m.error) || "PDF failed";
        patch.pdfError = { message: errMsg };
      }

      if (s === "pdf_ok") {
        patch.pdfError = null;
      }

      if (s === "email_ok") {
        const messageId = safeTrim(m.messageId);
        if (messageId) {
          patch.emailResult = { messageId };
          patch.result = { messageId };
        }
      }

      if (s === "email_failed") {
        const errMsg = safeTrim(m.error) || "Email failed";
        patch.error = { message: errMsg };
      }

      await store.patchLead(event, leadId, patch);
    };

    try {
      await handleLeadCore(adapter, parsed.data, process.env, {
        returnPdf: false,
        alsoEmail: true,
        correlationId: leadId,
        onStage,
      });

      await store.patchLead(event, leadId, {
        status: "sent",
        stage: "done",
        doneAt: nowIso(),
      });

      log("info", eventMessage(adapter, "bg.sent"), {
        leadId,
        durMs: Date.now() - started,
      });

      return json(200, { status: "ok", leadId });
    } catch (e) {
      const ne = store.normalizeError(e) || { message: "Background failed" };
      const stage =
        safeTrim(e && e.stage ? e.stage : "") ||
        lastStage ||
        safeTrim(existing.stage) ||
        "unknown";

      await store.failLead(event, leadId, e, stage);

      log("error", eventMessage(adapter, "bg.failed"), {
        leadId,
        stage,
        err: ne.message,
        durMs: Date.now() - started,
      });

      return json(500, { status: "error", message: ne.message, leadId });
    }
  }

  async function leadStatus(event) {
    const leadId = extractLeadIdFromEvent(event);
    if (!leadId)
      return json(400, { status: "error", message: "Missing leadId" });
    if (!isUuid(leadId))
      return json(400, { status: "error", message: "Invalid leadId" });

    const lead = await store.getLead(event, leadId);
    if (!lead) return json(404, { status: "error", message: "Not found" });

    return json(200, leadStatusPayload(leadId, lead), {
      "cache-control": "no-store",
    });
  }

  async function leadRetry(event) {
    if (event.httpMethod !== "POST")
      return { statusCode: 405, body: "POST only" };

    let body = {};
    try {
      body = parseRequestBody(event);
    } catch {
      body = {};
    }

    const leadId = safeTrim(
      extractLeadIdFromAny(body) || extractLeadIdFromEvent(event),
    );
    if (!leadId)
      return json(400, { status: "error", message: "Missing leadId" });
    if (!isUuid(leadId))
      return json(400, { status: "error", message: "Invalid leadId" });

    const lead = await store.getLead(event, leadId);
    if (!lead) return json(404, { status: "error", message: "Not found" });

    if (safeTrim(lead.status) === "sent")
      return json(200, { status: "ok", leadId });

    const attempts = Number(lead.attempts || 0);
    const limit = maxAttempts(process.env);

    if (attempts >= limit) {
      await store.failLead(
        event,
        leadId,
        new Error("Retry limit reached"),
        safeTrim(lead.stage) || "unknown",
      );
      return json(429, { status: "error", message: "Retry limit reached" });
    }

    await store.patchLead(event, leadId, {
      status: "queued",
      stage: "enqueue",
      error: null,
    });

    const origin = resolveOrigin(event, process.env);
    if (!origin)
      return json(500, { status: "error", message: "Missing WEBSITE_URL" });

    const res = await fetchWithTimeout(
      `${origin}${backgroundPath(adapter, process.env)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": leadId,
        },
        body: JSON.stringify({ leadId }),
      },
      enqueueTimeoutMs(process.env),
    );

    const ok = res.status === 202 || res.status === 200;
    if (!ok)
      return json(500, { status: "error", message: "Retry enqueue failed" });

    return json(202, { status: "queued", leadId });
  }

  return { handleLead, handleLeadBackground, leadStatus, leadRetry };
}

module.exports = { createLeadHandlers };
