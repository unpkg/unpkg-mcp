import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";

import worker from "../../src/index.ts";
import { _resetJwksCache } from "../../src/auth.ts";
import { preactPackument } from "../unit/npm.test.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pubJwk = publicKey.export({ format: "jwk" }) as { n?: string; e?: string };

const ISSUER = "https://issuer.test";
const RESOURCE = "http://localhost/mcp";
const ENV = {
  OAUTH_ENABLED: "true",
  OAUTH_ISSUER: ISSUER,
  OAUTH_RESOURCE: RESOURCE,
  SHIELD_API_ORIGIN: "https://shield.test",
};

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeToken(overrides: Record<string, unknown> = {}): string {
  let header = b64urlJson({ alg: "RS256", kid: "test-1", typ: "JWT" });
  let now = Math.floor(Date.now() / 1000);
  let claims = b64urlJson({
    iss: ISSUER,
    aud: RESOURCE,
    sub: "user-1",
    org_id: "org-1",
    client_id: "client-1",
    scope: "shield:read shield:simulate",
    type: "oauth-access",
    tv: 0,
    iat: now,
    exp: now + 900,
    ...overrides,
  });
  let signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  let signature = signer.sign(privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

const realFetch = globalThis.fetch;
let lastShieldAuth: string | null = null;
let lastShieldClientSource: string | null = null;
let lastShieldUserAgent: string | null = null;
let logLines: string[] = [];
const realLog = console.log;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = String(input);
    if (url === `${ISSUER}/v1/oauth/jwks`) {
      return Response.json({ keys: [{ kty: "RSA", kid: "test-1", alg: "RS256", use: "sig", n: pubJwk.n, e: pubJwk.e }] });
    }
    if (url === "https://shield.test/v1/auth/me") {
      lastShieldAuth = new Headers(init?.headers).get("Authorization");
      return Response.json({ email: "dev@example.com", organization: { id: "org-1", slug: "dev" } });
    }
    if (url === "https://shield.test/v1/monitor/packages/bulk-analyses") {
      lastShieldClientSource = new Headers(init?.headers).get("X-Client-Source");
      lastShieldUserAgent = new Headers(init?.headers).get("User-Agent");
      return Response.json([
        {
          package_name: "preact",
          new_version: "10.26.4",
          verdict: "clean",
          verdict_source: "classifier",
          review_state: "provisional",
          confidence: 0.99,
          analysis_text: "SECRET ANALYSIS TEXT",
        },
      ]);
    }
    if (url === "https://shield.test/v1/monitor/packages/preact/advisories/10.26.4") {
      return Response.json([
        {
          cve_id: "CVE-2026-0001",
          ghsa_id: "GHSA-test-0001",
          severity: "high",
          vulnerable_version_range: "<10.26.5",
          first_patched_version: "10.26.5",
          description: "should be curated away",
        },
      ]);
    }
    if (url === "https://shield.test/v1/domains/package_summary") {
      lastShieldAuth = new Headers(init?.headers).get("Authorization");
      return Response.json([
        { domain: "example.com", verified_at: "2026-01-01", package_count: 314, unpkg_package_count: 54 },
      ]);
    }
    if (url.startsWith("https://shield.test/v1/domains/domains/example.com/threats")) {
      lastShieldAuth = new Headers(init?.headers).get("Authorization");
      return Response.json({ domain: "example.com", malicious_confirmed: 1, packages: [] });
    }
    if (url === "https://shield.test/v1/edge/simulate") {
      return Response.json({ v: 7, action: "pin", package: "react", version: "18.3.1", serveVersion: "18.3.0" });
    }
    if (url.startsWith("https://registry.npmjs.org/preact")) {
      return Response.json(preactPackument);
    }
    if (url.includes("?meta")) {
      return Response.json({
        package: "preact",
        version: "10.26.4",
        prefix: "/",
        files: [{ path: "/dist/preact.module.js", size: 100, type: "text/javascript" }],
      });
    }
    return new Response("stub: unhandled " + url, { status: 404 });
  }) as typeof fetch;
  console.log = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
});

afterAll(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

let id = 0;
async function rpc(method: string, params: unknown, token?: string) {
  let response = await worker.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
    ENV,
  );
  let body = (await response.json()) as any;
  return { response, body };
}

async function callTool(name: string, args: unknown, token?: string) {
  return rpc("tools/call", { name, arguments: args }, token);
}

describe("OAuth tier gating (stubbed JWKS + Shield API)", () => {
  it("anonymous: Shield tools require login, free tools still work", async () => {
    _resetJwksCache();
    let whoami = await callTool("shield_whoami", {});
    expect(whoami.body.result.isError).toBe(true);
    expect(whoami.body.result.content[0].text).toContain("authorization_required");

    let free = await callTool("resolve_package", { package: "preact" });
    expect(free.body.result.structuredContent.resolvedVersion).toBe("10.26.4");
  });

  it("approved token: shield_whoami forwards the bearer and returns the account", async () => {
    _resetJwksCache();
    let token = makeToken();
    let whoami = await callTool("shield_whoami", {}, token);
    expect(whoami.body.result.isError).toBeFalsy();
    expect(whoami.body.result.structuredContent.email).toBe("dev@example.com");
    expect(lastShieldAuth).toBe(`Bearer ${token}`);
    let joined = logLines.join("\n");
    expect(joined).not.toContain(token);
    expect(joined).toContain("shield_tool_call");
    expect(joined).toContain('"userId":"user-1"');
  });

  it("insufficient scope and bad tokens degrade correctly", async () => {
    _resetJwksCache();
    let simulateOnly = makeToken({ scope: "shield:simulate" });
    let whoami = await callTool("shield_whoami", {}, simulateOnly);
    expect(whoami.body.result.isError).toBe(true);
    expect(whoami.body.result.content[0].text).toContain("insufficient_scope");

    let sim = await callTool("shield_simulate_request", { package: "react", version: "18.3.1" }, simulateOnly);
    // simulate is stubbed at the Shield origin; whoami scope is not needed here.
    expect(sim.body.result.isError).toBeFalsy();
    expect(sim.body.result.structuredContent.action).toBe("pin");

    let garbage = await callTool("shield_whoami", {}, "not-a-token");
    expect(garbage.body.result.isError).toBe(true);
    expect(garbage.body.result.content[0].text).toContain("authorization_required");

    let wrongAud = await callTool("shield_whoami", {}, makeToken({ aud: "https://elsewhere.example/mcp" }));
    expect(wrongAud.body.result.content[0].text).toContain("authorization_required");
  });

  it("audit is Shield-enriched anonymously and when logged in", async () => {
    _resetJwksCache();
    let anon = await callTool("audit_dependencies", { dependencies: { preact: "^10.25.0" } });
    expect(anon.body.result.structuredContent.shieldVerdicts).toHaveLength(1);
    expect(anon.body.result.structuredContent.shieldVerdicts[0].verdict).toBe("clean");
    expect(anon.body.result.structuredContent.shieldVerdicts[0].advisories[0].cve_id).toBe("CVE-2026-0001");

    let authed = await callTool("audit_dependencies", { dependencies: { preact: "^10.25.0" } }, makeToken());
    expect(authed.body.result.structuredContent.shieldVerdicts).toHaveLength(1);
    expect(authed.body.result.structuredContent.shieldVerdicts[0].verdict).toBe("clean");
  });

  it("anonymous: shield_check_packages works with curated public intel", async () => {
    _resetJwksCache();
    let check = await callTool("shield_check_packages", { packages: [{ name: "preact", version: "10.26.4" }] });
    expect(check.body.result.isError).toBeFalsy();
    let content = check.body.result.structuredContent;
    expect(content.loginRequired).toBe(false);
    expect(content.results[0].verdict).toBe("clean");
    expect(content.results[0].advisories[0].cve_id).toBe("CVE-2026-0001");
    // Shield API calls identify as MCP traffic for attribution metrics.
    expect(lastShieldClientSource).toBe("mcp");
    expect(lastShieldUserAgent).toContain("unpkg-mcp/");
    // Allowlist: classifier internals never reach the agent.
    let raw = JSON.stringify(content);
    expect(raw).not.toContain("SECRET ANALYSIS TEXT");
    expect(raw).not.toContain("confidence");
    expect(raw).not.toContain("description");

    let domains = await callTool("shield_domain_packages", {});
    expect(domains.body.result.isError).toBe(true);
    expect(domains.body.result.content[0].text).toContain("authorization_required");
  });

  it("domain summary never relays the all-source total, even for admins", async () => {
    _resetJwksCache();
    let token = makeToken();
    let summary = await callTool("shield_domain_packages", {}, token);
    expect(summary.body.result.isError).toBeFalsy();
    let domains = summary.body.result.structuredContent.domains;
    expect(domains[0].package_count).toBe(54);
    expect(domains[0].unpkg_package_count).toBe(54);
    expect(JSON.stringify(domains)).not.toContain("314");
  });

  it("approved token: domain threats mode passes through", async () => {
    _resetJwksCache();
    let token = makeToken();
    let threats = await callTool("shield_domain_packages", { domain: "example.com", includeThreats: true }, token);
    expect(threats.body.result.isError).toBeFalsy();
    expect(threats.body.result.structuredContent.malicious_confirmed).toBe(1);
    expect(lastShieldAuth).toBe(`Bearer ${token}`);
  });

  it("serves protected-resource metadata pointing at the issuer", async () => {
    let response = await worker.fetch(new Request("http://localhost/.well-known/oauth-protected-resource"), ENV);
    let body = (await response.json()) as any;
    expect(body.resource).toBe(RESOURCE);
    expect(body.authorization_servers).toEqual([ISSUER]);
    // Clients with a pathed resource also probe the RFC 9728 suffixed URL.
    let suffixed = await worker.fetch(new Request("http://localhost/.well-known/oauth-protected-resource/mcp"), ENV);
    expect(suffixed.status).toBe(200);
    expect(((await suffixed.json()) as any).resource).toBe(RESOURCE);
  });
});
