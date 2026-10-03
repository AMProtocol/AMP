# Publishing AMP MCP to registries

Your hosted hub: **https://mcp.agent-manifest.com** (`GET /health`, SSE at `GET /mcp`).

npm package: **`@agent-manifest/mcp-server`** (`npx -y @agent-manifest/mcp-server`).

---

## 1. Official MCP Registry (Anthropic / GitHub / Microsoft hub)

**One publish → many clients** (Claude, aggregators, PulseMCP mirrors, etc.).

1. Install the publisher CLI (see [Publishing guide](https://modelcontextprotocol.io/registry/publishing)).
2. In this directory, metadata is in [`server.json`](./server.json):
   - **Namespace:** `com.agent-manifest/amp-mcp` → prove **DNS** on `agent-manifest.com` (recommended for your domain).
   - **Remote:** SSE `https://mcp.agent-manifest.com/mcp`
   - **Package:** npm stdio `@agent-manifest/mcp-server`
3. Authenticate (pick one):
   - **DNS** — for `com.agent-manifest/*` (TXT record challenge from `mcp-publisher login`).
   - **GitHub** — alternatively use `io.github.AMProtocol/amp-mcp` if you prefer OAuth as the org.
4. Publish:

   ```bash
   cd amp-mcp
   mcp-publisher login   # follow DNS or GitHub flow
   mcp-publisher publish
   ```

5. Verify:

   ```bash
   curl "https://registry.modelcontextprotocol.io/v0/servers?search=agent-manifest&version=latest"
   ```

**After each npm bump:** update `version` in `server.json` (both top-level and `packages[].version`), republish.

Optional: add GitHub Actions with `mcp-publisher` + OIDC — see [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) `docs/guides/publishing/github-actions.md`.

---

## 2. Smithery

Two listings are common (stdio + remote):

### A. Stdio (from GitHub + `smithery.yaml`)

1. [smithery.ai/new](https://smithery.ai/new) → connect **AMProtocol/AMP**, root **`amp-mcp/`**.
2. Smithery reads [`smithery.yaml`](./smithery.yaml) (`startCommand.type: stdio`).

### B. Remote URL (your Railway host)

Smithery’s URL flow prefers **Streamable HTTP**. You currently expose **legacy SSE** at `/mcp`.

- Try: [smithery.ai/new](https://smithery.ai/new) → URL `https://mcp.agent-manifest.com/mcp`
- If the scanner rejects SSE, keep **A** for Smithery and rely on the **official MCP Registry** `remotes` entry for hosted SSE until you add Streamable HTTP alongside SSE.

CLI (API key from Smithery dashboard):

```bash
npx @smithery/cli mcp publish "https://mcp.agent-manifest.com/mcp" -n agent-manifest/amp-mcp
# or link GitHub repo per docs
```

---

## 3. npm (already done)

- Package: https://www.npmjs.com/package/@agent-manifest/mcp-server  
- Bump version → `npm publish --access public` → update `server.json` → `mcp-publisher publish`.

---

## 4. PulseMCP & other aggregators

Most **ingest the official MCP Registry**. Publishing step **1** is usually enough; no separate PulseMCP form.

---

## 5. Cursor / Claude Desktop (not registries)

Users install manually or via registry-aware clients:

**Cursor** — MCP settings → command:

```json
{
  "mcpServers": {
    "agent-manifest-protocol": {
      "command": "npx",
      "args": ["-y", "@agent-manifest/mcp-server"]
    }
  }
}
```

**Remote SSE** — only if the client supports URL/SSE; point at `https://mcp.agent-manifest.com/mcp` (session POST to `/messages`).

**Claude Desktop** — same stdio block in `claude_desktop_config.json`, or use connectors that pull from the official registry after you publish.

---

## 6. Marketing on agent-manifest.com

Add to landing / `llms.txt`:

- MCP hub: `https://mcp.agent-manifest.com/health`
- Install: `npx @agent-manifest/mcp-server`
- Registry name: `com.agent-manifest/amp-mcp` (after publish)

---

## Checklist

| Registry | Action |
|----------|--------|
| **registry.modelcontextprotocol.io** | `mcp-publisher publish` + DNS on `agent-manifest.com` |
| **Smithery** | New project → GitHub `amp-mcp/` or URL publish |
| **npm** | Keep `@agent-manifest/mcp-server` in sync with `server.json` |
| **PulseMCP / others** | Usually automatic after official registry |
| **Cursor / Claude** | Docs + registry entry; optional landing link |
