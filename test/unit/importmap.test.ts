import { describe, expect, it } from "bun:test";

import { NpmClient, type Packument } from "../../src/clients/npm.ts";
import { UnpkgClient } from "../../src/clients/unpkg.ts";
import { checkImportmap, completePeerImports } from "../../src/domain/importmap.ts";
import type { AuditEntry } from "../../src/domain/audit.ts";
import type { Clients } from "../../src/server.ts";

const packuments: Record<string, Packument> = {
  react: {
    name: "react",
    "dist-tags": { latest: "18.3.1" },
    versions: { "18.3.1": { name: "react", version: "18.3.1", module: "dist/react.mjs", main: "index.js" } },
  },
  headless: {
    name: "headless",
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": { name: "headless", version: "1.0.0", module: "dist/headless.mjs", peerDependencies: { react: "^18.2.0" } },
    },
  },
};

const files: Record<string, string[]> = {
  react: ["/dist/react.mjs"],
  headless: ["/dist/headless.mjs"],
};

const sources: Record<string, string> = {
  react: "export default {};",
  headless: "import React from 'react'; export default React;",
};

function stubClients(): Clients {
  let npm = new NpmClient("https://registry.example", (async (input: RequestInfo | URL) => {
    let name = decodeURIComponent(String(input).split("/").pop() ?? "");
    let packument = packuments[name];
    return packument ? Response.json(packument) : new Response("not found", { status: 404 });
  }) as typeof fetch);

  let unpkg = new UnpkgClient("https://unpkg.example", (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input);
    let name = /unpkg\.example\/([^@/]+)@/.exec(url)?.[1] ?? "";
    if (url.includes("?meta")) {
      return Response.json({
        package: name,
        version: "1.0.0",
        prefix: "/",
        files: (files[name] ?? []).map((path) => ({ path, size: 10, type: "text/javascript" })),
      });
    }
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    return new Response(sources[name] ?? "", { headers: { "Content-Type": "text/javascript" } });
  }) as typeof fetch);

  return { npm, unpkg };
}

describe("completePeerImports", () => {
  it("adds resolvable peer entries the agent would otherwise drop", async () => {
    let entry = {
      name: "headless",
      requested: "^1.0.0",
      resolvedVersion: "1.0.0",
      classification: "convert_now",
      reasons: [],
      entryFile: "dist/headless.mjs",
      entrySizeBytes: 10,
      bareImports: ["react"],
      peerDependencies: { react: "^18.2.0" },
      suggestedUrl: "https://unpkg.example/headless@^1.0.0/dist/headless.mjs",
      importmapUrl: "https://unpkg.example/headless@^1.0.0/dist/headless.mjs",
    } as AuditEntry;
    let imports: Record<string, string> = { headless: entry.importmapUrl! };
    let result = await completePeerImports(stubClients(), [entry], imports, { react: "^18.2.0" });
    expect(result.added.join(" ")).toContain("react@18.3.1");
    expect(imports.react).toBe("https://unpkg.example/react@^18.2.0/dist/react.mjs");
  });
});

describe("CJS peers and entries", () => {
  it("does not auto-map a CommonJS-only peer", async () => {
    let clients = stubClients();
    // react in this stub has an ESM module field; add a CJS-only package.
    (clients.npm as unknown as { getPackument: (n: string) => Promise<unknown> }).getPackument = async (n: string) =>
      n === "reactcjs"
        ? { name: "reactcjs", "dist-tags": { latest: "18.3.1" }, versions: { "18.3.1": { name: "reactcjs", version: "18.3.1", main: "index.js" } } }
        : null;
    let entry = {
      name: "headless", requested: "^1.0.0", resolvedVersion: "1.0.0", classification: "convert_now",
      reasons: [], entryFile: "dist/headless.mjs", entrySizeBytes: 10, bareImports: ["reactcjs"],
      peerDependencies: { reactcjs: "^18.0.0" },
      suggestedUrl: "https://unpkg.example/headless@^1.0.0/dist/headless.mjs",
      importmapUrl: "https://unpkg.example/headless@^1.0.0/dist/headless.mjs",
    } as AuditEntry;
    let imports: Record<string, string> = { headless: entry.importmapUrl! };
    let result = await completePeerImports(clients, [entry], imports);
    expect(result.added).toEqual([]);
    expect(imports.reactcjs).toBeUndefined();
    expect(result.notes.join(" ")).toContain("no browser ESM entry");
  });

  it("flags a CommonJS map entry as an error", async () => {
    let clients = stubClients();
    (clients.npm as unknown as { getPackument: (n: string) => Promise<unknown> }).getPackument = async (n: string) =>
      n === "reactcjs"
        ? { name: "reactcjs", "dist-tags": { latest: "18.3.1" }, versions: { "18.3.1": { name: "reactcjs", version: "18.3.1", main: "index.js" } } }
        : null;
    (clients.unpkg as unknown as { listFiles: () => Promise<unknown> }).listFiles = async () => ({
      package: "reactcjs", version: "18.3.1", prefix: "/",
      files: [{ path: "/index.js", size: 10, type: "text/javascript" }],
    });
    (clients.unpkg as unknown as { fetchText: () => Promise<string> }).fetchText = async () => "module.exports = {};";
    let report = await checkImportmap(clients, { reactcjs: "https://unpkg.example/reactcjs@18.3.1/index.js" });
    expect(report.ok).toBe(false);
    expect(report.entries[0].issues.map((i) => i.message).join(" ")).toContain("looks like CommonJS");
  });
});

describe("checkImportmap peer completeness", () => {
  it("warns when an entry imports a specifier no map entry provides", async () => {
    let report = await checkImportmap(stubClients(), {
      headless: "https://unpkg.example/headless@1.0.0/dist/headless.mjs",
    });
    let messages = report.entries.flatMap((e) => e.issues.map((i) => i.message)).join(" ");
    expect(messages).toContain("no entry in this map");
  });

  it("is quiet once the peer is mapped", async () => {
    let report = await checkImportmap(stubClients(), {
      headless: "https://unpkg.example/headless@1.0.0/dist/headless.mjs",
      react: "https://unpkg.example/react@18.3.1/dist/react.mjs",
    });
    let messages = report.entries.flatMap((e) => e.issues.map((i) => i.message)).join(" ");
    expect(messages).not.toContain("no entry in this map");
    expect(report.ok).toBe(true);
  });
});
