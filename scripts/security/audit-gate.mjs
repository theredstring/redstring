#!/usr/bin/env node
// Dependency audit gate: fails on high/critical advisories in runtime
// (non-dev) dependencies unless each one is allowlisted with a reason and an
// expiry date.
//
//   node scripts/security/audit-gate.mjs                    # runs npm audit --json --omit=dev
//   node scripts/security/audit-gate.mjs --from-file r.json # gate an existing `npm audit --json` report
//   node scripts/security/audit-gate.mjs --include-dev      # also dev dependencies (informational)
//   node scripts/security/audit-gate.mjs --json             # machine-readable result
//
// Exit codes: 0 pass, 1 unallowlisted high/critical advisories (or expired
// allowlist entries), 2 the audit itself could not run.
//
// Allowlist: scripts/security/audit-allowlist.json
//   { "package": "xlsx", "advisories": ["GHSA-4r6h-8v6p-xvw6"], "reason": "...", "expires": "2026-12-31" }
// `advisories` is optional (omit to cover every advisory of that package).
// An expired entry stops covering anything and fails the gate, so exceptions
// get re-reviewed instead of living forever. Keep expiries within ~90 days.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOWLIST = path.join(ROOT, 'scripts', 'security', 'audit-allowlist.json');
const GATED = new Set(['high', 'critical']);
const MAX_EXPIRY_DAYS = 180;

export function loadAllowlist(file = ALLOWLIST, today = new Date()) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const errors = [];
  const active = [];
  const expired = [];
  for (const [i, e] of entries.entries()) {
    const at = `entry #${i + 1} (${e.package ?? '?'})`;
    if (typeof e.package !== 'string' || !e.package) errors.push(`${at}: "package" is required`);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 20) errors.push(`${at}: "reason" must say why this is not exploitable here (20+ characters)`);
    const exp = typeof e.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.expires) ? new Date(`${e.expires}T23:59:59Z`) : null;
    if (!exp || Number.isNaN(exp.getTime())) { errors.push(`${at}: "expires" must be a YYYY-MM-DD date`); continue; }
    if ((exp - today) / 86400000 > MAX_EXPIRY_DAYS) errors.push(`${at}: expires more than ${MAX_EXPIRY_DAYS} days out; pick a nearer review date`);
    if (e.advisories !== undefined && !(Array.isArray(e.advisories) && e.advisories.every((a) => typeof a === 'string'))) {
      errors.push(`${at}: "advisories" must be an array of GHSA ids`);
    }
    (exp < today ? expired : active).push(e);
  }
  return { active, expired, errors };
}

const ghsaOf = (via) => (typeof via.url === 'string' && via.url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0]) || String(via.source ?? via.title ?? '?');

/**
 * From an npm audit v2 report, the high/critical root advisories, each with
 * the vulnerable package and which installed packages pull it in.
 */
export function rootAdvisories(report) {
  const vulns = report?.vulnerabilities || {};
  const roots = new Map(); // ghsa|package → advisory
  for (const v of Object.values(vulns)) {
    for (const via of v.via || []) {
      if (typeof via !== 'object' || !GATED.has(via.severity)) continue;
      const id = ghsaOf(via);
      const key = `${id}|${via.name}`;
      if (!roots.has(key)) {
        roots.set(key, {
          id, package: via.name, severity: via.severity, title: via.title, url: via.url, range: via.range,
          fixAvailable: v.fixAvailable, pulledInBy: new Set(),
        });
      }
    }
  }
  // Who depends on each vulnerable package (npm lists them under `effects`).
  for (const adv of roots.values()) {
    const seen = new Set();
    const queue = [adv.package];
    while (queue.length) {
      const name = queue.shift();
      if (seen.has(name)) continue;
      seen.add(name);
      const v = vulns[name];
      if (!v) continue;
      if (v.isDirect) adv.pulledInBy.add(name);
      queue.push(...(v.effects || []));
    }
  }
  return [...roots.values()].map((a) => ({ ...a, pulledInBy: [...a.pulledInBy].sort() }));
}

export function gate(report, allow) {
  const advisories = rootAdvisories(report);
  const covered = (a) => allow.active.find((e) => e.package === a.package && (!e.advisories || e.advisories.includes(a.id)));
  const failing = advisories.filter((a) => !covered(a));
  const allowed = advisories.filter((a) => covered(a));
  const unused = allow.active.filter((e) => !advisories.some((a) => e.package === a.package && (!e.advisories || e.advisories.includes(a.id))));
  return { failing, allowed, unused, expired: allow.expired, errors: allow.errors };
}

function runNpmAudit(includeDev) {
  const args = ['audit', '--json'];
  if (!includeDev) args.push('--omit=dev');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  // npm audit exits 1 when it finds anything; only a missing/invalid JSON body is a real failure.
  let report;
  try { report = JSON.parse(r.stdout); } catch { report = null; }
  if (!report || report.error) {
    const why = report?.error?.summary || r.stderr?.trim() || `npm audit exited ${r.status}`;
    throw new Error(`npm audit did not produce a report: ${why}`);
  }
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const fromIdx = argv.indexOf('--from-file');
  const includeDev = argv.includes('--include-dev');
  const report = fromIdx !== -1 ? JSON.parse(fs.readFileSync(argv[fromIdx + 1], 'utf8')) : runNpmAudit(includeDev);
  const result = gate(report, loadAllowlist());
  const fail = result.failing.length > 0 || result.expired.length > 0 || result.errors.length > 0;

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ pass: !fail, ...result })}\n`);
    return fail ? 1 : 0;
  }
  const scope = fromIdx !== -1 ? `report ${path.basename(argv[fromIdx + 1])}`
    : includeDev ? 'all dependencies' : 'runtime dependencies (--omit=dev)';
  for (const e of result.errors) console.log(`audit-allowlist: ${e}`);
  for (const e of result.expired) console.log(`audit-allowlist: entry for ${e.package} expired on ${e.expires} — re-review it (fix, or renew with a new reason).`);
  if (result.failing.length) {
    const byPackage = new Map();
    for (const a of result.failing) {
      if (!byPackage.has(a.package)) byPackage.set(a.package, []);
      byPackage.get(a.package).push(a);
    }
    console.log(`audit-gate: ${result.failing.length} high/critical advisor${result.failing.length === 1 ? 'y' : 'ies'} in ${byPackage.size} package(s), ${scope}:\n`);
    for (const [pkg, list] of byPackage) {
      const a = list[0];
      const worst = list.some((x) => x.severity === 'critical') ? 'critical' : 'high';
      const fix = a.fixAvailable === true ? 'fix: npm audit fix'
        : a.fixAvailable && typeof a.fixAvailable === 'object' ? `fix: ${a.fixAvailable.name}@${a.fixAvailable.version}${a.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
          : 'no fix available';
      const via = [...new Set(list.flatMap((x) => x.pulledInBy))];
      console.log(`  [${worst}] ${pkg} — ${list.length} advisor${list.length === 1 ? 'y' : 'ies'}; ${fix}`);
      console.log(`           via: ${via.join(', ') || `a transitive dependency (npm ls ${pkg})`}`);
      for (const x of list) console.log(`           ${x.id}  ${String(x.title).slice(0, 90)}`);
    }
    console.log([
      '',
      'What to do: upgrade or replace the package. If it truly cannot be exploited here (e.g. the vulnerable',
      'function is never called), add an entry with a reason and an expiry to scripts/security/audit-allowlist.json.',
    ].join('\n'));
  }
  if (result.unused.length) console.log(`audit-allowlist: ${result.unused.length} entr${result.unused.length === 1 ? 'y no longer matches' : 'ies no longer match'} anything — delete: ${result.unused.map((e) => e.package).join(', ')}`);
  if (!fail) console.log(`audit-gate: pass — no unallowlisted high/critical advisories in ${scope} (${result.allowed.length} allowlisted).`);
  return fail ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`audit-gate failed to run: ${err.message}`);
    process.exit(2);
  });
}
