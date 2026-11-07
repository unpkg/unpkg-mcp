# Client configuration examples

The MCP server is a remote Streamable HTTP endpoint, deployed at
`https://mcp.unpkg.com/mcp`. Local development URL used below:
`http://localhost:8787/mcp` — swap it for the deployed URL and nothing
else changes. URL is the only integration form.

## Muse Code

Muse loads MCP servers from `~/.config/muse/settings.json`. Add to the
existing `mcpServers` object:

```json
"unpkg": { "url": "http://localhost:8787/mcp" }
```

Then start a new `muse` session (servers load at startup). The general
tools need no login. For the Shield account tools afterwards:
`muse mcp login unpkg` (browser OAuth at shield.unpkg.com; disconnect
with `muse mcp logout unpkg`).

## Claude Code

```sh
claude mcp add --transport http unpkg http://localhost:8787/mcp
```

For Shield login in Claude Code, run `/mcp` in a session, select
`unpkg`, then Authenticate. Other clients: use the login action in the
client's MCP server panel (Codex: `codex mcp login unpkg`; Cursor:
Settings → MCP → unpkg → Connect; VS Code: Command Palette → MCP: List
Servers → unpkg → Authenticate). The landing page at
`https://mcp.unpkg.com/` has a per-client login picker with the exact
steps.

## Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.unpkg]
url = "http://localhost:8787/mcp"
```

## Cursor / VS Code (`.cursor/mcp.json` / `.vscode/mcp.json`)

```json
{
  "mcpServers": {
    "unpkg": { "url": "http://localhost:8787/mcp" }
  }
}
```

## Skill-only fallback (no MCP)

Copy `skill/unpkg/` into your agent's skills directory, e.g.:

- Claude Code: `~/.claude/skills/unpkg/SKILL.md`
- Or paste the rules from `skill/unpkg/SKILL.md` into your project's
  `AGENTS.md` / `CLAUDE.md`.
