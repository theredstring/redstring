// @vitest-environment node
// Every upload path has its own ignore file: git push (.gitignore), docker
// build (.dockerignore), gcloud deploy (.gcloudignore). Each must exclude the
// local secret files on its own; one gap is enough to publish a key.
import { describe, it } from 'vitest';
import ignore from 'ignore';
import { read, exists, violation, assertRule, trackedFiles } from './_lib/scan.js';

// Root-level sample paths (Docker patterns are anchored at the build-context
// root, so root-level samples are the case all three formats must handle).
const SECRET_SAMPLES = [
  'WIZARD_KEY.txt',
  'github.env', 'github.env.local', 'github.env.production',
  '.env', '.env.local', '.env.production', '.env.github-app',
  'prodredkey.pem', 'app.private-key.pem',
  'data/queues/goals.jsonl',
  'backup.redstring',
  '.dev.vars',
];

const IGNORE_FILES = ['.gitignore', '.dockerignore', '.gcloudignore'];

describe('security invariants: ignore files and tracked secrets', () => {
  it('.gitignore, .dockerignore and .gcloudignore exclude the local secret files', () => {
    const found = [];
    for (const f of IGNORE_FILES) {
      if (!exists(f)) { found.push(violation(f, 0, 'missing')); continue; }
      const ig = ignore().add(read(f));
      const missed = SECRET_SAMPLES.filter((s) => !ig.ignores(s));
      if (missed.length) found.push(violation(f, 0, `does not exclude: ${missed.join(', ')}`));
    }
    assertRule('repo/ignore-files', found);
  });

  it('no secret or private-data file is tracked', () => {
    const BANNED = [
      [/(^|\/)WIZARD_KEY\.txt$/, 'wizard API key'],
      [/(^|\/)github\.env(\..*)?$/, 'GitHub App credentials'],
      [/(^|\/)\.env(?!\.example$)(\..*)?$/, 'environment secrets'],
      [/(^|\/)\.dev\.vars$/, 'Wrangler local secrets'],
      [/\.(pem|p12|pfx|key)$/i, 'private key / certificate'],
      [/^data\/queues\//, 'queue journals (have held API keys)'],
      [/^data\/analytics\//, 'user analytics (GitHub logins)'],
      [/(^|\/)backup\.redstring$/, 'personal universe backup'],
    ];
    const found = [];
    for (const f of trackedFiles()) {
      const hit = BANNED.find(([re]) => re.test(f));
      if (hit) found.push(violation(f, 0, hit[1]));
    }
    assertRule('repo/tracked-secrets', found);
  });
});
