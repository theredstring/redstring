#!/usr/bin/env node
/**
 * Check the App Store Connect API key secrets before a macOS release builds.
 *
 * Notarization runs after the build and signing, about two minutes in, and
 * notarytool is the first thing to read APPLE_API_ISSUER, APPLE_API_KEY_ID and
 * APPLE_API_KEY_P8. A value pasted into the wrong secret (v0.15.10's first run:
 * "'***' is invalid for '--issuer'") then fails the whole Mac job. This step
 * checks their shape in seconds and says which one is wrong, never what it is.
 *
 * Spaces and line breaks around the two IDs are trimmed by the build step, so
 * they are only warned about here. With no APPLE_API_KEY_P8 the release
 * notarizes with the Apple ID login, and there is nothing to check.
 */

import { fileURLToPath } from 'node:url';

const ISSUER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Z0-9]{10}$/;
const P8 = /-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/;

const trim = (value) => String(value || '').replace(/\s+/g, '');

/** What the other secret's value looks like, to name a mix-up. */
function looksLike(value, teamId) {
  if (value === teamId) return ' It looks like the Team ID.';
  if (KEY_ID.test(value)) return ' It looks like a Key ID.';
  if (ISSUER.test(value)) return ' It looks like an Issuer ID.';
  if (/PRIVATE KEY/.test(value)) return ' It looks like the .p8 key itself.';
  return '';
}

/**
 * Judge the three secrets. Returns { status: 'ok' | 'skip' | 'fail', errors, warnings }.
 * Messages name the secret, never its value.
 */
export function evaluateNotarizeKey({ p8, keyId, issuer, teamId = '' }) {
  if (!p8) return { status: 'skip', errors: [], warnings: [] };
  const errors = [];
  const warnings = [];
  for (const [name, raw] of [['APPLE_API_ISSUER', issuer], ['APPLE_API_KEY_ID', keyId]]) {
    if (raw && trim(raw) !== raw) warnings.push(`${name} has spaces or a line break in it; the build trims them.`);
  }
  const issuerValue = trim(issuer);
  const keyIdValue = trim(keyId);
  if (!issuerValue) {
    errors.push('APPLE_API_ISSUER is not set. It is the Issuer ID above the key list in App Store Connect (Users and Access > Integrations > Team Keys).');
  } else if (!ISSUER.test(issuerValue)) {
    errors.push(`APPLE_API_ISSUER is not an Issuer ID (a UUID like 57246542-96fe-1a63-e053-0824d011072a).${looksLike(issuerValue, teamId)} The Issuer ID is above the key list in App Store Connect (Users and Access > Integrations > Team Keys).`);
  }
  if (!keyIdValue) {
    errors.push('APPLE_API_KEY_ID is not set. It is the Key ID in the key\'s row in App Store Connect.');
  } else if (!KEY_ID.test(keyIdValue)) {
    errors.push(`APPLE_API_KEY_ID is not a Key ID (10 capital letters and digits).${looksLike(keyIdValue, teamId)}`);
  } else if (keyIdValue === teamId) {
    errors.push('APPLE_API_KEY_ID is the Team ID, not the Key ID. The Key ID is in the key\'s row in App Store Connect.');
  }
  if (!P8.test(String(p8))) {
    errors.push('APPLE_API_KEY_P8 is not a .p8 key: paste the whole AuthKey_<KeyID>.p8 file, BEGIN and END lines included.');
  }
  return { status: errors.length ? 'fail' : 'ok', errors, warnings };
}

function main() {
  const result = evaluateNotarizeKey({
    p8: process.env.APPLE_API_KEY_P8,
    keyId: process.env.APPLE_API_KEY_ID,
    issuer: process.env.APPLE_API_ISSUER,
    teamId: trim(process.env.APPLE_TEAM_ID),
  });
  if (result.status === 'skip') {
    console.log('No APPLE_API_KEY_P8 secret: notarizing with the Apple ID login.');
    return;
  }
  for (const message of result.warnings) console.log(`::warning::${message}`);
  for (const message of result.errors) console.log(`::error::${message}`);
  if (result.status === 'fail') process.exit(1);
  console.log('App Store Connect API key secrets look right.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
