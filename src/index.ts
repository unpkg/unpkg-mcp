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
<a href="/privacy">Privacy</a>
<a href="/terms">Terms</a>
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

function privacyHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Privacy — UNPKG MCP</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Privacy policy for the UNPKG MCP server: data collected, purposes, recipients, retention, and user controls.">
<style>
:root{--ink:#0e1a23;--accent-deep:#264a56;--paper:#fbfaf7;--hairline:#ede7dc;--dark-link:#9cc2cc}
*{box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,sans-serif;background:var(--paper);color:var(--ink);margin:0;line-height:1.65}
a{color:var(--accent-deep)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
.wrap{max-width:62rem;margin:0 auto;padding:0 1.5rem}
header.site{background:var(--ink);color:#fff}
header.site .wrap{display:flex;align-items:center;gap:1rem;padding-top:1rem;padding-bottom:1rem;flex-wrap:wrap}
.wordmark{font-weight:800;letter-spacing:.04em;font-size:1.25rem;color:#fff;text-decoration:none}
.wordmark span{color:var(--dark-link);font-weight:600}
main{padding:2.5rem 0 3rem}
h1{font-size:2.2rem;line-height:1.15;margin:0 0 .5rem;font-weight:800}
h2{font-size:1.35rem;margin:2rem 0 .6rem;font-weight:750}
h3{font-size:1.05rem;margin:1.5rem 0 .5rem}
p,li{max-width:46rem}
.updated{opacity:.75;margin:0 0 1.5rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;margin:1rem 0}
th,td{text-align:left;vertical-align:top;padding:.5rem .6rem;border-bottom:1px solid var(--hairline)}
th{font-weight:700}
td.tool{font-family:ui-monospace,Menlo,monospace;font-size:.82rem;white-space:nowrap}
footer.site{border-top:1px solid var(--hairline);padding:2rem 0 3rem;font-size:.92rem}
footer.site .wrap{display:flex;gap:1.5rem;flex-wrap:wrap}
@media (max-width:720px){td.tool{white-space:normal}}
</style></head>
<body>
<header class="site"><div class="wrap"><a class="wordmark" href="/">UNPKG <span>MCP</span></a></div></header>
<main><div class="wrap">
<h1>Privacy — UNPKG MCP</h1>
<p class="updated">Last updated: November 9, 2026</p>
<p>This policy describes how UNPKG (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, discloses, and retains information when you or your AI agent use the UNPKG MCP server at <code>https://mcp.unpkg.com</code>, including the MCP endpoint <code>/mcp</code> and the website pages on this host (<code>/</code>, <code>/privacy</code>, <code>/terms</code>). It covers every tool the server currently offers, listed in the table below. Sign-in itself happens at UNPKG Shield (<code>shield.unpkg.com</code>); this policy covers how this MCP server handles information before and after that sign-in, including what it sends to Shield. Contact: <a href="mailto:support@unpkg.com">support@unpkg.com</a>.</p>

<h2>1. Data we collect and receive</h2>

<h3>1.1 Tool inputs and outputs (tool-call content)</h3>
<p>When an MCP client calls a tool, we receive that tool&rsquo;s inputs, process them as described in sections 2&ndash;3, and return outputs to your client. We log tool calls as described in section 1.2, and those logs include the inputs and the result returned. The current tools, their inputs, their outputs, and the external services each one contacts are:</p>
<table>
<tr><th>Tool</th><th>Inputs we receive</th><th>Outputs returned to your client</th><th>Sent onward to</th></tr>
<tr><td class="tool">resolve_package</td><td>npm package name; optional version, tag, or range</td><td>Resolved version, dist-tags, entry points, peer dependencies</td><td>npm registry</td></tr>
<tr><td class="tool">list_files</td><td>Package name; optional version, in-package path, result limit</td><td>File paths and sizes in that package version</td><td>npm registry, UNPKG (<code>unpkg.com</code>)</td></tr>
<tr><td class="tool">build_file_url</td><td>Package name; optional version, file path, subpath, version policy</td><td>UNPKG file URL, resolved version, whether the file was verified to exist</td><td>npm registry, UNPKG</td></tr>
<tr><td class="tool">search_packages</td><td>Free-text search query (for example &ldquo;date picker&rdquo;); optional result limit</td><td>Matching packages with browser-readiness notes, entry files, and sizes</td><td>npm registry (search query and package names), UNPKG</td></tr>
<tr><td class="tool">audit_dependencies</td><td>Dependency map from your <code>package.json</code> (package names and version specifiers); optional framework name; optional existing imports found in your project (bare specifier to current URL, typically from an import map in your HTML, which may include third-party CDN URLs)</td><td>Per-dependency classification, suggested UNPKG URLs, a generated import map, validation results, impact figures, and malware/CVE verdicts for the resolved versions</td><td>npm registry, UNPKG, UNPKG Shield API (resolved package names and versions only, for the safety check)</td></tr>
<tr><td class="tool">verify_url</td><td>A UNPKG file URL</td><td>Whether it resolves, HTTP status, final URL, content type</td><td>UNPKG (the URL is requested)</td></tr>
<tr><td class="tool">generate_importmap</td><td>List of entries: bare specifier, package name, optional version and file</td><td>Import map and resolved package versions/files</td><td>npm registry, UNPKG</td></tr>
<tr><td class="tool">check_importmap</td><td>Import map (bare specifier to URL); optional framework name</td><td>Per-entry validation results and issues</td><td>npm registry, UNPKG (URLs in the map are checked)</td></tr>
<tr><td class="tool">estimate_migration_impact</td><td>Monthly page views; bytes per page load; optional browser cache rate; optional bandwidth cost per GB in USD</td><td>Estimated bandwidth and cost ranges, assumptions, and caveats</td><td>No external service; computed on our server (still logged per section 1.2)</td></tr>
<tr><td class="tool">shield_check_packages</td><td>List of exact package name and version pairs. Works anonymously</td><td>Malware verdict and review state, CVE/GHSA identifiers, severity, first patched version</td><td>UNPKG Shield API</td></tr>
<tr><td class="tool">shield_whoami</td><td>No tool inputs. Requires Shield sign-in</td><td>Your Shield account, organization, and entitlements as returned by Shield</td><td>UNPKG Shield API (with your OAuth token, section 1.3)</td></tr>
<tr><td class="tool">shield_simulate_request</td><td>Package name and version; optional in-package path, referer URL, and origin URL. Requires Shield sign-in</td><td>Simulated Shield edge decision for that request under your organization&rsquo;s rules</td><td>UNPKG Shield API (with your OAuth token)</td></tr>
<tr><td class="tool">shield_domain_packages</td><td>Optional domain name verified to your organization; optional threat-annotation flag and lookback days. Requires Shield sign-in</td><td>Your domains and package counts, or packages observed on one of your domains, optionally annotated with verdicts/CVEs and ranked by that domain&rsquo;s traffic</td><td>UNPKG Shield API (with your OAuth token)</td></tr>
<tr><td class="tool">shield_watchlist_status</td><td>No tool inputs. Requires Shield sign-in</td><td>Your organization&rsquo;s monitored packages, blocklist entries, and pin policies</td><td>UNPKG Shield API (with your OAuth token)</td></tr>
</table>
<p>The server also offers three prompts (<code>audit_project_for_unpkg</code>, <code>convert_this_page</code>, <code>find_browser_package</code>) whose arguments are an optional yes/no flag, an HTML file path, and a free-text description of a package need, and two static guidance resources. Prompts and resources return guidance text and make no external requests themselves; any tool calls your agent then makes are covered above.</p>
<p>Tool inputs are chosen by you or your agent and can reveal information about your project and business &mdash; for example your dependency stack, domains, page-view volumes, and hosting costs. The tools never require personal data such as names or email addresses. Do not include passwords, API keys, access tokens, private source code, or other secrets in tool inputs (including in URLs, referers, or search queries); anything included in a tool call is logged as described below. We only ever see the tool calls your agent makes: we do not receive your conversations, prompts, or local files except where you or your agent include their content in a tool call.</p>

<h3>1.2 Tool-call logs and metadata</h3>
<p>For every tool call we write a structured server log entry containing: tool name; success or failure (and an error message on failure); duration in milliseconds; item counts where relevant (for example number of dependencies or import-map entries); the full inputs sent to the tool; and, on success, the full result returned. For Shield tools this means Shield outputs &mdash; including account/organization data, domain package lists, watchlist, blocklist, and pin-policy data returned to you &mdash; also appear in these logs. These logs are emitted to our hosting provider&rsquo;s logging systems (Cloudflare Workers Logs and Logpush; see section 3).</p>

<h3>1.3 Account identifiers and OAuth tokens (Shield sign-in only)</h3>
<ul>
<li>If you sign in with an UNPKG Shield account, we validate the OAuth access token your client presents and record, in the tool-call logs for that connection, your Shield user ID, organization ID, and MCP client ID, so usage can be attributed to your account. We also read the token&rsquo;s granted scopes (<code>shield:read</code>, <code>shield:simulate</code>) to decide which tools may run.</li>
<li>To execute a signed-in Shield tool, we forward your access token to the UNPKG Shield API (<code>shield.unpkg.com</code>) on that request only, so Shield can return data scoped to your own organization. We also fetch Shield&rsquo;s public signing keys (JWKS) to validate tokens; that fetch contains no user data.</li>
<li>Sign-in is handled by Shield. Your password never passes through this MCP server.</li>
</ul>

<h3>1.4 Technical and network data</h3>
<p>Like any web service, our hosting and content-delivery provider (Cloudflare) processes standard request metadata to deliver and protect the service: IP address, user agent, request timestamps, requested URL and method, and response status. This metadata is associated in provider logs with requests to the MCP endpoint and website pages. Anonymous tool calls are not tied to a Shield identity, but they are still processed with this request metadata.</p>

<h3>1.5 Website analytics and cookies</h3>
<p>The website landing page at <code>mcp.unpkg.com/</code> uses Google Analytics, provided by Google. Google Analytics may set first-party cookies (such as <code>_ga</code>) and collect page URL and title, approximate location derived from IP address, device and browser information, referral source, and page-view events, to measure website traffic. Analytics runs only on the landing page. The MCP endpoint (<code>/mcp</code>), this privacy page, and the terms page do not use Google Analytics and do not set cookies. See section 5 for how to opt out.</p>

<h3>What we never collect</h3>
<ul>
<li>Passwords.</li>
<li>OAuth access tokens, refresh tokens, authorization codes, or API keys in logs or storage &mdash; tokens are verified in memory and forwarded to the Shield API per request as described in section 1.3, and are never logged or stored by this MCP server.</li>
<li>Chat conversations, prompts, or local files, other than content you or your agent include in a tool call (section 1.1).</li>
<li>Payment information (we sell nothing through this server), precise location, contacts, or health, financial-account, or other sensitive personal data. No tool asks for any of these.</li>
</ul>

<h2>2. How we use this data (purposes)</h2>
<ul>
<li><strong>Provide the tools.</strong> Tool inputs are used to perform the requested lookups and computations and to return outputs to your MCP client. This includes sending package names, versions, file paths, search queries, URLs, domains, and simulation parameters to the services listed in section 3.</li>
<li><strong>Provide Shield account features.</strong> Account identifiers, scopes, and your forwarded token are used to authenticate signed-in requests and return data scoped to your own organization.</li>
<li><strong>Operate, debug, and secure the service.</strong> Tool-call logs and technical data are used to diagnose errors, prevent abuse and overload, apply rate limits, and keep the service reliable.</li>
<li><strong>Improve the service.</strong> Aggregated and individual tool-call logs are used to understand which tools and packages people use and where tools fail or return poor results, so we can prioritize fixes and features.</li>
<li><strong>Measure website traffic.</strong> Google Analytics data from the landing page is used to understand visits to that page.</li>
</ul>
<p>We do <strong>not</strong> use tool inputs, outputs, or logs to train AI models, for advertising, or to profile individuals or make automated decisions about individuals. We do not combine anonymous tool-call data with other data to identify anonymous users.</p>

<h2>3. Who receives this data (recipients and sharing)</h2>
<ul>
<li><strong>Your MCP client and its AI provider.</strong> Tool outputs are returned to the MCP client/agent you use (for example, OpenAI&rsquo;s ChatGPT when you use this plugin there, or another MCP client). That provider&rsquo;s handling of tool inputs and outputs is governed by its own privacy policy, not this one.</li>
<li><strong>Cloudflare, Inc. (hosting and logs).</strong> The server runs on Cloudflare Workers. Cloudflare processes technical/network data (section 1.4) and stores our tool-call logs (sections 1.1&ndash;1.3) via Workers Logs and Logpush, as our service provider, under Cloudflare&rsquo;s terms and privacy policy.</li>
<li><strong>npm registry (<code>registry.npmjs.org</code>, operated by npm/GitHub).</strong> Receives package names and free-text search queries needed to resolve versions and search. These requests are made server-side from our infrastructure; we do not send npm your IP address, account identifiers, dependency map as a set, domains, or page-view/cost figures. npm&rsquo;s handling is governed by its own privacy policy.</li>
<li><strong>UNPKG (<code>unpkg.com</code>) &mdash; same operator as this server.</strong> Receives package names, versions, and file paths to list and verify files, and the UNPKG URLs you ask us to verify or include in an import map.</li>
<li><strong>UNPKG Shield API (<code>shield.unpkg.com</code>) &mdash; same operator as this server.</strong> Receives exact package name/version pairs for safety checks (including anonymous <code>shield_check_packages</code> calls and the safety check inside <code>audit_dependencies</code>). For signed-in tools it also receives your OAuth access token (per request, section 1.3), domain names, and simulation inputs (package, version, path, referer, origin), and returns your organization&rsquo;s data to us for delivery to your client. Requests identify themselves as MCP traffic via user-agent headers.</li>
<li><strong>Google LLC (Google Analytics) &mdash; landing page only.</strong> Receives the website analytics data described in section 1.5 when a browser loads <code>mcp.unpkg.com/</code>. No MCP tool-call data is sent to Google.</li>
<li><strong>Legal and safety.</strong> We may disclose information if required by law or to protect the rights, safety, and security of UNPKG, our users, or the public.</li>
<li><strong>Business transfers.</strong> If UNPKG is involved in a merger, acquisition, or asset sale, information may be transferred as part of that transaction, subject to this policy.</li>
</ul>
<p>Other than the recipients above, we do not disclose tool-call content, logs, or account identifiers to third parties. We do not sell personal information, and we do not &ldquo;share&rdquo; it for cross-context behavioral advertising (as those terms are used in California law). Shield data returned for one organization is never disclosed to another organization through this server.</p>

<h2>4. Retention</h2>
<ul>
<li><strong>No application database or sessions.</strong> The MCP server is stateless: it keeps no per-user database or session store, and tool inputs and outputs exist in memory only for the duration of each request, apart from the logs below and short-lived caches of public npm package metadata (up to 5 minutes; public data only, no user data).</li>
<li><strong>Tool-call logs</strong> (tool name, timing, inputs, results, and, for signed-in calls, user/organization/client IDs) are retained in our Cloudflare logging systems for up to <strong>90 days</strong>, then deleted or retained only in aggregated form that no longer identifies tool inputs or accounts.</li>
<li><strong>Technical/network logs</strong> held by Cloudflare are retained for up to 90 days in our logging configuration and otherwise in accordance with Cloudflare&rsquo;s retention practices.</li>
<li><strong>Google Analytics data</strong> for the landing page is retained by Google for up to <strong>14 months</strong> under our property&rsquo;s data-retention setting, and otherwise per Google&rsquo;s policies.</li>
<li><strong>Shield account data</strong> (your domains, watchlist, policies, and related records) is held in your Shield account by the Shield service, not stored by this MCP server beyond the tool-call logs above. Deleting or closing a Shield account is handled through Shield.</li>
<li>We may retain specific log records for longer where needed to investigate abuse or a security incident, or to comply with legal obligations.</li>
</ul>

<h2>5. Your choices and controls</h2>
<ul>
<li><strong>Use the server anonymously.</strong> All general tools and anonymous package-safety checks work with no account. Anonymous calls carry no Shield user, organization, or client ID in tool-call logs (technical request metadata still applies, section 1.4).</li>
<li><strong>Control what you send.</strong> You and your agent choose every tool input. You can avoid sending a full dependency map, existing import-map URLs, domains, referer/origin URLs, or page-view/cost figures by not calling the tools that use them, or by omitting optional inputs. Do not send secrets or personal data in tool inputs (section 1.1).</li>
<li><strong>Disconnect Shield.</strong> Disconnect at any time from your MCP client (logout/remove this server) or by revoking the OAuth grant in your Shield account. Revocation stops future signed-in calls; previously written logs are retained per section 4 unless deletion is requested below.</li>
<li><strong>Analytics opt-out.</strong> Google Analytics loads only on the website landing page. You can block it with browser cookie settings or a content blocker, or use Google&rsquo;s Analytics opt-out add-on. Using the MCP endpoint involves no analytics cookies.</li>
<li><strong>Access and deletion.</strong> Email <a href="mailto:support@unpkg.com">support@unpkg.com</a> to request access to or deletion of personal information associated with your Shield account; include your Shield user or organization ID (visible via <code>shield_whoami</code>) so we can locate log records.</li>
</ul>

<h2>6. Security</h2>
<p>Traffic to this server is encrypted in transit (HTTPS). Shield tokens are validated against Shield&rsquo;s published signing keys, held only in memory during a request, forwarded only to the Shield API, and never logged or stored. Shield tools can only return data for the organization identified by the validated token; tenant scoping is enforced by the Shield API. Access to production logs is restricted to personnel who operate the service.</p>

<h2>7. International transfers</h2>
<p>Our providers (including Cloudflare, Google, and npm/GitHub) may process data on servers in the United States and other countries. By using the service, you understand that information may be processed outside your country, where data-protection laws may differ.</p>

<h2>8. Children</h2>
<p>This service is a developer tool and is not directed to children under 13 (or under 16 where that threshold applies). We do not knowingly collect personal information from children.</p>

<h2>9. Changes</h2>
<p>We may update this page as the service evolves, including when tool inputs, outputs, recipients, or retention change. Material changes will be noted by the date above. Continued use after an update takes effect constitutes acceptance of the updated policy.</p>

<h2>10. Contact</h2>
<p>UNPKG &mdash; <a href="mailto:support@unpkg.com">support@unpkg.com</a></p>
</div></main>
<footer class="site"><div class="wrap">
<a href="/">UNPKG MCP</a>
<a href="https://unpkg.com">unpkg.com</a>
<a href="https://shield.unpkg.com">UNPKG Shield</a>
<a href="/terms">Terms</a>
</div></footer>
</body></html>`;
}

function termsHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Terms of Service — UNPKG MCP</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Terms of service for the UNPKG MCP server.">
<style>
:root{--ink:#0e1a23;--accent-deep:#264a56;--paper:#fbfaf7;--hairline:#ede7dc;--dark-link:#9cc2cc}
*{box-sizing:border-box}
body{font-family:ui-sans-serif,system-ui,sans-serif;background:var(--paper);color:var(--ink);margin:0;line-height:1.65}
a{color:var(--accent-deep)}
.wrap{max-width:62rem;margin:0 auto;padding:0 1.5rem}
header.site{background:var(--ink);color:#fff}
header.site .wrap{display:flex;align-items:center;gap:1rem;padding-top:1rem;padding-bottom:1rem;flex-wrap:wrap}
.wordmark{font-weight:800;letter-spacing:.04em;font-size:1.25rem;color:#fff;text-decoration:none}
.wordmark span{color:var(--dark-link);font-weight:600}
main{padding:2.5rem 0 3rem}
h1{font-size:2.2rem;line-height:1.15;margin:0 0 .5rem;font-weight:800}
h2{font-size:1.35rem;margin:2rem 0 .6rem;font-weight:750}
p,li{max-width:46rem}
.updated{opacity:.75;margin:0 0 1.5rem}
footer.site{border-top:1px solid var(--hairline);padding:2rem 0 3rem;font-size:.92rem}
footer.site .wrap{display:flex;gap:1.5rem;flex-wrap:wrap}
</style></head>
<body>
<header class="site"><div class="wrap"><a class="wordmark" href="/">UNPKG <span>MCP</span></a></div></header>
<main><div class="wrap">
<h1>Terms of Service — UNPKG MCP</h1>
<p class="updated">Last updated: November 7, 2026</p>
<p>These terms cover the UNPKG MCP server at <code>https://mcp.unpkg.com</code>, operated by UNPKG ("we", "us"). By connecting a client to the server, you agree to them.</p>

<h2>The service</h2>
<p>The UNPKG MCP server provides AI agents with live npm and UNPKG data: package version and file resolution, project dependency audits, import-map generation and validation, migration estimates, and malware/CVE checks for exact package versions. Most tools are available anonymously, free of charge. Optional tools require signing in with an UNPKG Shield account approved from the beta waitlist.</p>
<p>Package data comes from the npm registry, UNPKG, and third-party malware and vulnerability feeds. We work to keep it accurate and current, but package metadata, verdicts, and estimates are provided for information only. Estimates are ranges based on stated assumptions, not guarantees of bandwidth, cost, or performance outcomes.</p>

<h2>Acceptable use</h2>
<ul>
<li>Do not use the service to disrupt, overload, or probe it beyond ordinary client use, or to attempt to access another organization's Shield data.</li>
<li>Do not misrepresent automated output from the service as independently verified fact where accuracy matters (for example, security or legal decisions) without checking the underlying sources.</li>
<li>Automated use through MCP clients and agents is expected and welcome; we may apply reasonable rate limits to keep the service available to everyone.</li>
</ul>

<h2>Shield accounts</h2>
<p>Shield features are scoped to your own organization. You are responsible for activity under your account and for revoking OAuth grants (from your MCP client or Shield account) when they are no longer needed.</p>

<h2>Availability and changes</h2>
<p>The service is provided "as is" and "as available", without warranties of any kind. We may change, suspend, or discontinue features, and may update these terms; material changes will be noted by the date above. Continued use after a change takes effect constitutes acceptance.</p>

<h2>Liability</h2>
<p>To the maximum extent permitted by law, UNPKG is not liable for indirect, incidental, or consequential damages arising from use of the service or reliance on its output.</p>

<h2>Contact</h2>
<p>UNPKG — <a href="mailto:support@unpkg.com">support@unpkg.com</a></p>
</div></main>
<footer class="site"><div class="wrap">
<a href="/">UNPKG MCP</a>
<a href="https://unpkg.com">unpkg.com</a>
<a href="https://shield.unpkg.com">UNPKG Shield</a>
<a href="/privacy">Privacy</a>
</div></footer>
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
    if (url.pathname === "/privacy" && request.method === "GET") {
      return new Response(privacyHtml(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/terms" && request.method === "GET") {
      return new Response(termsHtml(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
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
  <url>
    <loc>https://mcp.unpkg.com/privacy</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://mcp.unpkg.com/terms</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>
`,
        { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=86400" } },
      );
    }
    if (url.pathname === "/.well-known/openai-apps-challenge" && request.method === "GET") {
      // OpenAI plugin directory domain verification for mcp.unpkg.com.
      return new Response("95BHLv4vv5wvt54s06JwdirJPB9MOZExPUOqIk1pd1M", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
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
