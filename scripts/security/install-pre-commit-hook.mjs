#!/usr/bin/env node
// Opt-in: installs a git pre-commit hook that runs the secret scanner on the
// staged changes, so a key never reaches a commit (the repo is public).
//
//   node scripts/security/install-pre-commit-hook.mjs            # install
//   node scripts/security/install-pre-commit-hook.mjs --uninstall
//   node scripts/security/install-pre-commit-hook.mjs --force    # replace a hook someone else wrote
//
// Nothing runs this automatically. Skip the hook for one commit with
// `git commit --no-verify` (then run `npm run security:scan` yourself).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKER = '# redstring-secret-scan-hook';

const HOOK = `#!/bin/sh
${MARKER}
# Installed by scripts/security/install-pre-commit-hook.mjs. Remove with --uninstall.
# Blocks the commit if a staged file contains something that looks like a key.
exec node "$(git rev-parse --show-toplevel)/scripts/security/secret-scan.mjs" --staged
`;

function hookPath() {
  // --git-path respects core.hooksPath and worktrees.
  const rel = execFileSync('git', ['rev-parse', '--git-path', 'hooks/pre-commit'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return path.resolve(ROOT, rel);
}

function main(argv = process.argv.slice(2)) {
  const target = hookPath();
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  const ours = existing !== null && existing.includes(MARKER);

  if (argv.includes('--uninstall')) {
    if (!existing) { console.log('No pre-commit hook installed.'); return 0; }
    if (!ours) { console.error(`${target} was not installed by this script; leaving it alone.`); return 1; }
    fs.unlinkSync(target);
    console.log(`Removed ${target}.`);
    return 0;
  }
  if (existing !== null && !ours && !argv.includes('--force')) {
    console.error(`${target} already exists and was not written by this script.`);
    console.error('Add this line to it instead, or re-run with --force to replace it:');
    console.error('  node scripts/security/secret-scan.mjs --staged || exit 1');
    return 1;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, HOOK, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  console.log(`Installed ${target}: every commit now runs secret-scan --staged.`);
  return 0;
}

process.exit(main());
