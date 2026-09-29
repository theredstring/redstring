#!/usr/bin/env node
// Post-build check of what actually ships: run after `npm run build`.
//
//   node scripts/security/check-dist.mjs                  # checks ./dist
//   node scripts/security/check-dist.mjs dist-profile     # another build output
//   node scripts/security/check-dist.mjs --no-sourcemaps  # also fail on *.map files
//   node scripts/security/check-dist.mjs --no-headers     # skip the _headers check (non-web builds)
//
// Fails (exit 1) when dist/:
//   - contains anything matching a secret pattern (scripts/security/secret-patterns.mjs)
//   - contains a forbidden file (debug/test pages, .env*, keys, WIZARD_KEY.txt, github.env*, .dev.vars)
//   - has an index.html without the C-8 Content-Security-Policy meta, or with a weak script-src
//   - lacks _headers with frame-ancestors / HSTS / nosniff (the Cloudflare Pages response headers)
//   - still contains the local debug-log endpoint (127.0.0.1:7242, S-57)
// Exit 2 when there is no build to check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, isBinary } from './secret-patterns.mjs';
import { cspProblems } from './csp-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FORBIDDEN = [
  [/(^|\/)debug[-_.][^/]*\.html$/i, 'debug page'],
  [/(^|\/)[^/]*(test|preview|sandbox|playground)[^/]*\.html$/i, 'test/preview page'],
  [/(^|\/)\.env(\..*)?$/, 'environment file'],
  [/(^|\/)\.dev\.vars$/, 'Wrangler secrets'],
  [/(^|\/)WIZARD_KEY\.txt$/, 'wizard API key file'],
  [/(^|\/)github\.env/, 'GitHub App credentials'],
  [/\.(pem|key|p12|pfx)$/i, 'private key / certificate'],
  [/(^|\/)backup\.redstring$/, 'personal universe backup'],
];

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else if (entry.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

export async function checkDist(distDir, { sourcemaps = true, headers = true } = {}) {
  const problems = [];
  const files = walk(distDir);

  for (const f of files) {
    const hit = FORBIDDEN.find(([re]) => re.test(f));
    if (hit) problems.push(`${f}: forbidden file in the build (${hit[1]})`);
    if (!sourcemaps && f.endsWith('.map')) problems.push(`${f}: source map shipped (--no-sourcemaps)`);
    const buf = fs.readFileSync(path.join(distDir, f));
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    for (const h of scanText(text)) problems.push(`${f}:${h.line}: ${h.label} ${h.redacted} (fp:${h.fingerprint})`);
    if (/127\.0\.0\.1:7242|localhost:7242/.test(text) && !f.endsWith('.map')) problems.push(`${f}: contains the local debug-log endpoint :7242 (S-57: compile debugLogger out of production)`);
  }

  const index = path.join(distDir, 'index.html');
  if (!fs.existsSync(index)) problems.push('index.html: missing');
  else for (const p of cspProblems(fs.readFileSync(index, 'utf8'))) problems.push(`index.html: CSP: ${p}`);

  if (headers) {
    const hdr = path.join(distDir, '_headers');
    if (!fs.existsSync(hdr)) problems.push('_headers: missing (public/_headers should be copied into the build)');
    else {
      const t = fs.readFileSync(hdr, 'utf8').toLowerCase();
      if (!/frame-ancestors\s+'none'/.test(t)) problems.push("_headers: no frame-ancestors 'none'");
      if (!/strict-transport-security:/.test(t)) problems.push('_headers: no Strict-Transport-Security');
      if (!/x-content-type-options:\s*nosniff/.test(t)) problems.push('_headers: no X-Content-Type-Options: nosniff');
    }
  }
  return { files: files.length, problems };
}

export async function main(argv = process.argv.slice(2)) {
  const dirArg = argv.find((a) => !a.startsWith('--'));
  const distDir = path.resolve(ROOT, dirArg || 'dist');
  if (!fs.existsSync(distDir)) {
    console.error(`check-dist: ${path.relative(ROOT, distDir) || distDir} does not exist — run npm run build first.`);
    return 2;
  }
  const { files, problems } = await checkDist(distDir, {
    sourcemaps: !argv.includes('--no-sourcemaps'),
    headers: !argv.includes('--no-headers'),
  });
  if (problems.length) {
    console.log(`check-dist: ${problems.length} problem(s) in ${files} files under ${path.relative(ROOT, distDir)}/:`);
    for (const p of problems) console.log(`  ${p}`);
    console.log('\nWhy it matters: dist/ is exactly what redstring.io, the desktop app and the mobile apps ship.');
    return 1;
  }
  console.log(`check-dist: pass — ${files} files under ${path.relative(ROOT, distDir)}/ checked.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`check-dist failed: ${err.message}`);
    process.exit(2);
  });
}
