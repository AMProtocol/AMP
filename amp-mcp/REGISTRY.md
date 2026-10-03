# Publishing AMP MCP (current MCP Registry docs)

Official docs start here: **[The MCP Registry — About](https://modelcontextprotocol.io/registry/about)**.

This is **not** a separate “Anthropic-only” registry. It is the **official MCP Registry** (preview), backed by Anthropic, GitHub, PulseMCP, Microsoft, etc. It stores **`server.json` metadata** only — not your server binary (that stays on **npm** and/or your **HTTPS** host).

**Important (from the about page):** most **host apps do not read the registry directly**. They use **downstream marketplaces/aggregators** that sync from the registry API. You publish once to the MCP Registry; Smithery/PulseMCP-style catalogs are separate unless they ingest the official feed.

---

## What you already have

| Asset | URL / id |
|--------|-----------|
| Hosted SSE hub | `https://mcp.agent-manifest.com/mcp` (health: `/health`) |
| npm stdio | `@agent-manifest/mcp-server` |
| Metadata file | [`server.json`](./server.json) |
| Registry name | `com.agent-manifest/amp-mcp` |

---

## Step-by-step (official quickstart)

Follow: **[Quickstart: Publish an MCP Server](https://modelcontextprotocol.io/registry/quickstart)**

### 1. `mcpName` must match `server.json` → `name`

In `package.json`:

```json
"mcpName": "com.agent-manifest/amp-mcp"
```

Must equal `server.json` → `"name": "com.agent-manifest/amp-mcp"`.

After adding `mcpName`, **bump npm version** and `npm publish` again (registry verifies the live npm package).

### 2. Install `mcp-publisher` (binary, not npm)

```bash
brew install mcp-publisher
# or see https://modelcontextprotocol.io/registry/quickstart
```

### 3. Create or refine `server.json`

```bash
cd amp-mcp
mcp-publisher init   # optional; we already ship server.json
```

Schema: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`

Remote SSE entry is valid but **deprecated** for new clients — see [Publishing remote servers](https://modelcontextprotocol.io/registry/remote-servers). Prefer adding **streamable-http** later; keep `sse` for compatibility.

### 4. Authenticate (namespace must match)

See **[Authentication](https://modelcontextprotocol.io/registry/authentication)**.

| Method | `server.json` name prefix | You |
|--------|---------------------------|-----|
| **GitHub** | `io.github.AMProtocol/...` | `mcp-publisher login github` as org member |
| **DNS / HTTP** | `com.agent-manifest/...` | Prove `agent-manifest.com` (TXT or `/.well-known/mcp-registry-auth`) |

We use **`com.agent-manifest/amp-mcp`** → use **DNS or HTTP** auth on **agent-manifest.com** (or switch name + `mcpName` to `io.github.AMProtocol/amp-mcp` and use GitHub login).

### 5. Publish

```bash
mcp-publisher publish
```

Verify (API version from quickstart):

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=agent-manifest"
```

---

## Smithery (separate marketplace)

Still valid as a **downstream** catalog: [smithery.ai/docs/build/publish](https://www.smithery.ai/docs/build/publish)

- **Stdio:** connect GitHub `AMProtocol/AMP`, root `amp-mcp/`, `smithery.yaml`
- **URL:** Smithery favors **Streamable HTTP**; your hub is **SSE** today — use GitHub/stdio path or add streamable-http on the same host later

---

## Checklist

1. Add `mcpName` → republish npm  
2. `mcp-publisher login` (github **or** dns/http for `com.agent-manifest`)  
3. `mcp-publisher publish`  
4. Smithery / other marketplaces (optional, separate sign-up)  
5. Link from [agent-manifest.com](https://agent-manifest.com) to npm + `mcp.agent-manifest.com`
