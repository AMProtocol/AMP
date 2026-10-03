import type { AmpManifest, PermissionCheckResult, PermissionVerdict } from './types.js';

const RESTRICTION_PATTERNS: Array<{ pattern: RegExp; code: string; message: string }> = [
  {
    pattern: /\b(do not|don't|must not|prohibited|forbidden)\b[^.]{0,80}\b(scrape|bulk|crawl|harvest|mirror)\b/i,
    code: 'agent_notes_usage_restriction',
    message: 'Agent notes appear to prohibit bulk scraping or mirroring.',
  },
  {
    pattern: /\b(no automated|no automation|human.?in.?the.?loop|manual approval)\b/i,
    code: 'agent_notes_human_required',
    message: 'Agent notes suggest human approval or non-automated use.',
  },
  {
    pattern: /\b(commercial use|resale|redistribut(e|ion))\b[^.]{0,60}\b(prohibited|not permitted|forbidden)\b/i,
    code: 'agent_notes_commercial_restriction',
    message: 'Agent notes may restrict commercial or redistribution use.',
  },
];

const ACTION_RESTRICTION_TRIGGERS: Array<{ actionPattern: RegExp; notesPattern: RegExp; code: string; message: string }> =
  [
    {
      actionPattern: /\b(scrape|crawl|bulk|mirror|harvest)\b/i,
      notesPattern: /\b(do not|don't|must not|prohibited)\b/i,
      code: 'action_vs_notes_scraping',
      message: 'Requested action looks like bulk/scraping while agent notes contain prohibitive language.',
    },
  ];

export function parseAction(action: string): { method: string | null; path: string | null } {
  const trimmed = action.trim();
  const urlMatch = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[2]);
      return { method: urlMatch[1].toUpperCase(), path: u.pathname };
    } catch {
      return { method: urlMatch[1].toUpperCase(), path: null };
    }
  }

  const methodPath = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s?]*)/i);
  if (methodPath) {
    return { method: methodPath[1].toUpperCase(), path: methodPath[2] };
  }

  const pathOnly = trimmed.match(/^(\/[^\s?]+)/);
  if (pathOnly) {
    return { method: 'GET', path: pathOnly[1] };
  }

  return { method: null, path: null };
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

type ManifestEndpoint = NonNullable<AmpManifest['endpoints']>[number];

function findEndpoint(
  manifest: AmpManifest,
  method: string | null,
  path: string | null
): ManifestEndpoint | null {
  if (!manifest.endpoints?.length || !path) {
    return null;
  }
  const normPath = normalizePath(path);
  const m = method?.toUpperCase() ?? null;

  const exact = manifest.endpoints.find(
    (ep) => normalizePath(ep.path) === normPath && (!m || ep.method.toUpperCase() === m)
  );
  if (exact) {
    return exact;
  }

  // Template-style match: /items/{id}
  for (const ep of manifest.endpoints) {
    const pattern = ep.path.replace(/\{[^}]+\}/g, '[^/]+');
    const re = new RegExp(`^${pattern}$`);
    if (re.test(normPath) && (!m || ep.method.toUpperCase() === m)) {
      return ep;
    }
  }

  return null;
}

function aggregateVerdict(findings: PermissionCheckResult['findings']): PermissionVerdict {
  if (findings.some((f) => f.severity === 'error')) {
    return 'violation';
  }
  if (findings.some((f) => f.severity === 'warning')) {
    return 'warning';
  }
  if (findings.length === 0) {
    return 'unknown';
  }
  return 'compliant';
}

export interface CheckPermissionsOptions {
  /** If true, treat unauthenticated access as a violation when auth is required. */
  intends_unauthenticated?: boolean;
  /** If true, agent claims payment/onboarding is already complete. */
  payment_onboarded?: boolean;
}

export function checkAgentPermissions(
  action: string,
  manifest: AmpManifest,
  options: CheckPermissionsOptions = {}
): PermissionCheckResult {
  const parsed = parseAction(action);
  const findings: PermissionCheckResult['findings'] = [];
  const notes = manifest.agent_notes ?? '';

  const matched = findEndpoint(manifest, parsed.method, parsed.path);

  if (parsed.path && !matched) {
    findings.push({
      code: 'endpoint_not_declared',
      severity: 'error',
      message: `No matching endpoint in manifest for ${parsed.method ?? 'ANY'} ${parsed.path}. Agents should only call declared operations.`,
    });
  } else if (matched) {
    findings.push({
      code: 'endpoint_declared',
      severity: 'info',
      message: `Matched declared endpoint ${matched.method} ${matched.path}.`,
    });
  } else {
    findings.push({
      code: 'action_unparsed',
      severity: 'warning',
      message:
        'Could not parse HTTP method/path from action. Pass values like "POST /baking/validate-mix" or "GET https://api.example.com/health".',
    });
  }

  if (manifest.authentication?.required) {
    if (options.intends_unauthenticated) {
      findings.push({
        code: 'auth_required',
        severity: 'error',
        message: `Manifest requires authentication (${manifest.authentication.type ?? 'credentials'}). ${manifest.authentication.instructions ?? ''}`.trim(),
      });
    } else {
      findings.push({
        code: 'auth_required',
        severity: 'warning',
        message: `Authentication is required (${manifest.authentication.type}). Ensure credentials are included per manifest instructions.`,
      });
    }
  }

  const payment = manifest.payment;
  const paidPricing =
    manifest.pricing?.model &&
    !['free', 'unknown'].includes(manifest.pricing.model);

  if (payment && payment.onboarding?.url && !options.payment_onboarded) {
    findings.push({
      code: 'payment_onboarding',
      severity: 'warning',
      message: `Payment block present; complete onboarding at ${payment.onboarding.url} before paid usage.`,
    });
  } else if (paidPricing && !payment && !options.payment_onboarded) {
    findings.push({
      code: 'pricing_paid',
      severity: 'info',
      message: `Pricing model is "${manifest.pricing?.model}"; confirm billing terms in agent_notes before high-volume use.`,
    });
  }

  if (manifest.rate_limits?.requests_per_minute || manifest.rate_limits?.requests_per_day) {
    findings.push({
      code: 'rate_limits',
      severity: 'info',
      message: `Rate limits apply (rpm: ${manifest.rate_limits.requests_per_minute ?? 'n/a'}, rpd: ${manifest.rate_limits.requests_per_day ?? 'n/a'}).`,
    });
  }

  const termsUrl = payment?.refund_policy?.terms_url;
  if (termsUrl) {
    findings.push({
      code: 'terms_url',
      severity: 'info',
      message: `Refund/terms documented at ${termsUrl}.`,
    });
  }

  for (const rule of RESTRICTION_PATTERNS) {
    if (rule.pattern.test(notes)) {
      findings.push({
        code: rule.code,
        severity: 'warning',
        message: rule.message,
      });
    }
  }

  for (const rule of ACTION_RESTRICTION_TRIGGERS) {
    if (rule.actionPattern.test(action) && rule.notesPattern.test(notes)) {
      findings.push({
        code: rule.code,
        severity: 'error',
        message: rule.message,
      });
    }
  }

  const verdict = aggregateVerdict(findings);
  const compliant = verdict === 'compliant' || verdict === 'warning';

  return {
    verdict,
    compliant,
    action: { raw: action, method: parsed.method, path: parsed.path },
    findings,
    matched_endpoint: matched,
  };
}
