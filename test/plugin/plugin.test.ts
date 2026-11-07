import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Claude plugin bundle (plugin/)", () => {
  it("keeps the bundled skill identical to the canonical skill", () => {
    expect(read("plugin/skills/unpkg/SKILL.md")).toBe(read("skill/unpkg/SKILL.md"));
    // Root copy for Open Plugins scanners (e.g. cursor.directory), which
    // look for skills/*/SKILL.md at the repository root.
    expect(read("skills/unpkg/SKILL.md")).toBe(read("skill/unpkg/SKILL.md"));
  });

  it("exposes an Open Plugins mcp.json at the repo root", () => {
    let root = JSON.parse(read("mcp.json"));
    expect(root.mcpServers.unpkg.url).toBe("https://mcp.unpkg.com/mcp");
  });

  it("declares the remote MCP server, skill dir, icon, and privacy URL", () => {
    let manifest = JSON.parse(read("plugin/.claude-plugin/plugin.json"));
    expect(manifest.name).toBe("unpkg");
    expect(manifest.mcpServers.unpkg).toEqual({
      type: "http",
      url: "https://mcp.unpkg.com/mcp",
    });
    expect(manifest.skills).toEqual(["./skills/"]);
    expect(manifest.privacyPolicyUrl).toBe("https://mcp.unpkg.com/privacy");
    expect(manifest.supportUrl).toBe("https://github.com/unpkg/unpkg-mcp/issues");
    expect(manifest.documentationUrl).toBe("https://mcp.unpkg.com/");
    expect(existsSync("plugin/.claude-plugin/icon.png")).toBe(true);
  });

  it("declares a valid OpenAI (ChatGPT/Codex) package in the same folder", () => {
    let portable = JSON.parse(read("plugin/plugin.json"));
    expect(portable.name).toBe("unpkg");
    let ui = portable.extensions["com.openai"].interface;
    expect(ui.displayName).toBe("UNPKG");
    expect(ui.shortDescription.length).toBeLessThanOrEqual(30);
    expect(ui.privacyPolicyURL).toBe("https://mcp.unpkg.com/privacy");
    expect(ui.termsOfServiceURL).toBe("https://mcp.unpkg.com/terms");
    expect(ui.supportURL).toBe("https://github.com/unpkg/unpkg-mcp/issues");
    expect(ui.websiteURL).toBe("https://mcp.unpkg.com/");
    let review = portable.extensions["com.openai"].review;
    expect(review.test_cases.positive.length).toBe(5);
    expect(review.test_cases.negative.length).toBe(3);

    let mcp = JSON.parse(read("plugin/mcp.json"));
    expect(mcp.mcpServers.unpkg.type).toBe("streamable-http");
    expect(mcp.mcpServers.unpkg.url).toBe("https://mcp.unpkg.com/mcp");
    let auth = mcp.mcpServers.unpkg.extensions["com.openai"].auth;
    expect(auth.type).toBe("mixed");
    expect(auth.client.mode).toBe("dcr");

    for (let asset of ["icon.png", "icon-dark.png", "logo.png", "logo-dark.png"]) {
      expect(existsSync(`plugin/assets/${asset}`)).toBe(true);
    }
  });

  it("includes the Codex compatibility overlay so local installs load the MCP server", () => {
    let codex = JSON.parse(read("plugin/.codex-plugin/plugin.json"));
    expect(codex.name).toBe("unpkg");
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers).toBe("./.mcp.json");
    expect(codex.interface.displayName).toBe("UNPKG");
    let servers = JSON.parse(read("plugin/.mcp.json"));
    expect(servers.mcpServers.unpkg).toEqual({
      type: "http",
      url: "https://mcp.unpkg.com/mcp",
    });
  });

  it("keeps every version field in sync", () => {
    let version = JSON.parse(read("package.json")).version;
    expect(JSON.parse(read("server.json")).version).toBe(version);
    expect(JSON.parse(read("plugin/.claude-plugin/plugin.json")).version).toBe(version);
    expect(JSON.parse(read("plugin/plugin.json")).version).toBe(version);
    expect(JSON.parse(read("plugin/.codex-plugin/plugin.json")).version).toBe(version);
    let marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
    expect(marketplace.plugins[0].version).toBe(version);
    expect(read("src/version.ts")).toContain(`VERSION = "${version}"`);
  });

  it("marketplace points at the plugin subfolder", () => {
    let marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
    expect(marketplace.plugins[0].name).toBe("unpkg");
    expect(marketplace.plugins[0].source).toBe("./plugin");
  });
});
