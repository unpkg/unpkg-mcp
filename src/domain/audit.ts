import { browserModuleFile, entryPoints, resolveVersion, type Packument } from "../clients/npm.ts";
import type { UnpkgClient } from "../clients/unpkg.ts";

export type Classification =
  | "convert_now"
  | "convert_carefully"
  | "keep_bundled"
  | "needs_review"
  | "not_found"
  | "already_on_unpkg";

export interface CurrentUsage {
  status:
    | "already_on_unpkg"
    | "already_on_unpkg_esm"
    | "already_on_other_cdn"
    | "partially_on_unpkg"
    | "not_detected";
  /** The existing URL for the package root specifier, when one was found. */
  url: string | null;
  /** Subpath specifiers (e.g. preact/hooks) found for this package. */
  specifiers: string[];
}

export interface AuditEntry {
  name: string;
  requested: string;
  resolvedVersion: string | null;
  classification: Classification;
  reasons: string[];
  entryFile: string | null;
  entrySizeBytes: number | null;
  bareImports: string[];
  peerDependencies: Record<string, string>;
  suggestedUrl: string | null;
  importmapUrl: string | null;
  /** Set only when the caller scanned the project and passed existingImports. */
  currentUsage?: CurrentUsage;
}

/**
 * Cross-reference audit entries against the imports a project already has
 * (typically an import map extracted from its HTML). A package whose root
 * specifier already resolves to unpkg.com is not a conversion candidate —
 * it is already converted, and reporting it as convert_now misleads.
 * Packages on another CDN, or covered only via subpaths, keep their
 * suitability classification and are flagged through currentUsage instead.
 */
export function annotateCurrentUsage(
  entries: AuditEntry[],
  existingImports: Record<string, string>,
): void {
  for (let entry of entries) {
    let subSpecifiers = Object.keys(existingImports).filter((k) =>
      k.startsWith(`${entry.name}/`),
    );
    let rootUrl = existingImports[entry.name];
    if (rootUrl == null) {
      let onUnpkg = subSpecifiers.some((k) => hostOf(existingImports[k]) === "unpkg.com");
      entry.currentUsage = {
        status: onUnpkg ? "partially_on_unpkg" : "not_detected",
        url: null,
        specifiers: subSpecifiers,
      };
      continue;
    }
    let host = hostOf(rootUrl);
    if (host === "unpkg.com") {
      entry.currentUsage = { status: "already_on_unpkg", url: rootUrl, specifiers: subSpecifiers };
      if (entry.classification === "convert_now" || entry.classification === "convert_carefully") {
        entry.classification = "already_on_unpkg";
        entry.reasons = [
          `Already loaded from UNPKG in this project (${rootUrl}). No conversion needed; suitability confirmed.`,
          ...entry.reasons,
        ];
      }
    } else if (host === "esm.unpkg.com") {
      entry.currentUsage = { status: "already_on_unpkg_esm", url: rootUrl, specifiers: subSpecifiers };
    } else if (host != null) {
      entry.currentUsage = { status: "already_on_other_cdn", url: rootUrl, specifiers: subSpecifiers };
    } else {
      entry.currentUsage = { status: "not_detected", url: rootUrl, specifiers: subSpecifiers };
    }
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export type Framework = "next" | "nuxt" | "sveltekit" | "remix" | "astro" | "gatsby";

/** Packages a framework owns: externalizing them breaks its rendering. */
const FRAMEWORK_MANAGED: Record<Framework, { exact: string[]; prefixes: string[] }> = {
  next: { exact: ["next", "react", "react-dom"], prefixes: ["@next/", "@mdx-js/"] },
  nuxt: { exact: ["nuxt", "vue", "vue-router"], prefixes: ["@nuxt/"] },
  sveltekit: { exact: ["svelte"], prefixes: ["@sveltejs/"] },
  remix: { exact: ["react", "react-dom"], prefixes: ["@remix-run/"] },
  astro: { exact: ["astro"], prefixes: ["@astrojs/"] },
  gatsby: { exact: ["gatsby", "react", "react-dom"], prefixes: [] },
};

const FRAMEWORK_MARKERS: { framework: Framework; names: string[]; prefixes: string[] }[] = [
  { framework: "next", names: ["next"], prefixes: [] },
  { framework: "nuxt", names: ["nuxt"], prefixes: [] },
  { framework: "sveltekit", names: [], prefixes: ["@sveltejs/kit"] },
  { framework: "remix", names: [], prefixes: ["@remix-run/"] },
  { framework: "astro", names: ["astro"], prefixes: [] },
  { framework: "gatsby", names: ["gatsby"], prefixes: [] },
];

/** Infer the framework from a dependency map when the caller didn't say. */
export function detectFramework(dependencies: Record<string, string>): Framework | undefined {
  let names = Object.keys(dependencies);
  for (let marker of FRAMEWORK_MARKERS) {
    if (marker.names.some((n) => names.includes(n))) return marker.framework;
    if (marker.prefixes.some((prefix) => names.some((n) => n.startsWith(prefix)))) return marker.framework;
  }
  return undefined;
}

export function isFrameworkManaged(framework: Framework, name: string): boolean {
  let managed = FRAMEWORK_MANAGED[framework];
  return managed.exact.includes(name) || managed.prefixes.some((prefix) => name.startsWith(prefix));
}

/** Bare specifiers imported by a source text, comments stripped. */
export function extractBareImports(text: string): string[] {
  let clean = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\n)\s*\/\/.*$/gm, "$1");
  let found = new Set<string>();
  // Minified code writes from"react" with no space; allow zero whitespace.
  for (let m of clean.matchAll(/(?:from\s*|import\s*\(?\s*|require\(\s*)["']([^"']+)["']/g)) {
    let s = m[1];
    if (!s.startsWith(".") && !s.startsWith("/") && !s.startsWith("http") && !s.startsWith("node:")) found.add(s);
  }
  return [...found];
}

/** The npm package name a bare specifier belongs to. */
export function packageNameOf(specifier: string): string {
  let parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const NODE_BUILTIN =
  /(?:from\s+|require\(\s*|import\s+)["'](?:node:)?(?:fs|path|os|crypto|child_process|net|http|https|stream|util|events|buffer|process)["']/;
const ESM_SYNTAX = /(?:^|\n|;)\s*(?:import[\s({*]|export\s*(?:\{|const|var|let|function|class|default|async))/;

/**
 * Classify one runtime dependency for direct UNPKG file lookup.
 * Deliberately conservative: anything ambiguous lands in needs_review
 * rather than convert_now, because a wrong automated conversion breaks
 * the user's app while a missed one only misses an optimization.
 */
export async function auditDependency(
  unpkg: UnpkgClient,
  packument: Packument | null,
  name: string,
  spec: string,
  framework?: Framework,
): Promise<AuditEntry> {
  let base: AuditEntry = {
    name,
    requested: spec,
    resolvedVersion: null,
    classification: "needs_review",
    reasons: [],
    entryFile: null,
    entrySizeBytes: null,
    bareImports: [],
    peerDependencies: {},
    suggestedUrl: null,
    importmapUrl: null,
  };

  if (packument == null) {
    return { ...base, classification: "not_found", reasons: [`${name} was not found on npm.`] };
  }

  let resolved = resolveVersion(packument, spec);
  if (resolved == null) {
    return {
      ...base,
      classification: "not_found",
      reasons: [`No published version of ${name} matches "${spec}".`],
    };
  }
  base.resolvedVersion = resolved.resolvedVersion;
  let manifest = resolved.manifest;

  // Framework-owned packages stay bundled no matter what their files look
  // like: the framework renders with its own copies, and a CDN copy would
  // duplicate the runtime and fight SSR/hydration.
  if (framework != null && isFrameworkManaged(framework, name)) {
    return {
      ...base,
      classification: "keep_bundled",
      reasons: [
        `Managed by ${framework}: framework/runtime packages must stay bundled so the framework renders with its own copy (a second runtime copy breaks hooks/context and fights SSR/hydration). Only standalone surfaces outside the framework are UNPKG candidates.`,
      ],
    };
  }

  // A dependency literally named after a Node builtin (fs, path, util,
  // ...) is the npm placeholder package, not a browser library.
  const NODE_BUILTIN_NAMES = new Set([
    "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https",
    "net", "os", "path", "process", "querystring", "stream", "url", "util", "vm",
    "worker_threads", "zlib",
  ]);
  if (NODE_BUILTIN_NAMES.has(name)) {
    return {
      ...base,
      classification: "keep_bundled",
      reasons: [
        `"${name}" is the name of a Node.js builtin; the npm package under this name is a placeholder with no browser implementation. Remove it or use a browser alternative.`,
      ],
    };
  }

  // Types-only packages have no runtime file to load from a CDN.
  if (
    name.startsWith("@types/") ||
    (manifest.types != null && manifest.main == null && manifest.module == null && manifest.unpkg == null && manifest.exports == null)
  ) {
    return {
      ...base,
      classification: "needs_review",
      reasons: ["Types-only package: it ships declarations, not a runtime file. It belongs in devDependencies, not a CDN."],
    };
  }

  let entry = entryPoints(manifest);
  if (entry.file == null) {
    base.reasons.push("No browser entry point could be determined from package.json.");
    return base;
  }
  // For browser use, an ESM file beats the package root default: the
  // `unpkg` field often names a UMD build (fine as a classic script, wrong
  // in an import map). Prefer a real ES module when the package has one.
  let moduleFile = browserModuleFile(manifest);
  let targetFile: string = moduleFile ?? entry.file;
  base.entryFile = targetFile;

  // Command-line tools are build-time by definition.
  if (manifest.bin != null && moduleFile == null) {
    return {
      ...base,
      classification: "keep_bundled",
      reasons: ["Ships a CLI (package.json `bin` field) and no browser module: build-time tooling, not a browser dependency."],
    };
  }

  // Build-pipeline plugins run inside the build, never in the browser:
  // CSS (postcss/tailwind), bundlers/loaders (webpack/vite/rollup/esbuild),
  // unified/remark/rehype processors, babel plugins.
  let peers = manifest.peerDependencies ?? {};
  const BUILD_PEERS = ["tailwindcss", "postcss", "webpack", "vite", "rollup", "esbuild", "unified", "@babel/core"];
  let buildPeer = BUILD_PEERS.find((peer) => peer in peers);
  if (buildPeer != null) {
    return {
      ...base,
      classification: "keep_bundled",
      reasons: [`Build-pipeline package (peers on ${buildPeer}): it runs at build time as a plugin/processor, not as a browser dependency.`],
    };
  }

  let listing = await unpkg.listFiles(name, resolved.resolvedVersion, "/").catch(() => null);
  if (listing != null) {
    let matched = listing.files.find((f) => f.path === `/${targetFile}` || f.path.endsWith(`/${targetFile}`));
    base.entrySizeBytes = matched?.size ?? null;
    if (matched == null) {
      base.reasons.push(`Entry file ${targetFile} is not present in ${name}@${resolved.resolvedVersion}.`);
      return base;
    }
  }

  let specForUrl = spec.trim() === "" ? `^${resolved.resolvedVersion}` : spec.trim();
  let directUrl = unpkg.fileUrl(name, specForUrl, targetFile);

  // Non-JS entry points (CSS, JSON, WASM) are served as-is by UNPKG.
  if (!/\.(?:m?js|cjs)$/.test(targetFile)) {
    return {
      ...base,
      classification: "convert_now",
      reasons: [
        `Entry point is a static asset (${targetFile}); UNPKG serves it directly.`,
        ...(framework != null
          ? [`Standalone surfaces only in this ${framework} project, not the framework app itself.`]
          : []),
      ],
      suggestedUrl: directUrl,
      importmapUrl: null,
    };
  }

  let source = await unpkg.fetchText(name, resolved.resolvedVersion, targetFile).catch(() => null);
  // Follow relative imports: many Node packages have a thin root entry
  // that re-exports from lib/, and the builtin imports only appear there.
  // Bounded (depth 3, ~24 files) so audits stay fast.
  let usesNodeBuiltins = source != null && NODE_BUILTIN.test(source);
  let scannedFiles: string[] = [];
  if (source != null && !usesNodeBuiltins) {
    let seen = new Set<string>([targetFile]);
    let frontier = [targetFile];
    for (let depth = 0; depth < 3 && !usesNodeBuiltins; depth++) {
      let next: string[] = [];
      for (let file of frontier) {
        let text = file === targetFile ? source : await unpkg.fetchText(name, resolved.resolvedVersion, file).catch(() => null);
        if (text == null) continue;
        for (let match of text.matchAll(/(?:require\(\s*|from\s+|import\s+)["'](\.[^"']+)["']/g)) {
          let rel = match[1].replace(/^\.\//, "");
          let dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
          let candidate = (dir ? `${dir}/${rel}` : rel).replace(/\/$/, "");
          for (let variant of [candidate, `${candidate}.js`, `${candidate}/index.js`, `${candidate}.mjs`]) {
            if (!seen.has(variant) && seen.size < 24) {
              seen.add(variant);
              next.push(variant);
            }
          }
        }
      }
      for (let file of next) {
        let text = await unpkg.fetchText(name, resolved.resolvedVersion, file).catch(() => null);
        if (text != null && NODE_BUILTIN.test(text)) {
          usesNodeBuiltins = true;
          break;
        }
      }
      frontier = next;
    }
    scannedFiles = [...seen];
  }
  if (usesNodeBuiltins) {
    return {
      ...base,
      classification: "keep_bundled",
      reasons: ["Entry file imports Node.js builtins, so it needs a bundler or Node runtime."],
    };
  }

  // Node-leaning but unproven: Node engines, plain CJS entry, no browser
  // build, and no builtin found above. needs_review, not convert_carefully.
  if (manifest.engines?.node != null && entry.via === "main" && typeof manifest.browser !== "string" && moduleFile == null) {
    return {
      ...base,
      classification: "needs_review",
      reasons: [
        `Declares Node engines (${manifest.engines.node}) with a CommonJS entry and no browser build: likely a server-side package. Do not convert without evidence it runs in a browser.`,
      ],
    };
  }

  let looksEsm =
    targetFile.endsWith(".mjs") ||
    manifest.type === "module" ||
    moduleFile != null ||
    (source != null && ESM_SYNTAX.test(source));

  // Bare specifiers decide whether the plain file URL can actually
  // execute in a browser: it cannot, unless they are all peers the
  // caller will map separately. The ?module form rewrites them.
  // Extraction runs over the entry and the relative files scanned above
  // (remark-style packages re-export from lib/), with comments stripped
  // so JSDoc @import tags are not mistaken for real imports.
  let bareSet = new Set<string>();
  let collectBare = (text: string | null) => {
    if (text == null) return;
    for (let s of extractBareImports(text)) bareSet.add(s);
  };
  collectBare(source);
  base.peerDependencies = manifest.peerDependencies ?? {};
  for (let file of scannedFiles) {
    if (file !== targetFile) collectBare(await unpkg.fetchText(name, resolved.resolvedVersion, file).catch(() => null));
    if (bareSet.size >= 10) break;
  }
  let bareImports = [...bareSet].slice(0, 10);
  base.bareImports = bareImports;
  let peerNames = new Set(Object.keys(manifest.peerDependencies ?? {}));
  let unmappedBare = bareImports.filter((s) => !peerNames.has(s) && s !== name);

  if (looksEsm) {
    let reasons = [`Browser-ready ES module entry (${targetFile}).`];
    let importmapUrl = directUrl;
    if (unmappedBare.length > 0) {
      importmapUrl = `${directUrl}?module`;
      reasons.push(
        `Entry imports bare specifiers (${unmappedBare.join(", ")}); the suggested URL uses ?module so UNPKG rewrites them. Without it the file will not execute standalone.`,
      );
    } else if (bareImports.length > 0) {
      reasons.push(
        `Entry imports only its peer dependencies (${bareImports.join(", ")}); map those specifiers too (they are not bundled into this file).`,
      );
    }
    if (framework != null) {
      reasons.push(
        `Standalone surfaces only in this ${framework} project: convert_now applies to no-build pages/widgets outside the framework's rendering, not to the framework app itself.`,
      );
    }
    return { ...base, classification: "convert_now", reasons, suggestedUrl: importmapUrl, importmapUrl };
  }

  return {
    ...base,
    classification: "convert_carefully",
    reasons: [
      "Entry point looks like CommonJS. The direct file can be loaded with UNPKG's ?module import rewriting, but test it in a browser before committing.",
    ],
    suggestedUrl: `${directUrl}?module`,
    importmapUrl: `${directUrl}?module`,
  };
}
