import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { VERSION } from "../../src/version.ts";

describe("version", () => {
  it("matches package.json so version strings cannot drift", () => {
    let pkg = JSON.parse(readFileSync(`${import.meta.dir}/../../package.json`, "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
