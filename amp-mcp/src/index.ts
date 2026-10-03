#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAmpMcpServer } from './create-server.js';

async function main(): Promise<void> {
  const server = createAmpMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('AMP MCP server failed:', err);
  process.exit(1);
});
