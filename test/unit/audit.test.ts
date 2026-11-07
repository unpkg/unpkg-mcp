import { describe, expect, it } from "bun:test";

import { auditDependency } from "../../src/domain/audit.ts";
import { UnpkgClient } from "../../src/clients/unpkg.ts";
import { preactPackument } from "../unit/npm.test.ts";

function fakeUnpkg(files: string[], entrySource: string): UnpkgClient {
  let fetchFn = (async (input: RequestInfo | URL) => {
    let url = String(input);
    if (url.includes("?meta")) {
      return Response.json({
        package: "preact",
        version: "10.26.4",
        prefix: "/",
        files: files.map((path) => ({ path, size: 100, type: "text/javascript" })),
      });
    }
    return new Response(entrySource, { headers: { "Content-Type": "text/javascript" } });
  }) as typeof fetch;
  return new UnpkgClient("https://unpkg.example", fetchFn);
}

describe("auditDependency", () => {
  it("classifies a browser ESM package as convert_now with a range-preserved URL", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/dist/preact.module.js"], "export const x = 1;"),
      preactPackument,
      "preact",
      "^10.25.4",
    );
    expect(entry.classification).toBe("convert_now");
    expect(entry.suggestedUrl).toBe("https://unpkg.example/preact@^10.25.4/dist/preact.module.js");
    expect(entry.importmapUrl).toBe(entry.suggestedUrl);
  });

  it("keeps Node-builtin packages bundled", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/dist/preact.module.js"], "import fs from 'node:fs'; export const x = fs;"),
      preactPackument,
      "preact",
      "^10.25.4",
    );
    expect(entry.classification).toBe("keep_bundled");
    expect(entry.suggestedUrl).toBeNull();
  });

  it("flags a missing entry file for review instead of guessing", async () => {
    let entry = await auditDependency(fakeUnpkg(["/other.js"], "export const x = 1;"), preactPackument, "preact", "^10.25.4");
    expect(entry.classification).toBe("needs_review");
  });

  it("reports unknown packages as not_found", async () => {
    let entry = await auditDependency(fakeUnpkg([], ""), null, "nope-not-real", "^1.0.0");
    expect(entry.classification).toBe("not_found");
  });
});

describe("classification hardening (Next.js transcript cases)", () => {
  const packumentOf = (manifest: object) => ({
    name: "x",
    "dist-tags": { latest: "1.0.0" },
    versions: { "1.0.0": { name: "x", version: "1.0.0", ...manifest } },
  });

  it("does not call a require-only exports package ESM", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/index.js"], "module.exports = require('./cjs/x.js');"),
      packumentOf({ main: "index.js", exports: { ".": { require: "./index.js" } } }) as never,
      "x",
      "^1.0.0",
    );
    expect(entry.classification).toBe("convert_carefully");
  });

  it("keeps CLI tools bundled", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/lib/tool.js"], ""),
      packumentOf({ main: "lib/tool.js", bin: { tool: "lib/tool.js" } }) as never,
      "x",
      "^1.0.0",
    );
    expect(entry.classification).toBe("keep_bundled");
    expect(entry.reasons[0]).toContain("bin");
  });

  it("flags types-only packages for review with the right reason", async () => {
    let entry = await auditDependency(
      fakeUnpkg([], ""),
      packumentOf({ types: "index.d.ts" }) as never,
      "@types/react",
      "^1.0.0",
    );
    expect(entry.classification).toBe("needs_review");
    expect(entry.reasons[0]).toContain("Types-only");
  });

  it("sends Node-engines CJS server packages to review, not ?module", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/build/src/index.js"], ""),
      packumentOf({ main: "build/src/index.js", engines: { node: ">=14" } }) as never,
      "x",
      "^1.0.0",
    );
    expect(entry.classification).toBe("needs_review");
    expect(entry.suggestedUrl).toBeNull();
  });

  it("keeps framework-managed packages bundled in context", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/index.js"], "export const x = 1;"),
      packumentOf({ main: "index.js" }) as never,
      "react",
      "^1.0.0",
      "next",
    );
    expect(entry.classification).toBe("keep_bundled");
    expect(entry.reasons[0]).toContain("Managed by next");
  });
});

describe("detectFramework", () => {
  it("detects frameworks from dependency names", async () => {
    const { detectFramework } = await import("../../src/domain/audit.ts");
    expect(detectFramework({ next: "14", react: "18" })).toBe("next");
    expect(detectFramework({ vue: "3" })).toBeUndefined();
    expect(detectFramework({ "@sveltejs/kit": "2" })).toBe("sveltekit");
  });
});

describe("bare imports, builtin names, build peers, framework scoping", () => {
  const packumentOf = (manifest: object) => ({
    name: "x",
    "dist-tags": { latest: "1.0.0" },
    versions: { "1.0.0": { name: "x", version: "1.0.0", ...manifest } },
  });

  it("routes ESM entries with unmapped bare imports through ?module", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/index.js"], "export { default } from 'mdast-util-gfm';"),
      packumentOf({ type: "module", main: "index.js" }) as never,
      "remark-x",
      "^1.0.0",
    );
    expect(entry.classification).toBe("convert_now");
    expect(entry.bareImports).toContain("mdast-util-gfm");
    expect(entry.importmapUrl).toEndWith("?module");
    expect(entry.reasons.join(" ")).toContain("will not execute standalone");
  });

  it("treats builtin-named placeholder packages as keep_bundled", async () => {
    let entry = await auditDependency(
      fakeUnpkg([], ""),
      packumentOf({ main: "index.js" }) as never,
      "fs",
      "^1.0.0",
    );
    expect(entry.classification).toBe("keep_bundled");
    expect(entry.reasons[0]).toContain("Node.js builtin");
  });

  it("keeps unified-pipeline plugins bundled", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/index.js"], ""),
      packumentOf({ main: "index.js", peerDependencies: { unified: "^11.0.0" } }) as never,
      "rehype-x",
      "^1.0.0",
    );
    expect(entry.classification).toBe("keep_bundled");
    expect(entry.reasons[0]).toContain("Build-pipeline");
  });

  it("scopes convert_now reasons to standalone surfaces in a framework project", async () => {
    let entry = await auditDependency(
      fakeUnpkg(["/dist/clsx.mjs"], "export default function clsx() {}"),
      packumentOf({ module: "dist/clsx.mjs", main: "dist/clsx.js" }) as never,
      "clsx",
      "^1.0.0",
      "next",
    );
    expect(entry.classification).toBe("convert_now");
    expect(entry.reasons.join(" ")).toContain("Standalone surfaces only");
  });
});

describe("bare imports through re-export chains", () => {
  it("finds bare imports in lib/ behind an entry re-export", async () => {
    const { UnpkgClient } = await import("../../src/clients/unpkg.ts");
    let client = new UnpkgClient("https://unpkg.example", (async (input: RequestInfo | URL) => {
      let url = String(input);
      if (url.includes("?meta")) {
        return Response.json({
          package: "x", version: "1.0.0", prefix: "/",
          files: [{ path: "/index.js", size: 10, type: "text/javascript" }, { path: "/lib/index.js", size: 10, type: "text/javascript" }],
        });
      }
      if (url.endsWith("/lib/index.js")) {
        return new Response("import { gfm } from 'mdast-util-gfm'; export default gfm;", { headers: { "Content-Type": "text/javascript" } });
      }
      // JSDoc @import must not count as a real import.
      return new Response("/** @import {Root} from 'mdast' */ export { default } from './lib/index.js';", {
        headers: { "Content-Type": "text/javascript" },
      });
    }) as typeof fetch);
    let entry = await auditDependency(
      client,
      { name: "x", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { name: "x", version: "1.0.0", type: "module", main: "index.js" } } } as never,
      "x",
      "^1.0.0",
    );
    expect(entry.bareImports).toContain("mdast-util-gfm");
    expect(entry.bareImports).not.toContain("mdast");
    expect(entry.importmapUrl).toEndWith("?module");
  });
});

describe("annotateCurrentUsage (already-converted detection)", () => {
  function entry(name: string, classification: string) {
    return {
      name,
      requested: "^1.0.0",
      resolvedVersion: "1.0.0",
      classification,
      reasons: [],
      entryFile: "dist/index.mjs",
      entrySizeBytes: 10,
      bareImports: [],
      peerDependencies: {},
      suggestedUrl: `https://unpkg.com/${name}@^1.0.0/dist/index.mjs`,
      importmapUrl: `https://unpkg.com/${name}@^1.0.0/dist/index.mjs`,
    } as any;
  }

  it("reclassifies a package already on UNPKG and keeps subpaths", async () => {
    const { annotateCurrentUsage } = await import("../../src/domain/audit.ts");
    let entries = [entry("preact", "convert_now"), entry("htm", "convert_now")];
    annotateCurrentUsage(entries, {
      preact: "https://unpkg.com/preact@^10.26.4/dist/preact.module.js",
      "preact/hooks": "https://unpkg.com/preact@^10.26.4/hooks/dist/hooks.module.js",
      htm: "https://cdn.jsdelivr.net/npm/htm@3/+esm",
    });
    expect(entries[0].classification).toBe("already_on_unpkg");
    expect(entries[0].currentUsage.specifiers).toEqual(["preact/hooks"]);
    expect(entries[1].classification).toBe("convert_now");
    expect(entries[1].currentUsage.status).toBe("already_on_other_cdn");
  });

  it("marks subpath-only coverage as partial and absent packages as not detected", async () => {
    const { annotateCurrentUsage } = await import("../../src/domain/audit.ts");
    let entries = [entry("preact", "convert_now"), entry("clsx", "convert_now")];
    annotateCurrentUsage(entries, { "preact/hooks": "https://unpkg.com/preact/hooks/dist/hooks.module.js" });
    expect(entries[0].currentUsage.status).toBe("partially_on_unpkg");
    expect(entries[0].classification).toBe("convert_now");
    expect(entries[1].currentUsage.status).toBe("not_detected");
  });
});
