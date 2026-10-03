/**
 * Origin-level manifest URL per RFC 8615 (matches @agentmanifest/validator).
 */
export function resolveManifestUrl(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return new URL('/.well-known/agent-manifest.json', withScheme).toString();
}
