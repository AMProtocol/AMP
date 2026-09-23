import { describe, it, expect } from 'vitest';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadSchema(version: string): object {
  return JSON.parse(
    readFileSync(join(__dirname, `../../schemas/${version}/manifest.json`), 'utf-8')
  );
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators: Record<string, ValidateFunction> = {
  'agentmanifest-0.2': ajv.compile(loadSchema('v0.2')),
  'agentmanifest-0.3': ajv.compile(loadSchema('v0.3')),
};

/** Validate against the schema of the declared spec_version, like the validator does. */
function validate(manifest: unknown): boolean {
  const version = (manifest as { spec_version?: string }).spec_version ?? '';
  const fn = validators[version] ?? validators['agentmanifest-0.3'];
  const ok = fn(manifest) as boolean;
  validate.errors = fn.errors;
  return ok;
}
validate.errors = null as ValidateFunction['errors'];

const fixturesDir = join(__dirname, '../../fixtures');

function loadFixture(name: string): Record<string, any> {
  return JSON.parse(
    readFileSync(join(fixturesDir, name), 'utf-8')
  );
}

describe('Schema validation', () => {
  it('valid v0.2 manifest passes schema', () => {
    expect(validate(loadFixture('v02-valid.json'))).toBe(true);
  });

  it('valid v0.3 free manifest passes schema', () => {
    expect(validate(loadFixture('v03-free-valid.json'))).toBe(true);
  });

  it('valid v0.3 paid manifest passes schema', () => {
    expect(validate(loadFixture('v03-paid-valid.json'))).toBe(true);
  });

  it('v0.3 paid manifest without onboarding fails schema', () => {
    const valid = validate(loadFixture('v03-paid-invalid.json'));
    expect(valid).toBe(false);
    expect(validate.errors).toBeDefined();
    expect(validate.errors!.length).toBeGreaterThan(0);
  });

  it('v0.3 agent_notes short (149 chars) fails schema (v0.3 requires min 150)', () => {
    const valid = validate(loadFixture('v03-agent-notes-short.json'));
    expect(valid).toBe(false);
    expect(validate.errors?.some((e) => e.message?.includes('minLength') || e.instancePath?.includes('agent_notes'))).toBe(true);
  });

  it('v0.3 payment no terms passes schema', () => {
    expect(validate(loadFixture('v03-payment-no-terms.json'))).toBe(true);
  });

  it('invalid spec_version fails schema', () => {
    const manifest = loadFixture('v02-valid.json');
    manifest.spec_version = 'agentmanifest-0.1';
    expect(validate(manifest)).toBe(false);
  });

  it('cost_hint with valid format passes', () => {
    expect(validate(loadFixture('v03-paid-valid.json'))).toBe(true);
  });

  it('v0.3 payment with invalid rates[].price format fails schema', () => {
    const manifest = loadFixture('v03-paid-valid.json');
    manifest.payment.rates[0].price = 'abc';
    expect(validate(manifest)).toBe(false);
  });

  it('v0.3 payment with postpaid_cycle but missing cycle fails schema', () => {
    const manifest = loadFixture('v03-paid-valid.json');
    manifest.payment.settlement = { type: 'postpaid_cycle', cycle: null };
    expect(validate(manifest)).toBe(false);
  });
});

describe('Per-version schemas (revision 0.3.1)', () => {
  it('v0.2 manifest with a v0.2 payment block passes the v0.2 schema', () => {
    expect(validate(loadFixture('v02-payment-valid.json'))).toBe(true);
  });

  it('v0.2 payment block without checkout_url still fails', () => {
    const manifest = loadFixture('v02-payment-valid.json');
    delete manifest.payment.checkout_url;
    expect(validate(manifest)).toBe(false);
  });

  it('v0.3 manifest may not use a v0.2 payment block', () => {
    const manifest = loadFixture('v02-payment-valid.json');
    manifest.spec_version = 'agentmanifest-0.3';
    manifest.agent_notes = manifest.agent_notes.padEnd(160, '.');
    expect(validate(manifest)).toBe(false);
  });

  it('v0.2 manifest without reliability or listing_requested passes, as before', () => {
    const manifest = loadFixture('v02-valid.json');
    delete manifest.reliability;
    delete manifest.listing_requested;
    expect(validate(manifest)).toBe(true);
  });

  it.each(['agentmanifest-0.2', 'agentmanifest-0.3'])('freemium is accepted for %s', (version) => {
    const manifest = loadFixture(version === 'agentmanifest-0.2' ? 'v02-valid.json' : 'v03-free-valid.json');
    manifest.pricing.model = 'freemium';
    expect(validate(manifest)).toBe(true);
  });

  it('unknown pricing is accepted for v0.3 only', () => {
    const v03 = loadFixture('v03-free-valid.json');
    v03.pricing.model = 'unknown';
    expect(validate(v03)).toBe(true);

    const v02 = loadFixture('v02-valid.json');
    v02.pricing.model = 'unknown';
    expect(validate(v02)).toBe(false);
  });

  it('x402 payment without onboarding passes', () => {
    expect(validate(loadFixture('v03-x402-valid.json'))).toBe(true);
  });

  it('x402 payment without networks fails', () => {
    const manifest = loadFixture('v03-x402-valid.json');
    delete manifest.payment.networks;
    expect(validate(manifest)).toBe(false);
  });

  it('non-free payment without protocol still requires onboarding', () => {
    const manifest = loadFixture('v03-x402-valid.json');
    delete manifest.payment.protocol;
    delete manifest.payment.networks;
    expect(validate(manifest)).toBe(false);
  });

  it('paid_tier accepts amount with currency instead of amount_usd', () => {
    const manifest = loadFixture('v03-x402-valid.json');
    expect(manifest.pricing.paid_tier.amount_usd).toBeUndefined();
    expect(validate(manifest)).toBe(true);
  });

  it('paid_tier with amount but no currency fails', () => {
    const manifest = loadFixture('v03-x402-valid.json');
    delete manifest.pricing.paid_tier.currency;
    expect(validate(manifest)).toBe(false);
  });
});
