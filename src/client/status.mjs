import { safeTrim, readJsonSafe } from "./lead.mjs";

export function normalizeLeadStatus(json) {
  if (
    json &&
    typeof json === "object" &&
    json.lead &&
    typeof json.lead === "object"
  ) {
    return json.lead;
  }
  return json;
}

export function norm(v) {
  return safeTrim(v).toLowerCase();
}

export function isTerminalStatus(s) {
  const st = norm(s && s.status);
  return st === "sent" || st === "success" || st === "failed" || st === "error";
}

export function leadUiFromStatus(s, opts = {}) {
  const st = norm(s && s.status);
  const stage = norm(s && s.stage);
  const attempts = Number((s && s.attempts) || 0);
  const canRetry = attempts < Number(opts.maxAttempts || 3);

  const msgOk =
    safeTrim(opts.successDetail) ||
    "Your request has been delivered to the website owner.";

  const msgWorking =
    safeTrim(opts.workingDetail) ||
    "Preparing and sending PDF to the website owner. Keep this page open.";

  if (st === "sent" || st === "success") {
    return {
      kind: "success",
      title: "Sent successfully",
      detail: msgOk,
      canRetry: false,
    };
  }

  if (st === "failed" || st === "error") {
    const errMsg =
      (s && s.error && safeTrim(s.error.message)) || "Something failed.";

    const prefix =
      stage === "pdf" || stage.startsWith("pdf")
        ? "PDF generation failed."
        : stage === "email" || stage.startsWith("email")
          ? "Email sending failed."
          : "Processing failed.";

    return {
      kind: "error",
      title: "Failed to send",
      detail: `${prefix} ${errMsg}`.trim(),
      canRetry,
    };
  }

  if (stage === "plan" || st === "queued") {
    return {
      kind: "progress",
      title: "Preparing…",
      detail: msgWorking,
      canRetry: false,
    };
  }

  if (stage === "pdf_start") {
    return {
      kind: "progress",
      title: "Generating PDF…",
      detail: msgWorking,
      canRetry: false,
    };
  }

  if (stage === "pdf_ok") {
    return {
      kind: "progress",
      title: "PDF ready…",
      detail: "Now sending it to the website owner.",
      canRetry: false,
    };
  }

  if (stage === "pdf_failed") {
    const errMsg =
      (s && s.error && safeTrim(s.error.message)) ||
      (s && s.pdfError && safeTrim(s.pdfError.message)) ||
      "PDF failed.";
    return {
      kind: "progress",
      title: "PDF issue — continuing…",
      detail:
        `We couldn't generate the PDF, but we're still attempting to send the lead. ${errMsg}`.trim(),
      canRetry: false,
    };
  }

  if (stage === "email_start") {
    return {
      kind: "progress",
      title: "Sending…",
      detail: "Sending to the website owner now. Keep this page open.",
      canRetry: false,
    };
  }

  if (stage === "email_ok" || stage === "done") {
    return {
      kind: "success",
      title: "Sent successfully",
      detail: msgOk,
      canRetry: false,
    };
  }

  return {
    kind: "progress",
    title: "Processing…",
    detail: msgWorking,
    canRetry: false,
  };
}

export async function fetchLeadStatus(leadId, opts = {}) {
  const id = safeTrim(leadId);
  if (!id) throw new Error("Missing leadId");

  const endpoint = safeTrim(opts.endpoint || "/.netlify/functions/lead-status");
  const res = await fetch(`${endpoint}?leadId=${encodeURIComponent(id)}`, {
    headers: { "cache-control": "no-cache" },
  });

  if (!res.ok) throw new Error(`lead-status ${res.status}`);

  const json = await readJsonSafe(res);
  return normalizeLeadStatus(json);
}

export async function retryLead(leadId, opts = {}) {
  const id = safeTrim(leadId);
  if (!id) return false;

  const endpoint = safeTrim(opts.endpoint || "/.netlify/functions/lead-retry");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId: id }),
  });

  return res.status === 202 || res.status === 200;
}

export async function pollLeadStatus(leadId, opts = {}) {
  const id = safeTrim(leadId);
  if (!id) return null;

  const onUi = typeof opts.onUi === "function" ? opts.onUi : null;

  let intervalMs = Number(opts.intervalMs || 900);
  const maxIntervalMs = Number(opts.maxIntervalMs || 2500);
  const hardStopMs = Number(opts.hardStopMs || 60000);
  const startedAt = Date.now();

  if (onUi) {
    onUi(
      {
        kind: "progress",
        title: "Preparing…",
        detail:
          safeTrim(opts.workingDetail) ||
          "Preparing and sending PDF to the website owner. Keep this page open.",
        canRetry: false,
      },
      null,
    );
  }

  while (true) {
    if (Date.now() - startedAt > hardStopMs) {
      const ui = {
        kind: "error",
        title: "Still working…",
        detail:
          "This is taking longer than usual. You can keep this page open, or retry.",
        canRetry: true,
      };
      if (onUi) onUi(ui, null);
      return null;
    }

    try {
      const s = await fetchLeadStatus(id, {
        endpoint: opts.statusEndpoint || opts.endpointStatus,
      });
      const ui = leadUiFromStatus(s, {
        maxAttempts: opts.maxAttempts,
        workingDetail: opts.workingDetail,
        successDetail: opts.successDetail,
      });
      if (onUi) onUi(ui, s);
      if (isTerminalStatus(s)) return s;
    } catch {
      if (onUi) {
        onUi(
          {
            kind: "progress",
            title: "Checking status…",
            detail: "Still working. Retrying…",
            canRetry: false,
          },
          null,
        );
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
    intervalMs = Math.min(maxIntervalMs, Math.floor(intervalMs * 1.15));
  }
}
