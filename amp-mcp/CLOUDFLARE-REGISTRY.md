# Cloudflare + MCP Registry (domain auth for `com.agent-manifest/amp-mcp`)

You own **agent-manifest.com** on Cloudflare. Use **HTTP domain auth** (simplest) or **DNS TXT** (alternative). Both prove the same namespace for `mcp-publisher publish`.

Private signing key lives only in **`amp-mcp/.registry-keys/key.pem`** (gitignored). Back it up in 1Password; never commit it.

---

## Option A — HTTP auth (recommended)

### 1. Deploy the proof file

The public proof is committed at:

`agentmanifest-landing/.well-known/mcp-registry-auth`

After deploy, this must return **200** with a single line body:

```bash
curl -sS https://agent-manifest.com/.well-known/mcp-registry-auth
```

Expected:

```text
v=MCPv1; k=ed25519; p=90etDKbGEr45/9KKacEs5YqrpbiQICS7qWdPwjaUKIw=
```

**Cloudflare Pages:** ensure `.well-known/` is included in the build output (not ignored).

**Cloudflare proxy:** orange-cloud is fine; no special rule needed for this path.

### 2. Login and publish

```bash
brew install mcp-publisher   # or download from MCP registry quickstart

cd amp-mcp
npm version patch && npm publish --access public   # must include mcpName in package.json

DOMAIN=agent-manifest.com
PRIVATE_KEY="$(openssl pkey -in .registry-keys/key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"

mcp-publisher validate server.json
mcp-publisher login http --domain "$DOMAIN" --private-key "$PRIVATE_KEY"
mcp-publisher publish
```

### 3. Verify

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=com.agent-manifest"
```

---

## Option B — DNS TXT (Cloudflare dashboard)

If you prefer TXT instead of HTTP (or as backup):

1. Cloudflare → **agent-manifest.com** → **DNS** → **Add record**
2. **Type:** `TXT`
3. **Name:** `@` (apex)
4. **Content** (one string):

```text
v=MCPv1; k=ed25519; p=90etDKbGEr45/9KKacEs5YqrpbiQICS7qWdPwjaUKIw=
```

5. Wait for propagation (often 1–5 minutes with Cloudflare).

```bash
dig TXT agent-manifest.com +short
```

Login with DNS:

```bash
mcp-publisher login dns --domain agent-manifest.com --private-key "$PRIVATE_KEY"
mcp-publisher publish
```

---

## MCP hub DNS (already set)

| Record | Target |
|--------|--------|
| `mcp` CNAME | Railway hostname for the `mcp` service |
| Proxy | Your choice; if SSE clients fail, try **DNS only** (grey cloud) |

Health: `https://mcp.agent-manifest.com/health`

---

## Rotate keys

1. Generate new `key.pem`, update `.well-known/mcp-registry-auth` (and TXT if used).
2. Deploy landing.
3. `mcp-publisher login http` (or `dns`) again.
4. `mcp-publisher publish`.
