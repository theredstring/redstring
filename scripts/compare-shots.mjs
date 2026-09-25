#!/usr/bin/env node
// Compare two folders of screenshots pixel by pixel (P2.11).
//
//   node scripts/compare-shots.mjs <before-dir> <after-dir> [diff-dir]
//
// Prints each file's differing-pixel count and exits 1 if any file differs or
// is missing. With diff-dir, writes a PNG per differing file with the changed
// pixels in red.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle');

const [before, after, diffDir] = process.argv.slice(2);
if (!before || !after) {
  console.error('Usage: node scripts/compare-shots.mjs <before-dir> <after-dir> [diff-dir]');
  process.exit(2);
}

const read = (file) => PNG.sync.read(fs.readFileSync(file));
const names = [...new Set([...fs.readdirSync(before), ...fs.readdirSync(after)])].filter((n) => n.endsWith('.png')).sort();
let failed = false;
if (diffDir) fs.mkdirSync(diffDir, { recursive: true });

for (const name of names) {
  const a = path.join(before, name);
  const b = path.join(after, name);
  if (!fs.existsSync(a) || !fs.existsSync(b)) {
    console.log(`${name}: missing in ${fs.existsSync(a) ? 'after' : 'before'}`);
    failed = true;
    continue;
  }
  const pa = read(a);
  const pb = read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    console.log(`${name}: size ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`);
    failed = true;
    continue;
  }
  let diff = 0;
  const out = diffDir ? new PNG({ width: pa.width, height: pa.height }) : null;
  for (let i = 0; i < pa.data.length; i += 4) {
    const same = pa.data[i] === pb.data[i] && pa.data[i + 1] === pb.data[i + 1]
      && pa.data[i + 2] === pb.data[i + 2] && pa.data[i + 3] === pb.data[i + 3];
    if (!same) diff += 1;
    if (out) {
      out.data[i] = same ? pa.data[i] >> 2 : 255;
      out.data[i + 1] = same ? pa.data[i + 1] >> 2 : 0;
      out.data[i + 2] = same ? pa.data[i + 2] >> 2 : 0;
      out.data[i + 3] = 255;
    }
  }
  console.log(`${name}: ${diff === 0 ? 'identical' : `${diff} pixels differ`}`);
  if (diff > 0) {
    failed = true;
    if (out) fs.writeFileSync(path.join(diffDir, name), PNG.sync.write(out));
  }
}
process.exit(failed ? 1 : 0);
