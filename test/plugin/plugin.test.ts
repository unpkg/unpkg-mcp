import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Claude plugin bundle (plugin/)", () => {
  it("keeps the bundled skill identical to the canonical skill", () => {
    expect(read("plugin/skills/unpkg/SKILL.md")).toBe(read("skill/unpkg/SKILL.md"));
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
    expect(existsSync("plugin/.claude-plugin/icon.png")).toBe(true);
  });

  it("marketplace points at the plugin subfolder", () => {
    let marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
    expect(marketplace.plugins[0].name).toBe("unpkg");
    expect(marketplace.plugins[0].source).toBe("./plugin");
  });
});
