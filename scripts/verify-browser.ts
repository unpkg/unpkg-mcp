/**
 * Browser proof for an import map: resolution (HTTP 200) is not
 * execution. This loads the map in headless Chrome (system Chrome via
 * playwright-core; no browser download) and dynamic-imports every
 * specifier, reporting which ones actually execute.
 *
 * Usage:
 *   bun scripts/verify-browser.ts --map importmap.json [--timeout-ms 20000]
 *
 * The map file may be a bare imports object or a full { "imports": {} }.
 * Exit code is non-zero when any specifier fails to import.
 * Set CHROME_PATH to a Chrome/Chromium executable if auto-detection fails.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

function argValue(name: string): string | undefined {
  let index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

// ---- Page mode: serve a project directory and load its real page. ----
const serveDir = argValue("--serve");
if (serveDir != null) {
  const { statSync } = await import("node:fs");
  const { join: joinPath, extname } = await import("node:path");
  if (!statSync(serveDir).isDirectory()) {
    console.error(`--serve expects a directory, got: ${serveDir}`);
    process.exit(2);
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".map": "application/json",
  };
  const { readFile: read } = await import("node:fs/promises");
  const pageServer = createServer(async (request, response) => {
    try {
      const urlPath = (request.url ?? "/").split("?")[0];
      if (urlPath === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      const filePath = joinPath(serveDir, urlPath === "/" ? "index.html" : urlPath);
      const body = await read(filePath);
      response.writeHead(200, { "Content-Type": types[extname(filePath)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise<void>((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
  const addr = pageServer.address();
  if (addr == null || typeof addr === "string") throw new Error("Could not start page server");

  let pageBrowser;
  try {
    pageBrowser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    if (process.env.CHROME_PATH == null) {
      console.error("Could not launch system Chrome. Set CHROME_PATH.");
      process.exit(2);
    }
    pageBrowser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  }
  const errors: string[] = [];
  try {
    const page = await pageBrowser.newPage();
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${addr.port}/`, { waitUntil: "networkidle", timeout: 30000 });
    const clickSelector = argValue("--click");
    if (clickSelector != null) {
      await page.click(clickSelector, { timeout: 10000 });
      await page.waitForTimeout(750);
    }
    const text = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").trim();
    console.log(`Page title: ${await page.title()}`);
    console.log(`Rendered text (first 200 chars): ${text.slice(0, 200)}`);
    if (errors.length > 0) {
      console.log(`\n${errors.length} page error(s):`);
      for (const error of errors.slice(0, 10)) console.log(`  ${error.slice(0, 300)}`);
      console.log("\nPAGE PROOF FAILED");
      process.exitCode = 1;
    } else {
      console.log("\nPAGE PROOF PASSED: page loaded and ran with no page errors.");
    }
  } finally {
    await pageBrowser.close();
    pageServer.close();
  }
  process.exit(process.exitCode ?? 0);
}

const mapPath = argValue("--map");
if (mapPath == null) {
  console.error("Usage: bun scripts/verify-browser.ts --map importmap.json | --serve <project-dir> [--click <css-selector>]");
  process.exit(2);
}
const timeoutMs = Number(argValue("--timeout-ms") ?? 20000);

const raw = JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, unknown>;
const imports = (typeof raw.imports === "object" && raw.imports != null ? raw.imports : raw) as Record<string, string>;
const specifiers = Object.keys(imports);
if (specifiers.length === 0) {
  console.error("Import map has no entries.");
  process.exit(2);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>import map verification</title>
<script type="importmap">${JSON.stringify({ imports })}</script>
</head><body></body></html>`;

const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address == null || typeof address === "string") throw new Error("Could not start local server");
const pageUrl = `http://127.0.0.1:${address.port}/`;

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch {
  const executablePath = process.env.CHROME_PATH;
  if (executablePath == null) {
    console.error("Could not launch system Chrome. Set CHROME_PATH to a Chrome/Chromium executable.");
    server.close();
    process.exit(2);
  }
  browser = await chromium.launch({ executablePath, headless: true });
}

interface ImportResult {
  ok: boolean;
  exports?: string[];
  error?: string;
}

try {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(pageUrl, { waitUntil: "load", timeout: timeoutMs });

  const results = await page.evaluate(
    async ({ specs, perImportTimeout }) => {
      const out: Record<string, { ok: boolean; exports?: string[]; error?: string }> = {};
      for (const spec of specs) {
        try {
          const module = (await Promise.race([
            import(/* @vite-ignore */ spec),
            new Promise((_, reject) => setTimeout(() => reject(new Error("import timed out")), perImportTimeout)),
          ])) as Record<string, unknown>;
          out[spec] = { ok: true, exports: Object.keys(module).slice(0, 8) };
        } catch (error) {
          out[spec] = { ok: false, error: String(error).slice(0, 300) };
        }
      }
      return out;
    },
    { specs: specifiers, perImportTimeout: timeoutMs },
  );

  let failures = 0;
  for (const spec of specifiers) {
    const result = results[spec] as ImportResult;
    if (result.ok) {
      console.log(`OK    ${spec}  (exports: ${result.exports?.join(", ") || "none"})`);
    } else {
      failures++;
      console.log(`FAIL  ${spec}  ${result.error}`);
    }
  }
  if (pageErrors.length > 0) {
    console.log("\nPage errors observed:");
    for (const error of pageErrors.slice(0, 10)) console.log(`  ${error.slice(0, 300)}`);
  }

  console.log(
    `\n${specifiers.length - failures}/${specifiers.length} specifiers imported successfully in headless Chrome.`,
  );
  process.exitCode = failures > 0 ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
