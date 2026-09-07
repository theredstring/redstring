#!/usr/bin/env node
/**
 * Patch electron-builder's macOS signing keychain setup, in place, before a build.
 *
 * THE BUG (app-builder-lib <= 26.16.0, fixed upstream only in 27.0.0-alpha):
 * `createKeychain` makes a temp keychain with a random password, then imports the
 * .p12 into it. `security set-key-partition-list -k` wants the KEYCHAIN's password;
 * electron-builder passes the CERTIFICATE's password instead — the one it just
 * handed to `security import -P`. Two different secrets, and the wrong one is sent.
 *
 * It went unnoticed for years because the keychain is already unlocked by then, so
 * `security` accepted the bad password without complaint. Runner image 20260828.587
 * (macOS 26.6 / Darwin 25.6) stopped accepting it:
 *
 *   security: SecKeychainUnlock: The user name or passphrase you entered is not correct.
 *   ⨯ Exit code: 1. Command failed: /usr/bin/security set-key-partition-list ...
 *
 * which is what killed the v0.13.0 release. v0.12.2 built on the same macos-26-arm64
 * label five days earlier under image 20260707.563 (macOS 26.5) and never printed it.
 *
 * So: pass the keychain password, exactly as upstream's v27 does. Remove this script
 * and its release.yml step once electron-builder 27 is stable and adopted.
 *
 * Deliberately loud. A silent no-op here means an unsigned or unbuilt release, so
 * anything unexpected — a moved file, an unrecognized shape — exits non-zero and
 * fails the job rather than letting the build reach the same error later.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const fail = (message) => {
  console.error(`[patch-keychain] ${message}`);
  process.exit(1);
};

let pkgPath;
let targetPath;
try {
  pkgPath = require.resolve('app-builder-lib/package.json');
  targetPath = pkgPath.replace(/package\.json$/, 'out/codeSign/macCodeSign.js');
} catch {
  fail('app-builder-lib is not installed. Run this after `npm ci`.');
}

const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const major = Number.parseInt(version, 10);

if (Number.isFinite(major) && major >= 27) {
  console.log(`[patch-keychain] app-builder-lib ${version} carries the fix upstream — nothing to do.`);
  console.log('[patch-keychain] This script and its release.yml step can now be deleted.');
  process.exit(0);
}

let source;
try {
  source = readFileSync(targetPath, 'utf8');
} catch {
  fail(`Cannot read ${targetPath}. The file moved — re-derive the patch against app-builder-lib ${version}.`);
}

// The three edits, as [description, find, replace]. Every one must apply.
const edits = [
  [
    'importCerts takes the keychain password',
    'async function importCerts(keychainFile, paths, keyPasswords) {',
    'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {',
  ],
  [
    'createKeychain passes it down',
    'return await importCerts(keychainFile, certPaths, cscPasswords);',
    'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);',
  ],
  [
    'set-key-partition-list uses it instead of the certificate password',
    '"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile',
    '"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile',
  ],
];

if (edits.every(([, , replacement]) => source.includes(replacement))) {
  console.log(`[patch-keychain] app-builder-lib ${version} already patched.`);
  process.exit(0);
}

let patched = source;
for (const [description, find, replacement] of edits) {
  if (patched.includes(replacement)) continue;
  if (!patched.includes(find)) {
    fail(
      `Could not apply "${description}" — app-builder-lib ${version} does not contain the expected code.\n` +
        `             Check whether the keychain-password bug is still present in macCodeSign.js and update this patch.`
    );
  }
  patched = patched.replace(find, replacement);
}

writeFileSync(targetPath, patched);
console.log(`[patch-keychain] Patched app-builder-lib ${version}: set-key-partition-list now gets the keychain password.`);
