const { randomUUID } = require("crypto");
const { parseRequestBody, json, getHeader } = require("./core/http.cjs");
const { handleLeadCore } = require("./core/handleLeadCore.cjs");
const { formatIssues } = require("./core/zod.cjs");
const { safeTrim } = require("./core/utils.cjs");

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

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

async function getPayloadSchema(adapter) {
  const mod = await Promise.resolve(adapter.getSchema());
  const schema = mod && mod.payloadSchema ? mod.payloadSchema : null;
  if (!schema || typeof schema.safeParse !== "function")
    throw new Error("adapter.getSchema() must return { payloadSchema }");
  return schema;
}

function extractSubmissionEnvelope(body) {
  const envelope = isPlainObject(body) ? body : {};
  const submission = isPlainObject(envelope.payload)
    ? envelope.payload
    : envelope;
  const submissionData =
    isPlainObject(submission) && isPlainObject(submission.data)
      ? submission.data
      : isPlainObject(submission)
        ? submission
        : {};
  const submissionId =
    isPlainObject(submission) && submission.id != null
      ? safeTrim(submission.id)
      : "";
  return { submissionData, submissionId };
}

function correlationIdFor(event, submissionId) {
  const headerId = safeTrim(getHeader(event, "x-correlation-id"));
  return submissionId || headerId || randomUUID();
}

function eventMessage(adapter, suffix) {
  const slug = safeTrim(adapter && adapter.siteSlug) || "leadkit";
  return `${slug}.${suffix}`;
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

function createSubmissionCreatedHandler(adapter) {
  assertAdapter(adapter);
  let schemaPromise = null;

  async function schema() {
    if (!schemaPromise) schemaPromise = getPayloadSchema(adapter);
    return await schemaPromise;
  }

  return async (event) => {
    if (event.httpMethod && event.httpMethod !== "POST")
      return { statusCode: 405, body: "POST only" };

    let body = {};
    try {
      body = parseRequestBody(event);
    } catch {
      return json(200, { status: "ignored", reason: "invalid body" });
    }

    const { submissionData, submissionId } = extractSubmissionEnvelope(body);
    const payloadSchema = await schema();

    const parsed = payloadSchema.safeParse(submissionData);
    if (!parsed.success) {
      return json(200, {
        status: "ignored",
        reason: "invalid",
        errors: formatIssues(parsed.error.issues),
      });
    }

    const correlationId = correlationIdFor(event, submissionId);

    try {
      await handleLeadCore(adapter, parsed.data, process.env, {
        correlationId,
        alsoEmail: true,
        returnPdf: false,
      });
      log("info", eventMessage(adapter, "submission.ok"), { correlationId });
      return json(200, { status: "ok", correlationId });
    } catch (e) {
      const msg =
        e && e.message ? String(e.message) : "submission-created failed";
      log("error", eventMessage(adapter, "submission.failed"), {
        correlationId,
        err: msg,
      });
      return json(200, { status: "error", message: msg, correlationId });
    }
  };
}

module.exports = { createSubmissionCreatedHandler };
