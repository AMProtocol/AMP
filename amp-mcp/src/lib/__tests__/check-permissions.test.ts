import { describe, expect, it } from 'vitest';
import { checkAgentPermissions, parseAction } from '../check-permissions.js';
import { validateManifestSyntax } from '../validate-syntax.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../../validator/fixtures/v03-free-valid.json'),
    'utf-8'
  )
) as Record<string, unknown>;

describe('parseAction', () => {
  it('parses method and path', () => {
    expect(parseAction('POST /baking/validate-mix')).toEqual({
      method: 'POST',
      path: '/baking/validate-mix',
    });
  });
});

describe('checkAgentPermissions', () => {
  const manifest = fixture as Record<string, unknown>;

  it('flags undeclared endpoints', () => {
    const result = checkAgentPermissions('GET /not-in-manifest', manifest);
    expect(result.verdict).toBe('violation');
    expect(result.findings.some((f) => f.code === 'endpoint_not_declared')).toBe(true);
  });

  it('validates fixture syntax', () => {
    const syntax = validateManifestSyntax(manifest);
    expect(syntax.valid).toBe(true);
    expect(syntax.success_token).toMatch(/^amp-schema-valid:/);
  });
});
