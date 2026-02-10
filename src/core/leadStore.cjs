const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { envBool, nowIso, safeTrim } = require("./utils.cjs");

function isLocalDev() {
  return (
    envBool(process.env.NETLIFY_DEV) ||
    envBool(process.env.NETLIFY_LOCAL) ||
    envBool(process.env.NETLIFY_FUNCTIONS_LOCAL)
  );
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

function normalizeError(err) {
  if (!err) return null;

  const msg =
    typeof err.message === "string" && err.message.trim()
      ? err.message.trim()
      : safeTrim(err);

  const code =
    typeof err.code === "string" && err.code.trim() ? err.code.trim() : "";

  const stack =
    typeof err.stack === "string" && err.stack.trim() ? err.stack.trim() : "";

  return {
    message: msg,
    code: code || undefined,
    stack: stack ? stack.slice(0, 6000) : undefined,
  };
}

function localFilePath(storeName) {
  const safe = String(storeName || "lead-kit-leads").replace(
    /[^a-z0-9\-_]/gi,
    "_",
  );
  return path.join(os.tmpdir(), `${safe}.store.json`);
}

async function readLocalAll(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

async function writeLocalAll(filePath, obj) {
  await fs.writeFile(filePath, safeJson(obj) || "{}", "utf8");
}

async function getBackend(event, storeName) {
  try {
    const blobs = require("@netlify/blobs");
    if (typeof blobs.connectLambda === "function") {
      try {
        blobs.connectLambda(event);
      } catch {}
    }
    const store = blobs.getStore(String(storeName));
    return { kind: "blobs", store };
  } catch (err) {
    if (!isLocalDev()) throw err;
    return { kind: "file", filePath: localFilePath(storeName) };
  }
}

function createLeadStore(storeName) {
  const name = String(storeName || "lead-kit-leads");

  async function getLead(event, leadId) {
    const id = safeTrim(leadId);
    if (!id) return null;

    const backend = await getBackend(event, name);
    if (backend.kind === "blobs") {
      const v = await backend.store.get(id, { type: "json" });
      return v || null;
    }

    const all = await readLocalAll(backend.filePath);
    return all[id] || null;
  }

  async function setLead(event, leadId, lead) {
    const id = safeTrim(leadId);
    if (!id) throw new Error("Missing leadId");

    const backend = await getBackend(event, name);
    if (backend.kind === "blobs") {
      await backend.store.setJSON(id, lead);
      return;
    }

    const all = await readLocalAll(backend.filePath);
    all[id] = lead;
    await writeLocalAll(backend.filePath, all);
  }

  async function patchLead(event, leadId, patch) {
    const id = safeTrim(leadId);
    if (!id) throw new Error("Missing leadId");

    const prev = (await getLead(event, id)) || {
      leadId: id,
      createdAt: nowIso(),
    };

    const next = {
      ...prev,
      ...(patch || {}),
      leadId: id,
      correlationId: safeTrim(prev.correlationId || id) || id,
      updatedAt: nowIso(),
    };

    await setLead(event, id, next);
    return next;
  }

  async function failLead(event, leadId, err, stage) {
    const e = normalizeError(err);
    return await patchLead(event, leadId, {
      status: "failed",
      stage: stage || "unknown",
      error: e || { message: "Unknown error" },
      doneAt: nowIso(),
    });
  }

  return { getLead, setLead, patchLead, failLead, normalizeError };
}

module.exports = { createLeadStore };
