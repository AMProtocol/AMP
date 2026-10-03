/** Minimal manifest shape for permission checks (AMP v0.2/v0.3). */
export interface AmpManifest {
  spec_version?: string;
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  endpoints?: Array<{
    path: string;
    method: string;
    description: string;
    parameters?: unknown;
    response_description?: string;
    cost_hint?: {
      unit: string;
      estimated_price: string;
      currency: string;
      notes?: string;
    };
  }>;
  authentication?: {
    required?: boolean;
    type?: string | null;
    instructions?: string | null;
  };
  pricing?: {
    model?: string;
    free_tier?: unknown;
    paid_tier?: unknown;
  };
  payment?: null | {
    model?: string;
    onboarding?: { url?: string };
    budget_controls?: Record<string, unknown>;
    refund_policy?: { terms_url?: string | null };
  };
  rate_limits?: {
    requests_per_minute?: number | null;
    requests_per_day?: number | null;
    burst?: number | null;
    notes?: string | null;
  };
  agent_notes?: string;
  contact?: Record<string, unknown>;
}

export interface FetchManifestResult {
  domain: string;
  origin: string;
  manifest_url: string;
  tried_urls: string[];
  manifest: AmpManifest;
}

export interface SyntaxValidationResult {
  valid: boolean;
  spec_version: string | null;
  schema_checked: string | null;
  errors: string[];
  success_token: string | null;
}

export type PermissionVerdict = 'compliant' | 'violation' | 'warning' | 'unknown';

export interface PermissionCheckResult {
  verdict: PermissionVerdict;
  compliant: boolean;
  action: {
    raw: string;
    method: string | null;
    path: string | null;
  };
  findings: Array<{
    code: string;
    severity: 'error' | 'warning' | 'info';
    message: string;
  }>;
  matched_endpoint: {
    path: string;
    method: string;
    description: string;
  } | null;
}
