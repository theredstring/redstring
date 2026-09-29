// @vitest-environment node
/**
 * S-55: ~/.redstring/config.json (can hold a GitHub token) is 0600 in a 0700
 * dir, older loose files are tightened; workspace.json can't point a
 * universe's file outside the workspace; `redstring auth github` reads the
 * token from stdin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, ROOT } from './helpers.js';

const base = tmpDir('rs-sec-config-');
const home = path.join(base, 'home');
let config;

beforeAll(async () => {
  vi.stubEnv('REDSTRING_HOME', home);
  vi.resetModules();
  config = await import('../../../src/headless/config.js');
});

afterAll(() => {
  vi.unstubAllEnvs();
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('headless config permissions', () => {
  it('writes config.json 0600 inside a 0700 directory', () => {
    expect(config.CONFIG_PATH).toBe(path.join(home, 'config.json'));
    config.rememberGithubToken('ghp_testtoken');
    expect(fs.statSync(config.CONFIG_PATH).mode & 0o777).toBe(0o600);
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
    expect(config.readConfig().githubToken).toBe('ghp_testtoken');
  });

  it('tightens an existing world-readable config on read', () => {
    fs.chmodSync(config.CONFIG_PATH, 0o644);
    config.readConfig();
    expect(fs.statSync(config.CONFIG_PATH).mode & 0o777).toBe(0o600);
  });
});

describe('HeadlessWorkspace manifest paths', () => {
  let HeadlessWorkspace;
  const ws = path.join(base, 'workspace');

  beforeAll(async () => {
    fs.mkdirSync(ws, { recursive: true });
    ({ HeadlessWorkspace } = await import('../../../src/headless/HeadlessWorkspace.js'));
  });

  const withEntry = (p) => {
    const w = new HeadlessWorkspace({ dir: ws, useGraphStore: {}, log: () => {} });
    w.manifest.universes.u = { slug: 'u', name: 'u', localFile: { path: p } };
    return w;
  };

  it('keeps a plain file name inside the workspace', () => {
    expect(withEntry('Physics.redstring')._filePath('u')).toBe(path.join(ws, 'Physics.redstring'));
  });

  it('never resolves outside the workspace (traversal, absolute, backslashes)', () => {
    for (const p of ['../outside.redstring', '../../../../tmp/evil.redstring', '/etc/evil.redstring', '..\\..\\evil.redstring', 'sub/../../evil.redstring']) {
      const full = withEntry(p)._filePath('u');
      expect(path.dirname(full), p).toBe(path.resolve(ws));
    }
  });

  it('refuses non-.redstring targets and degenerate names', () => {
    for (const p of ['notes.txt', '../../.ssh/id_rsa', '..', '.', '', null]) {
      expect(() => withEntry(p)._filePath('u'), String(p)).toThrow();
    }
  });
});

describe('redstring auth github', () => {
  const cliHome = path.join(base, 'cli-home');
  const env = { ...process.env, REDSTRING_HOME: cliHome };
  delete env.REDSTRING_AGENT_TOKEN;

  it('reads the token from stdin when not given as an argument', () => {
    const r = spawnSync(process.execPath, ['cli/redstring.js', 'auth', 'github', '--json'], { cwd: ROOT, env, input: 'ghp_fromstdin\n', encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const saved = JSON.parse(fs.readFileSync(path.join(cliHome, 'config.json'), 'utf8'));
    expect(saved.githubToken).toBe('ghp_fromstdin');
    expect(fs.statSync(path.join(cliHome, 'config.json')).mode & 0o777).toBe(0o600);
  });

  it('still accepts the argument form, with a warning', () => {
    const r = spawnSync(process.execPath, ['cli/redstring.js', 'auth', 'github', 'ghp_fromarg', '--json'], { cwd: ROOT, env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/shell history/);
  });
});
