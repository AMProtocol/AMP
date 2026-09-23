/**
 * Auth and Payment verification for AMP validator.
 * Verifies that declared auth flows work and payment endpoints exist.
 * Does NOT process payments, store credentials, or handle money.
 */

interface ValidationCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ManifestForAuthPayment {
  spec_version?: string;
  authentication?: {
    required: boolean;
    type?: string | null;
    instructions?: string | null;
  };
  payment?: null | {
    // v0.2 legacy fields
    checkout_url?: string;
    key_provisioning_url?: string;
    prepay_required?: boolean;
    // v0.3 fields
    model?: string;
    currency?: string;
    protocol?: string;
    networks?: string[];
    discovery_url?: string;
    rates?: Array<{ unit: string; price: string }>;
    onboarding?: {
      url: string;
      method: string;
      accepts: string[];
      returns: {
        credential_type: string;
        credential_field: string;
        instructions: string;
      };
    };
    usage_endpoint?: {
      url: string;
      method: string;
      authentication: string;
    };
    settlement?: {
      type: string;
      cycle?: string | null;
    };
    budget_controls?: {
      supports_spend_cap?: boolean;
      supports_per_request_limit?: boolean;
      supports_rate_limit?: boolean;
      supports_alerting?: boolean;
    };
  };
  pricing?: {
    model?: string;
  };
  endpoints?: Array<{
    path: string;
    method: string;
  }>;
  agent_notes?: string;
}

export interface AuthPaymentResult {
  auth_verified: boolean;
  payment_flow_verified: boolean;
  checks: ValidationCheck[];
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 8000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function isReachableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Verify authentication flow based on manifest declaration.
 * Uses simple HTTP HEAD/GET checks only. Does not issue credentials.
 */
async function verifyAuthApiKey(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<{ verified: boolean; checks: ValidationCheck[] }> {
  const checks: ValidationCheck[] = [];
  const keyUrl = manifest.payment?.key_provisioning_url;

  if (!keyUrl) {
    checks.push({
      name: 'auth_api_key_provisioning',
      passed: false,
      message: 'API key auth declared but key_provisioning_url not in payment',
      severity: 'warning',
    });
    return { verified: false, checks };
  }

  if (!baseUrl || !isReachableUrl(keyUrl)) {
    checks.push({
      name: 'auth_api_key_provisioning',
      passed: false,
      message: 'Cannot verify key_provisioning_url (no base URL or invalid URL)',
      severity: 'info',
    });
    return { verified: false, checks };
  }

  try {
    const response = await fetchWithTimeout(keyUrl, { method: 'GET' });
    if (response.status === 200 || response.status === 401) {
      checks.push({
        name: 'auth_api_key_provisioning',
        passed: true,
        message: `key_provisioning_url responds (${response.status})`,
        severity: 'info',
      });
      return { verified: true, checks };
    }
    checks.push({
      name: 'auth_api_key_provisioning',
      passed: false,
      message: `key_provisioning_url returned ${response.status}, expected 200 or 401`,
      severity: 'warning',
    });
    return { verified: false, checks };
  } catch (error) {
    checks.push({
      name: 'auth_api_key_provisioning',
      passed: false,
      message: `key_provisioning_url unreachable: ${(error as Error).message}`,
      severity: 'warning',
    });
    return { verified: false, checks };
  }
}

/**
 * Extract OAuth token endpoint from instructions or endpoints.
 * Looks for common patterns: token_url, token endpoint, /oauth/token, etc.
 */
function findOAuthTokenEndpoint(
  manifest: ManifestForAuthPayment
): string | null {
  const instructions = manifest.authentication?.instructions || '';
  const endpoints = manifest.endpoints || [];

  // Common patterns in instructions
  const urlPattern = /https?:\/\/[^\s"'<>]+(?:token|oauth)[^\s"'<>]*/i;
  const match = instructions.match(urlPattern);
  if (match) {
    try {
      new URL(match[0]);
      return match[0];
    } catch {
      /* ignore */
    }
  }

  // Check for relative token paths in endpoints
  const tokenPaths = ['/oauth/token', '/token', '/auth/token', '/v1/token'];
  for (const ep of endpoints) {
    const path = (ep.path || '').toLowerCase();
    if (tokenPaths.some((p) => path.includes(p)) || path.includes('token')) {
      return ep.path; // Relative - caller must resolve with baseUrl
    }
  }

  return null;
}

async function verifyAuthOAuth2(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<{ verified: boolean; checks: ValidationCheck[] }> {
  const checks: ValidationCheck[] = [];
  const tokenEndpoint = findOAuthTokenEndpoint(manifest);

  if (!tokenEndpoint) {
    checks.push({
      name: 'auth_oauth2_token_endpoint',
      passed: false,
      message: 'OAuth2 declared but token endpoint not found in instructions or endpoints',
      severity: 'warning',
    });
    return { verified: false, checks };
  }

  let fullUrl: string;
  try {
    fullUrl = new URL(tokenEndpoint).toString();
  } catch {
    if (baseUrl) {
      fullUrl = new URL(tokenEndpoint, baseUrl).toString();
    } else {
      checks.push({
        name: 'auth_oauth2_token_endpoint',
        passed: false,
        message: 'Cannot resolve OAuth token URL without base URL',
        severity: 'info',
      });
      return { verified: false, checks };
    }
  }

  try {
    const response = await fetchWithTimeout(fullUrl, { method: 'GET' });
    const status = response.status;
    if (status === 200) {
      checks.push({
        name: 'auth_oauth2_token_endpoint',
        passed: true,
        message: 'OAuth token endpoint responds (200)',
        severity: 'info',
      });
      return { verified: true, checks };
    }
    if (status === 400) {
      const text = await response.text();
      if (
        text.includes('error') ||
        text.includes('invalid') ||
        text.includes('grant')
      ) {
        checks.push({
          name: 'auth_oauth2_token_endpoint',
          passed: true,
          message: 'OAuth token endpoint returns 400 with OAuth structure',
          severity: 'info',
        });
        return { verified: true, checks };
      }
    }
    if (status === 401 || status === 405) {
      checks.push({
        name: 'auth_oauth2_token_endpoint',
        passed: true,
        message: `OAuth token endpoint exists (${status})`,
        severity: 'info',
      });
      return { verified: true, checks };
    }
    checks.push({
      name: 'auth_oauth2_token_endpoint',
      passed: false,
      message: `OAuth token endpoint returned ${status}, expected 200 or 400`,
      severity: 'warning',
    });
    return { verified: false, checks };
  } catch (error) {
    checks.push({
      name: 'auth_oauth2_token_endpoint',
      passed: false,
      message: `OAuth token endpoint unreachable: ${(error as Error).message}`,
      severity: 'warning',
    });
    return { verified: false, checks };
  }
}

async function verifyAuthBearer(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<{ verified: boolean; checks: ValidationCheck[] }> {
  const checks: ValidationCheck[] = [];
  const instructions = manifest.authentication?.instructions || '';

  if (!instructions.toLowerCase().includes('token') && !instructions.toLowerCase().includes('bearer')) {
    checks.push({
      name: 'auth_bearer_docs',
      passed: false,
      message: 'Bearer auth requires instructions on how to obtain token',
      severity: 'warning',
    });
    return { verified: false, checks };
  }

  if (!baseUrl || !manifest.endpoints?.length) {
    checks.push({
      name: 'auth_bearer_endpoint',
      passed: false,
      message: 'Cannot verify 401 without base URL or endpoints',
      severity: 'info',
    });
    return { verified: false, checks };
  }

  const testable = manifest.endpoints.filter(
    (ep) => ep.method === 'GET' && ep.path
  );
  if (testable.length === 0) {
    checks.push({
      name: 'auth_bearer_endpoint',
      passed: false,
      message: 'No GET endpoints to verify 401 response',
      severity: 'info',
    });
    return { verified: false, checks };
  }

  for (const ep of testable.slice(0, 2)) {
    const url = new URL(ep.path, baseUrl).toString();
    try {
      const response = await fetchWithTimeout(url, {
        headers: { Authorization: 'Bearer invalid-test-token' },
      });
      if (response.status === 401) {
        checks.push({
          name: 'auth_bearer_endpoint',
          passed: true,
          message: `Endpoint returns 401 when unauthenticated`,
          severity: 'info',
        });
        return { verified: true, checks };
      }
    } catch {
      /* try next */
    }
  }

  checks.push({
    name: 'auth_bearer_endpoint',
    passed: false,
    message: 'No tested endpoint returned 401 for unauthenticated request',
    severity: 'warning',
  });
  return { verified: false, checks };
}

/**
 * Main auth verification. Runs when authentication.required === true.
 */
async function verifyAuthentication(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<{ auth_verified: boolean; checks: ValidationCheck[] }> {
  const checks: ValidationCheck[] = [];
  const auth = manifest.authentication;

  if (!auth?.required) {
    return { auth_verified: false, checks };
  }

  if (!auth.type || auth.type === 'none') {
    checks.push({
      name: 'auth_type',
      passed: false,
      message: 'Authentication required but type is missing or "none"',
      severity: 'error',
    });
    return { auth_verified: false, checks };
  }

  if (!auth.instructions || String(auth.instructions).trim().length === 0) {
    checks.push({
      name: 'auth_instructions',
      passed: false,
      message: 'Authentication required but instructions are empty',
      severity: 'error',
    });
    return { auth_verified: false, checks };
  }

  let result: { verified: boolean; checks: ValidationCheck[] };
  switch (auth.type) {
    case 'api_key':
      result = await verifyAuthApiKey(manifest, baseUrl);
      break;
    case 'oauth2':
      result = await verifyAuthOAuth2(manifest, baseUrl);
      break;
    case 'bearer':
      result = await verifyAuthBearer(manifest, baseUrl);
      break;
    default:
      checks.push({
        name: 'auth_type',
        passed: false,
        message: `Unsupported auth type for verification: ${auth.type}`,
        severity: 'warning',
      });
      return { auth_verified: false, checks };
  }

  checks.push(...result.checks);
  return { auth_verified: result.verified, checks };
}

/**
 * Payment readiness verification. Only when payment.prepay_required === true.
 * Verifies endpoints exist and respond. Does NOT process payment.
 */
async function verifyPaymentFlow(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<{ payment_flow_verified: boolean; checks: ValidationCheck[] }> {
  const checks: ValidationCheck[] = [];
  const payment = manifest.payment;
  const pricing = manifest.pricing;

  if (!payment?.prepay_required) {
    return { payment_flow_verified: false, checks };
  }

  if (!payment.checkout_url) {
    checks.push({
      name: 'payment_checkout_url',
      passed: false,
      message: 'prepay_required but checkout_url missing',
      severity: 'error',
    });
    return { payment_flow_verified: false, checks };
  }

  if (!payment.key_provisioning_url) {
    checks.push({
      name: 'payment_key_provisioning_url',
      passed: false,
      message: 'prepay_required but key_provisioning_url missing',
      severity: 'error',
    });
    return { payment_flow_verified: false, checks };
  }

  if (pricing?.model === 'free') {
    checks.push({
      name: 'payment_pricing_model',
      passed: false,
      message: 'prepay_required but pricing.model is "free"',
      severity: 'error',
    });
    return { payment_flow_verified: false, checks };
  }

  if (!baseUrl) {
    checks.push({
      name: 'payment_endpoints',
      passed: false,
      message: 'Cannot verify payment endpoints without base URL',
      severity: 'info',
    });
    return { payment_flow_verified: false, checks };
  }

  let checkoutOk = false;
  let keyProvOk = false;

  try {
    const checkoutRes = await fetchWithTimeout(payment.checkout_url, {
      method: 'HEAD',
    });
    if (checkoutRes.status === 405) {
      const getRes = await fetchWithTimeout(payment.checkout_url, {
        method: 'GET',
      });
      checkoutOk = getRes.status === 200;
    } else {
      checkoutOk = checkoutRes.status === 200;
    }
  } catch (error) {
    checks.push({
      name: 'payment_checkout_reachable',
      passed: false,
      message: `checkout_url unreachable: ${(error as Error).message}`,
      severity: 'error',
    });
  }

  if (checkoutOk) {
    checks.push({
      name: 'payment_checkout_reachable',
      passed: true,
      message: 'checkout_url responds with HTTP 200',
      severity: 'info',
    });
  }

  try {
    const keyRes = await fetchWithTimeout(payment.key_provisioning_url!, {
      method: 'GET',
    });
    keyProvOk = keyRes.status === 200 || keyRes.status === 401;
  } catch (error) {
    checks.push({
      name: 'payment_key_provisioning_reachable',
      passed: false,
      message: `key_provisioning_url unreachable: ${(error as Error).message}`,
      severity: 'error',
    });
  }

  if (keyProvOk) {
    checks.push({
      name: 'payment_key_provisioning_reachable',
      passed: true,
      message: 'key_provisioning_url responds with HTTP 200 or 401',
      severity: 'info',
    });
  }

  const payment_flow_verified =
    checkoutOk && keyProvOk && pricing?.model !== 'free';

  return { payment_flow_verified, checks };
}

function isOnboardingAnswer(status: number): boolean {
  return (status >= 200 && status < 300) || status === 401 || status === 402;
}

function allowHeaderIncludes(res: Response, method: string): boolean {
  const allow = res.headers?.get?.('allow');
  if (!allow) return false;
  return allow
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .includes(method.toUpperCase());
}

/**
 * An onboarding endpoint counts as answering when HEAD or GET returns 2xx, 401,
 * or 402, or returns 405 with an Allow header that lists the declared method.
 * Only HEAD and GET are sent, so nothing is created on the provider's side.
 */
async function probeOnboarding(
  url: string,
  method: string
): Promise<{ ok: boolean; detail: string }> {
  let last = '';
  for (const probe of ['HEAD', 'GET']) {
    const res = await fetchWithTimeout(url, { method: probe });
    if (isOnboardingAnswer(res.status)) {
      return { ok: true, detail: `${probe} returned ${res.status}` };
    }
    if (res.status === 405 && allowHeaderIncludes(res, method)) {
      return { ok: true, detail: `${probe} returned 405 with Allow: ${res.headers.get('allow')}` };
    }
    last = `${probe} returned ${res.status}`;
    if (res.status !== 405) break;
  }
  return { ok: false, detail: last };
}

interface X402Requirement {
  amount?: string | number;
  maxAmountRequired?: string | number;
  payTo?: string;
}

function hasPricedRequirement(accepts: unknown): boolean {
  return (
    Array.isArray(accepts) &&
    accepts.some((a: X402Requirement) => a && (a.amount ?? a.maxAmountRequired) !== undefined && !!a.payTo)
  );
}

/**
 * x402 APIs are payment-ready when their discovery document lists priced
 * resources, or when an unpaid GET to a paid endpoint returns 402 with payment
 * requirements. Neither costs anything.
 */
async function verifyX402PaymentFlow(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<{ payment_flow_verified: boolean; checks: ValidationCheck[] }> {
  const checks: ValidationCheck[] = [];
  const payment = manifest.payment!;

  if (!baseUrl) {
    checks.push({
      name: 'x402_payment_requirements',
      passed: false,
      message: 'Cannot verify x402 payment requirements without base URL',
      severity: 'info',
    });
    return { payment_flow_verified: false, checks };
  }

  const discoveryUrl = payment.discovery_url || new URL('/.well-known/x402', baseUrl).toString();
  try {
    const res = await fetchWithTimeout(discoveryUrl, { method: 'GET' });
    if (res.status === 200) {
      const doc = (await res.json()) as { resources?: Array<{ accepts?: unknown }> };
      const priced = (doc.resources ?? []).filter((r) => hasPricedRequirement(r?.accepts));
      if (priced.length > 0) {
        checks.push({
          name: 'x402_payment_requirements',
          passed: true,
          message: `x402 discovery document lists ${priced.length} priced resource(s)`,
          severity: 'info',
        });
        return { payment_flow_verified: true, checks };
      }
    }
  } catch {
    /* fall through to probing endpoints */
  }

  let sawFreeTier = false;
  const probes = (manifest.endpoints ?? []).filter((ep) => ep.method === 'GET' && ep.path).slice(0, 2);
  for (const ep of probes) {
    try {
      const res = await fetchWithTimeout(new URL(ep.path, baseUrl).toString(), { method: 'GET' });
      if (res.status === 402) {
        let described = !!(res.headers?.get?.('payment-required') || res.headers?.get?.('x-payment-required'));
        if (!described) {
          try {
            const body = (await res.json()) as { x402Version?: unknown; accepts?: unknown };
            described = body.x402Version !== undefined || hasPricedRequirement(body.accepts);
          } catch {
            /* not JSON */
          }
        }
        if (described) {
          checks.push({
            name: 'x402_payment_requirements',
            passed: true,
            message: `Unpaid GET ${ep.path} returned 402 with payment requirements`,
            severity: 'info',
          });
          return { payment_flow_verified: true, checks };
        }
      } else if (res.status >= 200 && res.status < 300) {
        sawFreeTier = true;
      }
    } catch {
      /* try next endpoint */
    }
  }

  checks.push({
    name: 'x402_payment_requirements',
    passed: false,
    message: sawFreeTier
      ? 'Unpaid requests succeeded (free tier); x402 payment requirements not observed this run'
      : 'No x402 discovery document with prices and no 402 with payment requirements from paid endpoints',
    severity: sawFreeTier ? 'info' : 'warning',
  });
  return { payment_flow_verified: false, checks };
}

/**
 * v0.3 payment flow verification.
 * Verifies that the onboarding and usage endpoints answer.
 * Does NOT send real credentials or process payments.
 */
async function verifyV03PaymentFlow(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<{ payment_flow_verified: boolean; checks: ValidationCheck[] }> {
  const checks: ValidationCheck[] = [];
  const payment = manifest.payment;

  if (!payment?.model || payment.model === 'free') {
    return { payment_flow_verified: false, checks };
  }

  if (payment.protocol === 'x402') {
    const x402 = await verifyX402PaymentFlow(manifest, baseUrl);
    if (x402.payment_flow_verified || !payment.onboarding?.url) return x402;
    checks.push(...x402.checks);
  }

  if (!payment.onboarding?.url) {
    checks.push({
      name: 'v03_payment_onboarding_reachable',
      passed: false,
      message: 'v0.3 payment declared but onboarding.url is missing',
      severity: 'warning',
    });
    return { payment_flow_verified: false, checks };
  }

  if (!baseUrl) {
    checks.push({
      name: 'v03_payment_onboarding_reachable',
      passed: false,
      message: 'Cannot verify onboarding endpoint without base URL',
      severity: 'info',
    });
    return { payment_flow_verified: false, checks };
  }

  let onboardingOk = false;

  try {
    const probe = await probeOnboarding(payment.onboarding.url, payment.onboarding.method || 'POST');
    onboardingOk = probe.ok;
    checks.push({
      name: 'v03_payment_onboarding_reachable',
      passed: probe.ok,
      message: probe.ok
        ? `Payment onboarding endpoint answers (${probe.detail})`
        : `Payment onboarding endpoint does not answer as an onboarding endpoint (${probe.detail}); expected 2xx, 401, 402, or 405 with Allow: ${payment.onboarding.method || 'POST'}`,
      severity: probe.ok ? 'info' : 'warning',
    });
  } catch (error) {
    checks.push({
      name: 'v03_payment_onboarding_reachable',
      passed: false,
      message: `Onboarding endpoint unreachable: ${(error as Error).message}`,
      severity: 'warning',
    });
  }

  // Check usage endpoint reachability if declared
  if (payment.usage_endpoint?.url) {
    try {
      const usageRes = await fetchWithTimeout(payment.usage_endpoint.url, { method: 'HEAD' });
      if (usageRes.status < 500) {
        checks.push({
          name: 'v03_payment_usage_reachable',
          passed: true,
          message: 'Usage endpoint is reachable',
          severity: 'info',
        });
      } else {
        checks.push({
          name: 'v03_payment_usage_reachable',
          passed: false,
          message: `Usage endpoint returned ${usageRes.status}`,
          severity: 'warning',
        });
      }
    } catch (error) {
      checks.push({
        name: 'v03_payment_usage_reachable',
        passed: false,
        message: `Usage endpoint unreachable: ${(error as Error).message}`,
        severity: 'warning',
      });
    }
  }

  return { payment_flow_verified: onboardingOk, checks };
}

/**
 * Validate auth and payment.
 */
export async function validateAuthAndPayment(
  manifest: ManifestForAuthPayment,
  baseUrl: string | null
): Promise<AuthPaymentResult> {
  const authResult = await verifyAuthentication(manifest, baseUrl);

  // Determine which payment verification to run based on spec version
  const isV03 = manifest.spec_version === 'agentmanifest-0.3' && manifest.payment?.model;

  let paymentResult: { payment_flow_verified: boolean; checks: ValidationCheck[] };
  if (isV03) {
    paymentResult = await verifyV03PaymentFlow(manifest, baseUrl);
  } else {
    paymentResult = await verifyPaymentFlow(manifest, baseUrl);
  }

  return {
    auth_verified: authResult.auth_verified,
    payment_flow_verified: paymentResult.payment_flow_verified,
    checks: [...authResult.checks, ...paymentResult.checks],
  };
}
