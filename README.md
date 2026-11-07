# unpkg-mcp

[![UNPKG MCP connector – tool definition quality and endpoint health on Glama](https://glama.ai/mcp/connectors/com.unpkg.mcp/unpkg/badges/score.svg)](https://glama.ai/mcp/connectors/com.unpkg.mcp/unpkg)

A remote [MCP](https://modelcontextprotocol.io) server for UNPKG. It gives AI
agents live npm and UNPKG data for direct UNPKG file lookups:
`https://unpkg.com/<package>@<version>/<file>`.

Agents often recall npm details incorrectly — versions that don't exist, file
paths that were never published, Node entry points offered as browser modules.
This server resolves versions, lists real package files, audits projects for
UNPKG conversion, validates import maps, and checks packages for malware and
CVEs, all from live data.

Deployed at `https://mcp.unpkg.com` (landing page at `/`, MCP endpoint at
`/mcp`).

## Tools

| Tool | Purpose |
|---|---|
| `resolve_package` | Resolve an exact version, tag, or range to a real version and its browser entry points |
| `search_packages` | Search npm, with results annotated for browser readiness |
| `list_files` | List the real files in a package version, via the `?meta` API |
| `build_file_url` | Build a canonical file URL with a version policy (`preserve`, `exact`, `patch`, or `range`) |
| `audit_dependencies` | Classify a `package.json` dependency map (`convert_now` / `convert_carefully` / `keep_bundled` / `needs_review` / `not_found`), with suggested URLs, an import map, and framework detection; packages already loading from UNPKG are reported separately from conversion candidates |
| `verify_url` | Check that a UNPKG URL resolves |
| `generate_importmap` | Generate an import map from bare specifiers |
| `check_importmap` | Validate an import map as a whole: resolution, file existence, version consistency, and framework-managed packages |
| `estimate_migration_impact` | Estimate bandwidth offload for a migration as a range with stated assumptions |
| `shield_check_packages` | Malware verdicts and CVEs for exact package versions. Anonymous (25 per call; Shield login raises the limit to 200) |
| `shield_whoami` | *(Shield login)* Account, organization, and entitlements for the connected user |
| `shield_domain_packages` | *(Shield login)* Packages observed on your verified domains, optionally annotated with malware verdicts and CVEs ranked by traffic |
| `shield_simulate_request` | *(Shield login)* Preview Shield's pin/block decision for a package version |
| `shield_watchlist_status` | *(Shield login)* Your monitored packages, blocklist, and pin policies |

## Package safety checks

Every package the server resolves can also be checked against Shield's
security data, in two ways:

- **Named packages.** `shield_check_packages` takes exact
  package@version pairs and returns, for each one, a malware verdict
  with its review state (confirmed or provisional), the CVEs that
  affect that version, and the first patched version to upgrade to.
  Verdicts and CVE matches are computed for the exact version asked
  about — a clean result never comes from checking a different version.
- **Inside audits.** `audit_dependencies` attaches the same verdict and
  CVE data to every version it resolves, so a flagged package is
  visible in the audit result next to its conversion recommendation.

No account is needed for either: named-package checks are anonymous
(25 per call), and audit enrichment works the same signed out. A
provisional verdict is reported as provisional; it is not presented as
confirmed malicious.

With a Shield login, the checks extend to your own estate:
`shield_domain_packages` (with threats enabled) returns the packages
observed on your verified domains annotated with verdicts and CVEs,
ranked by each domain's traffic, so the packages that matter most
surface first.

Example prompts:

- "Is `lodash@4.17.20` safe to load? Check it for malware and CVEs,
  and tell me what to upgrade to."
- "Check the packages in this audit for known compromises or CVEs
  before we convert anything."
- *(Shield login)* "Which packages on my domains have CVEs or malware
  verdicts, worst first?"

### Shield login

The general tools are anonymous. With a Shield account approved from the
beta waitlist, your MCP client can also sign in via OAuth and the
`shield_*` account tools unlock, scoped to your own organization.

Package-safety checks are not login-gated: `shield_check_packages` works
anonymously for packages you name, and `audit_dependencies` includes
verdicts and CVEs either way. Signing in adds your own domains,
watchlist, and edge simulation.

### Prompts, resources, and skill

- Prompts: `audit_project_for_unpkg`, `convert_this_page`,
  `find_browser_package`.
- Resources: the conversion playbook and version-specifier policy
  (`unpkg://guidance/…`), also served at `GET /playbook.md`.
- Skill: `skill/unpkg/SKILL.md` provides the same guidance to agents
  without MCP.

## Connect a client

Clients connect by URL. Per-client configuration is in
[`examples/clients.md`](./examples/clients.md) and in the picker on the
landing page at https://mcp.unpkg.com/.

Claude Code:

```sh
claude mcp add --transport http unpkg https://mcp.unpkg.com/mcp
```

For agents without MCP, copy `skill/unpkg/` into the client's skills
directory. At the project level, you can also paste
[`examples/AGENTS.snippet.md`](./examples/AGENTS.snippet.md) into your
project's `AGENTS.md`.

## Try it out

With an agent connected, some useful prompts:

- "Resolve `react@^18` with the UNPKG MCP — what's the resolved version
  and browser entry point? Now try a version of `react` that doesn't
  exist."
- "List the files in `preact@10.26.4/dist`, build a patch-policy URL
  for the module file, and verify it resolves."
- "Audit this project for UNPKG conversion."
- "Check this import map with the UNPKG MCP: …" (paste a map)
- "Is `lodash@4.17.20` safe to load? Check it for malware and CVEs, and
  tell me what to upgrade to."
- "Based on the audit, estimate the migration impact for a site with
  1M page views a month at $0.09/GB."

The server reports what it can verify and declines what it can't:
import maps are validated as a system, audits keep framework-managed
packages bundled, and estimates come back as ranges with assumptions
rather than a single figure.

## MCP Registry

`server.json` in this repo is the listing manifest for the official
MCP Registry, under the namespace `io.github.unpkg/unpkg-mcp`.

Publishing (maintainers): install the `mcp-publisher` CLI from the
MCP Registry project, then from this repo:

```sh
mcp-publisher login github
mcp-publisher publish
```

Note: the organization namespace requires an owner-level GitHub
credential — the interactive device flow only grants your personal
namespace. Use a classic PAT with `read:org` scope (see the MCP
Registry authentication docs), and revoke it afterwards.

## Releasing

The server is a remote endpoint, so most channels update themselves:
connected clients see new tools as soon as the Worker deploys, Glama
re-crawls this repo and the endpoint, skills.sh serves the skill from
GitHub, and directory listings (awesome lists, mcp.so) are static
entries that only change if the URL or description changes.

For a version release:

1. Bump the version everywhere it appears, keeping all of them equal:
   `package.json`, `src/version.ts`, `server.json`,
   `plugin/.claude-plugin/plugin.json`, and the plugin entry in
   `.claude-plugin/marketplace.json`. (A unit test already fails if
   `package.json` and `src/version.ts` drift.)
2. Deploy the Worker (`wrangler deploy`).
3. Tag the release on GitHub (`vX.Y.Z` with release notes).
4. Republish the registry manifest: `mcp-publisher publish`.
   Downstream directories (PulseMCP, Smithery, and others) ingest
   from the official MCP Registry, so this is the step that updates
   them.
5. If the plugin changed, publish the new plugin version in the
   Claude developer portal; marketplace users get it via
   `claude plugin marketplace update`.

## Claude plugin

This repo is also a Claude Code plugin (and its own plugin marketplace).
The plugin lives in `plugin/` and bundles the MCP server above with the
`unpkg` skill, so one install gives Claude Code both:

```sh
claude plugin marketplace add unpkg/unpkg-mcp
claude plugin install unpkg@unpkg
```

Connecting the plugin is the same anonymous-by-default server at
`https://mcp.unpkg.com/mcp`; Shield tools still sign in only when used.

## Run it locally

```sh
pnpm install
pnpm dev          # HTTP Worker on http://localhost:8787
```

- Landing page: http://localhost:8787/
- Health: http://localhost:8787/health
- MCP endpoint: http://localhost:8787/mcp
- Server card: http://localhost:8787/.well-known/mcp.json

For local client setup, use the same configurations as above with
`http://localhost:8787/mcp` in place of the production URL.

## Develop

```sh
pnpm test         # unit, golden-project, and MCP protocol tests
pnpm typecheck    # tsc --noEmit
pnpm build        # wrangler deploy --dry-run (production bundle check)
```

Layout: `src/clients/` (npm, UNPKG, and Shield API clients),
`src/domain/` (audit, import-map checking, estimation, guidance),
`src/server.ts` (MCP wiring). Golden projects in
`test/fixtures/projects/` pin audit classification behavior.

Environment (`wrangler.jsonc` vars): `UNPKG_ORIGIN`, `NPM_REGISTRY`,
`SHIELD_API_ORIGIN`, `OAUTH_ISSUER`, `OAUTH_RESOURCE`, `OAUTH_ENABLED`.

## Estimating impact

`audit_dependencies` reports entry-file byte totals.
`estimate_migration_impact` turns those, plus a traffic figure, into a
bandwidth-offload range (and a dollar range when a $/GB rate is
supplied). It does not forecast latency: where a site already serves
from a capable CDN, latency is usually unchanged, and the practical
gains are bundle size, cacheability, and how quickly patched versions
reach users.
