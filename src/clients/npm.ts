import semver from "semver";

export interface PackageManifest {
  name: string;
  version: string;
  type?: string;
  main?: string;
  module?: string;
  unpkg?: string;
  browser?: string | Record<string, string | false>;
  types?: string;
  sideEffects?: boolean | string[];
  bin?: string | Record<string, string>;
  engines?: Record<string, string>;
  keywords?: string[];
  exports?: unknown;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface Packument {
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, PackageManifest>;
  time?: Record<string, string>;
}

export class NpmClient {
  constructor(
    private registry: string,
    private fetchFn: typeof fetch = ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args)) as typeof fetch,
  ) {}

  async search(text: string, size = 10): Promise<NpmSearchResult[]> {
    let url = `${this.registry}/-/v1/search?text=${encodeURIComponent(text)}&size=${size}`;
    let response = await this.fetchFn(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`npm search returned ${response.status}`);
    let data = (await response.json()) as { objects?: { package?: NpmSearchResult }[] };
    return (data.objects ?? []).map((o) => o.package).filter((pkg): pkg is NpmSearchResult => pkg != null);
  }

  async getPackument(name: string): Promise<Packument | null> {
    let url = `${this.registry}/${name.replace("/", "%2F")}`;
    // Packuments are large and audits touch many packages. Cache them in
    // the Workers Cache API for 5 minutes (new publishes can lag by that
    // much; acceptable for audits, and resolve hot paths stay fast). Only
    // available under workerd; tests and local Bun skip the cache.
    let cache = (globalThis as { caches?: CacheStorage }).caches?.default as Cache | undefined;
    if (cache != null) {
      let hit = await cache.match(url).catch(() => undefined);
      if (hit != null) return (await hit.json()) as Packument;
    }
    // Full packument, not the abbreviated install-v1 form: the abbreviated
    // document strips main/module/unpkg/exports, which entry-point
    // resolution depends on.
    let response = await this.fetchFn(url, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`npm registry returned ${response.status} for ${name}`);
    let text = await response.text();
    if (cache != null) {
      await cache
        .put(
          url,
          new Response(text, {
            headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
          }),
        )
        .catch(() => {});
    }
    return JSON.parse(text) as Packument;
  }
}

export interface NpmSearchResult {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
}

export interface ResolvedPackage {
  name: string;
  requested: string;
  resolvedVersion: string;
  manifest: PackageManifest;
  distTags: Record<string, string>;
}

/** Resolve an exact version, dist-tag, or semver range against a packument. */
export function resolveVersion(packument: Packument, spec: string): ResolvedPackage | null {
  let requested = spec.trim() === "" ? "latest" : spec.trim();
  let version: string | null = null;

  if (packument.versions[requested]) {
    version = requested;
  } else if (packument["dist-tags"][requested]) {
    version = packument["dist-tags"][requested];
  } else {
    let all = Object.keys(packument.versions).filter((v) => semver.valid(v));
    version = semver.maxSatisfying(all, requested, { includePrerelease: false });
  }

  if (version == null || packument.versions[version] == null) return null;
  return {
    name: packument.name,
    requested,
    resolvedVersion: version,
    manifest: packument.versions[version],
    distTags: packument["dist-tags"],
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (let value of values) {
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

/** Walk an `exports` value for the package root under browser-ish conditions. */
export function resolveExportsRoot(exportsField: unknown): string | undefined {
  if (typeof exportsField === "string") return exportsField;
  if (exportsField == null || typeof exportsField !== "object") return undefined;

  let record = exportsField as Record<string, unknown>;
  // Root entry is either "." or the object itself is a conditions map.
  let root: unknown = "." in record ? record["."] : record;
  let conditions = ["browser", "import", "module", "unpkg", "default", "require", "node"];

  function walk(node: unknown): string | undefined {
    if (typeof node === "string") return node;
    if (node == null || typeof node !== "object" || Array.isArray(node)) return undefined;
    let entries = node as Record<string, unknown>;
    for (let condition of conditions) {
      if (condition in entries) {
        let found = walk(entries[condition]);
        if (found) return found;
      }
    }
    return undefined;
  }

  return walk(root);
}

function walkConditions(node: unknown): string | undefined {
  if (typeof node === "string") return node;
  if (node == null || typeof node !== "object" || Array.isArray(node)) return undefined;
  let entries = node as Record<string, unknown>;
  for (let condition of ["browser", "import", "module", "unpkg", "default", "require"]) {
    if (condition in entries) {
      let found = walkConditions(entries[condition]);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Resolve a package subpath ("hooks", "preact", "features/x") through the
 * `exports` map, including simple "*" wildcards. Returns the package-relative
 * file path or undefined when the map does not expose that subpath.
 */
export function resolveExportsSubpath(exportsField: unknown, subpath: string): string | undefined {
  if (exportsField == null || typeof exportsField !== "object") return undefined;
  let record = exportsField as Record<string, unknown>;
  let clean = subpath.replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
  let key = `./${clean}`;

  if (key in record) {
    return walkConditions(record[key])?.replace(/^\.\//, "");
  }
  for (let [pattern, target] of Object.entries(record)) {
    let star = pattern.indexOf("*");
    if (star < 0) continue;
    let prefix = pattern.slice(0, star);
    let suffix = pattern.slice(star + 1);
    if (key.startsWith(prefix) && key.endsWith(suffix)) {
      let captured = key.slice(prefix.length, key.length - suffix.length);
      let resolved = walkConditions(target);
      if (resolved) return resolved.replace("*", captured).replace(/^\.\//, "");
    }
  }
  return undefined;
}

/** The file an `exports` map offers specifically to ESM importers, if any. */
export function exportsImportFile(exportsField: unknown): string | undefined {
  if (exportsField == null || typeof exportsField !== "object") return undefined;
  let record = exportsField as Record<string, unknown>;
  let root: unknown = "." in record ? record["."] : record;
  function walk(node: unknown): string | undefined {
    if (typeof node === "string") return undefined; // plain string = format-agnostic, not proof of ESM
    if (node == null || typeof node !== "object" || Array.isArray(node)) return undefined;
    let entries = node as Record<string, unknown>;
    for (let condition of ["import", "module"]) {
      if (condition in entries) {
        let value = entries[condition];
        if (typeof value === "string") return value;
        let found = walk(value);
        if (found) return found;
      }
    }
    return undefined;
  }
  return walk(root)?.replace(/^\.\//, "");
}

/**
 * The file to use in an import map: a real ES module when the package has
 * one. The package-root default (entryPoints) often names a UMD build via
 * the unpkg field, which is fine as a classic script but wrong to import.
 * An `exports` map alone is not proof of ESM: it may only offer `require`.
 */
export function browserModuleFile(manifest: PackageManifest): string | undefined {
  if (typeof manifest.module === "string" && manifest.module !== "") {
    return manifest.module.replace(/^\.\//, "");
  }
  let imported = exportsImportFile(manifest.exports);
  if (imported) return imported;
  let entry = entryPoints(manifest);
  if (entry.file?.endsWith(".mjs")) return entry.file;
  return undefined;
}

export interface EntryPoints {
  /** Path UNPKG would serve for the package root, if determinable. */
  file?: string;
  via?: "unpkg" | "module" | "exports" | "main" | "browser";
  main?: string;
  module?: string;
  unpkg?: string;
  browser?: string;
  types?: string;
  hasExports: boolean;
}

/** Best-effort browser entry point, mirroring UNPKG's resolution order. */
export function entryPoints(manifest: PackageManifest): EntryPoints {
  let exportsFile = resolveExportsRoot(manifest.exports);
  let browser = typeof manifest.browser === "string" ? manifest.browser : undefined;
  let unpkgField = firstString(manifest.unpkg);
  let moduleField = firstString(manifest.module);
  let mainField = firstString(manifest.main) ?? "index.js";

  let file: string | undefined;
  let via: EntryPoints["via"];
  if (unpkgField) {
    file = unpkgField;
    via = "unpkg";
  } else if (exportsFile) {
    file = exportsFile;
    via = "exports";
  } else if (moduleField) {
    file = moduleField;
    via = "module";
  } else if (browser) {
    file = browser;
    via = "browser";
  } else {
    file = mainField;
    via = "main";
  }

  return {
    file: file?.replace(/^\.\//, ""),
    via,
    main: mainField,
    module: moduleField,
    unpkg: unpkgField,
    browser,
    types: firstString(manifest.types),
    hasExports: manifest.exports != null,
  };
}
