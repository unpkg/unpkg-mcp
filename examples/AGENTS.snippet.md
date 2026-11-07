<!-- Paste into your project's AGENTS.md (or CLAUDE.md). Teaches any agent
     the UNPKG direct-lookup rules for this project, MCP or not. -->

## Loading npm packages in the browser (UNPKG)

- Load browser dependencies as direct UNPKG file lookups:
  `https://unpkg.com/<package>@<version-spec>/<file>`. This is the
  original UNPKG behavior; prefer it over transform CDNs. Use
  esm.unpkg.com only when a package has no browser-ready file and the
  user explicitly opts into that beta.
- Never guess versions or file paths. Resolve live: if the UNPKG MCP
  server is connected, use `resolve_package` / `list_files` /
  `build_file_url`; otherwise use `https://unpkg.com/<pkg>@<ver>/?meta`.
- Preserve version intent: exact pins stay exact, ranges stay ranges.
  For new production dependencies, a patch-level specifier (e.g.
  `preact@10.26`) is the default: bug fixes flow, major/minor changes
  stay deliberate.
- Framework projects (Next, Nuxt, SvelteKit, Remix, Astro, Gatsby):
  framework-managed packages stay bundled. UNPKG fits standalone pages,
  widgets, static assets (CSS/fonts/WASM), and embeds — not the
  framework's module graph. If the UNPKG MCP is connected, run
  `audit_dependencies` (it auto-detects the framework) before converting
  anything, validate the result with `check_importmap`, and prove
  execution in a browser before calling it done.
- Do not convert devDependencies, build tools, `@types/*`, or packages
  whose entry points use Node builtins.
- Check safety before adding or upgrading a browser dependency. If the
  UNPKG MCP server is connected, use `shield_check_packages` (or the
  intel attached to `audit_dependencies`) for exact-version malware
  verdicts and CVEs, and prefer the first patched version it names.
  Treat provisional verdicts as unconfirmed, not proven malicious.
- Do not add tracking parameters to UNPKG URLs.
