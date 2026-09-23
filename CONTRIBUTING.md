# Contributing to AgentManifest

Thanks for your interest in contributing to the Agent Manifest Protocol. This is an open protocol — the spec, validator, and registry are all open source and we welcome contributions at every level.

## Ways to Contribute

**Spec proposals** — Suggest changes or additions to the AgentManifest specification. Open an issue with the `spec` label describing what you'd change and why. Spec changes are discussed publicly before being accepted.

**Validator improvements** — Bug fixes, new validation checks, better error messages, or performance improvements to the validation library, CLI, or web API.

**Registry features** — Improvements to the public registry API — better search, new filters, rate limiting, analytics, or a web UI.

**Reference implementations** — Build an AgentManifest-compliant API in any domain. This is one of the highest-impact contributions — every new domain that gets a reference API proves the protocol works beyond food science.

**Documentation** — Clarifications, examples, tutorials, or guides for API providers looking to add AgentManifest support.

## Getting Set Up

### Prerequisites

- Node.js 18+
- PostgreSQL 15+ (or Docker)

### Quick Start with Docker

```bash
git clone https://github.com/AMProtocol/AMP.git
cd agentmanifest
docker-compose up -d
```

This starts PostgreSQL, the validator (port 3001), and the registry (port 3002).

### Manual Setup

```bash
git clone https://github.com/AMProtocol/AMP.git
cd agentmanifest
npm install

# Validator
cd validator
npm install && npm run build
npm run dev  # http://localhost:3001

# Registry (in another terminal)
cd registry
npm install
echo "DATABASE_URL=postgresql://user:password@localhost:5432/agentmanifest_registry" > .env
echo "VALIDATOR_URL=http://localhost:3001" >> .env
npm run prisma:generate && npm run prisma:push && npm run prisma:seed
npm run dev  # http://localhost:3002
```

### Verify It Works

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3002/listings
```

## Project Structure

This is a monorepo with npm workspaces:

```
/spec          ← Specification (v0.2.md + schema.json) — the canonical copy
/validator     ← Validation library + CLI + web API
/registry      ← Public registry API + database
```

The `spec/` directory at the root is the canonical source for the specification and its JSON Schemas. `validator/schemas/` is a generated copy used for build-time bundling: edit `spec/`, then run `npm run sync-schemas`. CI fails if the copy is out of date.

## Pull Request Guidelines

1. **One concern per PR.** Don't mix a spec change with a code refactor.
2. **Describe the "why."** The PR description should explain what problem you're solving, not just what you changed.
3. **Test your changes.** Run the validator against a compliant API (`npm run cli -- validate https://bakebase.agent-manifest.com`) and verify the registry endpoints still work.
4. **Keep the spec stable.** Changes to `spec/v0.3.md`, `spec/v0.2.md`, or `spec/schemas/` have downstream effects on every existing manifest. We take spec changes seriously — open an issue to discuss before submitting a PR.

## Proposing Spec Changes

The spec is versioned and changes go through discussion before merging:

1. Open an issue with the `spec` label
2. Describe: what you'd add/change, why it matters, and whether it's backwards-compatible
3. The community discusses
4. If accepted, submit a PR against `spec/v0.3.md` and the matching schema in `spec/schemas/`

Backwards-compatible additions (new optional fields, new categories) have a much lower bar than breaking changes.

### Adding New Categories

To propose a new category for the controlled vocabulary:

1. Open an issue with the `category-request` label
2. Explain the domain and why existing categories don't cover it
3. Provide at least one example API that would use the category

## Code Style

- TypeScript with strict mode
- Express for HTTP services
- Prisma for database access
- Descriptive variable names over comments
- Error messages should be helpful to API providers debugging their manifests

## Questions?

Open an issue at [github.com/AMProtocol/AMP/issues](https://github.com/AMProtocol/AMP/issues) or email brandon@agent-manifest.com.
