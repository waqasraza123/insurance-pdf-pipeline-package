# insurance-pdf-pipeline-package

Reusable Netlify lead pipeline kit:

validate -> store -> background -> pdf -> email -> status/retry

Exports a single API:

- `createLeadHandlers(adapter)` -> `{ handleLead, handleLeadBackground, leadStatus, leadRetry }`

Two built-in fixes:

- Callback normalization: supports `onStage(stage, meta)` and legacy `onStep({stage, extra})`
- leadId/cid aliasing: accepts `leadId`, `cid`, `correlationId` in query/body/headers and returns aliases

## Install (GitHub dependency)

In your site repo (recommended inside `netlify/functions/package.json` if you keep a separate functions package):

```bash
npm i github:<YOUR_GH_ORG>/insurance-pdf-pipeline-package#main
```

Required env vars

```
Email (SMTP)

SMTP_HOST

SMTP_PORT (default 587)

SMTP_USER (optional if server allows)

SMTP_PASS (optional if server allows)

SMTP_SECURE (optional, defaults to true if port 465 else false)

LEAD_TO_EMAIL (comma/semicolon separated)

LEAD_FROM_EMAIL

Optional:

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

PDF rendering

WEBSITE_URL (preferred) OR Netlify provided URL/DEPLOY_PRIME_URL must exist

PDF_RUNTIME=local|lambda (default auto)

PDF_HEADLESS=0|1 (local only, default 1)

PDF_RENDER_TIMEOUT_MS (default 25000)

Pipeline / store

LEAD_STORE_NAME (optional, default lead-kit-<siteSlug>)

LEAD_MAX_ATTEMPTS (default 3)

LEAD_BACKGROUND_PATH (default /.netlify/functions/handle-lead-background)

LEAD_ENQUEUE_TIMEOUT_MS (default 8000)
```
