import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAuthAndPayment } from '../validateAuthAndPayment';

describe('validateAuthAndPayment', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('v0.2 path: prepay_required triggers verifyPaymentFlow', async () => {
    const manifest = {
      spec_version: 'agentmanifest-0.2',
      authentication: { required: false, type: null },
      payment: {
        prepay_required: true,
        checkout_url: 'https://example.com/checkout',
        key_provisioning_url: 'https://example.com/keys',
      },
      pricing: { model: 'usage_based' },
      endpoints: [],
    };

    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 200 });

    const result = await validateAuthAndPayment(manifest, 'https://example.com');
    expect(result.checks.some((c) => c.name === 'payment_checkout_reachable')).toBe(true);
    expect(result.checks.some((c) => c.name === 'payment_key_provisioning_reachable')).toBe(true);
  });

  it('v0.3 path: spec_version 0.3 and payment.model triggers verifyV03PaymentFlow', async () => {
    const manifest = {
      spec_version: 'agentmanifest-0.3',
      authentication: { required: false, type: null },
      payment: {
        model: 'per_request',
        onboarding: { url: 'https://example.com/amp/onboard', method: 'POST', accepts: ['signed_jwt'], returns: { credential_type: 'api_key', credential_field: 'api_key', instructions: 'Use header' } },
      },
      endpoints: [],
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 200 });

    const result = await validateAuthAndPayment(manifest, 'https://example.com');
    expect(result.checks.some((c) => c.name === 'v03_payment_onboarding_reachable')).toBe(true);
  });

  it('baseUrl null skips network checks for v0.3 payment', async () => {
    const manifest = {
      spec_version: 'agentmanifest-0.3',
      authentication: { required: false, type: null },
      payment: {
        model: 'per_request',
        onboarding: { url: 'https://example.com/amp/onboard', method: 'POST', accepts: ['signed_jwt'], returns: { credential_type: 'api_key', credential_field: 'api_key', instructions: 'Use header' } },
      },
      endpoints: [],
    };

    const result = await validateAuthAndPayment(manifest, null);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.checks.some((c) => c.name === 'v03_payment_onboarding_reachable' && !c.passed)).toBe(true);
  });

  it('v0.3 payment with usage_endpoint checks usage reachability', async () => {
    const manifest = {
      spec_version: 'agentmanifest-0.3',
      authentication: { required: false, type: null },
      payment: {
        model: 'per_request',
        onboarding: { url: 'https://example.com/amp/onboard', method: 'POST', accepts: ['signed_jwt'], returns: { credential_type: 'api_key', credential_field: 'api_key', instructions: 'Use header' } },
        usage_endpoint: { url: 'https://example.com/amp/usage', method: 'GET', authentication: 'same_as_api' },
      },
      endpoints: [],
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 200 });

    const result = await validateAuthAndPayment(manifest, 'https://example.com');
    expect(result.checks.some((c) => c.name === 'v03_payment_usage_reachable')).toBe(true);
  });
});

function response(status: number, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const headers = new Headers(opts.headers ?? {});
  return {
    status,
    headers,
    json: async () => {
      if (opts.body === undefined) throw new Error('no body');
      return opts.body;
    },
  };
}

const onboardingManifest = {
  spec_version: 'agentmanifest-0.3',
  authentication: { required: false, type: null },
  payment: {
    model: 'per_request',
    onboarding: {
      url: 'https://example.com/amp/onboard',
      method: 'POST',
      accepts: ['platform_token'],
      returns: { credential_type: 'api_key', credential_field: 'api_key', instructions: 'Use header' },
    },
  },
  endpoints: [],
};

describe('payment-ready: onboarding flows (revision 0.3.1)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('404 does not earn payment-ready', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response(404));
    const result = await validateAuthAndPayment(onboardingManifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(false);
    const check = result.checks.find((c) => c.name === 'v03_payment_onboarding_reachable');
    expect(check?.passed).toBe(false);
    expect(check?.severity).toBe('warning');
  });

  it('405 with Allow listing the declared method earns payment-ready', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response(405, { headers: { Allow: 'POST' } }));
    const result = await validateAuthAndPayment(onboardingManifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('405 without a matching Allow header falls back to GET', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(response(405, { headers: { Allow: 'GET' } }))
      .mockResolvedValueOnce(response(401));
    const result = await validateAuthAndPayment(onboardingManifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(true);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ method: 'GET' });
  });

  it('405 on both HEAD and GET without a matching Allow header fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response(405));
    const result = await validateAuthAndPayment(onboardingManifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(false);
  });

  it.each([200, 204, 401, 402])('%i earns payment-ready', async (status) => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response(status));
    const result = await validateAuthAndPayment(onboardingManifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(true);
  });

  it.each([400, 403, 500])('%i does not earn payment-ready', async (status) => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response(status));
    const result = await validateAuthAndPayment(onboardingManifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(false);
  });
});

const x402Manifest = {
  spec_version: 'agentmanifest-0.3',
  authentication: { required: false, type: 'none' },
  payment: {
    model: 'per_request',
    currency: 'x-XNO',
    protocol: 'x402',
    networks: ['nano:mainnet'],
    rates: [{ unit: 'request', price: '0.0001' }],
  },
  endpoints: [{ path: '/api/v1/extract', method: 'GET' }],
};

const pricedAccepts = [
  { scheme: 'exact', network: 'nano:mainnet', asset: 'XNO', amount: '100000000000000000000000000', payTo: 'nano_1abc' },
];

describe('payment-ready: x402 (revision 0.3.1)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('discovery document with priced resources earns payment-ready without calling endpoints', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      response(200, { body: { x402Version: 2, resources: [{ url: 'https://example.com/api/v1/extract', accepts: pricedAccepts }] } })
    );
    const result = await validateAuthAndPayment(x402Manifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://example.com/.well-known/x402');
  });

  it('uses the declared discovery_url', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      response(200, { body: { resources: [{ accepts: pricedAccepts }] } })
    );
    const manifest = { ...x402Manifest, payment: { ...x402Manifest.payment, discovery_url: 'https://pay.example.com/x402.json' } };
    await validateAuthAndPayment(manifest, 'https://example.com');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://pay.example.com/x402.json');
  });

  it('falls back to an unpaid GET that returns 402 with payment requirements', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(402, { body: { x402Version: 1, accepts: [{ maxAmountRequired: '100', payTo: '0xabc' }] } }));
    const result = await validateAuthAndPayment(x402Manifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(true);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe('https://example.com/api/v1/extract');
  });

  it('accepts the PAYMENT-REQUIRED header on a 402', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(402, { headers: { 'PAYMENT-REQUIRED': 'eyJ4NDAyVmVyc2lvbiI6Mn0=' } }));
    const result = await validateAuthAndPayment(x402Manifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(true);
  });

  it('a bare 402 without payment requirements does not qualify', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(402));
    const result = await validateAuthAndPayment(x402Manifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(false);
    expect(result.checks.find((c) => c.name === 'x402_payment_requirements')?.severity).toBe('warning');
  });

  it('a free-tier 200 is inconclusive, reported as info', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(200));
    const result = await validateAuthAndPayment(x402Manifest, 'https://example.com');
    expect(result.payment_flow_verified).toBe(false);
    expect(result.checks.find((c) => c.name === 'x402_payment_requirements')?.severity).toBe('info');
  });
});
