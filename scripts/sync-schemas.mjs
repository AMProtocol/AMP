#!/usr/bin/env node
// Copies the canonical schemas from spec/ into validator/schemas/, which Railway
// can see when it builds the validator from its own folder.
//
// Usage: node scripts/sync-schemas.mjs [--check]
//   --check  exit 1 if validator/schemas/ is out of date instead of writing

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const FILES = [
  ['spec/schemas/v0.2/manifest.json', 'validator/schemas/v0.2/manifest.json'],
  ['spec/schemas/v0.3/manifest.json', 'validator/schemas/v0.3/manifest.json'],
  ['spec/registry-record.schema.json', 'validator/schemas/registry-record.json'],
];

async function readOrNull(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

let stale = [];
for (const [from, to] of FILES) {
  const source = await readFile(join(root, from), 'utf8');
  const target = await readOrNull(join(root, to));
  if (source === target) continue;
  if (check) {
    stale.push(to);
  } else {
    await mkdir(dirname(join(root, to)), { recursive: true });
    await writeFile(join(root, to), source);
    console.log(`synced ${from} -> ${to}`);
  }
}

const expected = new Set(FILES.map(([, to]) => to));
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(rel)));
    else if (entry.name.endsWith('.json')) out.push(rel);
  }
  return out;
}
const extra = (await walk('validator/schemas').catch(() => [])).filter((f) => !expected.has(f));
if (extra.length) stale.push(...extra.map((f) => `${f} (not in spec/)`));

if (check && stale.length) {
  console.error('validator/schemas/ is out of date. Run `npm run sync-schemas`:');
  for (const f of stale) console.error(`  ${f}`);
  process.exit(1);
}
