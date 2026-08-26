#!/usr/bin/env node
/**
 * Merge the per-architecture `latest-mac.yml` files produced by parallel macOS
 * release builds into the single manifest electron-updater expects.
 *
 * Why this exists
 * ---------------
 * macOS notarization is ~3.5 minutes per architecture and electron-builder runs
 * them serially, so a combined x64+arm64 build spends ~7 minutes waiting on
 * Apple. Splitting the two architectures into concurrent CI jobs halves that —
 * but each job then emits its OWN `latest-mac.yml` describing only the artifacts
 * it built. Uploading both to one release is last-writer-wins, which would leave
 * the auto-update feed advertising a single architecture and silently strand
 * every user on the other one.
 *
 * So the arch jobs publish nothing, and this merges their manifests.
 *
 * How electron-updater reads the result
 * -------------------------------------
 * MacUpdater selects its download by filtering `files[]` on whether the URL
 * contains "arm64" — keeping those entries on Apple Silicon and rejecting them
 * on Intel. That works only because `artifactName` in electron-builder.json puts
 * the arch in the filename (`Redstring-mac-arm64.zip`). The merge below is
 * therefore just a union of the `files` arrays; no rewriting is needed.
 *
 * The top-level `path`/`sha512`/`size` fields are the pre-`files[]` format that
 * old updaters still read, and they can only name one artifact. They're pointed
 * at the x64 build deliberately: a client old enough to depend on them predates
 * Apple Silicon support, so Intel is the safer thing for it to be handed.
 *
 * Usage: node scripts/merge-mac-update-manifest.js <input-dir> <output-dir>
 *   input-dir  - searched recursively for latest-mac.yml (one per arch job)
 *   output-dir - receives the single merged latest-mac.yml
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const [, , inputDir, outputDir] = process.argv;

if (!inputDir || !outputDir) {
  console.error('Usage: merge-mac-update-manifest.js <input-dir> <output-dir>');
  process.exit(1);
}

/** Every latest-mac.yml under `dir`, at any depth. */
const findManifests = (dir) => {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findManifests(full));
    else if (entry.name === 'latest-mac.yml') found.push(full);
  }
  return found;
};

const manifestPaths = findManifests(inputDir);

if (manifestPaths.length === 0) {
  console.log('[merge-mac] No latest-mac.yml found — nothing to merge.');
  process.exit(0);
}

const manifests = manifestPaths.map((file) => ({
  file,
  doc: yaml.load(fs.readFileSync(file, 'utf8'))
}));

for (const { file, doc } of manifests) {
  const urls = (doc?.files ?? []).map((f) => f.url).join(', ');
  console.log(`[merge-mac] ${path.relative(inputDir, file)} → [${urls}]`);
}

// A version disagreement means artifacts from two different builds landed in the
// same release. Merging them would produce a manifest that points at a mixture,
// so fail rather than publish something incoherent.
const versions = [...new Set(manifests.map((m) => m.doc?.version).filter(Boolean))];
if (versions.length > 1) {
  console.error(`[merge-mac] Refusing to merge: conflicting versions ${versions.join(' vs ')}`);
  process.exit(1);
}

// Union the file entries, keyed by url. Duplicates would make an updater
// download the same artifact twice.
const filesByUrl = new Map();
for (const { doc } of manifests) {
  for (const entry of doc?.files ?? []) {
    if (entry?.url) filesByUrl.set(entry.url, entry);
  }
}
const files = [...filesByUrl.values()];

if (files.length === 0) {
  console.error('[merge-mac] Refusing to merge: no file entries in any manifest.');
  process.exit(1);
}

// Legacy single-artifact fields — Intel by preference, see the header note.
// Fall back to the first entry if this build produced no x64 slice at all.
const legacy = files.find((f) => !f.url.includes('arm64')) ?? files[0];

// Newest wins: the merged manifest describes whichever build finished last.
const releaseDate = manifests
  .map((m) => m.doc?.releaseDate)
  .filter(Boolean)
  .sort()
  .pop();

const merged = {
  version: versions[0],
  files,
  path: legacy.url,
  sha512: legacy.sha512,
  releaseDate
};
if (legacy.size != null) merged.size = legacy.size;

fs.mkdirSync(outputDir, { recursive: true });
const outFile = path.join(outputDir, 'latest-mac.yml');
fs.writeFileSync(outFile, yaml.dump(merged, { lineWidth: -1 }));

console.log(`[merge-mac] Merged ${manifests.length} manifest(s) → ${files.length} artifact(s):`);
for (const f of files) console.log(`[merge-mac]   ${f.url}`);
console.log(`[merge-mac] Legacy path field → ${merged.path}`);
console.log(`[merge-mac] Wrote ${outFile}`);
