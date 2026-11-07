import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { UnpkgClient } from "../../src/clients/unpkg.ts";
import { auditDependency, type Classification, type Framework } from "../../src/domain/audit.ts";

/**
 * Golden projects: whole project shapes with expected classifications.
 * Every heuristic change runs against these, so a classification can only
 * change by changing a fixture on purpose (which shows up in review).
 */

interface FixturePackage {
  spec: string;
  manifest: Record<string, unknown>;
  files: string[];
  source: string;
}

interface Fixture {
  name: string;
  framework: Framework | null;
  packages: Record<string, FixturePackage>;
  expected: Record<string, string>;
}

const fixturesDir = join(import.meta.dir, "../fixtures/projects");
const fixtures: Fixture[] = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(fixturesDir, f), "utf8")) as Fixture);

for (let fixture of fixtures) {
  describe(`golden project: ${fixture.name}`, () => {
    let unpkg = new UnpkgClient("https://unpkg.example", (async (input: RequestInfo | URL) => {
      let url = String(input);
      let match = /unpkg\.example\/(.+)@[^/]+\//.exec(url) ?? /unpkg\.example\/(.+)@[^/]+/.exec(url);
      let pkg = fixture.packages[decodeURIComponent(match?.[1] ?? "")];
      if (pkg == null) return new Response("not found", { status: 404 });
      if (url.includes("?meta")) {
        return Response.json({
          package: "x",
          version: "1.0.0",
          prefix: "/",
          files: pkg.files.map((path) => ({ path, size: 100, type: "text/javascript" })),
        });
      }
      return new Response(pkg.source, { headers: { "Content-Type": "text/javascript" } });
    }) as typeof fetch);

    for (let [name, expected] of Object.entries(fixture.expected)) {
      it(`${name} -> ${expected}`, async () => {
        let pkg = fixture.packages[name];
        let packument = {
          name,
          "dist-tags": { latest: pkg.spec },
          versions: { [pkg.spec]: { name, version: pkg.spec, ...pkg.manifest } },
        } as never;
        let entry = await auditDependency(unpkg, packument, name, pkg.spec, fixture.framework ?? undefined);
        expect(entry.classification).toBe(expected as Classification);
      });
    }
  });
}
