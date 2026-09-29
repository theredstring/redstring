// S-24: the swap-and-relaunch script takes its data as argv (never spliced
// into shell text), only strips quarantine from a bundle that passed the
// signature check, and only installs the expected version.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  buildSwapAndRelaunchScript,
  buildSwapAndRelaunchArgs,
  checkStagedVersion,
  pickPendingZip,
  parseLatestMacYmlSha512
} from '../../../electron/updater-install-helpers.cjs';

const runBash = (args, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const child = spawn('/bin/bash', args, { stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout ' + stderr)); }, timeoutMs);
  child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
});

// A pid that is certainly not alive, so the script's wait loop ends at once.
const deadPid = () => {
  const c = spawn('/bin/sh', ['-c', 'exit 0']);
  return new Promise((r) => c.on('exit', () => r(c.pid)));
};

describe('swap script is data-free (argv only)', () => {
  it('contains no caller-supplied paths', () => {
    const args = buildSwapAndRelaunchArgs({
      stagedBundlePath: '/tmp/staged/Evil$(id).app',
      targetBundlePath: '/Applications/Redstring.app',
      parentPid: 123,
      logPath: '/tmp/log',
      requirement: 'anchor apple generic'
    });
    expect(args[0]).toBe('-c');
    expect(args[2]).toBe('--');
    expect(args.slice(3)).toEqual(['/tmp/staged/Evil$(id).app', '/Applications/Redstring.app', '123', '/tmp/log', 'anchor apple generic']);
    const script = args[1];
    expect(script).not.toContain('/tmp/staged');
    expect(script).not.toContain('/Applications/Redstring.app');
    expect(script).not.toContain('Evil');
    expect(script).toContain('STAGED="$1"');
    expect(script).toContain('TARGET="$2"');
  });

  it('rejects a non-numeric parent pid', () => {
    expect(() => buildSwapAndRelaunchArgs({ stagedBundlePath: '/a.app', targetBundlePath: '/b.app', parentPid: '1; rm -rf /', logPath: '/l' })).toThrow();
  });

  it('strips quarantine only after the signature re-check', () => {
    const script = buildSwapAndRelaunchScript();
    const verifyAt = script.indexOf('/usr/bin/codesign --verify --deep --strict -R "=$REQUIREMENT" "$TARGET"');
    const xattrAt = script.indexOf('xattr -dr com.apple.quarantine "$TARGET"');
    expect(verifyAt).toBeGreaterThan(0);
    expect(xattrAt).toBeGreaterThan(verifyAt);
  });
});

describe.runIf(process.platform !== 'win32')('swap script (executed)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-swap-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('a bundle path containing $(…) stays literal — nothing is executed', async () => {
    const marker = path.join(tmp, 'pwned');
    const stagedDir = path.join(tmp, `staged$(touch ${marker})`);
    const staged = path.join(stagedDir, 'Redstring.app');
    const target = path.join(tmp, 'apps', 'Redstring.app');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'MARKER'), 'NEW');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'MARKER'), 'OLD');
    const opened = path.join(tmp, 'opened');
    const args = buildSwapAndRelaunchArgs({
      stagedBundlePath: staged,
      targetBundlePath: target,
      parentPid: await deadPid(),
      logPath: path.join(tmp, 'log'),
      openCommand: `/bin/sh -c 'printf %s "$1" > ${opened}' --`,
      maxWaitSeconds: 2,
      verify: false
    });
    const { code, stderr } = await runBash(args);
    expect(code, stderr).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.readFileSync(path.join(target, 'MARKER'), 'utf-8')).toBe('NEW');
    expect(fs.readFileSync(opened, 'utf-8')).toBe(target);
  });

  it('with verification on, a bundle failing the signature check is rolled back and not opened', async () => {
    const staged = path.join(tmp, 'staged', 'Redstring.app');
    const target = path.join(tmp, 'apps', 'Redstring.app');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'MARKER'), 'NEW');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'MARKER'), 'OLD');
    const opened = path.join(tmp, 'opened');
    const args = buildSwapAndRelaunchArgs({
      stagedBundlePath: staged,
      targetBundlePath: target,
      parentPid: await deadPid(),
      logPath: path.join(tmp, 'log'),
      requirement: '', // no requirement → must refuse
      openCommand: `/bin/sh -c 'echo x > ${opened}' --`,
      maxWaitSeconds: 2
    });
    const { code } = await runBash(args);
    expect(code).not.toBe(0);
    expect(fs.readFileSync(path.join(target, 'MARKER'), 'utf-8')).toBe('OLD');
    expect(fs.existsSync(opened)).toBe(false);
    expect(fs.readFileSync(path.join(tmp, 'log'), 'utf-8')).toMatch(/failed signature check/);
  });
});

describe('version and file selection', () => {
  it('installs only the pending version, and only forward', () => {
    expect(checkStagedVersion({ stagedVersion: '0.16.0', expectedVersion: '0.16.0', currentVersion: '0.15.3' }).ok).toBe(true);
    expect(checkStagedVersion({ stagedVersion: '0.15.9', expectedVersion: '0.16.0', currentVersion: '0.15.3' }).ok).toBe(false);
    expect(checkStagedVersion({ stagedVersion: '0.15.3', expectedVersion: '0.15.3', currentVersion: '0.15.3' }).ok).toBe(false);
    expect(checkStagedVersion({ stagedVersion: '0.14.0', expectedVersion: '0.14.0', currentVersion: '0.15.3' }).ok).toBe(false);
    expect(checkStagedVersion({ stagedVersion: '0.14.0', expectedVersion: '0.14.0', currentVersion: '0.15.3', allowDowngrade: true }).ok).toBe(true);
    expect(checkStagedVersion({ stagedVersion: '0.16.0', expectedVersion: null, currentVersion: '0.15.3' }).ok).toBe(false);
    expect(checkStagedVersion({ stagedVersion: null, expectedVersion: '0.16.0', currentVersion: '0.15.3' }).ok).toBe(false);
  });

  it('picks the zip named by update-info.json, never by directory order', () => {
    const entries = ['Redstring-mac-arm64-old.zip', 'Redstring-mac-arm64.zip', 'update-info.json'];
    expect(pickPendingZip({ entries, updateInfo: { fileName: 'Redstring-mac-arm64.zip' }, arch: 'arm64' })).toBe('Redstring-mac-arm64.zip');
    expect(pickPendingZip({ entries: ['a-mac-arm64.zip', 'b-mac-arm64.zip'], updateInfo: null, arch: 'arm64' })).toBe(null);
    expect(pickPendingZip({ entries: ['Redstring-mac-x64.zip', 'Redstring-mac-arm64.zip'], updateInfo: null, arch: 'x64' })).toBe('Redstring-mac-x64.zip');
    expect(pickPendingZip({ entries: ['../evil.zip'], updateInfo: { fileName: '../evil.zip' }, arch: 'x64' })).toBe(null);
  });

  it('reads the sha512 for one file from latest-mac.yml', () => {
    const yml = [
      'version: 0.15.2',
      'files:',
      '  - url: Redstring-mac-x64.zip',
      '    sha512: XXX==',
      '    size: 1',
      '  - url: Redstring-mac-arm64.zip',
      '    sha512: YYY==',
      '    size: 2',
      'path: Redstring-mac-x64.zip',
      'sha512: ZZZ==',
      "releaseDate: '2026-09-01T00:00:00.000Z'"
    ].join('\n');
    expect(parseLatestMacYmlSha512(yml, 'Redstring-mac-arm64.zip')).toBe('YYY==');
    expect(parseLatestMacYmlSha512(yml, 'Redstring-mac-x64.zip')).toBe('XXX==');
    expect(parseLatestMacYmlSha512(yml, 'missing.zip')).toBe(null);
  });
});
