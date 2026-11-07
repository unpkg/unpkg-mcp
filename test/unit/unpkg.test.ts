import { describe, expect, it } from "bun:test";

import { UnpkgClient } from "../../src/clients/unpkg.ts";
import { VERSION } from "../../src/version.ts";

describe("UnpkgClient", () => {
  it("identifies as unpkg-mcp on every fetch (visible in UNPKG zone logs)", async () => {
    let agents: (string | null)[] = [];
    let fetchFn = (async (_url: string, init?: RequestInit) => {
      agents.push(new Headers(init?.headers).get("User-Agent"));
      return Response.json({ package: "preact", version: "10.26.4", prefix: "/", files: [] });
    }) as unknown as typeof fetch;

    let client = new UnpkgClient("https://unpkg.example", fetchFn);
    await client.listFiles("preact", "10.26.4");
    await client.verifyUrl("https://unpkg.example/preact@10.26.4/dist/preact.module.js");

    expect(agents.length).toBeGreaterThan(0);
    for (let ua of agents) expect(ua).toBe(`unpkg-mcp/${VERSION} (+https://mcp.unpkg.com)`);
  });
});
