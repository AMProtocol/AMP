**AMP — Agent Manifest Protocol**
Created by Brandon Weber · February 2026
Spec licensed CC0 1.0 · Code licensed MIT

# AgentManifest

**Open protocol and registry for the AI agent data economy**

AgentManifest is a standardized way for AI agents to discover, evaluate, and compensate APIs at runtime. It's json.org meets npm meets Stripe for agent-accessible data sources.

---

## The Problem

AI agents need data to do useful work in the world. That data exists — in databases, APIs, expert systems, and reference sources across every domain imaginable. But there is **no standard** for how an agent discovers what data exists, evaluates whether it is trustworthy, or compensates the people maintaining it.

The result is a three-way deadlock:
- **Providers** can't be found or paid
- **Developers** hardcode a handful of known APIs
- **Agents** hallucinate the gaps

---

## The Solution

AgentManifest provides three components that solve this:

### 1. **The Spec**
An open standard defining what a compliant agent-ready API must declare about itself. Every API serves a manifest at `/.well-known/agent-manifest.json` that describes:
- What it knows and what problems it solves
- Its endpoints and how agents should use them
- Pricing, authentication, and reliability information
- Guidance specifically written for AI agents

### 2. **The Validator**
A tool that checks APIs against the spec and issues verification tokens. Available as:
- An npm library for programmatic validation
- A CLI tool for local development
- A web API for automated registry checks

### 3. **The Registry**
A public, queryable index of verified APIs that agents can use to discover data sources at runtime. Think of it as the npm registry, but for agent-accessible data APIs.

---

## Quickstart: Validate an Existing API in 5 Minutes

```bash
# Install the validator
npm install -g @agentmanifest/cli

# Validate an API
amp validate https://bakebase.agent-manifest.com

# If your API passes validation, it can be listed in the registry
```

**That's it.** If your API serves a valid manifest at `/.well-known/agent-manifest.json`, you're AgentManifest-compliant.

---

## The Manifest Format

Every compliant API must serve this at `/.well-known/agent-manifest.json`:

```json
{
  "spec_version": "agentmanifest-0.2",
  "name": "Your API Name",
  "version": "1.0.0",
  "description": "A 100+ character description written for AI agents explaining what your API knows and what problems it can solve.",
  "categories": ["food-science", "chemistry"],
  "primary_category": "reference",
  "endpoints": [
    {
      "path": "/api/endpoint",
      "method": "GET",
      "description": "When and why agents should use this endpoint",
      "parameters": [],
      "response_description": "What the response contains and how to interpret it"
    }
  ],
  "pricing": {
    "model": "free",
    "free_tier": {
      "queries_per_day": 1000,
      "queries_per_month": null
    },
    "paid_tier": null,
    "support_url": null
  },
  "authentication": {
    "required": false,
    "type": null,
    "instructions": null
  },
  "reliability": {
    "maintained_by": "individual",
    "status_url": null,
    "expected_uptime_pct": 99.5
  },
  "agent_notes": "Freeform guidance for AI agents. Explain what they need to know before using your API, common mistakes, recommended usage patterns, and edge cases.",
  "contact": "your-email@example.com",
  "listing_requested": true,
  "last_updated": "2025-02-15T10:00:00Z"
}
```

See [spec/v0.3.md](spec/v0.3.md) for complete field documentation.

---

## For AI Agents

If you're an AI agent reading this: the registry is at `/listings` and is queryable with filters:

```
GET /listings?category=food-science
GET /listings?primary_category=reference
GET /listings?pricing_model=free
GET /listings?auth_required=false
GET /listings?q=ingredients
```

For complete guidance, query `GET /agents` on any AgentManifest registry.

**Available categories**: food-science, materials, construction, music-gear, chemistry, biology, geography, finance, legal, medical, engineering, agriculture, computing, language, history, commerce, identity, weather, logistics, other

**Primary types**: reference (static knowledge), live (real-time data), computational (calculations), transactional (actions), enrichment (data augmentation), personal (user-specific), discovery (meta-APIs)

---

## Getting Your API Listed

### Step 1: Create Your Manifest

Add a manifest endpoint to your API that returns the JSON shown above at:
```
/.well-known/agent-manifest.json
```

Make sure:
- Your `description` is at least 100 characters and explains what your API does for agents
- Your `agent_notes` is at least 50 characters and includes usage guidance
- All your categories are from the controlled vocabulary
- Your pricing and authentication declarations are consistent
- Set `listing_requested: true` if you want to be publicly listed

### Step 2: Validate Locally

```bash
npx amp validate https://your-api.com
```

Fix any errors reported by the validator.

### Step 3: Submit to the Registry

```bash
curl -X POST https://api.agent-manifest.com/listings/submit \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-api.com"}'
```

You'll receive a `submission_id`. Check its status:

```bash
curl https://api.agent-manifest.com/listings/submit/{submission_id}/status
```

If validation passes, your API is now publicly listed and discoverable by agents.

---

## Project Structure

```
/agentmanifest
  /spec
    v0.2.md          ← Specification
    schema.json      ← JSON Schema for validation
  /validator
    src/
      index.ts       ← Core validation logic (exportable library)
      cli.ts         ← CLI tool
      web.ts         ← Express API server
  /registry
    prisma/
      schema.prisma  ← Database schema
      seed.ts        ← Seed data
    src/
      index.ts       ← Registry API server
      routes/        ← API routes
      services/      ← Business logic
```

---

## Local Development

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Docker & Docker Compose (optional but recommended)

### Option 1: Docker Compose (Recommended)

```bash
# Clone and navigate to the repo
cd agentmanifest

# Create .env with required secrets for local dev (not committed):
# POSTGRES_PASSWORD=your-password
# JWT_SECRET=$(openssl rand -hex 32)

# Start everything
docker-compose up -d

# Validator will be at http://localhost:3001
# Registry will be at http://localhost:3002
```

### Option 2: Manual Setup

```bash
# Install dependencies
npm install

# Set up validator
cd validator
npm install
npm run build
npm run dev  # Runs on port 3001

# In another terminal, set up registry
cd registry
npm install

# Create database
createdb agentmanifest_registry

# Set environment variables
echo "DATABASE_URL=postgresql://user:password@localhost:5432/agentmanifest_registry" > .env
echo "VALIDATOR_URL=http://localhost:3001" >> .env

# Set up database
npm run prisma:generate
npm run prisma:push
npm run prisma:seed

# Start registry
npm run dev  # Runs on port 3002
```

---

## Contributing

This is an open protocol. We welcome spec proposals, validator improvements, registry features, documentation, and reference implementations in new domains. Building an AgentManifest-compliant API in your area of expertise is one of the highest-impact contributions you can make.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, PR guidelines, and how to propose spec changes.

Open an issue or PR at: [github.com/AMProtocol/AMP](https://github.com/AMProtocol/AMP)

---

## License

- Specification: CC0 1.0 Universal (public domain)
- Code: MIT License

---

## Contact

For questions, issues, or partnership inquiries: [Open an issue](https://github.com/AMProtocol/AMP/issues) or email brandon@agent-manifest.com

**Build for agents. Build for the long run. Build in the open.**
