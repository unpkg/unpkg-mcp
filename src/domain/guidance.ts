export const CONVERSION_PLAYBOOK = `# Converting a project to UNPKG file lookups

## Principles

- Prefer the original UNPKG file lookup: \`https://unpkg.com/<package>@<version-spec>/<file>\`.
  Do not route through esm.unpkg.com unless the package has no browser-ready
  file.
- Preserve the project's version intent. Keep exact pins exact and ranges as
  ranges unless the user asks to change policy. For new dependencies, a
  patch-level specifier (e.g. \`preact@10.26\`) is a good production default:
  bug fixes flow automatically while major/minor changes stay deliberate.
- Only runtime browser dependencies are candidates. Never convert
  devDependencies, build tools, test tooling, SSR/framework internals, or
  packages whose entry points use Node.js builtins.
- Trust the audit classifications. \`convert_carefully\` and \`needs_review\`
  mean exactly that — verify in a browser or keep the dependency bundled.

## Current state before candidates

Suitability is not usage. An audit classification says whether a package
CAN load from UNPKG; it does not say whether the project already does.
Before auditing, scan the project's HTML for import maps and CDN URLs
(unpkg.com, cdn.jsdelivr.net, esm.sh, script tags) and pass what you find
as existingImports to audit_dependencies. Entries that already resolve to
unpkg.com come back as already_on_unpkg: name them as already converted,
never as conversion candidates. Lead every audit summary with current
state — already on UNPKG, then on another CDN, then convertible, then
stays bundled. If you did not scan, say current usage is unchecked rather
than implying the project is unconverted.

## Framework apps: standalone surfaces only

If the project uses a framework (next, nuxt, @sveltejs/kit, @remix-run/*,
astro, gatsby among its dependencies), the framework owns its runtime
packages. React in Next, Vue in Nuxt, and friends must stay bundled: the
framework renders with its own copies, and a CDN copy duplicates the
runtime and fights SSR/hydration. Pass the framework option to
audit_dependencies (it also auto-detects) so those packages are
classified in context.

Why the rule exists: a framework renders with exactly one copy of its
runtime. A second copy loaded from a CDN breaks hooks/context (two
Reacts), and frameworks often ship tuned runtime builds (Next pins a
specific React) that a stock CDN copy does not match; SSR/hydration then
fights the duplicate. This is about placement, not capability — UNPKG
serves those files fine.

For a framework app, UNPKG conversion applies only to standalone browser
surfaces outside the framework's rendering: a no-build static page, an
embedded widget, a docs snippet, a marketing island served as plain HTML.
"Keep everything bundled" is the correct recommendation for the framework
app itself; say so plainly instead of forcing conversions.

But do not stop there — framework projects usually still have UNPKG-fit
surfaces, and naming them is how an audit stays useful instead of ending
at "no": plain-HTML pages shipped outside the render pipeline (public/
assets, standalone landing or campaign pages), embedded widgets and
third-party embeds, docs and share/preview pages, error or maintenance
pages the framework does not render, and static assets (CSS, fonts,
WASM) referenced directly. Ask which of these the project has, or look
for them, before closing out a framework audit.

Deliberate exception, never a casual suggestion: a purely
client-rendered app (or micro-frontend portal) whose team externalizes
the framework runtime on purpose — one shared copy via an import map,
versions pinned — has re-architected ownership away from the framework.
That can work, with single-instance discipline as the price and
tree-shaking/code-splitting granularity as the trade. Surface it as an
architecture decision for the user to make, not as an audit conversion.

Build-time things are never candidates even when they sit in
dependencies: CLI tools (anything with a bin field), types-only
packages (@types/*), PostCSS/Tailwind plugins, and framework tooling.

## Package safety

Safety-check before you ship anything. Audits already carry Shield
intel (malware verdict + CVEs, exact-version) for every resolved
version — read it and call out flagged packages by name. For any single
package@version, \`shield_check_packages\` answers directly: malware
verdict with review state, CVEs affecting that version, and the first
patched version to upgrade to. Neither needs an account for packages
you name. Treat a \`provisional\` verdict as unconfirmed, never as proven
malicious; a \`confirmed\` or intel-sourced malicious verdict means do
not ship that version — recommend the patched release instead. With a
Shield login, \`shield_domain_packages\` (threats on) answers the same
question across everything a domain serves, ranked by traffic.

## Audit workflow

1. Read the project's package.json (runtime dependencies only), existing
   import maps, HTML entry files, and bundler config.
2. Call \`audit_dependencies\` with the dependency name/spec map, and
   read the Shield intel attached to it before recommending conversions.
3. Present the plan grouped by classification before editing, unless the
   user asked you to apply changes directly.
4. For \`convert_now\` entries, add import-map entries (or script tags for
   classic scripts) using the suggested URLs. If an entry lists bare
   imports in its reasons, its suggested URL already uses ?module to
   rewrite them (or names the peers to map); a plain file URL whose entry
   imports unmapped bare specifiers will not execute standalone.
5. Remove converted packages from the bundle only when the bundler setup
   makes that clean (externalize or remove the import); otherwise leave the
   dependency installed and note it.
6. Verify: call \`verify_url\` for each new URL and validate the map with
   check_importmap, then prove execution in a real browser where
   possible: the repo's scripts/verify-browser.ts loads the map in
   headless Chrome and reports which specifiers actually import. A URL
   returning 200 is resolution, not execution. Then run the project's
   own tests or open the page. A converted app that was not run is not
   done.

## URL rules

- Canonical form: \`https://unpkg.com/<name>@<spec>/<file>\` — scoped names
  keep their \`@scope/\` prefix.
- Use \`build_file_url\` rather than hand-assembling URLs when a file path
  or version policy matters; use \`list_files\` before guessing file paths.
- \`?module\` on a .js file rewrites its bare imports to UNPKG URLs. It is
  part of the direct file lookup, not a separate service.
- \`?meta\` on any package or directory URL returns JSON file metadata.

## What not to do

- Do not guess versions or file paths from memory; resolve them live.
- Do not convert every dependency. A mixed result (some CDN, some bundled)
  is the normal, healthy outcome.
- Do not add tracking parameters to UNPKG URLs.
`;

export const VERSION_POLICY = `# UNPKG version specifier policy

- Exact (\`preact@10.26.4\`): permanent, best cache behavior, updates are deliberate.
- Patch-level (\`preact@10.26\`): bug fixes within a release line flow automatically. Recommended default for new production dependencies.
- Minor range (\`preact@^10.26.4\` / \`preact@10\`): feature updates flow automatically; redirects to the resolved version.
- Dist-tag (\`preact@latest\`): always newest; use for experiments, not stable pages.

UNPKG redirects range/tag URLs to the resolved exact-version URL, so the
response a browser caches is always permanent. The security side of letting
versions move is covered by UNPKG Shield for armed domains; mention it when
a user hesitates about non-exact specifiers, without overselling it.
`;
