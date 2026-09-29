// @vitest-environment node
// GitHub Actions invariants (.github/workflows/*.yml, .github/dependabot.yml).
// The release workflow holds the Apple and Windows signing credentials and a
// write token; anything it runs is part of the app's supply chain.
import { describe, it } from 'vitest';
import yaml from 'js-yaml';
import { allRepoFiles, read, exists, violation, assertRule } from './_lib/scan.js';

const WORKFLOWS = allRepoFiles().filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
const load = (f) => yaml.load(read(f));
const lineOf = (text, needle) => {
  const i = text.indexOf(needle);
  return i === -1 ? 0 : text.slice(0, i).split('\n').length;
};

/** Every `uses:` in a workflow: step-level and job-level (reusable workflows). */
function usesOf(doc) {
  const out = [];
  for (const [jobId, job] of Object.entries(doc?.jobs || {})) {
    if (job?.uses) out.push({ jobId, uses: job.uses });
    for (const step of job?.steps || []) if (step?.uses) out.push({ jobId, uses: step.uses });
  }
  return out;
}

describe('security invariants: GitHub Actions', () => {
  it('there are workflows to check', () => {
    if (WORKFLOWS.length === 0) throw new Error('no .github/workflows/*.yml found — did the directory move?');
  });

  it('every action is pinned to a full commit SHA', () => {
    const found = [];
    for (const f of WORKFLOWS) {
      const text = read(f);
      for (const { uses } of usesOf(load(f))) {
        if (uses.startsWith('./')) continue; // local action in this repo
        if (uses.startsWith('docker://')) {
          if (!/@sha256:[0-9a-f]{64}$/.test(uses)) found.push(violation(f, lineOf(text, uses), `${uses} — pin the image by digest`));
          continue;
        }
        if (!/^[^@\s]+@[0-9a-f]{40}$/.test(uses)) found.push(violation(f, lineOf(text, uses), uses));
      }
    }
    assertRule('workflows/pinned-actions', found);
  });

  it('every workflow declares top-level permissions', () => {
    const found = WORKFLOWS
      .filter((f) => !Object.prototype.hasOwnProperty.call(load(f) || {}, 'permissions'))
      .map((f) => violation(f, 1, 'no top-level permissions: block'));
    assertRule('workflows/permissions', found);
  });

  it('release does not go through samuelmeuli/action-electron-builder', () => {
    const found = [];
    for (const f of WORKFLOWS) {
      const text = read(f);
      for (const { uses } of usesOf(load(f))) {
        if (/^samuelmeuli\/action-electron-builder/i.test(uses)) found.push(violation(f, lineOf(text, uses), uses));
      }
    }
    assertRule('workflows/no-third-party-builder', found);
  });

  it('no untrusted event text in run: scripts, and no pull_request_target', () => {
    // Fields an outside contributor can set: PR/issue titles and bodies,
    // branch names, commit messages, comment bodies, review text, labels.
    const UNTRUSTED = /\$\{\{\s*(github\.event\.(pull_request|issue|comment|review|review_comment|discussion|head_commit|commits|pages|workflow_run)\b[^}]*|github\.head_ref)\s*\}\}/;
    const found = [];
    for (const f of WORKFLOWS) {
      const text = read(f);
      const doc = load(f);
      // js-yaml parses the key `on` as the string "on" (YAML 1.2 core schema).
      const on = doc?.on ?? doc?.true;
      const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on || {});
      if (triggers.includes('pull_request_target')) found.push(violation(f, lineOf(text, 'pull_request_target'), 'pull_request_target runs fork code with secrets'));
      for (const job of Object.values(doc?.jobs || {})) {
        for (const step of job?.steps || []) {
          const script = step?.run;
          if (typeof script === 'string' && UNTRUSTED.test(script)) {
            found.push(violation(f, lineOf(text, script.split('\n')[0]), `${step.name || 'run step'}: ${script.match(UNTRUSTED)[0]}`));
          }
          const withScript = step?.with?.script; // actions/github-script
          if (typeof withScript === 'string' && UNTRUSTED.test(withScript)) {
            found.push(violation(f, 0, `${step.name || 'github-script step'}: ${withScript.match(UNTRUSTED)[0]}`));
          }
        }
      }
    }
    assertRule('workflows/script-injection', found);
  });

  it('Dependabot watches npm and github-actions', () => {
    const f = '.github/dependabot.yml';
    const found = [];
    if (!exists(f)) found.push(violation(f, 0, 'missing'));
    else {
      const ecosystems = new Set((load(f)?.updates || []).map((u) => u['package-ecosystem']));
      for (const eco of ['npm', 'github-actions']) if (!ecosystems.has(eco)) found.push(violation(f, 0, `no updates entry for ${eco}`));
    }
    assertRule('workflows/pinned-actions', found, { skipStaleCheck: true });
  });
});
