#!/usr/bin/env node
// Exports every listing from the live registry API into a local backup directory:
// the list response, each listing's stored detail (manifest snapshot + contact),
// the manifest each domain serves right now, and a fresh validator result.
//
// Usage: node scripts/export-registry.mjs <out-dir> [--since <ISO date>] [--skip-validate]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.REGISTRY_API || 'https://api.agent-manifest.com';
const VALIDATOR = process.env.VALIDATOR_API || 'https://validator.agent-manifest.com';
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--'));
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]) : null;
const skipValidate = args.includes('--skip-validate');

if (!outDir) {
  console.error('Usage: node scripts/export-registry.mjs <out-dir> [--since <ISO date>] [--skip-validate]');
  process.exit(1);
}

async function fetchJson(url, init = {}, timeoutMs = 60000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), body };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function wellKnownUrl(listingUrl) {
  return new URL('/.well-known/agent-manifest.json', listingUrl).toString();
}

async function main() {
  const exportedAt = new Date().toISOString();
  for (const sub of ['details', 'live', 'validation']) {
    await mkdir(join(outDir, sub), { recursive: true });
  }

  const list = await fetchJson(`${API}/listings?limit=500`);
  if (list.status !== 200) throw new Error(`GET /listings returned ${list.status}`);
  await writeFile(join(outDir, 'listings.json'), JSON.stringify(list.body, null, 2));

  let listings = list.body.data.listings;
  if (since) {
    listings = listings.filter((l) => new Date(l.verified_at ?? 0) > since);
  }
  console.log(`Exporting ${listings.length} listings from ${API}`);

  const categories = await fetchJson(`${API}/categories`);
  await writeFile(join(outDir, 'categories.json'), JSON.stringify(categories.body, null, 2));

  const summary = await mapLimit(listings, CONCURRENCY, async (listing, i) => {
    const row = { id: listing.id, name: listing.name, url: listing.url };

    const detail = await fetchJson(`${API}/listings/${listing.id}`);
    await writeFile(join(outDir, 'details', `${listing.id}.json`), JSON.stringify(detail.body, null, 2));
    row.detail_status = detail.status;
    row.contact = detail.body?.data?.contact ?? null;
    row.created_at = detail.body?.data?.created_at ?? null;
    row.stored_spec_version = detail.body?.data?.manifest?.spec_version ?? null;
    row.stored_last_updated = detail.body?.data?.manifest?.last_updated ?? null;

    const manifestUrl = wellKnownUrl(listing.url);
    row.manifest_url = manifestUrl;
    try {
      const live = await fetchJson(manifestUrl, {}, 20000);
      await writeFile(
        join(outDir, 'live', `${listing.id}.json`),
        JSON.stringify({ manifest_url: manifestUrl, fetched_at: new Date().toISOString(), ...live }, null, 2)
      );
      row.live_status = live.status;
      row.live_spec_version = typeof live.body === 'object' ? live.body?.spec_version ?? null : null;
      row.live_last_updated = typeof live.body === 'object' ? live.body?.last_updated ?? null : null;
    } catch (err) {
      row.live_status = null;
      row.live_error = err.message;
    }

    if (!skipValidate) {
      try {
        const result = await fetchJson(
          `${VALIDATOR}/validate`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: listing.url }),
          },
          90000
        );
        await writeFile(join(outDir, 'validation', `${listing.id}.json`), JSON.stringify(result.body, null, 2));
        row.validation_passed = result.body?.passed ?? null;
        row.validation_badges = result.body?.badges ?? [];
        row.validation_errors = (result.body?.checks ?? [])
          .filter((c) => !c.passed && c.severity === 'error')
          .map((c) => `${c.name}: ${c.message}`);
      } catch (err) {
        row.validation_passed = null;
        row.validation_error = err.message;
      }
    }

    console.log(`[${i + 1}/${listings.length}] ${listing.name} live=${row.live_status} passed=${row.validation_passed}`);
    return row;
  });

  await writeFile(
    join(outDir, 'summary.json'),
    JSON.stringify({ exported_at: exportedAt, api: API, validator: VALIDATOR, since, count: summary.length, listings: summary }, null, 2)
  );
  const failed = summary.filter((r) => r.validation_passed === false);
  console.log(`Done. ${summary.length} exported, ${failed.length} failing validation today.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
