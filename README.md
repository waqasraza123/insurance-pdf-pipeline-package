Here’s a **full updated README.md** that bakes in the “don’t forget the contract” mindset, documents the **adapter contract**, adds the **extra exported API** you’re already using (`createSubmissionCreatedHandler`), and adds a **site integration checklist** so future sites don’t drift.

````md
# insurance-pdf-pipeline-package

Reusable Netlify lead pipeline kit:

validate -> store -> background -> pdf -> email -> status/retry

This package exists to stop copy/paste pipelines across sites and to keep the lead contract + PDF/email flow consistent.

## What you get

Exports:

- `createLeadHandlers(adapter)` -> `{ handleLead, handleLeadBackground, leadStatus, leadRetry }`
- `createSubmissionCreatedHandler(adapter)` -> Netlify Forms “submission-created” webhook handler

Built-in compat fixes:

- Callback normalization: supports `onStage(stage, meta)` and legacy `onStep({ stage, extra })`
- leadId/cid aliasing: accepts `leadId`, `cid`, `correlationId` in query/body/headers and returns aliases

## How the pipeline works

1. **handle-lead** (HTTP)

- Reads JSON payload
- Validates via the site adapter schema/parser
- Normalizes + enriches (pagePath/referrer/utm if you want)
- Stores lead record
- Enqueues background job and returns `202` with `leadId`

2. **handle-lead-background**

- Loads lead by id
- Renders PDF (best-effort unless configured otherwise)
- Sends email (PDF required or optional based on env)
- Updates lead stage/status
- Stops after `LEAD_MAX_ATTEMPTS`

3. **lead-status**

- Returns `{ leadId, status, stage, attempts, updatedAt, doneAt, error }`

4. **lead-retry**

- Re-queues the background job if under `LEAD_MAX_ATTEMPTS`

## Install (GitHub dependency)

In your site repo (recommended inside `netlify/functions/package.json` if you keep a separate functions package):

```bash
npm i github:<YOUR_GH_ORG>/insurance-pdf-pipeline-package#main
```
````

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

The shared handlers live in this package. Your site only provides the site-specific contract + rendering + email content.

## Adapter contract (what every site must implement)

Your `netlify/functions/sites/<siteSlug>/adapter.cjs` must provide an object the kit can call.

Minimum responsibilities:

- Identify the site (slug/name)
- Validate incoming payload (Zod schema / parse function)
- Build PDF model from validated payload
- Provide email template builder (subject/body/attachments metadata) or data needed by the shared sender
- Provide print template path (public/pdf/<slug>-print.html) and pdf filename conventions

A practical adapter shape looks like this (names may differ slightly depending on your repo, but the responsibilities are fixed):

```js
module.exports.adapter = {
  siteSlug: "ti",

  safeParseLeadPayload(input) {
    // return { ok: true, data } or { ok: false, error }
  },

  buildPdfModel({ lead, payload, meta }) {
    // return { meta, sections: [...] } compatible with your print html
  },

  buildLeadEmail({ lead, payload, pdf, meta }) {
    // return { subject, html, text, attachments? }
  },

  pdf: {
    printTemplatePath: "public/pdf/ti-print.html",
    filename: "ti-lead.pdf",
  },
};
```

If your package version already expects different property names, keep those names — but still follow the same responsibilities. The goal is: **one contract per site**, no missing fields, no ad-hoc hacks.

## The lead contract (do not skip this)

Every site must define its **lead payload schema** in one place and treat it as the source of truth:

- `netlify/functions/sites/<siteSlug>/schema.cjs`

Rules that prevent future breakage:

- Preprocess + trim all strings
- Default optional strings to `""` so PDF/email doesn’t explode on `undefined`
- Use enums for controlled answers (`YES_NO`, location lists, etc.)
- Encode booleans consistently (recommended: `"yes" | "no"`)
- If you add a question, you must update:
  - schema
  - adapter mapping (PDF/email)
  - frontend payload builder (if applicable)
  - print template (labels shown in PDF)

## PDF rendering contract

You provide:

- `public/pdf/<siteSlug>-print.html` (static HTML that reads `window.__PDF_MODEL__`)
- `pdfModel.cjs` (builds `__PDF_MODEL__` shape)
- The shared renderer in this package opens the print template and injects the model.

### PDF model shape

Keep it stable across sites:

```js
{
  meta: {
    createdAt: "2026-02-13T10:00:00Z",
    source: "toolinsurance.co.nz/get-quotes",
    leadId: "..."
  },
  sections: [
    {
      title: "Applicant",
      rows: [
        { label: "Name", value: "..." },
        { label: "Email", value: "..." }
      ]
    }
  ]
}
```

If you use images (signatures/logos), use `{ kind: "image", src: "..." }`.

## Email sending

The kit sends via SMTP with sane defaults and safe timeouts.

### Required env vars

```
Email (SMTP)

SMTP_HOST
SMTP_PORT (default 587)
SMTP_USER (optional if server allows)
SMTP_PASS (optional if server allows)
SMTP_SECURE (optional, defaults to true if port 465 else false)

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

## PDF rendering env vars

```
WEBSITE_URL (preferred) OR Netlify provided URL/DEPLOY_PRIME_URL must exist

PDF_RUNTIME=local|lambda (default auto)
PDF_HEADLESS=0|1 (local only, default 1)
PDF_RENDER_TIMEOUT_MS (default 25000)
```

## Pipeline / store env vars

```
LEAD_STORE_NAME (optional, default lead-kit-<siteSlug>)
LEAD_MAX_ATTEMPTS (default 3)

LEAD_BACKGROUND_PATH (default /.netlify/functions/handle-lead-background)
LEAD_ENQUEUE_TIMEOUT_MS (default 8000)
```

## Netlify Forms integration (submission-created)

There are two common setups:

### A) You only use the pipeline (recommended)

Frontend posts JSON to `/.netlify/functions/handle-lead`.
No Netlify Forms required.

### B) You use Netlify Forms + pipeline bridge

Use `createSubmissionCreatedHandler(adapter)` to convert a Netlify Forms “submission-created” event into the same lead contract and push it through your downstream (CRM/webhook/etc).

Example:

```js
const {
  createSubmissionCreatedHandler,
} = require("insurance-pdf-pipeline-package");
const { adapter } = require("./sites/<siteSlug>/adapter.cjs");

exports.handler = createSubmissionCreatedHandler(adapter);
```

If you do use Netlify Forms, keep the hidden form fields aligned with your schema keys. Drift here is a classic source of “missing fields”.

## Frontend integration checklist (Astro/React/etc.)

If you collect leads via a quiz/component:

- Keep a single payload builder that outputs exactly the schema fields
- Use the same enum values as the backend schema
- Save `leadId` and redirect to thank-you with `?leadId=...`
- Use `lead-status` UI polling on thank-you if you want visibility

Recommended:

- Persist `leadId` in sessionStorage
- Show retry button that calls `lead-retry`

## “Do not forget” checklist when adding new mandatory questions

When you add or change questions in any site:

1. Update `netlify/functions/sites/<siteSlug>/schema.cjs`

- Add new fields
- Add conditional validation rules (`superRefine`) if needed

2. Update the frontend quiz payload + UI validation

- Add steps/questions
- Ensure `buildPayload()` sends the new keys

3. Update adapter mapping

- Add those fields to PDF model rows
- Add those fields to email body/template
- If you forward to a CRM webhook, map them too

4. Update the print template if labels/layout need changes

- PDF should show the new fields clearly

5. Update any Netlify Forms hidden fields (only if using Forms)

- Add missing `<input name="..." />` keys

6. Sanity check lead-status stages

- If you made PDF required, set `EMAIL_REQUIRE_PDF=1` intentionally
- Otherwise keep `EMAIL_ALLOW_WITHOUT_PDF=1`

## Common failure modes

- `Missing lead id from server`
  - Your handle-lead must return `leadId` or `correlationId`. The kit aliases, but you still must return something.

- PDF works locally but fails in Netlify
  - Ensure `WEBSITE_URL` is set or Netlify URL is available
  - Ensure chromium runtime is configured for lambda mode (package side)

- Email sends without PDF unexpectedly
  - Set `EMAIL_REQUIRE_PDF=1` if PDF must exist
  - Or keep default behavior if PDF is best-effort

- Validation fails but frontend looks correct
  - Enum values mismatch (frontend sends “Yes” but schema expects “yes”)
  - Trim/normalization mismatch
  - Missing mandatory fields on some branches (conditional steps)

## Versioning and stability

Treat the schema and adapter responsibilities as stable.
If you change exported names/adapter keys, bump versions and update this README immediately.
This package should reduce drift, not create new surprises.
