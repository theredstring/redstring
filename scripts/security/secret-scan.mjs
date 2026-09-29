#!/usr/bin/env node
// Secret scanner for the Redstring repo (public on GitHub).
//
//   node scripts/security/secret-scan.mjs              # tracked files (working tree)
//   node scripts/security/secret-scan.mjs --staged     # what `git commit` would record (pre-commit hook)
//   node scripts/security/secret-scan.mjs --history    # every blob in every ref's history
//   node scripts/security/secret-scan.mjs --json       # machine-readable output (any mode)
//   node scripts/security/secret-scan.mjs --no-commits # --history without the per-hit commit lookup
//
// Exit codes: 0 clean, 1 secrets found, 2 the scan itself failed.
//
// Output is always redacted: a known prefix, three characters, the length and
// a fingerprint (truncated SHA-256). Nothing printed can be used as a key.
//
// Exceptions live in scripts/security/secret-scan-allowlist.json:
//   { "path": "<glob>", "rule": "<pattern id>", "reason": "..." }   a fake key in a test fixture
//   { "fingerprint": "<16 hex>", "reason": "..." }                  one specific value, e.g. a key
//                                                                    that was revoked but stays in history
// Every entry needs a reason. Patterns: scripts/security/secret-patterns.mjs.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';
import { scanText, isBinary } from './secret-patterns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOWLIST = path.join(ROOT, 'scripts', 'security', 'secret-scan-allowlist.json');
const MAX_BYTES = 50 * 1024 * 1024;

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, ...opts });

export function loadAllowlist(file = ALLOWLIST) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const bad = entries.filter((e) => typeof e.reason !== 'string' || e.reason.trim().length < 10 || (!e.fingerprint && !e.path));
  if (bad.length) throw new Error(`${path.relative(ROOT, file)}: every entry needs "reason" and either "path" or "fingerprint" (${bad.length} invalid)`);
  return entries.map((e) => ({ ...e, match: e.path ? picomatch(e.path, { dot: true }) : null }));
}

export function isAllowed(hit, entries) {
  return entries.some((e) =>
    (e.fingerprint && e.fingerprint === hit.fingerprint)
    || (e.match && e.match(hit.path) && (!e.rule || e.rule === hit.rule)));
}

function scanBuffer(buf, filePath) {
  if (!buf || buf.length === 0 || buf.length > MAX_BYTES || isBinary(buf)) return [];
  return scanText(buf.toString('utf8')).map((h) => ({ ...h, path: filePath }));
}

function scanTracked() {
  const files = git(['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const hits = [];
  for (const f of files) {
    const abs = path.join(ROOT, f);
    let st;
    try { st = fs.lstatSync(abs); } catch { continue; } // deleted in the working tree
    if (!st.isFile()) continue;
    hits.push(...scanBuffer(fs.readFileSync(abs), f));
  }
  return { hits, scanned: files.length };
}

function scanStaged() {
  const files = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const hits = [];
  for (const f of files) hits.push(...scanBuffer(git(['show', `:${f}`]), f));
  return { hits, scanned: files.length };
}

/** Streams `git cat-file --batch` for the given blob ids, calling onBlob(sha, buf). */
function catFileBatch(shas, onBlob) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
    let pending = Buffer.alloc(0);
    let header = null;
    child.stdout.on('data', (chunk) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      for (;;) {
        if (!header) {
          const nl = pending.indexOf(10);
          if (nl === -1) return;
          const [sha, type, size] = pending.subarray(0, nl).toString('utf8').split(' ');
          pending = pending.subarray(nl + 1);
          header = type === 'missing' ? null : { sha, size: Number(size) };
          if (!header) continue;
        }
        if (pending.length < header.size + 1) return;
        onBlob(header.sha, pending.subarray(0, header.size));
        pending = pending.subarray(header.size + 1);
        header = null;
      }
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git cat-file exited ${code}`))));
    child.stdin.end(`${shas.join('\n')}\n`);
  });
}

async function scanHistory({ commits = true } = {}) {
  // Every object reachable from any ref, with the first path it was seen at.
  const lines = git(['rev-list', '--all', '--objects'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const pathOf = new Map();
  for (const l of lines) {
    const sp = l.indexOf(' ');
    if (sp === -1) continue;
    const sha = l.slice(0, sp);
    if (!pathOf.has(sha)) pathOf.set(sha, l.slice(sp + 1));
  }
  // Keep blobs under the size cap.
  const check = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    cwd: ROOT, input: `${[...pathOf.keys()].join('\n')}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
  }).split('\n').filter(Boolean).map((l) => l.split(' '));
  const blobs = check.filter(([, type, size]) => type === 'blob' && Number(size) <= MAX_BYTES).map(([sha]) => sha);
  const hits = [];
  await catFileBatch(blobs, (sha, buf) => {
    for (const h of scanBuffer(buf, pathOf.get(sha))) hits.push({ ...h, blob: sha.slice(0, 10) });
  });
  if (commits) {
    const byBlob = new Map();
    for (const h of hits) {
      if (!byBlob.has(h.blob)) {
        let out = '';
        try { out = git(['log', '--all', '--format=%h %ad', '--date=short', `--find-object=${h.blob}`], { encoding: 'utf8' }); } catch { /* shallow clone */ }
        const list = out.split('\n').filter(Boolean);
        byBlob.set(h.blob, list.length ? `${list[list.length - 1]} (first of ${list.length} commit(s))` : 'unknown commit');
      }
      h.commit = byBlob.get(h.blob);
    }
  }
  return { hits, scanned: blobs.length };
}

function dedupeHistory(hits) {
  // The same key in 40 revisions of one file is one leak.
  const map = new Map();
  for (const h of hits) {
    const k = `${h.fingerprint}\u0000${h.path}`;
    if (!map.has(k)) map.set(k, { ...h, revisions: 1 });
    else map.get(k).revisions++;
  }
  return [...map.values()];
}

export async function main(argv = process.argv.slice(2)) {
  const mode = argv.includes('--history') ? 'history' : argv.includes('--staged') ? 'staged' : 'tracked';
  const asJson = argv.includes('--json');
  let result;
  if (mode === 'history') result = await scanHistory({ commits: !argv.includes('--no-commits') });
  else if (mode === 'staged') result = scanStaged();
  else result = scanTracked();

  const entries = loadAllowlist();
  let hits = result.hits;
  if (mode === 'history') hits = dedupeHistory(hits);
  const allowed = hits.filter((h) => isAllowed(h, entries));
  const found = hits.filter((h) => !isAllowed(h, entries));

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ mode, scanned: result.scanned, found, allowed: allowed.length })}\n`);
  } else {
    const unit = mode === 'history' ? 'blobs' : 'files';
    if (found.length === 0) {
      console.log(`secret-scan (${mode}): clean — ${result.scanned} ${unit} scanned, ${allowed.length} allowlisted hit(s).`);
    } else {
      console.log(`secret-scan (${mode}): ${found.length} possible secret(s) in ${result.scanned} ${unit} scanned (${allowed.length} allowlisted).\n`);
      for (const h of found) {
        const where = mode === 'history' ? `${h.path} [blob ${h.blob}${h.commit ? `, ${h.commit}` : ''}${h.revisions > 1 ? `, ${h.revisions} revisions` : ''}]` : `${h.path}:${h.line}`;
        console.log(`  ${h.label.padEnd(24)} ${h.redacted.padEnd(34)} fp:${h.fingerprint}  ${where}`);
      }
      console.log([
        '',
        'What to do:',
        '  1. Treat each key as leaked: revoke/rotate it at the provider first (documentation/security/RUNBOOK.md).',
        mode === 'history'
          ? '  2. History cannot be un-published. After revoking, add { "fingerprint": "<fp>", "reason": "revoked YYYY-MM-DD" }\n     to scripts/security/secret-scan-allowlist.json so the weekly scan goes green.'
          : '  2. Remove it from the file (use an env var or the OS keychain) and re-run this scan.',
        '  3. A fake key in a test fixture: build it at runtime (\'sk-or-v1-\' + \'0\'.repeat(64)) or allowlist the path with a reason.',
      ].join('\n'));
    }
  }
  return found.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`secret-scan failed: ${err.message}`);
    process.exit(2);
  });
}
