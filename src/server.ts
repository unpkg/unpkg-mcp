import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.ts";
import { z } from "zod";

import { annotateCurrentUsage, auditDependency, detectFramework, type AuditEntry, type Framework } from "./domain/audit.ts";
import { CONVERSION_PLAYBOOK, VERSION_POLICY } from "./domain/guidance.ts";
import { browserModuleFile, entryPoints, NpmClient, resolveVersion } from "./clients/npm.ts";
import { UnpkgClient } from "./clients/unpkg.ts";
import { estimateMigrationImpact } from "./domain/estimate.ts";
import { checkImportmap, completePeerImports, resolveSubpathFile } from "./domain/importmap.ts";
import { authError, type AuthContext } from "./auth.ts";
import { ShieldClient, ShieldError, shieldErrorMessage } from "./clients/shield.ts";

export interface Clients {
  npm: NpmClient;
  unpkg: UnpkgClient;
  shield?: ShieldClient | null;
}

export interface ServerOptions {
  auth?: AuthContext | null;
  bearer?: string | null;
  resourceMetadataUrl?: string;
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function logTool(
  tool: string,
  started: number,
  ok: boolean,
  extra: Record<string, unknown> = {},
  detail: { args?: unknown; result?: unknown } = {},
) {
  console.log(
    JSON.stringify({
      event: "mcp_tool_call",
      tool,
      ok,
      ms: Math.round(Date.now() - started),
      ...extra,
      ...(detail.args !== undefined ? { args: detail.args } : {}),
      ...(detail.result !== undefined ? { result: detail.result } : {}),
    }),
  );
}

/** Run async work over items with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  let results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      let index = next++;
      results[index] = await run(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** All tools here are read-only and call live public data. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const numRange = z.object({ low: z.number(), high: z.number() });
const OUTPUT = {
  resolve_package: {
    name: z.string(), requested: z.string(), resolvedVersion: z.string(),
    distTags: z.record(z.string(), z.string()), entryPoints: z.object({}).passthrough(),
    peerDependencies: z.record(z.string(), z.string()),
  },
  list_files: {
    package: z.string(), version: z.string(), prefix: z.string(), totalFiles: z.number(),
    truncated: z.boolean(), files: z.array(z.object({}).passthrough()),
  },
  build_file_url: {
    url: z.string(), package: z.string(), specUsed: z.string(), resolvedVersion: z.string(),
    file: z.string(), verifiedFileExists: z.boolean().nullable(),
  },
  audit_dependencies: {
    framework: z.string().nullable(), frameworkNote: z.string().nullable(),
    scopeNote: z.string(), currentStateSummary: z.object({}).passthrough(),
    shieldVerdicts: z.array(z.object({}).passthrough()).nullable(), shieldNote: z.string().nullable(),
    summary: z.object({}).passthrough(), dependencies: z.array(z.object({}).passthrough()),
    importmap: z.object({}).passthrough(), importmapScope: z.string(), peerImportsAdded: z.array(z.string()), peerNotes: z.array(z.string()), mapValidation: z.object({}).passthrough().nullable(), impact: z.object({}).passthrough(), nextSteps: z.string(),
  },
  verify_url: { ok: z.boolean(), status: z.number(), finalUrl: z.string(), contentType: z.string().nullable() },
  generate_importmap: { importmap: z.object({}).passthrough(), resolved: z.record(z.string(), z.string()) },
  check_importmap: {
    ok: z.boolean(), framework: z.string().nullable(),
    entries: z.array(z.object({}).passthrough()), globalIssues: z.array(z.object({}).passthrough()),
  },
  search_packages: {
    query: z.string(),
    results: z.array(z.object({}).passthrough()),
    note: z.string(),
  },
  estimate_migration_impact: {
    monthlyGbOffloaded: numRange, monthlySavingsUsd: numRange.nullable(), perLoadWireBytes: numRange,
    transferTimeEquivalentMs: z.object({}).passthrough(), assumptions: z.array(z.string()),
    caveats: z.array(z.string()), betterMetrics: z.array(z.string()),
  },
};

export function createServer(clients: Clients, options: ServerOptions = {}): McpServer {
  let server = new McpServer(
    { name: "unpkg-mcp", version: VERSION },
    {
      instructions:
        "Live npm and UNPKG data for direct file lookups (https://unpkg.com/<package>@<version>/<file>) — the original UNPKG file serving. Do not suggest esm.unpkg.com by default: it is a beta transform service, appropriate only when a package has no browser-ready file and the user opts in. " +
        "Use resolve_package/list_files instead of guessing versions or paths, build_file_url for canonical URLs, " +
        "Before an audit, scan the project's HTML for existing import maps and CDN URLs (unpkg.com, cdn.jsdelivr.net, esm.sh, plain script tags) and pass them as existingImports — suitability is not usage, and a project may already be converted. Lead audit summaries with current state. " +
        "shield_check_packages works anonymously for package@versions the user names (malware verdicts and CVEs); only domain, watchlist, and simulation tools need Shield login. " +
        "If a shield_* tool returns authorization_required, walk the user through connecting: MCP server must be https://mcp.unpkg.com/mcp, then Authenticate from the client's MCP server panel, sign in at shield.unpkg.com in the browser, Approve, retry. Never present the oauth-protected-resource URL as something the user should open. " +
        "audit_dependencies and check_importmap before converting a project, and estimate_migration_impact for rough bandwidth ranges (never exact savings promises). Recommend against UNPKG when a bundler or framework already owns the dependency. Framework apps (Next, Nuxt, ...) keep framework-managed packages bundled; only standalone browser surfaces convert. Read the conversion playbook resource before a project audit.",
    },
  );

  async function timed<T>(
    tool: string,
    extra: Record<string, number>,
    args: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    let started = Date.now();
    let identity = options.auth
      ? { userId: options.auth.userId, orgId: options.auth.orgId, clientId: options.auth.clientId }
      : {};
    try {
      let result = await run();
      logTool(tool, started, true, { ...extra, ...identity }, {
        args,
        result: (result as { structuredContent?: unknown })?.structuredContent ?? result,
      });
      return result;
    } catch (error) {
      logTool(tool, started, false, { ...extra, ...identity }, { args });
      throw error;
    }
  }

  server.registerTool(
    "resolve_package",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.resolve_package,
      title: "Resolve an npm package version",
      description:
        "Resolve a package name plus exact version, dist-tag, or semver range to the version that exists on npm today, with its browser entry points. Use this instead of recalling versions from memory.",
      inputSchema: {
        package: z.string().describe("npm package name, e.g. react or @scope/name"),
        version: z.string().optional().describe("Exact version, dist-tag, or semver range. Defaults to latest."),
      },
    },
    async ({ package: name, version }) =>
      timed("resolve_package", {}, { package: name, version }, async () => {
        let packument = await clients.npm.getPackument(name);
        if (packument == null) throw new Error(`Package not found on npm: ${name}`);
        let resolved = resolveVersion(packument, version ?? "latest");
        if (resolved == null) throw new Error(`No version of ${name} matches "${version}"`);
        return jsonResult({
          name: resolved.name,
          requested: resolved.requested,
          resolvedVersion: resolved.resolvedVersion,
          distTags: resolved.distTags,
          entryPoints: entryPoints(resolved.manifest),
          peerDependencies: resolved.manifest.peerDependencies ?? {},
        });
      }),
  );

  server.registerTool(
    "list_files",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.list_files,
      title: "List files in a package version",
      description:
        "List the real files inside an exact or resolvable package version via UNPKG ?meta. Use this before choosing a file path; never guess paths.",
      inputSchema: {
        package: z.string(),
        version: z.string().optional().describe("Defaults to latest; resolved before listing."),
        path: z.string().optional().describe("Directory prefix inside the package, e.g. /dist/. Defaults to /."),
        limit: z.number().int().min(1).max(1000).optional().describe("Max files to return. Defaults to 200."),
      },
    },
    async ({ package: name, version, path, limit }) =>
      timed("list_files", {}, { package: name, version, path, limit }, async () => {
        let packument = await clients.npm.getPackument(name);
        if (packument == null) throw new Error(`Package not found on npm: ${name}`);
        let resolved = resolveVersion(packument, version ?? "latest");
        if (resolved == null) throw new Error(`No version of ${name} matches "${version}"`);
        let listing = await clients.unpkg.listFiles(name, resolved.resolvedVersion, path ?? "/");
        if (listing == null) throw new Error(`No files found for ${name}@${resolved.resolvedVersion}${path ?? "/"}`);
        let max = limit ?? 200;
        return jsonResult({
          package: listing.package,
          version: listing.version,
          prefix: listing.prefix,
          totalFiles: listing.files.length,
          truncated: listing.files.length > max,
          files: listing.files.slice(0, max),
        });
      }),
  );

  server.registerTool(
    "build_file_url",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.build_file_url,
      title: "Build a canonical UNPKG file URL",
      description:
        "Build a direct UNPKG file URL (the original file lookup) with a deliberate version policy, verifying the file exists when a path is given.",
      inputSchema: {
        package: z.string(),
        version: z.string().optional().describe("Exact version, dist-tag, or range to resolve. Defaults to latest."),
        file: z.string().optional().describe("File path inside the package. Defaults to the resolved entry point."),
        subpath: z
          .string()
          .optional()
          .describe("Package subpath import, e.g. hooks for preact/hooks. Resolved through the exports map, then file discovery. Ignored when file is given."),
        policy: z
          .enum(["preserve", "exact", "patch", "range"])
          .optional()
          .describe(
            "preserve: keep the given spec (default). exact: resolved version. patch: major.minor (bug fixes flow). range: ^major.minor.patch.",
          ),
      },
    },
    async ({ package: name, version, file, subpath, policy }) =>
      timed("build_file_url", {}, { package: name, version, file, subpath, policy }, async () => {
        let packument = await clients.npm.getPackument(name);
        if (packument == null) throw new Error(`Package not found on npm: ${name}`);
        let spec = version ?? "latest";
        let resolved = resolveVersion(packument, spec);
        if (resolved == null) throw new Error(`No version of ${name} matches "${spec}"`);

        let targetFile = file?.replace(/^\//, "");
        if (targetFile == null && subpath != null) {
          targetFile = await resolveSubpathFile(clients, name, resolved.resolvedVersion, resolved.manifest, subpath);
          if (targetFile == null) {
            throw new Error(`Could not resolve subpath "${subpath}" in ${name}@${resolved.resolvedVersion}; use list_files to find the real path.`);
          }
        }
        targetFile ??= entryPoints(resolved.manifest).file;
        if (targetFile == null) throw new Error(`Cannot determine an entry file for ${name}; pass file explicitly.`);

        let [major, minor] = resolved.resolvedVersion.split(".");
        let specUsed =
          policy === "exact"
            ? resolved.resolvedVersion
            : policy === "patch"
              ? `${major}.${minor}`
              : policy === "range"
                ? `^${resolved.resolvedVersion}`
                : spec;

        let verified: boolean | null = null;
        if (file != null || subpath != null) {
          let dir = targetFile.includes("/") ? targetFile.slice(0, targetFile.lastIndexOf("/")) : "/";
          let listing = await clients.unpkg.listFiles(name, resolved.resolvedVersion, dir).catch(() => null);
          verified = listing != null && listing.files.some((f) => f.path === `/${targetFile}`);
        }

        return jsonResult({
          url: clients.unpkg.fileUrl(name, specUsed, targetFile),
          package: name,
          specUsed,
          resolvedVersion: resolved.resolvedVersion,
          file: targetFile,
          verifiedFileExists: verified,
        });
      }),
  );

  server.registerTool(
    "audit_dependencies",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.audit_dependencies,
      title: "Audit dependencies for UNPKG conversion",
      description:
        "Classify a project's runtime dependencies for conversion to direct UNPKG file lookups, in framework context when given. Read the project's package.json yourself and pass its dependencies map; this tool checks each package against live npm/UNPKG data and returns convert_now / convert_carefully / keep_bundled / needs_review with suggested URLs and an import map for the safe conversions. IMPORTANT: suitability is not usage. Before calling, scan the project's HTML/files for an existing import map and CDN URLs and pass them as existingImports; entries already on UNPKG come back as already_on_unpkg, not conversion candidates. If you did not scan, say so — currentUsage will be absent rather than falsely 'not detected'. Only pass runtime dependencies, never devDependencies.",
      inputSchema: {
        dependencies: z
          .record(z.string(), z.string())
          .describe("Map of package name to the version spec from package.json, e.g. { \"preact\": \"^10.25.4\" }"),
        framework: z
          .enum(["next", "nuxt", "sveltekit", "remix", "astro", "gatsby"])
          .optional()
          .describe(
            "The project's framework, if any. Framework-managed packages (react/react-dom in Next, vue in Nuxt, ...) are classified keep_bundled in context. Auto-detected from the dependency map when omitted.",
          ),
        existingImports: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Existing imports found in the project: bare specifier to current URL, typically an import map extracted from HTML (include subpath keys like preact/hooks). Pass {} if you scanned and found none. Omit only if you did not scan; the result then reports current usage as unknown instead of not detected.",
          ),
      },
    },
    async ({ dependencies, framework: frameworkArg, existingImports }) =>
      timed("audit_dependencies", { dependencies: Object.keys(dependencies).length }, { dependencies, framework: frameworkArg, existingImports }, async () => {
        let framework: Framework | undefined = frameworkArg ?? detectFramework(dependencies);
        // Bounded-parallel: a 26-dependency audit took ~31s sequentially.
        let entries = await mapWithConcurrency(Object.entries(dependencies), 6, async ([name, spec]) => {
          let packument = await clients.npm.getPackument(name).catch(() => null);
          return auditDependency(clients.unpkg, packument, name, spec, framework);
        });
        let usageScanned = existingImports !== undefined;
        if (existingImports !== undefined) annotateCurrentUsage(entries, existingImports);
        let imports: Record<string, string> = {};
        for (let entry of entries) {
          if (entry.classification === "convert_now" && entry.importmapUrl) imports[entry.name] = entry.importmapUrl;
        }
        // Self-validate the composed map before it leaves the tool, so a
        // "suggested" map never arrives unchecked. Framework is NOT passed:
        // the framework verdict lives in the classifications, and in a
        // framework project this map is for standalone surfaces, where a
        // framework-context check would only produce misleading errors.
        let peerCompletion = await completePeerImports(
          clients,
          entries,
          imports,
          Object.fromEntries(entries.map((e) => [e.name, e.requested])),
        );
        let count = (c: string) => entries.filter((e) => e.classification === c).length;
        // Shield enrichment (authenticated only): verdicts for the exact
        // resolved versions, so a recommendation can say "Shield has flagged
        // this one" instead of guessing. Failure leaves the audit untouched.
        let shieldVerdicts: Record<string, unknown>[] | null = null;
        if (clients.shield) {
          let pairs = entries
            .filter((e) => e.resolvedVersion)
            .map((e) => ({ name: e.name, version: e.resolvedVersion! }));
          if (pairs.length > 0) {
            let safety = await packageSafety(pairs, options.auth ? 200 : ANON_SAFETY_CAP).catch(() => null);
            shieldVerdicts = safety ? safety.results.map((r) => ({ ...r })) : null;
          }
        }
        return jsonResult({
          framework: framework ?? null,
          frameworkNote:
            framework != null
              ? `This is a ${framework} project${frameworkArg == null ? " (auto-detected)" : ""}. Framework-managed packages are keep_bundled in context (one runtime copy, framework-tuned builds, SSR/hydration). UNPKG conversion only applies to standalone browser surfaces outside the framework's rendering. Do not put framework packages in an import map. Before closing out, check for UNPKG-fit surfaces this project may still have — plain-HTML/public pages, embedded widgets, docs or share pages, error/maintenance pages, direct CSS/font/WASM assets — and ask the user about them rather than ending at 'convert nothing'.`
              : null,
          summary: {
            total: entries.length,
            convert_now: count("convert_now"),
            convert_carefully: count("convert_carefully"),
            keep_bundled: count("keep_bundled"),
            needs_review: count("needs_review"),
            not_found: count("not_found"),
            already_on_unpkg: count("already_on_unpkg"),
          },
          scopeNote:
            "Suitability is not usage: classifications say whether a package CAN load from UNPKG. currentUsage (present only when existingImports was passed) says whether this project already loads it from UNPKG. Lead your summary with current state when scanned: already-on-UNPKG first, then remaining opportunities. Never present already_on_unpkg entries as things to convert.",
          currentStateSummary: usageScanned
            ? {
                scanned: true,
                alreadyOnUnpkg: entries.filter((e) => e.currentUsage?.status === "already_on_unpkg").length,
                alreadyOnUnpkgEsm: entries.filter((e) => e.currentUsage?.status === "already_on_unpkg_esm").length,
                alreadyOnOtherCdn: entries.filter((e) => e.currentUsage?.status === "already_on_other_cdn").length,
                partiallyOnUnpkg: entries.filter((e) => e.currentUsage?.status === "partially_on_unpkg").length,
                notDetected: entries.filter((e) => e.currentUsage?.status === "not_detected").length,
              }
            : {
                scanned: false,
                note: "No existingImports were passed, so current UNPKG usage is unknown. The caller did not scan the project's HTML/import maps; do not claim the project is or is not already using UNPKG from this audit alone.",
              },
          dependencies: entries,
          importmap: { imports },
          mapValidation:
            Object.keys(imports).length > 0 ? await checkImportmap(clients, imports).catch(() => null) : null,
          peerImportsAdded: peerCompletion.added,
          peerNotes: peerCompletion.notes,
          importmapScope:
            framework != null
              ? "standalone_surfaces_only: this import map is for no-build pages/widgets outside the framework's rendering, never for the framework app itself"
              : "project",
          impact: {
            convertNowEntryBytes: entries
              .filter((e) => e.classification === "convert_now")
              .reduce((sum, e) => sum + (e.entrySizeBytes ?? 0), 0),
            note: "Sum of convert_now entry-file sizes (raw bytes, entry files only; transitive imports excluded). For a bandwidth/cost range, pass this as unpkgBytesPerPageLoad to estimate_migration_impact with the site's monthly page views. Never quote a single dollar or millisecond figure.",
          },
          shieldVerdicts,
          shieldNote:
            "Shield intel for the audited resolved versions is in shieldVerdicts (works anonymously; it covers packages the project names, not account data). Call out any package with a malicious verdict or advisories by name and explain it changes the recommendation for that entry. reviewState 'provisional' is not a confirmed verdict; say so.",
          nextSteps:
            "Open with current state, not candidates: if currentStateSummary.scanned, state plainly how many packages already load from UNPKG (name them), then what remains. If not scanned, say current usage was not checked. Then present the rest grouped by classification. The map below is already system-validated (mapValidation); still verify execution in a browser before calling it done. Apply convert_now entries first, then run the project's tests or open the page. Do not convert keep_bundled or already_on_unpkg entries.",
        });
      }),
  );

  server.registerTool(
    "verify_url",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.verify_url,
      title: "Verify a UNPKG URL resolves",
      description: "Check that a UNPKG file URL actually resolves (follows redirects) before you put it in a project.",
      inputSchema: {
        url: z.string().url().describe("A full https://unpkg.com/... file URL."),
      },
    },
    async ({ url }) =>
      timed("verify_url", {}, { url }, async () => {
        let parsed = new URL(url);
        let allowed = new URL(clients.unpkg.origin).host;
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) URLs can be verified.");
        if (parsed.host !== allowed && parsed.host !== "unpkg.com" && parsed.host !== "esm.unpkg.com") {
          throw new Error(`verify_url only checks UNPKG URLs (got host ${parsed.host}).`);
        }
        return jsonResult(await clients.unpkg.verifyUrl(url));
      }),
  );

  server.registerTool(
    "generate_importmap",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.generate_importmap,
      title: "Generate an import map for UNPKG packages",
      description:
        "Resolve a set of bare specifiers to UNPKG file URLs and return a ready-to-paste import map. Entry files are resolved live from each package.",
      inputSchema: {
        entries: z.array(
          z.object({
            specifier: z.string().describe("Bare specifier used in imports, e.g. preact or preact/hooks"),
            package: z.string(),
            version: z.string().optional(),
            file: z.string().optional().describe("Explicit file; defaults to the package entry point."),
          }),
        ),
      },
    },
    async ({ entries }) =>
      timed("generate_importmap", { entries: entries.length }, { entries }, async () => {
        let imports: Record<string, string> = {};
        let resolvedDetail: Record<string, string> = {};
        for (let entry of entries) {
          let packument = await clients.npm.getPackument(entry.package);
          if (packument == null) throw new Error(`Package not found on npm: ${entry.package}`);
          let resolved = resolveVersion(packument, entry.version ?? "latest");
          if (resolved == null) throw new Error(`No version of ${entry.package} matches "${entry.version}"`);
          let file = entry.file?.replace(/^\//, "");
          if (file == null) {
            let subpath =
              entry.specifier !== entry.package && entry.specifier.startsWith(`${entry.package}/`)
                ? entry.specifier.slice(entry.package.length + 1)
                : null;
            if (subpath != null) {
              file = await resolveSubpathFile(clients, entry.package, resolved.resolvedVersion, resolved.manifest, subpath);
              if (file == null) throw new Error(`Could not resolve subpath "${subpath}" in ${entry.package}; pass file explicitly.`);
            }
          }
          file ??= browserModuleFile(resolved.manifest) ?? entryPoints(resolved.manifest).file;
          if (file == null) throw new Error(`Cannot determine an entry file for ${entry.package}; pass file explicitly.`);
          let spec = entry.version ?? `^${resolved.resolvedVersion}`;
          imports[entry.specifier] = clients.unpkg.fileUrl(entry.package, spec, file);
          resolvedDetail[entry.specifier] = `${entry.package}@${resolved.resolvedVersion}/${file}`;
        }
        return jsonResult({ importmap: { imports }, resolved: resolvedDetail });
      }),
  );

  server.registerTool(
    "check_importmap",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.check_importmap,
      title: "Validate an import map as a system",
      description:
        "Validate an existing or proposed import map: every UNPKG URL resolves, files exist, versions are mutually consistent (including react/react-dom pairing and duplicate-version skew), loose specs are flagged, and framework-managed packages are errors when a framework is given or detected. Run this after generate_importmap or an audit, before committing to a conversion.",
      inputSchema: {
        imports: z.record(z.string(), z.string()).describe("The import map's imports object: bare specifier to URL."),
        framework: z.enum(["next", "nuxt", "sveltekit", "remix", "astro", "gatsby"]).optional(),
      },
    },
    async ({ imports, framework }) =>
      timed("check_importmap", { entries: Object.keys(imports).length }, { imports, framework }, async () =>
        jsonResult(await checkImportmap(clients, imports, framework)),
      ),
  );

  server.registerTool(
    "search_packages",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.search_packages,
      title: "Search npm for browser-suitable packages",
      description:
        "Search npm for a need (e.g. 'date picker', 'markdown parser') and annotate each result with browser readiness for direct UNPKG file lookup: browser-ready ESM, CommonJS-only, or unclear, with the entry file and size when known. Ranking is npm's relevance order; readiness is annotated, never hidden, so a CJS-only result is visible as such rather than silently dropped.",
      inputSchema: {
        query: z.string().describe("What the package should do, e.g. 'confetti', 'sanitize html', 'date picker'."),
        limit: z.number().int().min(1).max(10).optional().describe("Results to annotate. Defaults to 5."),
      },
    },
    async ({ query, limit }) =>
      timed("search_packages", {}, { query, limit }, async () => {
        let found = await clients.npm.search(query, Math.max(limit ?? 5, 5));
        let results = [];
        for (let candidate of found.slice(0, limit ?? 5)) {
          let packument = await clients.npm.getPackument(candidate.name).catch(() => null);
          let resolved = packument ? resolveVersion(packument, candidate.version) : null;
          let manifest = resolved?.manifest;
          let esmFile = manifest ? browserModuleFile(manifest) : undefined;
          let entryFile = esmFile ?? (manifest ? entryPoints(manifest).file : undefined);
          let entrySizeBytes: number | null = null;
          if (resolved != null && entryFile != null) {
            let dir = entryFile.includes("/") ? entryFile.slice(0, entryFile.lastIndexOf("/")) : "/";
            let listing = await clients.unpkg.listFiles(candidate.name, resolved.resolvedVersion, dir).catch(() => null);
            entrySizeBytes = listing?.files.find((f) => f.path === `/${entryFile}`)?.size ?? null;
          }
          results.push({
            name: candidate.name,
            version: resolved?.resolvedVersion ?? candidate.version,
            description: candidate.description ?? null,
            readiness:
              esmFile != null
                ? "browser-ready ESM: suitable for direct UNPKG file lookup"
                : manifest?.type === "module"
                  ? "ESM package: likely suitable, verify the entry file"
                  : "no browser ESM entry found: CommonJS-only or unclear; do not assume it loads in a browser",
            entryFile: entryFile ?? null,
            entrySizeBytes,
            npmUrl: `https://www.npmjs.com/package/${candidate.name}`,
          });
        }
        return jsonResult({
          query,
          results,
          note: "Order is npm search relevance. Readiness is annotated from live package data; verify the winner with build_file_url + verify_url before using it.",
        });
      }),
  );

  server.registerTool(
    "estimate_migration_impact",
    {
      annotations: READ_ONLY,
      outputSchema: OUTPUT.estimate_migration_impact,
      title: "Rough bandwidth/cost impact of a conversion",
      description:
        "Order-of-magnitude estimate of bandwidth offloaded (and hosting dollars, if a $/GB is given) when bytes move from first-party hosting to UNPKG. Range-based with explicit assumptions and caveats; it cannot forecast latency or Core Web Vitals. Get unpkgBytesPerPageLoad from audit_dependencies' impact.convertNowEntryBytes plus any transitive files the caller chooses to include.",
      inputSchema: {
        monthlyPageViews: z.number().positive(),
        unpkgBytesPerPageLoad: z.number().positive().describe("Raw bytes per page load moving to UNPKG."),
        browserCacheRate: z.number().min(0).max(0.95).optional().describe("Share of loads served from browser cache. Default 0.5."),
        bandwidthCostPerGbUsd: z.number().positive().optional().describe("Current hosting $/GB, if known. Omit to skip dollars."),
      },
    },
    async ({ monthlyPageViews, unpkgBytesPerPageLoad, browserCacheRate, bandwidthCostPerGbUsd }) =>
      timed("estimate_migration_impact", {}, { monthlyPageViews, unpkgBytesPerPageLoad, browserCacheRate, bandwidthCostPerGbUsd }, async () =>
        jsonResult(
          estimateMigrationImpact({ monthlyPageViews, unpkgBytesPerPageLoad, browserCacheRate, bandwidthCostPerGbUsd }),
        ),
      ),
  );

  // ---- Shield tier (optional OAuth login; anonymous tier above is unchanged)

  function requireShield(scope: string) {
    if (!options.auth) {
      return authError("authorization_required", options.resourceMetadataUrl ?? "");
    }
    if (!options.auth.scopes.includes(scope)) {
      return authError("insufficient_scope", options.resourceMetadataUrl ?? "");
    }
    if (!clients.shield || !options.bearer) {
      throw new Error("Shield login is not configured on this server.");
    }
    return null;
  }

  async function shieldCall<T>(tool: string, args: unknown, run: (bearer: string | null) => Promise<T>) {
    let started = Date.now();
    try {
      let result = await run(options.bearer ?? null);
      console.log(
        JSON.stringify({
          event: "shield_tool_call",
          tool,
          ok: true,
          ms: Math.round(Date.now() - started),
          userId: options.auth?.userId,
          orgId: options.auth?.orgId,
          clientId: options.auth?.clientId,
          args,
          result,
        }),
      );
      return jsonResult(result);
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "shield_tool_call",
          tool,
          ok: false,
          ms: Math.round(Date.now() - started),
          userId: options.auth?.userId,
          orgId: options.auth?.orgId,
          args,
          error: shieldErrorMessage(error),
          shieldStatus: error instanceof ShieldError ? error.status : null,
        }),
      );
      throw new Error(shieldErrorMessage(error));
    }
  }


  // Package safety for user-supplied package@versions is public intel:
  // it works anonymously and never touches account data. Output is
  // allowlisted — no analysis text, confidence, or signals reach agents.
  const ANON_SAFETY_CAP = 25;

  function curateAnalysis(a: Record<string, unknown>) {
    return {
      package_name: a.package_name,
      new_version: a.new_version,
      verdict: a.verdict ?? null,
      verdict_source: a.verdict_source ?? null,
      review_state: a.review_state ?? null,
    };
  }

  function curateAdvisory(a: Record<string, unknown>) {
    return {
      cve_id: a.cve_id ?? null,
      ghsa_id: a.ghsa_id ?? null,
      severity: a.severity,
      vulnerable_version_range: a.vulnerable_version_range ?? null,
      first_patched_version: a.first_patched_version ?? null,
    };
  }

  async function packageSafety(packages: { name: string; version: string }[], cap: number) {
    let slice = packages.slice(0, cap);
    let analyses = await clients.shield!.publicAnalyses(slice).catch(() => [] as Record<string, unknown>[]);
    let byPair = new Map(analyses.map((a) => [`${String(a.package_name).toLowerCase()}@${a.new_version}`, curateAnalysis(a)]));
    let results = await Promise.all(
      slice.map(async (item) => {
        let advisories = await clients.shield!
          .publicVersionAdvisories(item.name, item.version)
          .catch(() => [] as Record<string, unknown>[]);
        let analysis = byPair.get(`${item.name.toLowerCase()}@${item.version}`);
        return {
          name: item.name,
          version: item.version,
          scanned: analysis !== undefined,
          verdict: analysis?.verdict ?? null,
          verdictSource: analysis?.verdict_source ?? null,
          reviewState: analysis?.review_state ?? null,
          advisories: advisories.map(curateAdvisory),
        };
      }),
    );
    return { results, truncated: packages.length > slice.length, cap };
  }

  server.registerTool(
    "shield_whoami",
    {
      annotations: READ_ONLY,
      title: "Shield account for the logged-in user",
      description:
        "Return the Shield account, organization, and entitlements for the OAuth login on this connection. Requires an approved Shield account; anonymous connections get an authorization_required error with reconnect instructions.",
      inputSchema: {},
    },
    async () => {
      let gate = requireShield("shield:read");
      if (gate) return gate;
      return shieldCall("shield_whoami", {}, (bearer) => clients.shield!.me(bearer!));
    },
  );

  server.registerTool(
    "shield_simulate_request",
    {
      annotations: READ_ONLY,
      title: "Simulate a Shield edge decision",
      description:
        "Preview what Shield would do for one package@version request (optionally with referer/origin) under the logged-in user's effective pin/block rules, using the same rule-matching semantics as the edge.",
      inputSchema: {
        package: z.string(),
        version: z.string(),
        path: z.string().optional(),
        referer: z.string().optional(),
        origin: z.string().optional(),
      },
    },
    async (args) => {
      let gate = requireShield("shield:simulate");
      if (gate) return gate;
      return shieldCall("shield_simulate_request", args, (bearer) => clients.shield!.simulate(bearer!, args));
    },
  );

  server.registerTool(
    "shield_check_packages",
    {
      annotations: READ_ONLY,
      title: "Malware verdicts and CVEs for package versions",
      description:
        "Check exact package@version pairs against Shield intel: malware verdict (with review state) and CVEs affecting that version, including the first patched version. Works anonymously for packages you name (25 per call); Shield login raises the cap to 200. Domain data still requires login. Missing pairs were not scanned yet — absence is not a clean verdict.",
      inputSchema: {
        packages: z.array(z.object({ name: z.string(), version: z.string() })).min(1).max(200),
      },
    },
    async ({ packages }) => {
      return shieldCall("shield_check_packages", { packages }, async () => {
        let cap = options.auth ? 200 : ANON_SAFETY_CAP;
        let { results, truncated } = await packageSafety(packages, cap);
        return {
          count: results.length,
          truncated,
          cap,
          loginRequired: false,
          note: "Verdicts are exact-version. reviewState 'provisional' means not yet confirmed; do not present it as confirmed malicious.",
          results,
        };
      });
    },
  );

  server.registerTool(
    "shield_domain_packages",
    {
      annotations: READ_ONLY,
      title: "Shield-observed packages on your domains",
      description:
        "List the caller's verified domains with package counts, or the packages Shield has observed on one domain. With includeThreats, one domain's packages come back annotated with malware verdicts and CVEs, ranked by the domain's own traffic. Requires Shield login.",
      inputSchema: {
        domain: z.string().optional().describe("One verified domain. Omit to list domains with package counts."),
        includeThreats: z.boolean().optional().describe("Annotate one domain's packages with verdicts and CVEs. Requires domain."),
        days: z.number().int().min(0).max(365).optional().describe("Lookback window for threats mode. Default 30; 0 = all-time."),
      },
    },
    async ({ domain, includeThreats, days }) => {
      let gate = requireShield("shield:read");
      if (gate) return gate;
      return shieldCall("shield_domain_packages", { domain: domain ?? null, includeThreats: includeThreats ?? false }, async (bearer) => {
        if (domain && includeThreats) return clients.shield!.domainThreats(bearer!, domain, days ?? 30);
        if (domain) return clients.shield!.domainPackages(bearer!, domain);
        return { domains: await clients.shield!.domainsSummary(bearer!) };
      });
    },
  );

  server.registerTool(
    "shield_watchlist_status",
    {
      annotations: READ_ONLY,
      title: "Your Shield watchlist, pins, and blocks",
      description:
        "Return the logged-in org's monitored packages, blocklist entries, and pin policies as Shield currently holds them. Requires Shield login.",
      inputSchema: {},
    },
    async () => {
      let gate = requireShield("shield:read");
      if (gate) return gate;
      return shieldCall("shield_watchlist_status", {}, async (bearer) => {
        let [myPackages, blocklist, pinPolicies] = await Promise.all([
          clients.shield!.myPackages(bearer!),
          clients.shield!.blocklist(bearer!),
          clients.shield!.pinPolicies(bearer!),
        ]);
        return {
          monitoredPackages: myPackages.length,
          myPackages,
          blocklistCount: blocklist.length,
          blocklist,
          pinPolicyCount: pinPolicies.length,
          pinPolicies,
        };
      });
    },
  );

  server.registerResource(
    "conversion-playbook",
    "unpkg://guidance/conversion-playbook",
    { title: "UNPKG conversion playbook", description: "How to audit and convert a project to UNPKG file lookups.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: CONVERSION_PLAYBOOK }] }),
  );

  server.registerResource(
    "version-policy",
    "unpkg://guidance/version-policy",
    { title: "UNPKG version specifier policy", description: "Exact vs patch-level vs range specifiers and when to use each.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: VERSION_POLICY }] }),
  );

  server.registerPrompt(
    "audit_project_for_unpkg",
    {
      title: "Audit this project for UNPKG conversion",
      description: "Guided workflow: audit the current project's dependencies and convert the ones that make sense.",
      argsSchema: { apply: z.string().optional().describe("Set to \"yes\" to apply conversions after the audit; otherwise propose first.") },
    },
    async ({ apply }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Audit this project for conversion to direct UNPKG file lookups (https://unpkg.com/<package>@<version>/<file>).\n\n` +
              `1. Read the conversion playbook resource (unpkg://guidance/conversion-playbook).\n` +
              `2. Read package.json and collect runtime dependencies only (never devDependencies). Then scan the project's HTML entry files for CURRENT usage before judging anything: any <script type="importmap">, unpkg.com / cdn.jsdelivr.net / esm.sh / other CDN script or module URLs. Extract specifier -> URL pairs (including subpaths like preact/hooks) as existingImports. If no HTML or import map exists, existingImports is {}.\n` +
              `3. Check for a framework (next, nuxt, @sveltejs/kit, @remix-run/*, astro, gatsby in the dependencies). If present, pass framework to audit_dependencies, and frame the whole audit as standalone surfaces only: framework-managed packages stay bundled, and conversion candidates are only no-build pages, widgets, or snippets outside the framework's rendering.\n` +
              `4. Call audit_dependencies with that dependency map AND existingImports ({} when the scan found none — never omit it after scanning).\n` +
              `5. Open with current state, in this order: (a) what already loads from UNPKG today (already_on_unpkg — name the packages; do not present them as conversions), (b) what is on another CDN, (c) what could convert now, (d) what stays bundled and why. If currentStateSummary.scanned is false, say current usage was not checked instead of implying the project is unconverted.\n` +
              (apply === "yes"
                ? `6. Apply the convert_now entries (import map or script tags), verify each URL with verify_url, then run the project's tests or open the page and confirm it works.\n`
                : `6. Stop after the plan and ask before editing files.\n`) +
              `Do not convert keep_bundled dependencies. Mixed CDN + bundled is the expected outcome.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "convert_this_page",
    {
      title: "Convert this page to UNPKG imports",
      description: "Wire a single no-build HTML page's bare imports to UNPKG, with validation and browser proof.",
      argsSchema: { page: z.string().optional().describe("Path to the HTML file. Defaults to index.html.") },
    },
    async ({ page }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Convert ${page ?? "index.html"} in this project to load its dependencies as direct UNPKG file lookups.\n\n` +
              `1. Read the page and find its module scripts and bare imports (including subpaths like preact/hooks). Check for a package.json too.\n` +
              `2. Resolve every specifier live with generate_importmap (it resolves subpaths); never guess versions or file paths.\n` +
              `3. Validate the map with check_importmap and fix every error it reports.\n` +
              `4. Insert the import map into the page before its module scripts.\n` +
              `5. Prove execution, not just resolution: if the unpkg-mcp repo is available locally, run its scripts/verify-browser.ts with --serve on this project directory (it loads the page in headless Chrome and fails on page errors). Otherwise say plainly that execution is unverified.\n` +
              `Keep the change to the page and the import map; do not restructure the app.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "find_browser_package",
    {
      title: "Find an npm package that works as a browser import",
      description: "Search npm for a need and shortlist packages by browser readiness for direct UNPKG lookup.",
      argsSchema: { need: z.string().describe("What the package should do, e.g. 'a small markdown parser'.") },
    },
    async ({ need }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Find an npm package for this need: ${need ?? "(ask me what I need first)"}.\n\n` +
              `1. Call search_packages with the need and review readiness annotations, not just relevance rank.\n` +
              `2. For the top browser-ready candidate, confirm the entry file with list_files and build a patch-policy URL with build_file_url; verify it resolves.\n` +
              `3. Present a shortlist: the recommended package and URL, any runner-up, and any popular result you are rejecting because it is CommonJS-only or Node-only — saying what you rejected and why is part of the answer.\n` +
              `Do not recommend a package you have not resolved live.`,
          },
        },
      ],
    }),
  );

  return server;
}
