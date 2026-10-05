#!/usr/bin/env node
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createAmpMcpServer } from './create-server.js';

const MCP_SSE_PATH = process.env.AMP_MCP_SSE_PATH ?? '/mcp';
const MCP_MESSAGES_PATH = process.env.AMP_MCP_MESSAGES_PATH ?? '/messages';
const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const ALLOWED_HOSTS = process.env.AMP_ALLOWED_HOSTS
  ? process.env.AMP_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
  : ['agent-manifest.com', 'www.agent-manifest.com', 'localhost', '127.0.0.1'];

const transports: Record<string, SSEServerTransport> = {};

const app = createMcpExpressApp({
  host: HOST,
  allowedHosts: ALLOWED_HOSTS,
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'amp-mcp', transport: 'sse' });
});

app.get('/', (req, res) => {
  const accept = req.get('accept') ?? '';
  if (accept.includes('application/json') || accept.includes('application/*')) {
    res.json({
      service: 'amp-mcp',
      transport: 'sse',
      sse: MCP_SSE_PATH,
      messages: MCP_MESSAGES_PATH,
      health: '/health',
      human_docs: 'https://agent-manifest.com/#integrate',
      stdio: 'npx -y @agentmanifest/mcp-server@0.1.5',
    });
    return;
  }
  res.redirect(302, 'https://agent-manifest.com/#integrate');
});

app.get(MCP_SSE_PATH, async (req, res) => {
  try {
    const transport = new SSEServerTransport(MCP_MESSAGES_PATH, res);
    const sessionId = transport.sessionId;
    transports[sessionId] = transport;
    transport.onclose = () => {
      delete transports[sessionId];
    };

    const server = createAmpMcpServer();
    await server.connect(transport);
  } catch (error) {
    console.error('SSE connection error:', error);
    if (!res.headersSent) {
      res.status(500).send('Failed to establish SSE stream');
    }
  }
});

app.post(MCP_MESSAGES_PATH, async (req, res) => {
  const sessionId = req.query.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) {
    res.status(400).send('Missing sessionId query parameter');
    return;
  }

  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).send('Unknown session');
    return;
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Message handling error:', error);
    if (!res.headersSent) {
      res.status(500).send('Error handling MCP message');
    }
  }
});

app.listen(PORT, HOST, () => {
  console.log(
    `AMP MCP (SSE) listening on http://${HOST}:${PORT} — SSE GET ${MCP_SSE_PATH}, POST ${MCP_MESSAGES_PATH}`
  );
});

process.on('SIGINT', async () => {
  for (const id of Object.keys(transports)) {
    try {
      await transports[id].close();
    } catch {
      /* ignore */
    }
    delete transports[id];
  }
  process.exit(0);
});
