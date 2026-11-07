import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { CONVERSION_PLAYBOOK } from "./domain/guidance.ts";
import { NpmClient } from "./clients/npm.ts";
import { createServer } from "./server.ts";
import { ShieldClient } from "./clients/shield.ts";
import { UnpkgClient } from "./clients/unpkg.ts";
import { validateToken, type AuthConfig } from "./auth.ts";
import { VERSION } from "./version.ts";

export interface Env {
  GA_MEASUREMENT_ID?: string;
  UNPKG_ORIGIN?: string;
  NPM_REGISTRY?: string;
  SHIELD_API_ORIGIN?: string;
  OAUTH_ISSUER?: string;
  OAUTH_RESOURCE?: string;
  OAUTH_ENABLED?: string;
}

function landingHtml(gaId?: string): string {
  let ga = gaId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
if (location.hostname === "mcp.unpkg.com") {
  gtag('js', new Date());
  gtag('config', '${gaId}');
}
</script>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>UNPKG MCP — UNPKG for AI agents</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="The UNPKG MCP server: live npm and UNPKG data for AI agents. Project audits, import-map validation, and optional Shield account tools for direct UNPKG file lookups.">
<style>
:root{--ink:#0e1a23;--accent:#3a6b7a;--accent-deep:#264a56;--accent-soft:#e8f0f2;--paper:#fbfaf7;--paper-alt:#f4f1eb;--hairline:#ede7dc;--hairline-strong:#d9d2c5;--dark-code:#081118;--dark-panel:#16242f;--dark-border:#223645;--dark-link:#9cc2cc}
*{box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,sans-serif;background:var(--paper);color:var(--ink);margin:0;line-height:1.65}
a{color:var(--accent-deep)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
code{background:var(--paper-alt);padding:.08rem .32rem;font-size:.92em}
.wrap{max-width:62rem;margin:0 auto;padding:0 1.5rem}
header.site{background:var(--ink);color:#fff}
header.site .wrap{display:flex;align-items:center;gap:1rem;padding-top:1rem;padding-bottom:1rem;flex-wrap:wrap}
.wordmark{font-weight:800;letter-spacing:.04em;font-size:1.25rem;color:#fff;text-decoration:none}
.wordmark span{color:var(--dark-link);font-weight:600}
header.site nav{margin-left:auto;display:flex;gap:1.25rem;flex-wrap:wrap}
header.site nav a{color:#fff;text-decoration:none;font-size:.95rem}
header.site nav a:hover{text-decoration:underline}
.hero{padding:3.5rem 0 2.5rem}
.hero h1{font-size:2.6rem;line-height:1.12;margin:0 0 1rem;font-weight:800;letter-spacing:-.01em}
.hero p.lede{font-size:1.15rem;max-width:44rem;margin:0 0 1.5rem}
.endpoint{display:inline-block;background:var(--dark-code);color:#e8f0f2;padding:.7rem 1rem;font-size:.95rem;border:1px solid var(--dark-border)}
.endpoint b{color:var(--dark-link);font-weight:600}
section{padding:2.25rem 0;border-top:1px solid var(--hairline)}
section h2{font-size:1.55rem;margin:0 0 .75rem;font-weight:750}
section h3{font-size:1.05rem;margin:1.5rem 0 .5rem}
section p{max-width:46rem}
select{font:inherit;padding:.45rem .6rem;border:1px solid var(--hairline-strong);background:#fff;color:var(--ink);max-width:100%}
pre.snippet{background:var(--dark-code);color:#e8f0f2;border:1px solid var(--dark-border);padding:1rem 1.1rem;overflow:auto;font-size:.92rem;line-height:1.55;min-height:3.5rem;white-space:pre-wrap;word-break:break-word}
.note{font-size:.95rem;max-width:46rem}
table{border-collapse:collapse;width:100%;font-size:.95rem}
th,td{text-align:left;vertical-align:top;padding:.55rem .75rem;border-bottom:1px solid var(--hairline)}
th{font-weight:700;border-bottom:2px solid var(--hairline-strong)}
td.tool{font-family:ui-monospace,Menlo,monospace;font-size:.88rem;white-space:nowrap}
.tag{display:inline-block;font-size:.78rem;font-weight:650;padding:.08rem .5rem;border:1px solid var(--hairline-strong);background:#fff}
.tag.shield{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-deep)}
.modes{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--hairline-strong)}
.mode{padding:1.25rem 1.4rem;background:#fff}
.mode+.mode{border-left:1px solid var(--hairline-strong);background:var(--accent-soft)}
.mode h3{margin-top:0;font-size:1.1rem}
.mode ul{margin:.5rem 0;padding-left:1.2rem}
ol.steps{max-width:46rem;padding-left:1.4rem}
ol.steps li{margin:.45rem 0}
.prompt{background:#fff;border:1px solid var(--hairline);border-left:3px solid var(--accent);padding:.8rem 1rem;margin:.7rem 0;max-width:52rem}
.prompt-tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0 .25rem}
.prompt-tab{font:inherit;font-size:.93rem;padding:.45rem .9rem;border:1px solid var(--hairline-strong);background:#fff;color:var(--ink);cursor:pointer}
.prompt-tab:hover{border-color:var(--accent)}
.prompt-tab.active{background:var(--ink);color:#fff;border-color:var(--ink)}
.prompt-panel{margin-top:.5rem}
.prompt p{margin:0}
.prompt .why{font-size:.9rem;margin-top:.35rem}
footer.site{border-top:1px solid var(--hairline);padding:2rem 0 3rem;font-size:.92rem}
footer.site .wrap{display:flex;gap:1.5rem;flex-wrap:wrap}
@media (max-width:720px){.modes{grid-template-columns:1fr}.mode+.mode{border-left:none;border-top:1px solid var(--hairline-strong)}.hero h1{font-size:2rem}td.tool{white-space:normal}}
</style>
${ga}
</head><body>
<header class="site"><div class="wrap">
<a class="wordmark" href="/">UNPKG <span>MCP</span></a>
<nav>
<a href="#connect">Connect</a>
<a href="#modes">Anonymous vs Shield</a>
<a href="#login">Shield login</a>
<a href="#prompts">Example prompts</a>
<a href="#tools">Tools</a>
</nav>
</div></header>

<div class="wrap">
<div class="hero">
<h1>UNPKG, inside your AI agent.</h1>
<p class="lede">Live npm and UNPKG data for direct file lookups —
<code>https://unpkg.com/&lt;package&gt;@&lt;version&gt;/&lt;file&gt;</code> — so agents resolve
real versions and files instead of guessing from memory, audit projects for conversion,
and validate import maps before they land.</p>
<span class="endpoint"><b>POST</b> https://mcp.unpkg.com/mcp</span>
</div>

<section id="connect">
<h2>Connect</h2>
<p>Pick your client. The general tools need no account and no login.</p>
<label>Your client:
<select id="client-picker">
  <option value="claude-code" selected>Claude Code</option>
  <option value="muse">Muse Code</option>
  <option value="codex">Codex</option>
  <option value="cursor">Cursor</option>
  <option value="vscode">VS Code</option>
</select></label>
<pre class="snippet" id="snippet"></pre>
<p class="note" id="snippet-note"></p>
</section>

<section id="modes">
<h2>Anonymous vs Shield login</h2>
<p>Two tiers, same server. Anonymous is the default and never requires an account.
Shield login is optional and only adds your own account's data.</p>
<div class="modes">
<div class="mode">
<h3>Anonymous — no account</h3>
<ul>
<li>All 9 general tools: resolution, file discovery, search, audits, import maps, estimates</li>
<li>Package-safety checks for packages you name: malware verdicts and CVEs with patched versions</li>
<li>Works in any MCP client that supports remote (HTTP) servers</li>
<li>Best for: evaluating a conversion, one-off pages, CI checks</li>
</ul>
</div>
<div class="mode">
<h3>Shield login — approved account</h3>
<ul>
<li>Everything anonymous has, plus the 5 <code>shield_*</code> tools</li>
<li>Your domains' packages annotated with verdicts and CVEs, ranked by your traffic</li>
<li>Scoped to your organization only, via OAuth at shield.unpkg.com</li>
<li>Best for: Shield customers who want edge decisions and compromise state in-agent</li>
</ul>
</div>
</div>
</section>

<section id="login">
<h2>Shield login</h2>
<p>Login is OAuth, run by your MCP client — there is no token to copy and paste. Your account must be
email-verified and approved from the Shield beta waitlist.</p>
<ol class="steps">
<li>Connect this server as <code>https://mcp.unpkg.com/mcp</code> (see Connect above). Logins cannot complete against a localhost server, because tokens are issued for the production address.</li>
<li>Run your client's login action:</li>
</ol>
<label>Your client:
<select id="login-picker">
  <option value="claude-code" selected>Claude Code</option>
  <option value="muse">Muse Code</option>
  <option value="codex">Codex</option>
  <option value="cursor">Cursor</option>
  <option value="vscode">VS Code</option>
</select></label>
<pre class="snippet" id="login-snippet"></pre>
<p class="note" id="login-note"></p>
<ol class="steps" start="3">
<li>Your browser opens at <code>shield.unpkg.com</code>. Sign in and review the consent screen — client name, scopes in plain language, redirect host — then Approve.</li>
<li>Ask the agent to run <code>shield_whoami</code> to confirm. To disconnect later, use the logout for this server shown above; revoking there ends the grant.</li>
</ol>
<p>Discovery for client software: <a href="/.well-known/oauth-protected-resource">protected-resource metadata</a> ·
<a href="/.well-known/mcp.json">server card</a> · <a href="/health">health</a></p>
</section>

<section id="prompts">
<h2>Example prompts</h2>
<p>Paste these into your agent once connected. Start with your project; add Shield login only when you want your own domains in the picture.</p>

<div class="prompt-tabs" role="tablist" aria-label="Example prompt categories">
<button class="prompt-tab active" type="button" role="tab" aria-selected="true" data-prompt-tab="project">Start with your project</button>
<button class="prompt-tab" type="button" role="tab" aria-selected="false" data-prompt-tab="safety">Package safety</button>
<button class="prompt-tab" type="button" role="tab" aria-selected="false" data-prompt-tab="estate">Your Shield estate</button>
</div>
<div class="prompt-panel" data-prompt-panel="project">
<h3>Start with your project <span class="tag">Anonymous</span></h3>
<div class="prompt"><p>\u201cCheck my current project and audit what makes sense to convert to UNPKG.\u201d</p><p class="why">Classifies every runtime dependency, separates what already loads from UNPKG from candidates, and refuses framework-managed packages.</p></div>
<div class="prompt"><p>\u201cConvert this page to load its imports from UNPKG and prove it runs.\u201d</p><p class="why">Generates and validates the import map, then verifies execution \u2014 not just HTTP 200s.</p></div>
<div class="prompt"><p>\u201cFind me a small date-picker package that actually works as a browser import.\u201d</p><p class="why">Search results annotated with browser readiness, with CJS-only results rejected openly.</p></div>
<div class="prompt"><p>\u201cIf I move these packages to UNPKG, roughly what bandwidth do I offload at my traffic level?\u201d</p><p class="why">A range with stated assumptions. It will not invent a latency or dollar figure.</p></div>

</div>
<div class="prompt-panel" data-prompt-panel="safety" hidden>
<h3>Package safety <span class="tag">Anonymous</span></h3>
<div class="prompt"><p>\u201cIs lodash@4.17.20 safe to load? Check it for malware and CVEs, and tell me what to upgrade to.\u201d</p><p class="why">Exact-version verdict with review state, affecting CVEs, and the first patched version. Provisional verdicts are labelled, never overstated.</p></div>
<div class="prompt"><p>\u201cCheck the packages in this audit for known compromises or CVEs before we convert anything.\u201d</p><p class="why">Audits are enriched with Shield intel for the resolved versions, so a flagged package changes the recommendation before it ships.</p></div>

</div>
<div class="prompt-panel" data-prompt-panel="estate" hidden>
<h3>Your Shield estate <span class="tag shield">Shield login</span></h3>
<div class="prompt"><p>\u201cConnect to my Shield account and tell me what Shield would do for react@18.3.1 on my domains.\u201d</p><p class="why">Simulates the edge pin/block decision under your rules before you ship anything.</p></div>
<div class="prompt"><p>\u201cShow my verified domains and tell me which packages on them have CVEs or malware verdicts, worst first.\u201d</p><p class="why">Your domain inventory annotated server-side: exact-version verdicts and CVEs ranked by your own traffic, so a clean result never comes from the wrong version.</p></div>
<div class="prompt"><p>\u201cShow my Shield watchlist, pins, and blocks.\u201d</p><p class="why">Your monitored packages and edge policies as Shield currently holds them.</p></div>
</div>
</section>

<section id="tools">
<h2>Tools</h2>
<table>
<thead><tr><th>Tool</th><th>Access</th><th>Purpose</th></tr></thead>
<tbody>
<tr><td class="tool">resolve_package</td><td><span class="tag">Anonymous</span></td><td>Resolve exact, tag, or range specs to a real version with browser entry points</td></tr>
<tr><td class="tool">search_packages</td><td><span class="tag">Anonymous</span></td><td>Search npm for a need, annotated with browser readiness</td></tr>
<tr><td class="tool">list_files</td><td><span class="tag">Anonymous</span></td><td>Real file listing for a package version — never guess paths</td></tr>
<tr><td class="tool">build_file_url</td><td><span class="tag">Anonymous</span></td><td>Canonical UNPKG file URL with a deliberate version policy</td></tr>
<tr><td class="tool">audit_dependencies</td><td><span class="tag">Anonymous</span></td><td>Classify a project's dependencies, separating what already loads from UNPKG from what could convert</td></tr>
<tr><td class="tool">verify_url</td><td><span class="tag">Anonymous</span></td><td>Confirm a UNPKG URL resolves before it lands in a project</td></tr>
<tr><td class="tool">generate_importmap</td><td><span class="tag">Anonymous</span></td><td>Ready-to-paste import map from bare specifiers, subpaths resolved</td></tr>
<tr><td class="tool">check_importmap</td><td><span class="tag">Anonymous</span></td><td>Validate a whole import map: resolution, peers, version skew, CJS entries</td></tr>
<tr><td class="tool">estimate_migration_impact</td><td><span class="tag">Anonymous</span></td><td>Range-based bandwidth estimate with explicit assumptions — never a single savings figure</td></tr>
<tr><td class="tool">shield_whoami</td><td><span class="tag shield">Shield login</span></td><td>Your Shield account, organization, and entitlements</td></tr>
<tr><td class="tool">shield_simulate_request</td><td><span class="tag shield">Shield login</span></td><td>Preview Shield's pin/block decision for one package@version under your rules</td></tr>
<tr><td class="tool">shield_check_packages</td><td><span class="tag">Anonymous</span></td><td>Malware verdicts and CVEs for exact package versions you name (login raises the per-call cap)</td></tr>
<tr><td class="tool">shield_domain_packages</td><td><span class="tag shield">Shield login</span></td><td>Packages observed on your verified domains, optionally annotated with malware verdicts and CVEs</td></tr>
<tr><td class="tool">shield_watchlist_status</td><td><span class="tag shield">Shield login</span></td><td>Your monitored packages, blocklist, and pin policies</td></tr>
</tbody>
</table>
<p>Plus three guided prompts (<code>audit_project_for_unpkg</code>, <code>convert_this_page</code>,
<code>find_browser_package</code>) and the conversion playbook resource.</p>
</section>

</div>

<footer class="site"><div class="wrap">
<a href="/playbook.md">Conversion playbook</a>
<a href="https://unpkg.com">unpkg.com</a>
<a href="https://unpkg.com/llms.txt">llms.txt</a>
<a href="https://shield.unpkg.com">UNPKG Shield</a>
</div></footer>

<script>
(function () {
  var origin = location.origin;
  var httpUrl = origin + "/mcp";
  var snippets = {
    "muse": {
      text: '"unpkg": { "url": "' + httpUrl + '" }',
      note: "Merge into mcpServers in ~/.config/muse/settings.json, then start a new muse session. For Shield tools afterwards: muse mcp login unpkg"
    },
    "claude-code": {
      text: "claude mcp add --transport http unpkg " + httpUrl,
      note: "Then start a new session. Use your client's MCP panel to authenticate later if you want the Shield tools."
    },
    "codex": {
      text: "[mcp_servers.unpkg]\\nurl = \\"" + httpUrl + "\\"",
      note: "Add to ~/.codex/config.toml, or: codex mcp add unpkg --url " + httpUrl
    },
    "cursor": {
      text: JSON.stringify({ mcpServers: { unpkg: { url: httpUrl } } }, null, 2),
      note: "Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project)."
    },
    "vscode": {
      text: JSON.stringify({ servers: { unpkg: { url: httpUrl } } }, null, 2),
      note: "Add to .vscode/mcp.json in your workspace."
    },
  };
  var loginSnippets = {
    "claude-code": {
      text: "In a Claude Code session, run:\\n  /mcp\\nThen select unpkg, then Authenticate.",
      note: "There is no terminal login command in Claude Code; authentication happens in the /mcp panel. Disconnect from the same panel."
    },
    "muse": {
      text: "muse mcp login unpkg",
      note: "Disconnect later: muse mcp logout unpkg"
    },
    "codex": {
      text: "codex mcp login unpkg",
      note: "Disconnect later: codex mcp logout unpkg. If your Codex build has no login subcommand, choose Authenticate in its MCP server panel instead."
    },
    "cursor": {
      text: "Cursor Settings > MCP > unpkg > Connect",
      note: "Cursor has no terminal login command; the Connect button opens the browser flow. Disconnect from the same MCP settings panel."
    },
    "vscode": {
      text: "Command Palette > MCP: List Servers > unpkg > Authenticate",
      note: "VS Code has no terminal login command; authenticate from the MCP server list. Disconnect by signing out of the server there."
    },
  };
  var picker = document.getElementById("client-picker");
  function render() {
    var s = snippets[picker.value];
    document.getElementById("snippet").textContent = s.text;
    document.getElementById("snippet-note").textContent = s.note;
  }
  picker.addEventListener("change", render);
  render();
  var loginPicker = document.getElementById("login-picker");
  function renderLogin() {
    var s = loginSnippets[loginPicker.value];
    document.getElementById("login-snippet").textContent = s.text;
    document.getElementById("login-note").textContent = s.note;
  }
  loginPicker.addEventListener("change", renderLogin);
  renderLogin();
  var promptTabs = document.querySelectorAll("[data-prompt-tab]");
  var promptPanels = document.querySelectorAll("[data-prompt-panel]");
  function activatePromptTab(name) {
    promptTabs.forEach(function (tab) {
      var active = tab.getAttribute("data-prompt-tab") === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    promptPanels.forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-prompt-panel") !== name;
    });
  }
  promptTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      activatePromptTab(tab.getAttribute("data-prompt-tab"));
    });
  });
})();
</script>
</body></html>`;
}

/** Self-description in the emerging MCP server-card shape. */
export const SERVER_CARD = {
  name: "unpkg-mcp",
  version: VERSION,
  description:
    "Live npm and UNPKG data for direct UNPKG file lookups: version resolution, file discovery, project conversion audits, import-map validation, and rough impact estimates.",
  homepage: "https://unpkg.com",
  documentation: "https://unpkg.com/llms.txt",
  transport: { type: "streamable-http", endpoint: "/mcp" },
  authentication: {
    type: "optional-oauth2",
    note: "Anonymous free tier needs no login. An approved Shield account may connect via OAuth (see /.well-known/oauth-protected-resource) to unlock the shield_* tools.",
  },
  capabilities: {
    tools: [
      "resolve_package",
      "list_files",
      "build_file_url",
      "search_packages",
      "audit_dependencies",
      "verify_url",
      "generate_importmap",
      "check_importmap",
      "estimate_migration_impact",
      "shield_whoami",
      "shield_simulate_request",
      "shield_check_packages",
      "shield_domain_packages",
      "shield_watchlist_status",
    ],
    prompts: ["audit_project_for_unpkg", "convert_this_page", "find_browser_package"],
    resources: ["unpkg://guidance/conversion-playbook", "unpkg://guidance/version-policy"],
  },
  positioning:
    "Promotes the original UNPKG direct file lookup (unpkg.com/<package>@<version>/<file>). esm.unpkg.com is an opt-in beta fallback only. Recommends against UNPKG when a bundler or framework already owns a dependency.",
};

function clients(env: Env) {
  return {
    npm: new NpmClient(env.NPM_REGISTRY ?? "https://registry.npmjs.org"),
    unpkg: new UnpkgClient(env.UNPKG_ORIGIN ?? "https://unpkg.com"),
    shield: new ShieldClient(env.SHIELD_API_ORIGIN ?? "http://localhost:8000"),
  };
}

function authConfig(env: Env, requestUrl: URL): AuthConfig {
  let issuer = (env.OAUTH_ISSUER ?? env.SHIELD_API_ORIGIN ?? "http://localhost:8000").replace(/\/$/, "");
  return {
    issuer,
    resource: env.OAUTH_RESOURCE ?? `${requestUrl.origin}/mcp`,
    jwksUrl: `${issuer}/v1/oauth/jwks`,
    enabled: env.OAUTH_ENABLED === "true",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, name: "unpkg-mcp", version: VERSION });
    }
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(landingHtml(env.GA_MEASUREMENT_ID), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/robots.txt" && request.method === "GET") {
      return new Response(
        "User-agent: *\nAllow: /\n\nSitemap: https://mcp.unpkg.com/sitemap.xml\n",
        { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } },
      );
    }
    if (url.pathname === "/sitemap.xml" && request.method === "GET") {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://mcp.unpkg.com/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`,
        { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=86400" } },
      );
    }
    if (url.pathname === "/.well-known/mcp.json" && request.method === "GET") {
      return Response.json(SERVER_CARD, { headers: { "Cache-Control": "public, max-age=300" } });
    }
    if (
      (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname === "/.well-known/oauth-protected-resource/mcp") &&
      request.method === "GET"
    ) {
      let config = authConfig(env, url);
      return Response.json(
        {
          resource: config.resource,
          authorization_servers: [config.issuer],
          scopes_supported: ["shield:read", "shield:simulate"],
          bearer_methods_supported: ["header"],
          resource_documentation: "https://unpkg.com/llms.txt",
        },
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    }
    if (url.pathname === "/playbook.md" && request.method === "GET") {
      return new Response(CONVERSION_PLAYBOOK, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    }

    if (url.pathname === "/mcp") {
      // Stateless: a fresh server+transport per request. No session state,
      // no Durable Object, nothing to leak between clients.
      let config = authConfig(env, url);
      let bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;
      // A bad or expired token degrades to anonymous: the free tier must
      // never break because a login went stale. Shield tools re-check.
      let auth = config.enabled && bearer ? await validateToken(bearer, config).catch(() => null) : null;
      let resourceMetadataUrl = `${url.origin}/.well-known/oauth-protected-resource`;
      let server = createServer(clients(env), {
        auth,
        bearer: auth ? bearer : null,
        resourceMetadataUrl,
      });
      let transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      let response = await transport.handleRequest(request);
      response.headers.set("Access-Control-Allow-Origin", "*");
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version");
      if (config.enabled && !auth) {
        response.headers.set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${resourceMetadataUrl}", scope="shield:read shield:simulate"`,
        );
      }
      return response;
    }

    return new Response("Not found", { status: 404 });
  },
};
