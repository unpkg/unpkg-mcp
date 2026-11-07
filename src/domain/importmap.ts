import { browserModuleFile, entryPoints, resolveExportsSubpath, resolveVersion, type PackageManifest } from "../clients/npm.ts";
import type { Clients } from "../server.ts";
import { detectFramework, extractBareImports, isFrameworkManaged, packageNameOf, type AuditEntry, type Framework } from "./audit.ts";

export interface ImportmapEntryReport {
  specifier: string;
  url: string;
  package: string | null;
  spec: string | null;
  resolvedVersion: string | null;
  file: string | null;
  fileExists: boolean | null;
  issues: { level: "error" | "warning"; message: string }[];
}

export interface ImportmapReport {
  ok: boolean;
  framework: Framework | null;
  entries: ImportmapEntryReport[];
  globalIssues: { level: "error" | "warning"; message: string }[];
}

/** Parse an UNPKG file URL into package/spec/file. Returns null if not parseable. */
export function parseUnpkgFileUrl(url: string): { name: string; spec: string | null; file: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  let segments = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) return null;

  let nameSegments = segments[0].startsWith("@") ? 2 : 1;
  if (segments.length <= nameSegments) return null;
  let namePart = segments.slice(0, nameSegments).join("/");
  let rest = segments.slice(nameSegments);

  // name may carry @spec on its last segment: react@18.3.1 or @scope/react@^1
  let at = namePart.lastIndexOf("@");
  let name = at > 0 ? namePart.slice(0, at) : namePart;
  let spec = at > 0 ? namePart.slice(at + 1) : null;
  return { name, spec, file: rest.join("/") };
}

/**
 * Validate an existing or proposed import map as a system: every URL
 * resolves, files exist, versions are mutually consistent, and no
 * framework-managed package sneaks in. This is the check to run AFTER
 * generate_importmap/audit and BEFORE committing to a conversion.
 */
export async function checkImportmap(
  clients: Clients,
  imports: Record<string, string>,
  frameworkArg?: Framework,
): Promise<ImportmapReport> {
  // Detect from the packages the URLs actually name (specifiers lie:
  // "preact/hooks" is still preact).
  let preParsed = Object.values(imports).map((u) => parseUnpkgFileUrl(u)?.name).filter((n): n is string => n != null);
  let framework =
    frameworkArg ?? detectFramework(Object.fromEntries(preParsed.map((n) => [n, ""]))) ?? null;
  let entries: ImportmapEntryReport[] = [];
  let byPackage = new Map<string, Set<string>>();
  let mappedPackages = new Set(
    Object.values(imports).map((u) => parseUnpkgFileUrl(u)?.name).filter((n): n is string => n != null),
  );

  for (let [specifier, url] of Object.entries(imports)) {
    let report: ImportmapEntryReport = {
      specifier,
      url,
      package: null,
      spec: null,
      resolvedVersion: null,
      file: null,
      fileExists: null,
      issues: [],
    };
    entries.push(report);

    let host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "";
      }
    })();
    let expectedHost = new URL(clients.unpkg.origin).host;
    if (host === "esm.unpkg.com") {
      report.issues.push({
        level: "warning",
        message:
          "esm.unpkg.com is the beta transform service, not the direct UNPKG file lookup. Prefer a direct unpkg.com file URL; keep esm only when the package has no browser-ready file and the user has opted into the beta.",
      });
    }
    if (host !== expectedHost && host !== "unpkg.com" && host !== "esm.unpkg.com") {
      report.issues.push({ level: "warning", message: `Not an UNPKG URL (host ${host || "?"}); left unverified.` });
      continue;
    }

    let parsedUrl = parseUnpkgFileUrl(url);
    if (parsedUrl == null) {
      report.issues.push({ level: "error", message: "Could not parse this as an UNPKG package file URL." });
      continue;
    }
    report.package = parsedUrl.name;
    report.spec = parsedUrl.spec;
    report.file = parsedUrl.file;

    if (framework != null && isFrameworkManaged(framework, parsedUrl.name)) {
      report.issues.push({
        level: "error",
        message: `${parsedUrl.name} is managed by ${framework}; an import-map copy duplicates the framework runtime. Remove it.`,
      });
    }
    if (parsedUrl.spec == null || parsedUrl.spec === "latest") {
      report.issues.push({
        level: "warning",
        message: "Loose spec (latest/implicit): every load takes the newest release. Prefer a patch-level spec for production.",
      });
    }

    let packument = await clients.npm.getPackument(parsedUrl.name).catch(() => null);
    if (packument == null) {
      report.issues.push({ level: "error", message: `Package not found on npm: ${parsedUrl.name}` });
      continue;
    }
    let resolved = resolveVersion(packument, parsedUrl.spec ?? "latest");
    if (resolved == null) {
      report.issues.push({ level: "error", message: `No version of ${parsedUrl.name} matches "${parsedUrl.spec}".` });
      continue;
    }
    report.resolvedVersion = resolved.resolvedVersion;
    if (!byPackage.has(parsedUrl.name)) byPackage.set(parsedUrl.name, new Set());
    byPackage.get(parsedUrl.name)!.add(resolved.resolvedVersion);

    let dir = parsedUrl.file.includes("/") ? parsedUrl.file.slice(0, parsedUrl.file.lastIndexOf("/")) : "/";
    let listing = await clients.unpkg.listFiles(parsedUrl.name, resolved.resolvedVersion, dir).catch(() => null);
    report.fileExists = listing != null && listing.files.some((f) => f.path === `/${parsedUrl.file}`);
    if (!report.fileExists) {
      report.issues.push({ level: "error", message: `File ${parsedUrl.file} does not exist in ${parsedUrl.name}@${resolved.resolvedVersion}.` });
      continue;
    }

    let verify = await clients.unpkg.verifyUrl(url).catch(() => null);
    if (verify == null || !verify.ok) {
      report.issues.push({ level: "error", message: `URL does not resolve (status ${verify?.status ?? "unknown"}).` });
    }

    // A 200 is not executability: if the file imports bare specifiers
    // that no map entry provides (and this URL is not the ?module form,
    // which rewrites them), the browser will fail at import time. A
    // CommonJS file fails earlier still: it has no ESM exports at all.
    if (!url.includes("?module")) {
      let text = await clients.unpkg.fetchText(parsedUrl.name, resolved.resolvedVersion, parsedUrl.file).catch(() => null);
      if (text != null && /\bmodule\.exports\b/.test(text) && !/(?:^|\n|;)\s*(?:import[\s({*]|export\s)/.test(text)) {
        report.issues.push({
          level: "error",
          message:
            "This file looks like CommonJS (module.exports, no ESM exports): importing it as an ES module will fail in a browser even though it resolves. Use a browser ESM build, a UMD global, or the esm transform with the user's opt-in.",
        });
      }
      if (text != null) {
        for (let bare of extractBareImports(text)) {
          let pkg = packageNameOf(bare);
          if (pkg !== parsedUrl.name && !mappedPackages.has(pkg)) {
            report.issues.push({
              level: "warning",
              message: `Entry imports "${bare}", which no entry in this map provides. Add a "${bare}" entry or use the ?module form of this URL.`,
            });
          }
        }
      }
    }
  }

  let globalIssues: ImportmapReport["globalIssues"] = [];
  for (let [name, versions] of byPackage) {
    if (versions.size > 1) {
      globalIssues.push({
        level: "warning",
        message: `${name} resolves to multiple versions across the map (${[...versions].join(", ")}): expect duplicate code and possible runtime skew. Align the specs.`,
      });
    }
  }
  let react = entries.find((e) => e.package === "react");
  let reactDom = entries.find((e) => e.package === "react-dom");
  if (react?.resolvedVersion && reactDom?.resolvedVersion && react.resolvedVersion !== reactDom.resolvedVersion) {
    globalIssues.push({
      level: "error",
      message: `react@${react.resolvedVersion} and react-dom@${reactDom.resolvedVersion} must be identical versions. Align them.`,
    });
  }

  let ok = ![...entries.flatMap((e) => e.issues), ...globalIssues].some((i) => i.level === "error");
  return { ok, framework, entries, globalIssues };
}

/**
 * Auto-include resolvable peer entries in an audit-composed import map.
 * A convert_now entry whose file imports only its peers (react, say) is
 * not standalone-usable until those specifiers are mapped too; agents
 * kept dropping them when composing maps by hand. Only root specifiers
 * are completed; subpath peers are returned as notes for a human/agent
 * to place deliberately.
 */
export async function completePeerImports(
  clients: Clients,
  entries: AuditEntry[],
  imports: Record<string, string>,
  projectSpecs: Record<string, string> = {},
): Promise<{ added: string[]; notes: string[] }> {
  let added: string[] = [];
  let notes: string[] = [];
  for (let entry of entries) {
    if (entry.classification !== "convert_now") continue;
    for (let bare of entry.bareImports) {
      let pkg = packageNameOf(bare);
      // Prefer the project's own spec for this package over the peer
      // range: peers often say "*" while the project runs a specific
      // major, and the map must match the project's runtime.
      let spec = projectSpecs[pkg] ?? entry.peerDependencies[bare] ?? entry.peerDependencies[pkg];
      if (spec == null) continue; // not a peer: already handled via ?module
      if (bare !== pkg) {
        notes.push(`${entry.name} imports peer subpath "${bare}"; add an entry for it deliberately (not auto-completed).`);
        continue;
      }
      if (imports[bare] != null) continue;
      let packument = await clients.npm.getPackument(pkg).catch(() => null);
      if (packument == null) continue;
      let resolved = resolveVersion(packument, spec);
      if (resolved == null) continue;
      let esmFile = browserModuleFile(resolved.manifest);
      let file = esmFile ?? entryPoints(resolved.manifest).file;
      if (file == null) continue;
      if (esmFile == null && resolved.manifest.type !== "module" && !file.endsWith(".mjs")) {
        // Resolving is not executing: a CommonJS peer entry mapped into
        // an import map will fail in the browser. Say so instead of
        // emitting a URL that only passes a 200 check.
        notes.push(
          `Peer "${bare}" (${pkg}@${resolved.resolvedVersion}) has no browser ESM entry (only ${file}); not auto-mapped. For a standalone page, load its UMD build as a classic script/global if it ships one, or use the esm transform with the user's explicit opt-in.`,
        );
        continue;
      }
      imports[bare] = clients.unpkg.fileUrl(pkg, spec, file);
      added.push(`${bare}@${resolved.resolvedVersion} (peer of ${entry.name})`);
    }
  }
  return { added, notes };
}

/**
 * Resolve a subpath import (preact/hooks, htm/preact) to an actual file:
 * exports map first, then extension/directory discovery via file
 * listings. Returns undefined when nothing plausible exists.
 */
export async function resolveSubpathFile(
  clients: Clients,
  name: string,
  version: string,
  manifest: PackageManifest,
  subpath: string,
): Promise<string | undefined> {
  let clean = subpath.replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
  if (/\.(?:m?js|cjs|css|json|wasm)$/.test(clean)) return clean;

  let fromExports = resolveExportsSubpath(manifest.exports, clean);
  if (fromExports) return fromExports;

  let candidates = [
    `/${clean}.js`,
    `/${clean}.mjs`,
    `/${clean}.module.js`,
    `/${clean}/index.js`,
    `/${clean}/index.mjs`,
    `/${clean}/index.module.js`,
  ];
  let parent = clean.includes("/") ? clean.slice(0, clean.lastIndexOf("/")) : "/";
  for (let prefix of [parent, `/${clean}`]) {
    let listing = await clients.unpkg.listFiles(name, version, prefix).catch(() => null);
    if (listing == null) continue;
    let found = listing.files.find((f) => candidates.includes(f.path));
    if (found) return found.path.replace(/^\//, "");
  }
  return undefined;
}
