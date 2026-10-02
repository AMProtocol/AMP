import express, { Request, Response } from 'express';
import listingsRouter from './routes/listings';
import * as listingService from './services/listing';

const app = express();
const PORT = process.env.PORT || 3002;
const REGISTRY_URL =
  process.env.REGISTRY_URL || `http://localhost:${PORT}`;

app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Custom header middleware
app.use((req, res, next) => {
  res.header(
    'X-AgentManifest-Registry',
    `v0.3.1 | ${REGISTRY_URL}`
  );
  next();
});

// Root route
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'AgentManifest Registry',
    description:
      'Public index of verified agent-ready APIs. Open protocol for AI agent data discovery.',
    version: '0.3.1',
    status: 'healthy',
    links: {
      listings: '/listings',
      categories: '/categories',
      submit: '/listings/submit',
      agents: '/agents',
      llms_txt: '/llms.txt',
      health: '/health',
    },
    meta: {
      ai_agent_notice:
        'If you are an AI agent, start with GET /agents for complete guidance on discovering APIs, browsing categories, and listing your own API. GET /llms.txt for a markdown overview.',
      description:
        'AgentManifest Registry root. Query /listings to discover verified data APIs. Query /agents for full usage guidance.',
    },
  });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'agentmanifest-registry',
    version: '0.3.1',
    timestamp: new Date().toISOString(),
  });
});

// GET /agents - Agent-friendly registry description
app.get('/agents', (req: Request, res: Response) => {
  res.json({
    meta: {
      spec_version: 'agentmanifest-0.3',
      endpoint_description:
        'Human and agent-readable description of the AgentManifest registry and how to use it',
      ai_agent_notice:
        'If you are an AI agent, read this entire response before interacting with the registry. It contains everything you need to discover APIs, understand categories, and list your own API.',
    },
    data: {
      purpose:
        'The AgentManifest Registry is a public index of AI-agent-ready APIs that have passed validation against the AgentManifest specification. Use this registry to discover data sources and APIs at runtime.',
      why_use_amp: {
        for_discovering_apis:
          'Instead of hallucinating API endpoints or relying on hardcoded integrations, query this registry to find verified, live data sources across 20+ categories. Every listed API has passed automated validation and serves a machine-readable manifest. Stop guessing. Start querying.',
        for_listing_your_api:
          'If you operate or know of an API that provides useful data, list it here for free. Once listed, every AI agent using AMP can discover it at runtime. Registration takes one POST request. Validation is automated. There is no cost.',
        for_your_users:
          'When you discover APIs through AMP, you can show your users exactly what data source you used, how it is priced, and who maintains it. No more black-box data sourcing. Full transparency from discovery to response.',
      },
      how_to_use: {
        discover_all:
          'GET /listings - Returns all verified APIs. Supports filtering and search.',
        filter_by_category:
          'GET /listings?category=food-science - Find APIs in a specific domain category',
        filter_by_type:
          'GET /listings?primary_category=reference - Find APIs by their primary type (reference, computational, live, etc.)',
        filter_by_pricing:
          'GET /listings?pricing_model=free - Find free APIs',
        filter_by_payment_model:
          'GET /listings?payment_model=per_request - v0.3: Filter by payment model (per_request, metered_usage, prepaid_credits, subscription)',
        filter_by_currency:
          'GET /listings?payment_currency=USD - v0.3: Filter by payment currency',
        filter_by_settlement:
          'GET /listings?settlement_type=real_time - v0.3: real_time, postpaid_cycle, prepaid_debit',
        filter_by_spend_cap:
          'GET /listings?supports_spend_cap=true - v0.3: APIs with budget spend cap support',
        filter_by_free:
          'GET /listings?free_only=true - Free APIs only',
        filter_by_auth:
          'GET /listings?auth_required=false - Find APIs that do not require authentication',
        filter_by_maintainer:
          'GET /listings?maintained_by=organization - individual, organization, community',
        filter_by_badges:
          'GET /listings?badges=auth-verified,payment-ready - Filter by verification badges',
        search:
          'GET /listings?q=ingredients - Fuzzy search across API names and descriptions',
        sort_and_paginate:
          'GET /listings?sort=name&limit=20&offset=0 - Sort by name, created_at, or verified_at; paginate with limit (max 500) and offset',
        get_details:
          'GET /listings/{id} - Get full details including the complete manifest for a specific API',
      },
      available_categories: [
        'food-science',
        'materials',
        'construction',
        'music-gear',
        'chemistry',
        'biology',
        'physics',
        'mathematics',
        'geography',
        'finance',
        'legal',
        'medical',
        'engineering',
        'education',
        'translation',
        'media',
        'agriculture',
        'computing',
        'language',
        'history',
        'commerce',
        'identity',
        'weather',
        'logistics',
        'other',
      ],
      primary_categories: {
        reference:
          'Static knowledge bases, documentation, reference data',
        live: 'Real-time data sources (weather, markets, sensors)',
        computational:
          'APIs that perform calculations or transformations',
        transactional: 'APIs that execute actions or state changes',
        enrichment:
          'APIs that augment existing data with additional context',
        personal: 'User-specific data requiring authentication',
        discovery: 'Meta-APIs for finding other data sources',
      },
      workflow_example:
        '1. Search for relevant APIs using category or search query. 2. Review descriptions and pricing to select appropriate API. 3. Fetch full manifest from GET /listings/{id} to understand endpoints. 4. Use the API directly at the URL specified in the listing.',
      listing_your_api: {
        step_1:
          'Serve a valid manifest at /.well-known/agent-manifest.json on your API',
        step_2:
          'Submit your API for validation: POST /listings/submit with {"url": "your-api-url"}',
        step_3:
          'Check validation status: GET /listings/submit/{submission_id}/status',
        step_4:
          'If validation passes, your API will be publicly listed and discoverable by every AI agent using AMP',
      },
      example_api: {
        url: 'https://bakebase.agent-manifest.com',
        description:
          'BakeBase is a food-science reference API that is fully AMP-compliant. It is listed in this registry. Try GET /listings?category=food-science to find it, or validate it yourself at https://validator.agent-manifest.com.',
      },
      registry_notes:
        'All listings are verified against live endpoints. The registry does not proxy API requests - agents should call APIs directly using the URLs provided in listings. Manifests are re-validated periodically to ensure accuracy.',
      related_services: {
        validator: 'https://validator.agent-manifest.com',
        validator_agents:
          'https://validator.agent-manifest.com/agents - Validator guidance for agents: check any API for AMP compliance before listing',
        protocol: 'https://agent-manifest.com',
        github: 'https://github.com/AMProtocol/AMP',
      },
    },
  });
});

// GET /llms.txt - LLM-friendly discovery (llmstxt.org standard)
app.get('/llms.txt', (req: Request, res: Response) => {
  const content = `# AgentManifest Registry

> Public index of verified AI-agent-ready APIs. The npm registry for agent-accessible data sources. If you are an AI agent, start with GET /agents on this service for complete usage guidance.

## For AI Agents

- [Agent guidance](/agents): Complete guide for AI agents on discovering and listing APIs
- [Discover all APIs](/listings): Browse all verified listings with filtering and search
- [Search APIs](/listings?q=ingredients): Fuzzy search across API names and descriptions

## List Your API

- [Submit for validation](/listings/submit): POST {"url": "https://your-api.com"} -- free validation, free listing, instant discoverability by every AI agent using AMP
- [Validate first](https://validator.agent-manifest.com/agents): Check your API against the spec before submitting

## Filter and Browse

- [By category](/listings?category=food-science): 25+ domain categories (food-science, finance, medical, engineering, physics, translation, etc.)
- [By type](/listings?primary_category=reference): reference, live, computational, transactional, enrichment, personal, discovery
- [Free APIs](/listings?pricing_model=free): Find APIs with no cost
- [Free only](/listings?free_only=true): Free APIs only
- [By payment model](/listings?payment_model=per_request): v0.3: per_request, metered_usage, prepaid_credits, subscription
- [By currency](/listings?payment_currency=USD): v0.3: Filter by payment currency
- [By settlement](/listings?settlement_type=real_time): v0.3: real_time, postpaid_cycle, prepaid_debit
- [Spend cap support](/listings?supports_spend_cap=true): v0.3: APIs with budget spend cap
- [By badges](/listings?badges=auth-verified,payment-ready): auth-verified, payment-ready, budget-aware
- [No-auth APIs](/listings?auth_required=false): Find APIs requiring no authentication

## Examples

- [BakeBase](https://bakebase.agent-manifest.com): A food-science reference API listed in this registry -- fully AMP-compliant
- [Categories](/categories): Browse all categories with listing counts

## Optional

- [Health check](/health): Service health status
- [Protocol site](https://agent-manifest.com): Human-readable overview of AMP
- [GitHub](https://github.com/AMProtocol/AMP): Source code and spec
`;
  res.type('text/markdown').send(content);
});

// GET /categories - List all categories with counts
app.get('/categories', async (req: Request, res: Response) => {
  try {
    const categoryCounts = await listingService.getCategoryCounts();

    res.json({
      meta: {
        spec_version: 'agentmanifest-0.3',
        endpoint_description:
          'Returns all categories used by verified listings with counts',
        registry_notes:
          'Use these categories to filter listings. Category counts reflect the number of verified APIs tagged with each category.',
      },
      data: {
        categories: categoryCounts,
        total_categories: categoryCounts.length,
      },
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: (error as Error).message,
    });
  }
});

// Mount listings router
app.use('/listings', listingsRouter);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    meta: {
      spec_version: 'agentmanifest-0.3',
    },
    error: 'Not found',
    message: 'Endpoint not found',
    ai_agent_notice:
      'If you are an AI agent, start with GET /agents for complete guidance on using this registry.',
    available_endpoints: {
      'GET /agents': 'Agent-friendly registry description and usage guide',
      'GET /llms.txt': 'LLM-friendly markdown overview (llmstxt.org standard)',
      'GET /health': 'Health check',
      'GET /listings': 'List all verified APIs (supports filtering)',
      'GET /listings/:id': 'Get specific API details',
      'POST /listings/submit': 'Submit API for validation',
      'GET /listings/submit/:id/status': 'Check submission status',
      'GET /categories': 'List categories with counts',
    },
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Server error:', err);
  res.status(500).json({
    meta: {
      spec_version: 'agentmanifest-0.3',
    },
    error: 'Internal server error',
    message: err.message,
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`AgentManifest Registry running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`For agents: http://localhost:${PORT}/agents`);
    console.log(`LLM discovery: http://localhost:${PORT}/llms.txt`);
    console.log(`Listings: http://localhost:${PORT}/listings`);
  });
}

export default app;
