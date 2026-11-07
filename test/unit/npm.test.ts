import { describe, expect, it } from "bun:test";

import { browserModuleFile, entryPoints, resolveExportsSubpath, resolveVersion, type Packument } from "../../src/clients/npm.ts";

export const preactPackument: Packument = {
  name: "preact",
  "dist-tags": { latest: "10.26.4" },
  versions: {
    "10.25.4": { name: "preact", version: "10.25.4", main: "dist/preact.js", module: "dist/preact.module.js" },
    "10.26.4": {
      name: "preact",
      version: "10.26.4",
      main: "dist/preact.js",
      module: "dist/preact.module.js",
      exports: { ".": { import: "./dist/preact.module.js", require: "./dist/preact.js" } },
    },
    "11.0.0-beta.1": { name: "preact", version: "11.0.0-beta.1", module: "dist/preact.module.js" },
  },
};

describe("resolveVersion", () => {
  it("resolves exact versions, tags, and ranges", () => {
    expect(resolveVersion(preactPackument, "10.25.4")?.resolvedVersion).toBe("10.25.4");
    expect(resolveVersion(preactPackument, "latest")?.resolvedVersion).toBe("10.26.4");
    expect(resolveVersion(preactPackument, "^10.25.0")?.resolvedVersion).toBe("10.26.4");
    expect(resolveVersion(preactPackument, "10.26")?.resolvedVersion).toBe("10.26.4");
  });

  it("does not resolve prereleases or impossible ranges by default", () => {
    expect(resolveVersion(preactPackument, "^11.0.0")).toBeNull();
    expect(resolveVersion(preactPackument, "99.0.0")).toBeNull();
  });
});

describe("entryPoints", () => {
  it("prefers the unpkg field, then exports, then module, then main", () => {
    expect(entryPoints({ name: "x", version: "1.0.0", unpkg: "dist/x.umd.js", module: "dist/x.mjs", main: "index.js" })).toMatchObject({
      file: "dist/x.umd.js",
      via: "unpkg",
    });
    expect(entryPoints(preactPackument.versions["10.26.4"])).toMatchObject({ file: "dist/preact.module.js", via: "exports" });
    expect(entryPoints(preactPackument.versions["10.25.4"])).toMatchObject({ file: "dist/preact.module.js", via: "module" });
    expect(entryPoints({ name: "x", version: "1.0.0", main: "lib/main.js" })).toMatchObject({ file: "lib/main.js", via: "main" });
    expect(entryPoints({ name: "x", version: "1.0.0" })).toMatchObject({ file: "index.js", via: "main" });
  });
});

describe("browserModuleFile", () => {
  it("requires real ESM evidence", () => {
    expect(browserModuleFile({ name: "x", version: "1.0.0", module: "dist/x.mjs" })).toBe("dist/x.mjs");
    expect(
      browserModuleFile({ name: "x", version: "1.0.0", main: "index.js", exports: { ".": { import: "./esm.js", require: "./cjs.js" } } }),
    ).toBe("esm.js");
    expect(
      browserModuleFile({ name: "x", version: "1.0.0", main: "index.js", exports: { ".": { require: "./cjs.js" } } }),
    ).toBeUndefined();
    expect(browserModuleFile({ name: "x", version: "1.0.0", main: "index.js", unpkg: "dist/x.umd.js" })).toBeUndefined();
  });
});

describe("resolveExportsSubpath", () => {
  it("resolves exact and wildcard subpaths", () => {
    const exportsField = {
      ".": "./dist/index.mjs",
      "./hooks": { import: "./hooks/dist/hooks.module.js", require: "./hooks/dist/hooks.js" },
      "./features/*": "./dist/features/*.js",
    };
    expect(resolveExportsSubpath(exportsField, "hooks")).toBe("hooks/dist/hooks.module.js");
    expect(resolveExportsSubpath(exportsField, "features/charts")).toBe("dist/features/charts.js");
    expect(resolveExportsSubpath(exportsField, "nope")).toBeUndefined();
    expect(resolveExportsSubpath(undefined, "hooks")).toBeUndefined();
  });
});
