import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { requireJwtSecret, signJwt } from './jwt';
import schemaV02 from '../schemas/v0.2/manifest.json';
import schemaV03 from '../schemas/v0.3/manifest.json';
import { validateAuthAndPayment } from './validateAuthAndPayment';
import { checkAgentOperationalCompleteness } from './checkAgentCompleteness';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export const CURRENT_SPEC_VERSION = 'agentmanifest-0.3';

/** JSON Schema for each supported spec_version. */
export const SCHEMAS: Record<string, object> = {
  'agentmanifest-0.2': schemaV02,
  'agentmanifest-0.3': schemaV03,
};

const schemaValidators: Record<string, ValidateFunction> = Object.fromEntries(
  Object.entries(SCHEMAS).map(([version, schema]) => [version, ajv.compile(schema)])
);

/**
 * Where the manifest for a URL lives: the origin root, per RFC 8615. A path in
 * the submitted URL does not change the manifest location.
 */
export function resolveManifestUrl(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return new URL('/.well-known/agent-manifest.json', withScheme).toString();
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ValidationResult {
  url: string;
  /** Resolved origin-level manifest location, or null for manifests validated without a URL */
  manifest_url: string | null;
  validated_at: string;
  passed: boolean;
  spec_version: string | null;
  checks: ValidationCheck[];
  verification_token: string | null;
  /** Schema validation passed */
  schema_valid?: boolean;
  /** Declared endpoints are reachable */
  endpoints_reachable?: boolean;
  /** Auth flow verified (when auth required) */
  auth_verified?: boolean;
  /** Payment flow verified (when prepay_required) */
  payment_flow_verified?: boolean;
  /** Agent notes contain procedural completeness */
  operationally_complete?: boolean;
  /** Informational badges (auth-verified, payment-ready) */
  badges?: string[];
}

interface ManifestData {
  spec_version?: string;
  name?: string;
  version?: string;
  description?: string;
  categories?: string[];
  primary_category?: string;
  endpoints?: Array<{
    path: string;
    method: string;
    description: string;
    parameters: any[];
    response_description: string;
  }>;
  pricing?: {
    model: string;
    free_tier?: any;
    paid_tier?: any;
    support_url?: string;
  };
  payment?: null | {
    // v0.2 fields (legacy)
    provider?: string;
    checkout_url?: string;
    key_provisioning_url?: string;
    accepted_methods?: string[];
    prepay_required?: boolean;
    // v0.3 fields
    model?: string;
    currency?: string;
    protocol?: string;
    networks?: string[];
    discovery_url?: string;
    rates?: Array<{
      unit: string;
      price: string;
      description?: string;
      tier?: string | null;
      threshold?: number | null;
      cap?: number | null;
    }>;
    onboarding?: {
      url: string;
      method: string;
      accepts: string[];
      returns: {
        credential_type: string;
        credential_field: string;
        instructions: string;
        expires_in?: number | null;
        refresh_url?: string | null;
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
      provider_name?: string | null;
      provider_url?: string | null;
    };
    budget_controls?: {
      supports_spend_cap?: boolean;
      supports_per_request_limit?: boolean;
      supports_rate_limit?: boolean;
      supports_alerting?: boolean;
    };
    refund_policy?: {
      type: string;
      terms_url?: string | null;
      window_seconds?: number | null;
    };
  };
  authentication?: {
    required: boolean;
    type?: string | null;
    instructions?: string | null;
  };
  reliability?: {
    maintained_by: string;
    status_url?: string | null;
    expected_uptime_pct?: number | null;
  };
  agent_notes?: string;
  contact?: string;
  listing_requested?: boolean;
  last_updated?: string;
}

const BOILERPLATE_PATTERNS = [
  /this api provides/i,
  /lorem ipsum/i,
  /todo:/i,
  /replace this/i,
  /example description/i,
  /\[insert.*?\]/i,
];

const VALID_CATEGORIES = [
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
];

const VALID_PRIMARY_CATEGORIES = [
  'reference',
  'live',
  'computational',
  'transactional',
  'enrichment',
  'personal',
  'discovery',
];

function isBoilerplate(text: string): boolean {
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text));
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 10000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function checkManifestReachability(
  manifestUrl: string
): Promise<{ check: ValidationCheck; manifest: ManifestData | null }> {
  try {
    const response = await fetchWithTimeout(manifestUrl);

    if (response.status !== 200) {
      return {
        check: {
          name: 'manifest_reachability',
          passed: false,
          message: `Manifest returned status ${response.status}, expected 200`,
          severity: 'error',
        },
        manifest: null,
      };
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return {
        check: {
          name: 'manifest_reachability',
          passed: false,
          message: `Invalid Content-Type: ${contentType}, expected application/json`,
          severity: 'error',
        },
        manifest: null,
      };
    }

    const manifest = (await response.json()) as ManifestData;

    return {
      check: {
        name: 'manifest_reachability',
        passed: true,
        message: 'Manifest successfully fetched',
        severity: 'info',
      },
      manifest,
    };
  } catch (error) {
    return {
      check: {
        name: 'manifest_reachability',
        passed: false,
        message: `Failed to fetch manifest: ${(error as Error).message}`,
        severity: 'error',
      },
      manifest: null,
    };
  }
}

/** Validates against the schema of the declared spec_version (current version if unrecognized). */
function checkSchemaValidity(manifest: ManifestData): ValidationCheck {
  const version =
    manifest.spec_version && schemaValidators[manifest.spec_version]
      ? manifest.spec_version
      : CURRENT_SPEC_VERSION;
  const validate = schemaValidators[version];
  const valid = validate(manifest);
  const label = version.replace('agentmanifest-', 'v');

  if (!valid) {
    const errors = validate.errors
      ?.map((err) => `${err.instancePath} ${err.message}`)
      .join('; ');
    return {
      name: 'schema_validity',
      passed: false,
      message: `Schema validation failed: ${errors} (checked against the ${label} schema)`,
      severity: 'error',
    };
  }

  return {
    name: 'schema_validity',
    passed: true,
    message: `Manifest passes JSON Schema validation (${label} schema)`,
    severity: 'info',
  };
}

const SUPPORTED_SPEC_VERSIONS = ['agentmanifest-0.2', 'agentmanifest-0.3'];

function checkSpecVersion(manifest: ManifestData): ValidationCheck {
  if (!manifest.spec_version || !SUPPORTED_SPEC_VERSIONS.includes(manifest.spec_version)) {
    return {
      name: 'spec_version',
      passed: false,
      message: `Unsupported spec version: ${manifest.spec_version}. Use agentmanifest-0.2 or agentmanifest-0.3.`,
      severity: 'error',
    };
  }

  return {
    name: 'spec_version',
    passed: true,
    message: `Valid spec version declared (${manifest.spec_version})`,
    severity: 'info',
  };
}

function isV03(manifest: ManifestData): boolean {
  return manifest.spec_version === 'agentmanifest-0.3';
}

function checkDescriptionQuality(manifest: ManifestData): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Description length
  if (!manifest.description || manifest.description.length < 100) {
    checks.push({
      name: 'description_length',
      passed: false,
      message: `Description too short (${manifest.description?.length || 0} chars, minimum 100)`,
      severity: 'error',
    });
  } else if (isBoilerplate(manifest.description)) {
    checks.push({
      name: 'description_quality',
      passed: false,
      message: 'Description appears to be auto-generated boilerplate',
      severity: 'warning',
    });
  } else {
    checks.push({
      name: 'description_length',
      passed: true,
      message: 'Description meets minimum length requirement',
      severity: 'info',
    });
  }

  // Agent notes length — v0.3 requires 150 chars, v0.2 requires 50
  const agentNotesMin = isV03(manifest) ? 150 : 50;
  if (!manifest.agent_notes || manifest.agent_notes.length < agentNotesMin) {
    checks.push({
      name: 'agent_notes_length',
      passed: false,
      message: `Agent notes too short (${manifest.agent_notes?.length || 0} chars, minimum ${agentNotesMin})`,
      severity: 'error',
    });
  } else if (isBoilerplate(manifest.agent_notes)) {
    checks.push({
      name: 'agent_notes_quality',
      passed: false,
      message: 'Agent notes appear to be auto-generated boilerplate',
      severity: 'warning',
    });
  } else {
    checks.push({
      name: 'agent_notes_length',
      passed: true,
      message: 'Agent notes meet minimum length requirement',
      severity: 'info',
    });
  }

  return checks;
}

async function checkEndpointReachability(
  baseUrl: string,
  manifest: ManifestData
): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  if (!manifest.endpoints || manifest.endpoints.length === 0) {
    checks.push({
      name: 'endpoint_reachability',
      passed: false,
      message: 'No endpoints declared',
      severity: 'error',
    });
    return checks;
  }

  // Only test GET endpoints with no required parameters
  const testableEndpoints = manifest.endpoints.filter(
    (ep) =>
      ep.method === 'GET' &&
      (!ep.parameters || ep.parameters.every((p) => !p.required))
  );

  if (testableEndpoints.length === 0) {
    checks.push({
      name: 'endpoint_reachability',
      passed: true,
      message: 'No testable GET endpoints (all require parameters or are non-GET)',
      severity: 'info',
    });
    return checks;
  }

  for (const endpoint of testableEndpoints.slice(0, 3)) {
    // Test max 3 endpoints
    const endpointUrl = new URL(endpoint.path, baseUrl).toString();

    try {
      const start = Date.now();
      const response = await fetchWithTimeout(endpointUrl, {}, 8000);
      const duration = Date.now() - start;

      if (response.status >= 500) {
        checks.push({
          name: `endpoint_${endpoint.path}`,
          passed: false,
          message: `Endpoint returned ${response.status} (server error)`,
          severity: 'error',
        });
      } else {
        checks.push({
          name: `endpoint_${endpoint.path}`,
          passed: true,
          message: `Endpoint reachable (${response.status}, ${duration}ms)`,
          severity: 'info',
        });
      }
    } catch (error) {
      checks.push({
        name: `endpoint_${endpoint.path}`,
        passed: false,
        message: `Endpoint unreachable: ${(error as Error).message}`,
        severity: 'warning',
      });
    }
  }

  return checks;
}

function checkPricingConsistency(manifest: ManifestData): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  if (!manifest.pricing) {
    checks.push({
      name: 'pricing_consistency',
      passed: false,
      message: 'Pricing object missing',
      severity: 'error',
    });
    return checks;
  }

  const { model, free_tier, paid_tier, support_url } = manifest.pricing;

  // Check model-specific requirements
  if (
    ['per-query', 'subscription', 'tiered'].includes(model) &&
    !paid_tier
  ) {
    checks.push({
      name: 'pricing_paid_tier',
      passed: false,
      message: `Pricing model "${model}" requires paid_tier to be defined`,
      severity: 'error',
    });
  }

  if (model === 'free' && !free_tier) {
    checks.push({
      name: 'pricing_free_tier',
      passed: false,
      message: 'Pricing model "free" requires free_tier to be defined',
      severity: 'error',
    });
  }

  // Check support URL if present
  if (support_url) {
    try {
      new URL(support_url);
      checks.push({
        name: 'pricing_support_url',
        passed: true,
        message: 'Support URL is valid',
        severity: 'info',
      });
    } catch {
      checks.push({
        name: 'pricing_support_url',
        passed: false,
        message: 'Support URL is not a valid URL',
        severity: 'error',
      });
    }
  }

  if (checks.length === 0 || checks.every((c) => c.passed)) {
    checks.push({
      name: 'pricing_consistency',
      passed: true,
      message: 'Pricing configuration is consistent',
      severity: 'info',
    });
  }

  return checks;
}

function checkCategoryValidity(manifest: ManifestData): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Check primary category
  if (
    !manifest.primary_category ||
    !VALID_PRIMARY_CATEGORIES.includes(manifest.primary_category)
  ) {
    checks.push({
      name: 'primary_category',
      passed: false,
      message: `Invalid primary_category: ${manifest.primary_category}`,
      severity: 'error',
    });
  } else {
    checks.push({
      name: 'primary_category',
      passed: true,
      message: 'Primary category is valid',
      severity: 'info',
    });
  }

  // Check categories
  if (!manifest.categories || manifest.categories.length === 0) {
    checks.push({
      name: 'categories',
      passed: false,
      message: 'No categories declared',
      severity: 'error',
    });
  } else {
    const invalidCategories = manifest.categories.filter(
      (cat) => !VALID_CATEGORIES.includes(cat)
    );

    if (invalidCategories.length > 0) {
      checks.push({
        name: 'categories',
        passed: false,
        message: `Invalid categories: ${invalidCategories.join(', ')}`,
        severity: 'error',
      });
    } else {
      checks.push({
        name: 'categories',
        passed: true,
        message: 'All categories are valid',
        severity: 'info',
      });
    }
  }

  return checks;
}

function checkAuthenticationConsistency(manifest: ManifestData): ValidationCheck {
  if (!manifest.authentication) {
    return {
      name: 'authentication_consistency',
      passed: false,
      message: 'Authentication object missing',
      severity: 'error',
    };
  }

  const { required, type, instructions } = manifest.authentication;

  if (required) {
    if (!type || type === 'none') {
      return {
        name: 'authentication_consistency',
        passed: false,
        message: 'Authentication required but type is null or "none"',
        severity: 'error',
      };
    }

    if (!instructions) {
      return {
        name: 'authentication_consistency',
        passed: false,
        message: 'Authentication required but instructions are missing',
        severity: 'error',
      };
    }
  }

  return {
    name: 'authentication_consistency',
    passed: true,
    message: 'Authentication configuration is consistent',
    severity: 'info',
  };
}

const VALID_PAYMENT_MODELS = ['free', 'per_request', 'metered_usage', 'prepaid_credits', 'subscription'];
const VALID_SETTLEMENT_TYPES = ['real_time', 'postpaid_cycle', 'prepaid_debit'];
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function checkPaymentConsistency(manifest: ManifestData): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Payment field is optional — null or absent is fine
  if (!manifest.payment) {
    return checks;
  }

  // Detect v0.3 payment object (has model/currency/rates) vs v0.2 legacy (has checkout_url/prepay_required)
  if (isV03(manifest) && manifest.payment.model) {
    return checkV03PaymentConsistency(manifest);
  }

  // v0.2 legacy payment checks
  if (!manifest.payment.checkout_url) {
    checks.push({
      name: 'payment_checkout_url',
      passed: false,
      message: 'Payment object present but checkout_url is missing (required when payment is specified)',
      severity: 'error',
    });
  } else {
    try {
      new URL(manifest.payment.checkout_url);
      checks.push({
        name: 'payment_checkout_url',
        passed: true,
        message: 'Payment checkout_url is valid',
        severity: 'info',
      });
    } catch {
      checks.push({
        name: 'payment_checkout_url',
        passed: false,
        message: 'Payment checkout_url is not a valid URL',
        severity: 'error',
      });
    }
  }

  if (manifest.payment.key_provisioning_url) {
    try {
      new URL(manifest.payment.key_provisioning_url);
      checks.push({
        name: 'payment_key_provisioning_url',
        passed: true,
        message: 'Payment key_provisioning_url is valid',
        severity: 'info',
      });
    } catch {
      checks.push({
        name: 'payment_key_provisioning_url',
        passed: false,
        message: 'Payment key_provisioning_url is not a valid URL',
        severity: 'error',
      });
    }
  }

  return checks;
}

/**
 * v0.3 payment block validation (§18.2 checks 13–22)
 */
function checkV03PaymentConsistency(manifest: ManifestData): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const payment = manifest.payment!;

  // Check 13: payment.model is recognized
  if (!payment.model || !VALID_PAYMENT_MODELS.includes(payment.model)) {
    checks.push({
      name: 'payment_model',
      passed: false,
      message: `Unrecognized payment model: "${payment.model}". Expected one of: ${VALID_PAYMENT_MODELS.join(', ')}`,
      severity: 'error',
    });
  } else {
    checks.push({
      name: 'payment_model',
      passed: true,
      message: `Valid payment model: ${payment.model}`,
      severity: 'info',
    });
  }

  // Check 14: payment.currency is valid ISO 4217 or x- prefixed
  if (!payment.currency) {
    checks.push({
      name: 'payment_currency',
      passed: false,
      message: 'payment.currency is required',
      severity: 'error',
    });
  } else {
    const isIso4217 = /^[A-Z]{3}$/.test(payment.currency);
    const isCustom = /^x-/.test(payment.currency);
    if (!isIso4217 && !isCustom) {
      checks.push({
        name: 'payment_currency',
        passed: false,
        message: `payment.currency "${payment.currency}" is not a valid ISO 4217 code or x- prefixed identifier`,
        severity: 'warning',
      });
    } else {
      checks.push({
        name: 'payment_currency',
        passed: true,
        message: `Valid payment currency: ${payment.currency}`,
        severity: 'info',
      });
    }
  }

  // Check 15: rates has at least one entry (unless model is free)
  if (payment.model !== 'free') {
    if (!payment.rates || payment.rates.length === 0) {
      checks.push({
        name: 'payment_rates',
        passed: false,
        message: 'payment.rates must contain at least one entry for non-free payment models',
        severity: 'error',
      });
    } else {
      checks.push({
        name: 'payment_rates',
        passed: true,
        message: `${payment.rates.length} rate(s) defined`,
        severity: 'info',
      });
    }
  }

  // Check 16: all rates[].price values are valid decimal strings
  if (payment.rates && payment.rates.length > 0) {
    const invalidPrices = payment.rates.filter(r => !DECIMAL_PATTERN.test(r.price));
    if (invalidPrices.length > 0) {
      checks.push({
        name: 'payment_rates_price_format',
        passed: false,
        message: `Invalid price format in rates: ${invalidPrices.map(r => `"${r.price}" for unit "${r.unit}"`).join(', ')}. Prices must be decimal strings (e.g., "0.001").`,
        severity: 'error',
      });
    } else {
      checks.push({
        name: 'payment_rates_price_format',
        passed: true,
        message: 'All rate prices are valid decimal strings',
        severity: 'info',
      });
    }
  }

  // Revision 0.3.1: payment.protocol (x402) makes onboarding optional
  if (payment.protocol) {
    if (!payment.networks || payment.networks.length === 0) {
      checks.push({
        name: 'payment_protocol_networks',
        passed: false,
        message: `payment.networks must list at least one network when payment.protocol is "${payment.protocol}"`,
        severity: 'error',
      });
    } else {
      checks.push({
        name: 'payment_protocol_networks',
        passed: true,
        message: `${payment.protocol} on ${payment.networks.join(', ')}`,
        severity: 'info',
      });
    }
    if (payment.discovery_url) {
      try {
        new URL(payment.discovery_url);
      } catch {
        checks.push({
          name: 'payment_discovery_url',
          passed: false,
          message: 'payment.discovery_url is not a valid URL',
          severity: 'error',
        });
      }
    }
  }

  // Check 17–19: onboarding (required when model is not free, unless a payment protocol is declared)
  if (payment.model !== 'free' && (payment.onboarding || !payment.protocol)) {
    if (!payment.onboarding) {
      checks.push({
        name: 'payment_onboarding',
        passed: false,
        message: 'payment.onboarding is required for non-free payment models',
        severity: 'error',
      });
    } else {
      // Check 17: onboarding.url is a valid URL
      if (!payment.onboarding.url) {
        checks.push({
          name: 'payment_onboarding_url',
          passed: false,
          message: 'payment.onboarding.url is required',
          severity: 'error',
        });
      } else {
        try {
          new URL(payment.onboarding.url);
          checks.push({
            name: 'payment_onboarding_url',
            passed: true,
            message: 'payment.onboarding.url is a valid URL',
            severity: 'info',
          });
        } catch {
          checks.push({
            name: 'payment_onboarding_url',
            passed: false,
            message: 'payment.onboarding.url is not a valid URL',
            severity: 'error',
          });
        }
      }

      // Check 18: onboarding.accepts has at least one value
      if (!payment.onboarding.accepts || payment.onboarding.accepts.length === 0) {
        checks.push({
          name: 'payment_onboarding_accepts',
          passed: false,
          message: 'payment.onboarding.accepts must contain at least one credential type',
          severity: 'error',
        });
      } else {
        checks.push({
          name: 'payment_onboarding_accepts',
          passed: true,
          message: `Onboarding accepts: ${payment.onboarding.accepts.join(', ')}`,
          severity: 'info',
        });
      }

      // Check 19: onboarding.returns has required fields
      if (!payment.onboarding.returns) {
        checks.push({
          name: 'payment_onboarding_returns',
          passed: false,
          message: 'payment.onboarding.returns is required',
          severity: 'error',
        });
      } else {
        const ret = payment.onboarding.returns;
        const missingFields = [];
        if (!ret.credential_type) missingFields.push('credential_type');
        if (!ret.credential_field) missingFields.push('credential_field');
        if (!ret.instructions) missingFields.push('instructions');

        if (missingFields.length > 0) {
          checks.push({
            name: 'payment_onboarding_returns',
            passed: false,
            message: `payment.onboarding.returns missing required fields: ${missingFields.join(', ')}`,
            severity: 'error',
          });
        } else {
          checks.push({
            name: 'payment_onboarding_returns',
            passed: true,
            message: 'payment.onboarding.returns has all required fields',
            severity: 'info',
          });
        }
      }
    }
  }

  // Check 20: settlement.type is recognized
  if (!payment.settlement) {
    checks.push({
      name: 'payment_settlement',
      passed: false,
      message: 'payment.settlement is required',
      severity: 'error',
    });
  } else {
    if (!VALID_SETTLEMENT_TYPES.includes(payment.settlement.type)) {
      checks.push({
        name: 'payment_settlement_type',
        passed: false,
        message: `Unrecognized settlement type: "${payment.settlement.type}". Expected one of: ${VALID_SETTLEMENT_TYPES.join(', ')}`,
        severity: 'error',
      });
    } else {
      checks.push({
        name: 'payment_settlement_type',
        passed: true,
        message: `Valid settlement type: ${payment.settlement.type}`,
        severity: 'info',
      });
    }

    // Check 21: if postpaid_cycle, cycle must be non-null
    if (payment.settlement.type === 'postpaid_cycle' && !payment.settlement.cycle) {
      checks.push({
        name: 'payment_settlement_cycle',
        passed: false,
        message: 'settlement.cycle is required when settlement.type is "postpaid_cycle"',
        severity: 'error',
      });
    }
  }

  // Check 22: usage_endpoint URL is valid if present
  if (payment.usage_endpoint) {
    if (!payment.usage_endpoint.url) {
      checks.push({
        name: 'payment_usage_endpoint',
        passed: false,
        message: 'payment.usage_endpoint.url is required when usage_endpoint is declared',
        severity: 'error',
      });
    } else {
      try {
        new URL(payment.usage_endpoint.url);
        checks.push({
          name: 'payment_usage_endpoint',
          passed: true,
          message: 'payment.usage_endpoint.url is a valid URL',
          severity: 'info',
        });
      } catch {
        checks.push({
          name: 'payment_usage_endpoint',
          passed: false,
          message: 'payment.usage_endpoint.url is not a valid URL',
          severity: 'error',
        });
      }
    }
  }

  // Summary
  if (checks.every(c => c.passed)) {
    checks.push({
      name: 'payment_consistency',
      passed: true,
      message: 'v0.3 payment configuration is consistent',
      severity: 'info',
    });
  }

  return checks;
}

function computeDerivedFields(
  checks: ValidationCheck[],
  authVerified: boolean,
  paymentFlowVerified: boolean,
  operationallyComplete: boolean,
  budgetAware: boolean = false
): {
  schema_valid: boolean;
  endpoints_reachable: boolean;
  badges: string[];
} {
  const schemaCheck = checks.find((c) => c.name === 'schema_validity');
  const schema_valid = schemaCheck?.passed ?? false;

  const endpointChecks = checks.filter(
    (c) => c.name === 'endpoint_reachability' || c.name.startsWith('endpoint_')
  );
  const endpoints_reachable =
    endpointChecks.length === 0 || endpointChecks.every((c) => c.passed);

  const badges: string[] = [];
  if (authVerified) badges.push('auth-verified');
  if (paymentFlowVerified) badges.push('payment-ready');
  if (budgetAware) badges.push('budget-aware');

  return { schema_valid, endpoints_reachable, badges };
}

async function generateVerificationToken(
  url: string,
  validatedAt: string,
  specVersion: string
): Promise<string> {
  const secret = requireJwtSecret();
  return signJwt(
    {
      url,
      validated_at: validatedAt,
      spec_version: specVersion,
      iss: 'agentmanifest-validator',
    },
    secret
  );
}

function getBaseUrlForValidation(sourceUrl: string): string | null {
  if (
    typeof sourceUrl === 'string' &&
    (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://'))
  ) {
    try {
      return new URL(sourceUrl).origin;
    } catch {
      return null;
    }
  }
  return null;
}

export async function validateManifestObject(manifest: ManifestData, sourceUrl: string = 'local-file'): Promise<ValidationResult> {
  const validatedAt = new Date().toISOString();
  const checks: ValidationCheck[] = [];
  const baseUrl = getBaseUrlForValidation(sourceUrl);
  const manifestUrl = baseUrl ? resolveManifestUrl(baseUrl) : null;

  // Skip reachability check for local validation
  checks.push({
    name: 'manifest_source',
    passed: true,
    message: 'Validating local manifest file',
    severity: 'info',
  });

  // 2. Schema validity
  checks.push(checkSchemaValidity(manifest));

  // 3. Spec version check
  checks.push(checkSpecVersion(manifest));

  // 4. Description quality
  checks.push(...checkDescriptionQuality(manifest));

  // 5. Skip endpoint reachability for local validation (no URL to test)
  checks.push({
    name: 'endpoint_reachability',
    passed: true,
    message: 'Skipped (local validation - deploy to test endpoints)',
    severity: 'info',
  });

  // 6. Pricing consistency
  checks.push(...checkPricingConsistency(manifest));

  // 7. Category validity
  checks.push(...checkCategoryValidity(manifest));

  // 8. Authentication consistency
  checks.push(checkAuthenticationConsistency(manifest));

  // 9. Payment consistency
  checks.push(...checkPaymentConsistency(manifest));

  // 10. Agent operational completeness
  const hasV03Payment = isV03(manifest) && !!manifest.payment?.model && manifest.payment.model !== 'free';
  const completenessResult = checkAgentOperationalCompleteness(
    manifest.agent_notes,
    hasV03Payment,
    isV03(manifest)
  );
  checks.push(completenessResult.check);

  // 11. Auth and payment verification
  const authPaymentResult = await validateAuthAndPayment(manifest, baseUrl);
  checks.push(...authPaymentResult.checks);

  // Determine if validation passed (all error-severity checks must pass)
  const passed = checks.every(
    (check) => check.passed || check.severity !== 'error'
  );

  // Generate verification token if passed
  const verificationToken = passed
    ? await generateVerificationToken(
        sourceUrl,
        validatedAt,
        manifest.spec_version || 'unknown'
      )
    : null;

  const budgetAware = isV03(manifest) && !!manifest.payment?.budget_controls &&
    (manifest.payment.budget_controls.supports_spend_cap === true ||
     manifest.payment.budget_controls.supports_per_request_limit === true);
  const { schema_valid, endpoints_reachable, badges } = computeDerivedFields(
    checks,
    authPaymentResult.auth_verified,
    authPaymentResult.payment_flow_verified,
    completenessResult.operationally_complete,
    budgetAware
  );

  return {
    url: sourceUrl,
    manifest_url: manifestUrl,
    validated_at: validatedAt,
    passed,
    spec_version: manifest.spec_version || null,
    checks,
    verification_token: verificationToken,
    schema_valid,
    endpoints_reachable,
    auth_verified: authPaymentResult.auth_verified,
    payment_flow_verified: authPaymentResult.payment_flow_verified,
    operationally_complete: completenessResult.operationally_complete,
    badges,
  };
}

export async function validateManifest(url: string): Promise<ValidationResult> {
  const validatedAt = new Date().toISOString();
  const checks: ValidationCheck[] = [];

  // Normalize URL; result.url keeps the submitted path, checks run against the origin
  let submittedUrl = url.trim();
  if (!submittedUrl.startsWith('http://') && !submittedUrl.startsWith('https://')) {
    submittedUrl = `https://${submittedUrl}`;
  }
  submittedUrl = submittedUrl.replace(/\/$/, '');

  let baseUrl: string;
  let manifestUrl: string;
  try {
    baseUrl = new URL(submittedUrl).origin;
    manifestUrl = resolveManifestUrl(baseUrl);
  } catch {
    return {
      url: submittedUrl,
      manifest_url: null,
      validated_at: validatedAt,
      passed: false,
      spec_version: null,
      checks: [
        {
          name: 'manifest_reachability',
          passed: false,
          message: `Invalid URL: ${url}`,
          severity: 'error',
        },
      ],
      verification_token: null,
    };
  }

  // 1. Manifest reachability
  const { check: reachabilityCheck, manifest } =
    await checkManifestReachability(manifestUrl);
  checks.push(reachabilityCheck);

  if (!manifest) {
    return {
      url: submittedUrl,
      manifest_url: manifestUrl,
      validated_at: validatedAt,
      passed: false,
      spec_version: null,
      checks,
      verification_token: null,
    };
  }

  // 2. Schema validity
  checks.push(checkSchemaValidity(manifest));

  // 3. Spec version check
  checks.push(checkSpecVersion(manifest));

  // 4. Description quality
  checks.push(...checkDescriptionQuality(manifest));

  // 5. Endpoint reachability
  checks.push(...(await checkEndpointReachability(baseUrl, manifest)));

  // 6. Pricing consistency
  checks.push(...checkPricingConsistency(manifest));

  // 7. Category validity
  checks.push(...checkCategoryValidity(manifest));

  // 8. Authentication consistency
  checks.push(checkAuthenticationConsistency(manifest));

  // 9. Payment consistency
  checks.push(...checkPaymentConsistency(manifest));

  // 10. Agent operational completeness
  const hasV03Payment = isV03(manifest) && !!manifest.payment?.model && manifest.payment.model !== 'free';
  const completenessResult = checkAgentOperationalCompleteness(
    manifest.agent_notes,
    hasV03Payment,
    isV03(manifest)
  );
  checks.push(completenessResult.check);

  // 11. Auth and payment verification
  const authPaymentResult = await validateAuthAndPayment(manifest, baseUrl);
  checks.push(...authPaymentResult.checks);

  // Determine if validation passed (all error-severity checks must pass)
  const passed = checks.every(
    (check) => check.passed || check.severity !== 'error'
  );

  // Generate verification token if passed
  const verificationToken = passed
    ? await generateVerificationToken(
        submittedUrl,
        validatedAt,
        manifest.spec_version || 'unknown'
      )
    : null;

  const budgetAware = isV03(manifest) && !!manifest.payment?.budget_controls &&
    (manifest.payment.budget_controls.supports_spend_cap === true ||
     manifest.payment.budget_controls.supports_per_request_limit === true);
  const { schema_valid, endpoints_reachable, badges } = computeDerivedFields(
    checks,
    authPaymentResult.auth_verified,
    authPaymentResult.payment_flow_verified,
    completenessResult.operationally_complete,
    budgetAware
  );

  return {
    url: submittedUrl,
    manifest_url: manifestUrl,
    validated_at: validatedAt,
    passed,
    spec_version: manifest.spec_version || null,
    checks,
    verification_token: verificationToken,
    schema_valid,
    endpoints_reachable,
    auth_verified: authPaymentResult.auth_verified,
    payment_flow_verified: authPaymentResult.payment_flow_verified,
    operationally_complete: completenessResult.operationally_complete,
    badges,
  };
}
