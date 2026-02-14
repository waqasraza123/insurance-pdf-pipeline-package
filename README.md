````md
# insurance-pdf-pipeline-package

Reusable Netlify lead pipeline kit:

**validate → store → background → pdf → email → status/retry**

This package exists to stop copy/paste pipelines across sites and to keep the **lead contract + PDF/email flow** consistent.

---

## What you get

### Server exports (CommonJS)

- `createLeadHandlers(adapter)` → `{ handleLead, handleLeadBackground, leadStatus, leadRetry }`
- `createSubmissionCreatedHandler(adapter)` → Netlify Forms “submission-created” webhook handler
- `siteUtils` → helper utilities for building email + PDF models

### Client exports (ESM subpath)

- `insurance-pdf-pipeline-package/client` → optional browser helpers for:
  - submit lead
  - save/read leadId
  - poll status + retry
  - logo.dev URL builder

Example:

```js
import {
  submitLead,
  pollLeadStatus,
  retryLead,
  saveLeadId,
  getLeadId,
  buildThankYouUrl,
  logoDev,
} from "insurance-pdf-pipeline-package/client";
```
````

---

## Built-in compat + stability

- **Callback normalization**: supports `onStage(stage, meta)` and legacy `onStep({ stage, extra })`
- **LeadId aliasing**: accepts `leadId`, `cid`, `correlationId` in query/body/headers and returns aliases
- **Best-effort PDF** (configurable): can continue email even if PDF fails

---

## How the pipeline works

### 1) `handle-lead` (HTTP)

- Reads JSON payload (or form-encoded)
- Validates with your site schema (`adapter.getSchema().payloadSchema`)
- Stores the lead record in a backend store (Netlify Blobs; local file fallback in dev)
- Enqueues background job and returns `202` with `leadId`

### 2) `handle-lead-background`

- Loads stored lead by id
- Runs PDF render (best-effort unless configured)
- Sends email (PDF required or optional based on env)
- Updates lead stage/status (for UI polling)
- Stops after `LEAD_MAX_ATTEMPTS`

### 3) `lead-status`

Returns a JSON payload with both:

- `lead` (full status object for UIs)
- plus convenient top-level fields (`leadId`, `status`, `stage`, etc.)

### 4) `lead-retry`

Re-queues the background job if still under `LEAD_MAX_ATTEMPTS`.

---

## Install (GitHub dependency)

In your site repo (recommended inside `netlify/functions/package.json` if you keep a separate functions package):

```bash
npm i github:<YOUR_GH_ORG>/insurance-pdf-pipeline-package#main
```

---

## Required folder layout in the site repo

Recommended:

```
netlify/functions/
  sites/
    <siteSlug>/
      adapter.cjs
      schema.cjs
      pdfModel.cjs
      leadTemplate.cjs
  handle-lead.cjs
  handle-lead-background.cjs
  lead-status.cjs
  lead-retry.cjs
  submission-created.cjs (optional)
public/
  pdf/
    <siteSlug>-print.html
```

Your site provides only the site-specific contract (schema + pdfModel + email template).
The shared handlers and pipeline logic live in this package.

---

## Minimal Netlify function wrappers

These wrappers stay tiny and don’t drift.

`netlify/functions/handle-lead.cjs`

```js
const { createLeadHandlers } = require("insurance-pdf-pipeline-package");
const { adapter } = require("./sites/<siteSlug>/adapter.cjs");
exports.handler = createLeadHandlers(adapter).handleLead;
```

`netlify/functions/handle-lead-background.cjs`

```js
const { createLeadHandlers } = require("insurance-pdf-pipeline-package");
const { adapter } = require("./sites/<siteSlug>/adapter.cjs");
exports.handler = createLeadHandlers(adapter).handleLeadBackground;
```

`netlify/functions/lead-status.cjs`

```js
const { createLeadHandlers } = require("insurance-pdf-pipeline-package");
const { adapter } = require("./sites/<siteSlug>/adapter.cjs");
exports.handler = createLeadHandlers(adapter).leadStatus;
```

`netlify/functions/lead-retry.cjs`

```js
const { createLeadHandlers } = require("insurance-pdf-pipeline-package");
const { adapter } = require("./sites/<siteSlug>/adapter.cjs");
exports.handler = createLeadHandlers(adapter).leadRetry;
```

---

## Adapter contract (what every site must implement)

Your `netlify/functions/sites/<siteSlug>/adapter.cjs` must export:

- `siteSlug` (string)
- `templatePath` (string; typically `public/pdf/<slug>-print.html`)
- `leadStoreName` (string; optional but recommended)
- `getSchema()` (function returning `{ payloadSchema, ... }`)
- `buildPdfModel(payload)` (function returning a PDF model)
- `renderLeadEmailHTML(payload, env)` (function returning HTML string)
- `renderLeadEmailText(payload, env)` (function returning text string)

Example adapter that matches the package code:

```js
const { buildPdfModel } = require("./pdfModel.cjs");
const {
  renderLeadEmailHTML,
  renderLeadEmailText,
} = require("./leadTemplate.cjs");

function getSchema() {
  return require("./schema.cjs");
}

const adapter = {
  siteSlug: "<siteSlug>",
  templatePath: "public/pdf/<siteSlug>-print.html",
  leadStoreName: "<siteSlug>-leads",
  getSchema,
  buildPdfModel,
  renderLeadEmailHTML,
  renderLeadEmailText,
};

module.exports = { adapter };
```

If you rename these adapter fields, you are going to break the pipeline.

---

## The lead contract (do not skip this)

Every site must define its payload schema in one place and treat it as the source of truth:

- `netlify/functions/sites/<siteSlug>/schema.cjs`

Rules that prevent future breakage:

- Preprocess + trim all strings
- Default optional strings to `""` so PDF/email doesn’t explode on `undefined`
- Use enums for controlled answers (`YES_NO`, locations, etc.)
- Encode booleans consistently (recommended: `"yes" | "no"`)
- If you add a question, you must update:
  - schema
  - pdfModel
  - leadTemplate
  - frontend payload builder (if applicable)
  - print template (if labels/layout change)

---

## PDF rendering contract

You provide:

- `public/pdf/<siteSlug>-print.html` (static HTML that reads `window.__PDF_MODEL__`)
- `pdfModel.cjs` builds a stable model shape

The shared renderer:

- opens the print template in Chromium
- injects `window.__PDF_MODEL__`
- prints to PDF

### Recommended PDF model shape

```js
{
  meta: {
    createdAt: "2026-02-13T10:00:00Z",
    source: "your-site/path",
    leadId: "..."
  },
  sections: [
    {
      title: "Applicant",
      rows: [
        { label: "Name", value: "..." },
        { label: "Email", value: "..." },
        { label: "Signature", kind: "image", src: "data:image/png;base64,..." }
      ]
    }
  ]
}
```

Images use: `{ kind: "image", src: "..." }`.

---

## Email sending

The kit sends via SMTP with safe defaults + timeouts.
Email templates are fully site-owned (`renderLeadEmailHTML` + `renderLeadEmailText`).

### Required env vars

```
SMTP_HOST
SMTP_PORT (default 587)
SMTP_USER (optional if server allows)
SMTP_PASS (optional if server allows)
SMTP_SECURE (optional; defaults true on 465 else false)

LEAD_TO_EMAIL (comma/semicolon separated)
LEAD_FROM_EMAIL
```

### Optional env vars

```
SMTP_VERIFY=1
SMTP_TLS_REJECT_UNAUTHORIZED=0|1 (default 1)

SMTP_CONNECTION_TIMEOUT_MS (default 8000)
SMTP_GREETING_TIMEOUT_MS (default 8000)
SMTP_SOCKET_TIMEOUT_MS (default 15000)

LEAD_EMAIL_SUBJECT (fixed subject)
LEAD_EMAIL_SUBJECT_PREFIX (default: SITE_SLUG uppercased)

EMAIL_REQUIRE_PDF=1 (fail if PDF missing)
EMAIL_ALLOW_WITHOUT_PDF=1 (default 1)

LEAD_EMAIL_LOGO_PATH (optional file path for inline logo; default tries public/logo.png)
LEAD_EMAIL_INLINE_LOGO=0|1 (default 1)

LEAD_PDF_FILENAME (default <siteSlug>-lead.pdf)
```

---

## PDF rendering env vars

You must have a resolvable origin so Chromium can load the print template:

```
WEBSITE_URL (preferred)
or Netlify-provided URL / DEPLOY_PRIME_URL
```

Rendering settings:

```
PDF_RUNTIME=local|lambda (default auto)
PDF_HEADLESS=0|1 (local only; default 1)
PDF_RENDER_TIMEOUT_MS (default 25000)

PUPPETEER_EXECUTABLE_PATH (optional override)
GOOGLE_CHROME_BIN / CHROME_PATH (local fallback discovery)
```

---

## Pipeline / store env vars

```
LEAD_STORE_NAME (optional; default lead-kit-<siteSlug>)
LEAD_MAX_ATTEMPTS (default 3)

LEAD_BACKGROUND_PATH (default /.netlify/functions/handle-lead-background)
LEAD_ENQUEUE_TIMEOUT_MS (default 8000)
```

---

## Netlify Forms integration (submission-created)

There are two common setups.

### A) Pipeline only (recommended)

Frontend posts JSON to `/.netlify/functions/handle-lead`.
No Netlify Forms required.

### B) Netlify Forms + pipeline handler

If you use Netlify Forms “submission-created” webhook events:

`netlify/functions/submission-created.cjs`

```js
const {
  createSubmissionCreatedHandler,
} = require("insurance-pdf-pipeline-package");
const { adapter } = require("./sites/<siteSlug>/adapter.cjs");

exports.handler = createSubmissionCreatedHandler(adapter);
```

The submission data must match your schema keys. Drift here is a classic source of missing fields.

---

## Frontend integration checklist (Astro/React/etc.)

If you collect leads via a quiz/component:

- Keep one payload builder that outputs exactly the schema fields
- Use the same enum values as the backend schema
- Store `leadId` and redirect to thank-you with `?leadId=...`
- Optionally poll `lead-status` on thank-you and show retry

### Using the package client helpers (optional)

```js
import {
  submitLead,
  saveLeadId,
  buildThankYouUrl,
} from "insurance-pdf-pipeline-package/client";

const res = await submitLead(payload);

if (res.ok) {
  const leadId =
    res.body?.leadId || res.body?.correlationId || res.correlationId || "";

  if (leadId)
    saveLeadId(leadId, {
      storageKey: "<siteSlug>:lastLeadId",
      storage: "session",
    });

  window.location.href = buildThankYouUrl(leadId, {
    path: "/thank-you",
    param: "leadId",
  });
}
```

Polling:

```js
import {
  getLeadId,
  pollLeadStatus,
  retryLead,
} from "insurance-pdf-pipeline-package/client";

const leadId = getLeadId({ storageKey: "<siteSlug>:lastLeadId" });

if (leadId) {
  await pollLeadStatus(leadId, {
    hardStopMs: 60000,
    onUi: (ui) => {
      // ui.kind: progress | success | error
      // ui.canRetry tells you if retry makes sense
      console.log(ui);
    },
    onTerminal: (s) => {
      console.log("terminal:", s.status, s.stage);
    },
  });
}
```

---

## “Do not forget” checklist when adding new mandatory questions

When you add or change questions in any site:

1. Update `netlify/functions/sites/<siteSlug>/schema.cjs`

- Add fields
- Add conditional validation (`superRefine`) if needed

2. Update the frontend quiz payload + UI validation

- Add steps/questions
- Ensure the payload builder sends the new keys

3. Update adapter mapping

- Add fields to PDF model rows
- Add fields to email template
- If you forward to a CRM webhook, map them too

4. Update the print template if labels/layout need changes

5. Update any Netlify Forms hidden fields (only if using Forms)

6. Sanity check stages + env

- If PDF is mandatory, set `EMAIL_REQUIRE_PDF=1` intentionally
- Otherwise keep `EMAIL_ALLOW_WITHOUT_PDF=1`

---

## Common failure modes

- **Missing leadId**
  - If your frontend ignores the `leadId` response, status/retry will not work.

- **PDF works locally but fails on Netlify**
  - Missing `WEBSITE_URL` / Netlify URL
  - Chromium runtime mismatch (local vs lambda)
  - Print template path wrong (must resolve at runtime)

- **Email sends without PDF unexpectedly**
  - Set `EMAIL_REQUIRE_PDF=1` if PDF must exist
  - Default behavior is best-effort PDF and still send email

- **Validation fails but frontend looks correct**
  - Enum mismatch (frontend sends “Yes” but schema expects “yes”)
  - Missing conditional fields (only required on some branches)
  - Trim/normalization mismatch

---

## Versioning and stability

Treat the schema and adapter responsibilities as stable.
If you change exported names/adapter keys, bump versions and update this README immediately.

This package should reduce drift, not create new surprises.
