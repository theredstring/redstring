#!/usr/bin/env node
/**
 * Check the macOS signing certificate before a release builds.
 *
 * The release signs with the Developer ID Application certificate in CSC_LINK
 * (a base64 .p12, unlocked by CSC_KEY_PASSWORD). Apple issues these for one
 * year now, so it will run out every November or so (renewal steps:
 * documentation/dev-ops/CODE_SIGNING.md). This step reads the certificate and:
 *
 *   - fails when it has expired, is not a Developer ID Application
 *     certificate, or belongs to another team. The updater on every installed
 *     copy only accepts Developer ID builds from our team
 *     (electron/updaterSignature.cjs), so any of those would ship a release no
 *     one can update to;
 *   - warns when it expires within WARN_DAYS, so renewal starts in time;
 *   - only warns when it can't read the file. A wrong password fails at
 *     electron-builder's signing step anyway, and a parsing gap here must not
 *     block a release that would have signed fine.
 *
 * Runs on the macOS runner only, before the build, so a bad certificate fails
 * in seconds rather than after the ten-minute build.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DEFAULT_TEAM_ID } = require('../electron/updaterSignature.cjs');

export const WARN_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Judge a certificate from its subject line and expiry date.
 * Returns { status: 'ok' | 'warn' | 'fail', message }.
 */
export function evaluateCertificate({ subject, notAfter, now = new Date(), teamId = DEFAULT_TEAM_ID, warnDays = WARN_DAYS }) {
  const name = (String(subject).match(/CN\s*=\s*(Developer ID Application:[^/\n]*?\([A-Z0-9]{10}\))/) || [])[1];
  if (!name) {
    return { status: 'fail', message: `CSC_LINK is not a Developer ID Application certificate (subject: ${subject}). Apple Development and Apple Distribution certificates can't sign a release people download.` };
  }
  const ou = (String(subject).match(/OU\s*=\s*([A-Z0-9]{10})/) || [])[1];
  if (ou !== teamId) {
    return { status: 'fail', message: `${name} belongs to team ${ou || 'unknown'}, not ${teamId}. Installed copies would refuse this release as an update.` };
  }
  const expires = new Date(notAfter);
  if (Number.isNaN(expires.getTime())) {
    return { status: 'warn', message: `${name}: couldn't read its expiry date (${notAfter}).` };
  }
  const daysLeft = Math.floor((expires.getTime() - now.getTime()) / DAY_MS);
  const when = expires.toISOString().slice(0, 10);
  if (expires.getTime() <= now.getTime()) {
    return { status: 'fail', message: `${name} expired on ${when}. Make a new one and replace CSC_LINK and CSC_KEY_PASSWORD (documentation/dev-ops/CODE_SIGNING.md).` };
  }
  if (daysLeft <= warnDays) {
    return { status: 'warn', message: `${name} expires on ${when}, in ${daysLeft} days. Renew it before then (documentation/dev-ops/CODE_SIGNING.md).` };
  }
  return { status: 'ok', message: `Signing as ${name}, valid until ${when} (${daysLeft} days).` };
}

/** The .p12 bytes CSC_LINK points at: a file path, or base64 (what release.yml uses). */
export function readCscLink(cscLink) {
  const value = String(cscLink || '').trim();
  if (/^https?:\/\//i.test(value)) return null;
  const path = value.replace(/^file:\/\//, '');
  if (path.length < 1024 && existsSync(path)) return readFileSync(path);
  return Buffer.from(value.replace(/\s+/g, ''), 'base64');
}

/** Subject and expiry of the certificate in a .p12, via openssl. Throws if it can't be read. */
function inspectP12(p12, password) {
  const env = { ...process.env, CSC_KEY_PASSWORD: password || '' };
  // macOS's own /usr/bin/openssl (LibreSSL) reads Keychain exports as they come;
  // OpenSSL 3 needs -legacy for their older ciphers.
  const attempts = [
    ['/usr/bin/openssl', []],
    ['openssl', []],
    ['openssl', ['-legacy']],
  ].filter(([bin]) => bin !== '/usr/bin/openssl' || existsSync(bin));
  let lastError;
  for (const [bin, extra] of attempts) {
    try {
      const pem = execFileSync(bin, ['pkcs12', '-nokeys', '-clcerts', '-passin', 'env:CSC_KEY_PASSWORD', ...extra], { input: p12, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const out = execFileSync(bin, ['x509', '-noout', '-subject', '-enddate'], { input: pem, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      const subject = (out.match(/^subject\s*=\s*(.*)$/m) || [])[1];
      const notAfter = (out.match(/^notAfter\s*=\s*(.*)$/m) || [])[1];
      if (subject && notAfter) return { subject, notAfter };
      lastError = new Error(`unexpected openssl output: ${out.trim()}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function main() {
  const report = (level, message) => console.log(`::${level}::${message}`);
  if (!process.env.CSC_LINK) {
    report('error', 'CSC_LINK secret is not set: the macOS release would ship unsigned, and installed copies would refuse it as an update.');
    process.exit(1);
  }
  const p12 = readCscLink(process.env.CSC_LINK);
  if (!p12) {
    report('warning', 'CSC_LINK is a URL; not downloading it to check the certificate.');
    return;
  }
  let cert;
  try {
    cert = inspectP12(p12, process.env.CSC_KEY_PASSWORD);
  } catch (err) {
    report('warning', `Couldn't read the certificate in CSC_LINK to check its expiry (${String(err.message || err).split('\n')[0]}). If CSC_KEY_PASSWORD is wrong, signing will fail next.`);
    return;
  }
  const result = evaluateCertificate(cert);
  if (result.status === 'fail') {
    report('error', result.message);
    process.exit(1);
  }
  if (result.status === 'warn') report('warning', result.message);
  else console.log(result.message);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
