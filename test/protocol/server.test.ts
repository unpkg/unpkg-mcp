import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import worker from "../../src/index.ts";
import { preactPackument } from "../unit/npm.test.ts";

const realFetch = globalThis.fetch;

// Stub the outside world: npm registry + UNPKG origin. The MCP transport
// itself is exercised for real against the Worker's fetch handler.
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input);
    if (url.includes("/-/v1/search")) {
      return Response.json({
        objects: [{ package: { name: "preact", version: "10.26.4", description: "Fast 3kB React alternative" } }],
      });
    }
    if (url.startsWith("https://registry.npmjs.org/preact")) {
      return Response.json(preactPackument);
    }
    if (url.startsWith("https://registry.npmjs.org/subpkg")) {
      return Response.json({
        name: "subpkg",
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": {
            name: "subpkg",
            version: "1.0.0",
            module: "dist/index.mjs",
            exports: { ".": "./dist/index.mjs", "./hooks": { import: "./hooks/dist/hooks.module.js" } },
          },
        },
      });
    }
    if (url.startsWith("https://registry.npmjs.org/")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("?meta")) {
      return Response.json({
        package: "preact",
        version: "10.26.4",
        prefix: "/",
        files: [
          { path: "/dist/preact.module.js", size: 100, type: "text/javascript" },
          { path: "/dist/preact.js", size: 120, type: "text/javascript" },
        ],
      });
    }
    if (url.includes("/dist/preact.module.js")) {
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "Content-Type": "text/javascript" } });
      return new Response("export const x = 1;", { headers: { "Content-Type": "text/javascript" } });
    }
    return new Response("stub: unhandled " + url, { status: 404 });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

async function rpc(method: string, params: unknown, id = 1): Promise<any> {
  let response = await worker.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
    {},
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("MCP protocol end-to-end (stubbed npm/UNPKG)", () => {
  it("initializes and lists all tools, the prompt, and resources", async () => {
    let init = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    });
    expect(init.result.serverInfo.name).toBe("unpkg-mcp");

    let tools = await rpc("tools/list", {}, 2);
    let names = tools.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual([
      "audit_dependencies",
      "build_file_url",
      "check_importmap",
      "estimate_migration_impact",
      "generate_importmap",
      "list_files",
      "resolve_package",
      "search_packages",
      "shield_check_packages",
      "shield_domain_packages",
      "shield_simulate_request",
      "shield_watchlist_status",
      "shield_whoami",
      "verify_url",
    ]);

    let prompts = await rpc("prompts/list", {}, 3);
    expect(prompts.result.prompts.map((p: any) => p.name)).toContain("audit_project_for_unpkg");
    expect(prompts.result.prompts.map((p: any) => p.name)).toContain("convert_this_page");
    expect(prompts.result.prompts.map((p: any) => p.name)).toContain("find_browser_package");

    let resources = await rpc("resources/list", {}, 4);
    expect(resources.result.resources.map((r: any) => r.uri)).toContain("unpkg://guidance/conversion-playbook");
  });

  it("resolve_package returns live resolution and entry points", async () => {
    let result = await rpc("tools/call", { name: "resolve_package", arguments: { package: "preact", version: "^10.25.0" } }, 5);
    let data = result.result.structuredContent;
    expect(data.resolvedVersion).toBe("10.26.4");
    expect(data.entryPoints.file).toBe("dist/preact.module.js");
  });

  it("build_file_url applies the patch policy and verifies the file", async () => {
    let result = await rpc(
      "tools/call",
      { name: "build_file_url", arguments: { package: "preact", version: "^10.25.0", file: "dist/preact.module.js", policy: "patch" } },
      6,
    );
    let data = result.result.structuredContent;
    expect(data.url).toBe("https://unpkg.com/preact@10.26/dist/preact.module.js");
    expect(data.verifiedFileExists).toBe(true);
  });

  it("audit_dependencies classifies and builds an import map", async () => {
    let result = await rpc("tools/call", { name: "audit_dependencies", arguments: { dependencies: { preact: "^10.25.4" } } }, 7);
    let data = result.result.structuredContent;
    expect(data.summary.convert_now).toBe(1);
    expect(data.importmap.imports.preact).toContain("preact@^10.25.4/dist/preact.module.js");
    expect(data.importmapScope).toBe("project");
    expect(data.mapValidation.ok).toBe(true);
  });

  it("verify_url checks UNPKG URLs and rejects foreign hosts", async () => {
    let ok = await rpc("tools/call", { name: "verify_url", arguments: { url: "https://unpkg.com/preact@10.26.4/dist/preact.module.js" } }, 8);
    expect(ok.result.structuredContent.ok).toBe(true);

    let bad = await rpc("tools/call", { name: "verify_url", arguments: { url: "https://example.com/x.js" } }, 9);
    expect(bad.result.isError).toBe(true);
  });

  it("build_file_url resolves subpath imports through the exports map", async () => {
    let result = await rpc(
      "tools/call",
      { name: "build_file_url", arguments: { package: "subpkg", version: "^1.0.0", subpath: "hooks" } },
      15,
    );
    let data = result.result.structuredContent;
    expect(data.url).toBe("https://unpkg.com/subpkg@^1.0.0/hooks/dist/hooks.module.js");
  });

  it("check_importmap validates a good map and estimate returns ranges", async () => {
    let checked = await rpc(
      "tools/call",
      { name: "check_importmap", arguments: { imports: { preact: "https://unpkg.com/preact@^10.25.4/dist/preact.module.js" } } },
      12,
    );
    expect(checked.result.structuredContent.ok).toBe(true);
    expect(checked.result.structuredContent.entries[0].resolvedVersion).toBe("10.26.4");

    let esmChecked = await rpc(
      "tools/call",
      { name: "check_importmap", arguments: { imports: { preact: "https://esm.unpkg.com/preact@10.26.4/dist/preact.module.js" } } },
      14,
    );
    let esmIssues = esmChecked.result.structuredContent.entries[0].issues.map((i: any) => i.message).join(" ");
    expect(esmIssues).toContain("not the direct UNPKG file lookup");

    let estimate = await rpc(
      "tools/call",
      { name: "estimate_migration_impact", arguments: { monthlyPageViews: 100000, unpkgBytesPerPageLoad: 50000, bandwidthCostPerGbUsd: 0.1 } },
      13,
    );
    let data = estimate.result.structuredContent;
    expect(data.monthlyGbOffloaded.high).toBeGreaterThan(data.monthlyGbOffloaded.low);
    expect(data.monthlySavingsUsd).not.toBeNull();
    expect(data.caveats.join(" ")).toContain("not a forecast");
  });

  it("search_packages annotates readiness and the server card is served", async () => {
    let search = await rpc("tools/call", { name: "search_packages", arguments: { query: "react alternative" } }, 16);
    let result = search.result.structuredContent.results[0];
    expect(result.name).toBe("preact");
    expect(result.readiness).toContain("browser-ready ESM");

    let cardResponse = await worker.fetch(new Request("http://localhost/.well-known/mcp.json"), {});
    let card = (await cardResponse.json()) as { name: string; capabilities: { tools: string[] } };
    expect(card.name).toBe("unpkg-mcp");
    expect(card.capabilities.tools).toContain("search_packages");
  });

  it("landing page snippet script parses and renders for every client", async () => {
    let page = await worker.fetch(new Request("http://localhost/"), {});
    let html = await page.text();
    let script =
      html
        .split("<script>")
        .map((part) => part.split("</script>")[0] ?? "")
        .find((part) => part.includes("client-picker") && part.includes("getElementById")) ?? "";
    expect(script).toContain("client-picker");
    expect(script).toContain("login-picker");
    // Page order: login right after the tier comparison, then categorized
    // prompts, then tools. No Logging section.
    let order = ["connect", "modes", "login", "prompts", "tools"].map((id) => html.indexOf(`<section id="${id}">`));
    expect(order.every((pos) => pos >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("<h2>Logging</h2>");
    expect(html).toContain("Start with your project");
    expect(html).toContain("Package safety");
    expect(html).toContain("Your Shield estate");
    expect(html).toContain("Is lodash@4.17.20 safe to load?");
    // No GA snippet unless the measurement ID is configured.
    expect(html).not.toContain("googletagmanager");
    let gaPage = await worker.fetch(new Request("http://localhost/"), { GA_MEASUREMENT_ID: "G-TEST123456" });
    let gaHtml = await gaPage.text();
    expect(gaHtml).toContain("googletagmanager.com/gtag/js?id=G-TEST123456");
    expect(gaHtml).toContain("gtag('config', 'G-TEST123456')");
    expect(gaHtml).toContain('location.hostname === "mcp.unpkg.com"');
    // Claude Code is the default selection on both pickers.
    expect(html).toContain('<option value="claude-code" selected>Claude Code</option>');
    // Compiling catches quote/newline escaping bugs that blank the snippet box.
    expect(() => new Function(script)).not.toThrow();

    let changeHandler: (() => void) | undefined;
    let loginChangeHandler: (() => void) | undefined;
    let elements: Record<string, { value?: string; textContent?: string; addEventListener?: (e: string, f: () => void) => void }> = {
      "client-picker": {
        value: "claude-code",
        addEventListener: (_event, fn) => {
          changeHandler = fn;
        },
      },
      snippet: { textContent: "" },
      "snippet-note": { textContent: "" },
      "login-picker": {
        value: "claude-code",
        addEventListener: (_event, fn) => {
          loginChangeHandler = fn;
        },
      },
      "login-snippet": { textContent: "" },
      "login-note": { textContent: "" },
    };
    // Prompt category tabs: stub the DOM surface the tab switcher uses.
    type StubEl = {
      attrs: Record<string, string>;
      hidden?: boolean;
      classes: Set<string>;
      click?: () => void;
      getAttribute: (k: string) => string;
      setAttribute: (k: string, v: string) => void;
      classList: { toggle: (c: string, on: boolean) => void };
      addEventListener: (e: string, f: () => void) => void;
    };
    let mkTab = (name: string): StubEl => {
      let el: StubEl = {
        attrs: { "data-prompt-tab": name },
        classes: new Set(name === "project" ? ["active"] : []),
        getAttribute: (k) => el.attrs[k] ?? "",
        setAttribute: (k, v) => {
          el.attrs[k] = v;
        },
        classList: {
          toggle: (c, on) => {
            if (on) el.classes.add(c);
            else el.classes.delete(c);
          },
        },
        addEventListener: (_e, f) => {
          el.click = f;
        },
      };
      return el;
    };
    let mkPanel = (name: string): StubEl => {
      let el = mkTab(name);
      el.attrs = { "data-prompt-panel": name };
      el.hidden = name !== "project";
      return el;
    };
    let tabs = ["project", "safety", "estate"].map(mkTab);
    let panels = ["project", "safety", "estate"].map(mkPanel);
    let documentStub = {
      getElementById: (id: string) => elements[id],
      querySelectorAll: (sel: string) => (sel.includes("data-prompt-tab") ? tabs : panels),
    };
    new Function("document", "location", script)(documentStub, { origin: "http://localhost:8787" });

    // Tabs switch panels: only the selected category is visible.
    expect(panels.map((pan) => pan.hidden)).toEqual([false, true, true]);
    tabs[1]!.click?.();
    expect(panels.map((pan) => pan.hidden)).toEqual([true, false, true]);
    expect(tabs[1]!.classes.has("active")).toBe(true);
    expect(tabs[1]!.attrs["aria-selected"]).toBe("true");
    expect(tabs[0]!.attrs["aria-selected"]).toBe("false");
    tabs[2]!.click?.();
    expect(panels.map((pan) => pan.hidden)).toEqual([true, true, false]);
    // Default (Claude Code) renders on load for both pickers.
    expect(elements.snippet?.textContent).toContain("claude mcp add --transport http unpkg http://localhost:8787/mcp");
    expect(elements["login-snippet"]?.textContent).toContain("/mcp");

    elements["client-picker"]!.value = "muse";
    changeHandler?.();
    expect(elements.snippet?.textContent).toContain('"url": "http://localhost:8787/mcp"');

    elements["client-picker"]!.value = "codex";
    changeHandler?.();
    expect(elements.snippet?.textContent).toContain('[mcp_servers.unpkg]\nurl = "http://localhost:8787/mcp"');

    elements["client-picker"]!.value = "vscode";
    changeHandler?.();
    expect(elements.snippet?.textContent).toContain('"servers"');

    elements["login-picker"]!.value = "muse";
    loginChangeHandler?.();
    expect(elements["login-snippet"]?.textContent).toBe("muse mcp login unpkg");
    expect(elements["login-note"]?.textContent).toContain("muse mcp logout unpkg");

    elements["login-picker"]!.value = "cursor";
    loginChangeHandler?.();
    expect(elements["login-snippet"]?.textContent).toContain("Cursor Settings");

    elements["login-picker"]!.value = "vscode";
    loginChangeHandler?.();
    expect(elements["login-snippet"]?.textContent).toContain("MCP: List Servers");
  });

  it("serves the privacy page and links it from the landing footer", async () => {
    let privacy = await worker.fetch(new Request("http://localhost/privacy"), {});
    expect(privacy.status).toBe(200);
    expect(privacy.headers.get("Content-Type")).toContain("text/html");
    let privacyText = await privacy.text();
    expect(privacyText).toContain("Privacy — UNPKG MCP");
    expect(privacyText).toContain("What we never collect");

    let landing = await worker.fetch(new Request("http://localhost/"), {});
    expect(await landing.text()).toContain('href="/privacy"');
  });

  it("serves robots.txt and sitemap.xml for crawlers", async () => {
    let robots = await worker.fetch(new Request("http://localhost/robots.txt"), {});
    expect(robots.status).toBe(200);
    expect(await robots.text()).toContain("Sitemap: https://mcp.unpkg.com/sitemap.xml");

    let sitemap = await worker.fetch(new Request("http://localhost/sitemap.xml"), {});
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("Content-Type")).toContain("application/xml");
    expect(await sitemap.text()).toContain("<loc>https://mcp.unpkg.com/</loc>");
  });

  it("audit separates current UNPKG usage from conversion candidates", async () => {
    let converted = await rpc(
      "tools/call",
      {
        name: "audit_dependencies",
        arguments: {
          dependencies: { preact: "^10.25.4" },
          existingImports: { preact: "https://unpkg.com/preact@^10.26.4/dist/preact.module.js" },
        },
      },
      17,
    );
    let data = converted.result.structuredContent;
    expect(data.dependencies[0].classification).toBe("already_on_unpkg");
    expect(data.currentStateSummary).toMatchObject({ scanned: true, alreadyOnUnpkg: 1 });
    expect(data.importmap.imports).toEqual({});
    expect(data.scopeNote).toContain("Suitability is not usage");

    let unscanned = await rpc(
      "tools/call",
      { name: "audit_dependencies", arguments: { dependencies: { preact: "^10.25.4" } } },
      18,
    );
    expect(unscanned.result.structuredContent.currentStateSummary.scanned).toBe(false);
    expect(unscanned.result.structuredContent.dependencies[0].classification).toBe("convert_now");
  });

  it("serves the playbook resource and audit prompt", async () => {
    let resource = await rpc("resources/read", { uri: "unpkg://guidance/conversion-playbook" }, 10);
    expect(resource.result.contents[0].text).toContain("Converting a project to UNPKG file lookups");

    let prompt = await rpc("prompts/get", { name: "audit_project_for_unpkg", arguments: {} }, 11);
    expect(prompt.result.messages[0].content.text).toContain("audit_dependencies");
  });
});
