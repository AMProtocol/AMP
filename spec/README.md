# Agent Manifest Specification

This directory is the single source of truth for the AMP specification and its schemas.

| File | Purpose | Published at |
|---|---|---|
| [`v0.3.md`](./v0.3.md) | Current specification (revision 0.3.1) | |
| [`v0.2.md`](./v0.2.md) | Previous version; its manifests remain valid | |
| [`schemas/v0.3/manifest.json`](./schemas/v0.3/manifest.json) | Schema for manifests declaring `agentmanifest-0.3` | `https://agent-manifest.com/schemas/v0.3/manifest.json` |
| [`schemas/v0.2/manifest.json`](./schemas/v0.2/manifest.json) | Schema for manifests declaring `agentmanifest-0.2` | `https://agent-manifest.com/schemas/v0.2/manifest.json` |
| [`registry-record.schema.json`](./registry-record.schema.json) | Registry record that wraps a manifest with its trust status | `https://agent-manifest.com/schemas/registry-record.json` |
| [`archive/`](./archive/) | Retired v0.1 documents | |

A manifest is validated against the schema of the `spec_version` it declares.

The validator package carries a generated copy of `schemas/` (Railway builds each service from its own folder). After editing a schema, run `npm run sync-schemas` from the repository root; CI fails if the copy is out of date.
