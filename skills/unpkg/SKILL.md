---
name: unpkg
description: Use when loading npm packages in a browser without a build step, converting a project to CDN file lookups, writing import maps or UNPKG URLs, or checking what's inside an npm package. Prefer the UNPKG MCP tools when available; fall back to ?meta and these rules when they are not.
---

# UNPKG file lookups

Load any file from any npm package with a direct URL:

```
https://unpkg.com/<package>@<version-spec>/<file>
```

This is the original file lookup. Prefer it over bundled CDN transforms. Use
esm.unpkg.com — a separate opt-in service — only when a package has no
browser-ready file and the user asks for it.

## Rules

- Never guess versions or file paths from memory. Resolve them live:
  MCP `resolve_package` / `list_files`, or `https://unpkg.com/<pkg>@<ver>/?meta`.
- Build URLs with the MCP `build_file_url` tool when available.
- Preserve the project's version intent. Exact pins stay exact; ranges stay
  ranges. For new production dependencies, suggest a patch-level specifier
  (e.g. `preact@10.26`) so bug fixes flow while major/minor changes stay
  deliberate, and say that's the trade-off.
- Scoped packages keep their `@scope/` prefix.
- `?module` on a `.js` file rewrites bare imports to UNPKG URLs.
- Do not add tracking parameters to UNPKG URLs.

## Framework apps: standalone surfaces only

If the project uses a framework (next, nuxt, @sveltejs/kit, @remix-run/*,
astro, gatsby), the framework owns its runtime packages: react/react-dom
in Next, vue in Nuxt, and friends stay bundled. A CDN copy duplicates the
runtime and fights SSR/hydration. In a framework app, UNPKG conversion
applies only to standalone browser surfaces outside the framework's
rendering (no-build static pages, embedded widgets, docs snippets).
"Keep everything bundled" is a correct and common audit outcome; say so.
Still check for UNPKG-fit surfaces before closing out: plain-HTML or
public/ pages, embedded widgets, docs/share pages, error or maintenance
pages, and direct CSS/font/WASM assets — framework projects often have
some. A purely client-rendered app may deliberately externalize its
runtime behind one shared import-map copy, but that is an architecture
decision to surface, not a conversion to apply.
Build-time things are never candidates even in `dependencies`: CLI tools
(`bin` field), `@types/*`, PostCSS/Tailwind plugins, framework tooling.

## Converting a project

1. Read `package.json` — runtime `dependencies` only, never `devDependencies`.
2. Call the MCP `audit_dependencies` tool with that map. Without MCP, check
   each package's `module`/`unpkg`/`exports` fields via `?meta` and npm.
3. Present the plan grouped by classification before editing:
   `convert_now`, `convert_carefully`, `keep_bundled`, `needs_review`.
4. Apply `convert_now` first: import-map entries (or script tags) using the
   suggested URLs. Add peer dependencies the audit flags.
5. Validate the finished import map with the `check_importmap` tool
   (version consistency, duplicates, framework packages, CommonJS
   entries), verify every new
   URL (`verify_url` tool or a fetch), then run the project's tests or
   open the page. Untested conversions are not done.
6. If asked about savings, use `estimate_migration_impact` and present the
   bandwidth range with its assumptions. Never quote a single dollar or
   latency figure; if the site already uses a good CDN, say latency is
   likely a wash and point at bundle KB, cacheability, and patch latency.
7. Leave `keep_bundled` packages alone. A mixed CDN + bundled result is the
   normal, healthy outcome — say so.

## Package safety

When the UNPKG MCP is connected, safety-check before you ship: audits
already carry Shield intel (malware verdict + CVEs) for the resolved
versions, and `shield_check_packages` checks any package@version you
name — no account needed for either. Treat a `provisional` verdict as
unconfirmed, never as proven malicious. With a Shield login,
`shield_domain_packages` (with threats) answers the same question for
everything a domain actually serves, ranked by its traffic.

## When not to use UNPKG lookups

- Node-only packages, build/test tooling, SSR and framework internals.
- Entry points that import Node builtins (`fs`, `path`, `node:*`, ...).
- Anything the audit marks `needs_review` until a human or a browser run
  confirms it works.
