import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateManifest, validateManifestObject, resolveManifestUrl } from '../index';
import { readFileSync } from 'fs';
import { join } from 'path';

const fixturesDir = join(__dirname, '../../fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(fixturesDir, name), 'utf-8')
  );
}

describe('validateManifestObject integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('v0.2 manifest passes validation', async () => {
    const manifest = loadFixture('v02-valid.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.passed).toBe(true);
    expect(result.spec_version).toBe('agentmanifest-0.2');
    expect(result.schema_valid).toBe(true);
    expect(result.checks.every((c) => c.passed || c.severity !== 'error')).toBe(true);
  });

  it('v0.3 free manifest passes validation', async () => {
    const manifest = loadFixture('v03-free-valid.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.passed).toBe(true);
    expect(result.spec_version).toBe('agentmanifest-0.3');
    expect(result.schema_valid).toBe(true);
  });

  it('v0.3 paid manifest runs payment checks (local validation skips network)', async () => {
    const manifest = loadFixture('v03-paid-valid.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.spec_version).toBe('agentmanifest-0.3');
    expect(result.checks.some((c) => c.name.includes('payment'))).toBe(true);
  });

  it('v0.3 agent_notes short (149 chars) fails validation', async () => {
    const manifest = loadFixture('v03-agent-notes-short.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.passed).toBe(false);
    const agentNotesCheck = result.checks.find((c) => c.name === 'agent_notes_length' || c.name === 'operationally_complete');
    expect(agentNotesCheck).toBeDefined();
    expect(agentNotesCheck?.passed).toBe(false);
  });

  it('v0.3 payment no terms yields warning in operational completeness', async () => {
    const manifest = loadFixture('v03-payment-no-terms.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    const opCompleteCheck = result.checks.find((c) => c.name === 'operationally_complete');
    expect(opCompleteCheck).toBeDefined();
    expect(opCompleteCheck?.passed).toBe(true);
    expect(opCompleteCheck?.severity).toBe('warning');
    expect(opCompleteCheck?.message).toContain('payment');
  });

  it('budget-aware badge when budget_controls supports spend_cap', async () => {
    const manifest = loadFixture('v03-paid-valid.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.badges).toContain('budget-aware');
  });

  it('v0.3 paid invalid (missing onboarding) fails schema validation', async () => {
    const manifest = loadFixture('v03-paid-invalid.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.passed).toBe(false);
    expect(result.schema_valid).toBe(false);
  });

  it('v0.2 manifest with a v0.2 payment block passes against the v0.2 schema', async () => {
    const manifest = loadFixture('v02-payment-valid.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.schema_valid).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('x402 manifest without onboarding passes', async () => {
    const manifest = loadFixture('v03-x402-valid.json');
    const result = await validateManifestObject(manifest as Record<string, unknown>, 'local-file');
    expect(result.passed).toBe(true);
    expect(result.checks.find((c) => c.name === 'payment_protocol_networks')?.passed).toBe(true);
    expect(result.checks.some((c) => c.name === 'v03_onboarding_exists')).toBe(false);
  });

  it('local validation has no manifest_url', async () => {
    const result = await validateManifestObject(loadFixture('v02-valid.json') as Record<string, unknown>, 'local-file');
    expect(result.manifest_url).toBeNull();
  });

  it('URL-sourced validation resolves manifest_url at the origin', async () => {
    const result = await validateManifestObject(
      loadFixture('v03-free-valid.json') as Record<string, unknown>,
      'https://example.com/docs/api'
    );
    expect(result.manifest_url).toBe('https://example.com/.well-known/agent-manifest.json');
  });
});

describe('manifest location (revision 0.3.1)', () => {
  it.each([
    ['example.com', 'https://example.com/.well-known/agent-manifest.json'],
    ['https://example.com/', 'https://example.com/.well-known/agent-manifest.json'],
    ['https://api.example.com/v1/tools', 'https://api.example.com/.well-known/agent-manifest.json'],
    ['http://localhost:3000/x', 'http://localhost:3000/.well-known/agent-manifest.json'],
  ])('%s resolves to %s', (input, expected) => {
    expect(resolveManifestUrl(input)).toBe(expected);
  });
});

describe('validateManifest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the manifest from the origin even when a path is submitted', async () => {
    const manifest = loadFixture('v02-valid.json');
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (url === 'https://example.com/.well-known/agent-manifest.json') {
        return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => manifest };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
    });

    const result = await validateManifest('https://example.com/some/path');
    expect(result.url).toBe('https://example.com/some/path');
    expect(result.manifest_url).toBe('https://example.com/.well-known/agent-manifest.json');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://example.com/.well-known/agent-manifest.json');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => u === 'https://example.com/test')).toBe(true);
    expect(result.schema_valid).toBe(true);
  });

  it('reports an invalid URL instead of throwing', async () => {
    const result = await validateManifest('https://');
    expect(result.passed).toBe(false);
    expect(result.manifest_url).toBeNull();
  });
});
