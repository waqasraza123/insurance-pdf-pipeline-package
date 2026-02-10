let _browserPromise = null;

const fs = require("fs/promises");
const { toInt, safeTrim, stripTrailingSlash } = require("./utils.cjs");

function resolveSiteOrigin(env) {
  const e = env || process.env;

  const explicit = stripTrailingSlash(safeTrim(e.WEBSITE_URL));
  if (explicit) return explicit;

  const netlifyUrl = stripTrailingSlash(
    safeTrim(e.URL || e.DEPLOY_PRIME_URL || e.DEPLOY_URL),
  );
  if (netlifyUrl) return netlifyUrl;

  const isLocal = safeTrim(e.NETLIFY_LOCAL || e.NETLIFY_DEV).toLowerCase();
  if (isLocal === "true" || isLocal === "1") return "http://localhost:8888";

  return "";
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findLocalChrome() {
  const envPaths = [
    process.env.GOOGLE_CHROME_BIN,
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_CHROME_PATH,
  ].filter(Boolean);

  for (const p of envPaths) {
    if (await fileExists(p)) return p;
  }

  const platform = process.platform;
  const candidates =
    platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
          ];

  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }

  throw new Error(
    "Local Chrome not found. Set GOOGLE_CHROME_BIN (or CHROME_PATH).",
  );
}

function parseHeadless(v, fallback) {
  const s = safeTrim(v).toLowerCase();
  if (!s) return fallback;
  return !(s === "0" || s === "false" || s === "no");
}

function isNetlifyLocal(env) {
  const e = env || process.env;
  const v = safeTrim(e.NETLIFY_LOCAL || e.NETLIFY_DEV).toLowerCase();
  return v === "1" || v === "true" || process.platform !== "linux";
}

async function getBrowser(env) {
  if (_browserPromise) return _browserPromise;

  _browserPromise = (async () => {
    let puppeteer = null;
    try {
      puppeteer = require("puppeteer-core");
    } catch {
      throw new Error("Missing dependency: puppeteer-core");
    }

    let chromium = null;
    try {
      chromium = require("@sparticuz/chromium");
    } catch {
      chromium = null;
    }

    const e = env || process.env;
    const runtime = safeTrim(
      e.PDF_RUNTIME || process.env.PDF_RUNTIME,
    ).toLowerCase();
    const local =
      runtime === "local" || (runtime !== "lambda" && isNetlifyLocal(e));

    const execPathEnv = safeTrim(process.env.PUPPETEER_EXECUTABLE_PATH);
    const executablePath = execPathEnv
      ? execPathEnv
      : local
        ? await findLocalChrome()
        : chromium
          ? await chromium.executablePath()
          : "";

    if (!executablePath)
      throw new Error("Chromium executablePath not available");

    const headless = local
      ? parseHeadless(e.PDF_HEADLESS || process.env.PDF_HEADLESS, true)
      : chromium
        ? chromium.headless
        : true;

    const args = local ? [] : chromium ? chromium.args : [];

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        message: "leadkit.pdf.browser.launch.start",
        execPathPresent: Boolean(executablePath),
        headless,
        local,
        platform: process.platform,
      }),
    );

    return await puppeteer.launch({
      args,
      defaultViewport: chromium
        ? chromium.defaultViewport
        : { width: 1280, height: 720 },
      executablePath,
      headless,
      ignoreHTTPSErrors: true,
    });
  })();

  return _browserPromise;
}

async function renderPdf({ templatePath, model, env, correlationId }) {
  const origin = resolveSiteOrigin(env || process.env);
  if (!origin) throw new Error("Missing WEBSITE_URL/URL for PDF rendering");

  const template = safeTrim(templatePath).replace(/^\/+/, "");
  if (!template) throw new Error("Missing templatePath");

  const templateUrl = `${origin}/${template
    .replace(/^public\//, "")
    .replace(/^public\//, "")
    .replace(/^\/+/, "")}`;

  const timeoutMs = toInt(
    (env && env.PDF_RENDER_TIMEOUT_MS) || process.env.PDF_RENDER_TIMEOUT_MS,
    25000,
  );

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message: "leadkit.pdf.render.start",
      correlationId: safeTrim(correlationId),
      origin,
      templateUrl,
      timeoutMs: String(timeoutMs),
    }),
  );

  const browser = await getBrowser(env || process.env);
  const page = await browser.newPage();

  try {
    await page.setDefaultNavigationTimeout(timeoutMs);
    await page.setDefaultTimeout(timeoutMs);

    await page.evaluateOnNewDocument((m) => {
      window.__PDF_MODEL__ = m;
    }, model);

    await page.goto(templateUrl, { waitUntil: "networkidle0" });

    try {
      await page.waitForFunction(
        () => {
          const root = document.getElementById("root");
          return !!root && root.children && root.children.length > 0;
        },
        { timeout: 5000 },
      );
    } catch {}

    try {
      await page.evaluate(async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      });
    } catch {}

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" },
    });

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        message: "leadkit.pdf.render.ok",
        correlationId: safeTrim(correlationId),
        bytes: pdf && typeof pdf.length === "number" ? pdf.length : 0,
      }),
    );

    return pdf;
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "PDF render failed";
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        message: "leadkit.pdf.failed",
        correlationId: safeTrim(correlationId),
        err: msg,
        stack: e && e.stack ? String(e.stack) : "",
      }),
    );
    const id = safeTrim(correlationId);
    throw new Error(id ? `${msg} (${id})` : msg);
  } finally {
    try {
      await page.close();
    } catch {}
  }
}

module.exports = { renderPdf };
