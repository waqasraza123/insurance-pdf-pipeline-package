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

function storeNameFor(adapter, env) {
  const e = env || process.env;
  const explicit = safeTrim(e.LEAD_STORE_NAME);
  if (explicit) return explicit;
  return `lead-kit-${safeTrim(adapter.siteSlug)}`;
}

function backgroundPath(env) {
  const e = env || process.env;
  return (
    safeTrim(e.LEAD_BACKGROUND_PATH) ||
    "/.netlify/functions/handle-lead-background"
  );
}

function maxAttempts(env) {
  const e = env || process.env;
  return toInt(e.LEAD_MAX_ATTEMPTS, 3);
}

async function getPayloadSchema(adapter) {
  const mod = await Promise.resolve(adapter.getSchema());
  const schema = mod && mod.payloadSchema ? mod.payloadSchema : null;
  if (!schema || typeof schema.safeParse !== "function")
    throw new Error("adapter.getSchema() must return { payloadSchema }");
  return schema;
}

function leadStatusResponse(leadId, lead) {
  const attempt = Number(lead && lead.attempts ? lead.attempts : 0);
  const error =
    lead && lead.error
      ? {
          stage: safeTrim(lead.stage),
          message: safeTrim(lead.error.message || "Failed"),
        }
      : undefined;

  return {
    status: "ok",
    lead: {
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
      result: lead && lead.result ? lead.result : undefined,
    },
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

    log("info", "leadkit.fg.start", {
      siteSlug: safeTrim(adapter.siteSlug),
      leadId,
      path: safeTrim(event.path),
      ct: safeTrim(getHeader(event, "content-type")),
    });

    let payload = {};
    try {
      payload = parseRequestBody(event);
    } catch {
      log("error", "leadkit.fg.body_invalid", { leadId });
      return json(400, { status: "error", message: "Invalid request body" });
    }

    const payloadSchema = await schema();
    const parsed = payloadSchema.safeParse(payload);

    if (!parsed.success) {
      log("info", "leadkit.fg.schema_invalid", { leadId });
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
      return json(500, {
        status: "error",
        message: "Missing WEBSITE_URL",
        leadId,
        correlationId,
        cid: correlationId,
      });
    }

    let enqueueOk = false;
    try {
      const res = await fetchWithTimeout(
        `${origin}${backgroundPath(process.env)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify({ leadId: correlationId }),
        },
        toInt(process.env.LEAD_ENQUEUE_TIMEOUT_MS, 8000),
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
      log("error", "leadkit.fg.enqueue_failed", {
        leadId,
        durMs: Date.now() - started,
      });
      return json(500, {
        status: "error",
        message: "Background enqueue failed",
        leadId,
        correlationId,
        cid: correlationId,
      });
    }

    log("info", "leadkit.fg.queued", { leadId, durMs: Date.now() - started });

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

    log("info", "leadkit.bg.start", {
      leadId,
      siteSlug: safeTrim(adapter.siteSlug),
      durMs: Date.now() - started,
    });

    const existing = await store.getLead(event, leadId);
    if (!existing || !existing.payload) {
      await store.failLead(
        event,
        leadId,
        new Error("Missing stored payload"),
        "enqueue",
      );
      return json(404, { status: "error", message: "Lead not found", leadId });
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

      const patch = { stage: s };
      const m = meta && typeof meta === "object" ? meta : {};

      if (m && typeof m.error === "string" && safeTrim(m.error)) {
        patch.error = { message: safeTrim(m.error) };
      }

      if (s === "email_ok" && m && safeTrim(m.messageId)) {
        patch.result = { messageId: safeTrim(m.messageId) };
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

      log("info", "leadkit.bg.sent", { leadId, durMs: Date.now() - started });
      return json(200, {
        status: "ok",
        leadId,
        correlationId: leadId,
        cid: leadId,
      });
    } catch (e) {
      const ne = store.normalizeError(e) || { message: "Background failed" };
      const stage =
        safeTrim(e && e.stage ? e.stage : "") ||
        lastStage ||
        safeTrim(existing.stage) ||
        "unknown";
      await store.failLead(event, leadId, e, stage);
      log("error", "leadkit.bg.failed", {
        leadId,
        stage,
        err: ne.message,
        durMs: Date.now() - started,
      });
      return json(500, {
        status: "error",
        message: ne.message,
        leadId,
        correlationId: leadId,
        cid: leadId,
      });
    }
  }

  async function leadStatus(event) {
    const leadId = extractLeadIdFromEvent(event);
    if (!leadId)
      return json(400, { status: "error", message: "Missing leadId" });
    if (!isUuid(leadId))
      return json(400, { status: "error", message: "Invalid leadId" });

    const lead = await store.getLead(event, leadId);
    if (!lead) {
      return json(
        200,
        { status: "not_found", leadId, correlationId: leadId, cid: leadId },
        { "cache-control": "no-store" },
      );
    }

    return json(200, leadStatusResponse(leadId, lead), {
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
      return json(400, { status: "error", message: "Invalid request body" });
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
      return json(200, {
        status: "ok",
        leadId,
        correlationId: leadId,
        cid: leadId,
      });

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
      `${origin}${backgroundPath(process.env)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": leadId,
        },
        body: JSON.stringify({ leadId }),
      },
      toInt(process.env.LEAD_ENQUEUE_TIMEOUT_MS, 8000),
    );

    const ok = res.status === 202 || res.status === 200;
    if (!ok)
      return json(500, { status: "error", message: "Retry enqueue failed" });

    return json(202, {
      status: "queued",
      leadId,
      correlationId: leadId,
      cid: leadId,
    });
  }

  return { handleLead, handleLeadBackground, leadStatus, leadRetry };
}

module.exports = { createLeadHandlers };
