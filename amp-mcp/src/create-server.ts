import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { fetchManifestByDomain } from './lib/fetch-manifest.js';
import { validateManifestSyntax } from './lib/validate-syntax.js';
import { checkAgentPermissions } from './lib/check-permissions.js';
import type { AmpManifest } from './lib/types.js';

const manifestObjectSchema = z
  .record(z.unknown())
  .describe('Parsed AMP manifest object (agentmanifest-0.2 or agentmanifest-0.3).');

export function createAmpMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'agent-manifest-protocol',
      version: '0.1.0',
    },
    {
      instructions: [
        'You are connected to the official Agent Manifest Protocol (AMP) MCP server.',
        'Use fetch_manifest_by_domain to discover /.well-known/agent-manifest.json (and fallbacks) for any API origin.',
        'Use validate_manifest_syntax before trusting manifest JSON.',
        'Use check_agent_permissions before calling an API operation to see if it matches declared endpoints, auth, payment, and agent_notes constraints.',
        'AMP complements MCP: MCP carries tools; AMP declares what remote agents/APIs allow, cost, and how to authenticate.',
      ].join(' '),
    }
  );

  server.registerTool(
    'fetch_manifest_by_domain',
    {
      title: 'Fetch AMP manifest by domain',
      description:
        'Resolve an API origin from a domain (e.g. "bakebase.agent-manifest.com"), try standard AMP discovery URLs, and return parsed manifest JSON plus metadata.',
      inputSchema: {
        domain: z
          .string()
          .min(1)
          .describe(
            'API hostname or URL origin without a path, e.g. "example.com", "api.example.com", or "https://bakebase.agent-manifest.com".'
          ),
      },
    },
    async ({ domain }) => {
      const result = await fetchManifestByDomain(domain);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    'validate_manifest_syntax',
    {
      title: 'Validate AMP manifest JSON Schema',
      description:
        'Validate a manifest JSON string or object against the official AMP JSON Schema for its spec_version (agentmanifest-0.2 or agentmanifest-0.3). Returns errors or a success_token.',
      inputSchema: {
        manifest: z
          .union([z.string(), manifestObjectSchema])
          .describe(
            'Either a JSON string of the manifest, or a parsed manifest object with spec_version, name, endpoints, etc.'
          ),
      },
    },
    async ({ manifest }) => {
      const result = validateManifestSyntax(manifest as string | Record<string, unknown>);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    'check_agent_permissions',
    {
      title: 'Check action against AMP manifest constraints',
      description:
        'Given an intended HTTP action (method + path or full URL) and a manifest, determine whether the action aligns with declared endpoints, authentication, payment onboarding, rate limits, and language in agent_notes.',
      inputSchema: {
        action: z
          .string()
          .min(1)
          .describe(
            'Intended operation, e.g. "POST /baking/validate-mix", "GET /health", or "POST https://api.example.com/v1/search".'
          ),
        manifest: manifestObjectSchema,
        intends_unauthenticated: z
          .boolean()
          .optional()
          .describe('Set true if the agent plans to call the API without credentials.'),
        payment_onboarded: z
          .boolean()
          .optional()
          .describe('Set true if AMP payment onboarding is already complete for this API.'),
      },
    },
    async ({ action, manifest, intends_unauthenticated, payment_onboarded }) => {
      const result = checkAgentPermissions(action, manifest as AmpManifest, {
        intends_unauthenticated,
        payment_onboarded,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
