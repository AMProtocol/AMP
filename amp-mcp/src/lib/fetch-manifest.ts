import { resolveManifestUrl } from './resolve-manifest-url.js';
import type { AmpManifest, FetchManifestResult } from './types.js';

/** RFC 8615 primary path plus common publisher fallbacks. */
export const MANIFEST_PATH_CANDIDATES = [
  '/.well-known/agent-manifest.json',
  '/.well-known/amp.json',
  '/agent-manifest.json',
] as const;

function normalizeDomain(domain: string): string {
  const trimmed = domain.trim().replace(/\/+$/, '');
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  const host = withoutScheme.split('/')[0] ?? withoutScheme;
  return host;
}

function originFromDomain(domain: string): string {
  const host = normalizeDomain(domain);
  return `https://${host}`;
}

function manifestUrlsForOrigin(origin: string): string[] {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return MANIFEST_PATH_CANDIDATES.map((p) => `${base}${p}`);
}

function getFetchTimeoutMs(): number {
  const raw = process.env.AMP_FETCH_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : 15_000;
  return Number.isFinite(n) && n > 0 ? n : 15_000;
}

async function fetchJson(url: string): Promise<{ ok: true; data: AmpManifest } | { ok: false; status?: number; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getFetchTimeoutMs());
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      return { ok: false, error: `Unexpected Content-Type: ${contentType || '(none)'}` };
    }
    const data = (await response.json()) as AmpManifest;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchManifestByDomain(domain: string): Promise<FetchManifestResult> {
  const host = normalizeDomain(domain);
  const origin = originFromDomain(host);
  const canonical = resolveManifestUrl(origin);
  const tried = manifestUrlsForOrigin(origin);

  const errors: string[] = [];
  for (const url of tried) {
    const result = await fetchJson(url);
    if (result.ok) {
      return {
        domain: host,
        origin,
        manifest_url: url,
        tried_urls: tried,
        manifest: result.data,
      };
    }
    errors.push(`${url}: ${result.error}`);
  }

  throw new Error(
    `Could not fetch an AMP manifest for ${host}. Tried ${tried.length} URL(s). Canonical: ${canonical}. Details: ${errors.join(' | ')}`
  );
}
