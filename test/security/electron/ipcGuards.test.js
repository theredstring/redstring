// C-3 guards: store names, path approvals, external URLs, trusted senders.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isValidStoreName,
  resolveStorePath,
  createPathApprovals,
  isSafeExternalUrl,
  isAppUrl,
  isTrustedSender
} from '../../../electron/ipcGuards.cjs';

describe('isValidStoreName / resolveStorePath (S-21)', () => {
  it('accepts the store names the app uses', () => {
    for (const name of ['fileHandles', 'settings', 'workspace', 'universes', 'a-b_c9']) {
      expect(isValidStoreName(name)).toBe(true);
    }
  });

  it('rejects traversal, separators, empty and non-strings', () => {
    for (const name of ['../x', '..', 'a/b', 'a\\b', '', ' ', 'a.b', '%2e%2e', 'x'.repeat(65), null, undefined, 42, {}, ['a']]) {
      expect(isValidStoreName(name)).toBe(false);
    }
  });

  it('resolves inside the data dir and throws for anything else', () => {
    const dir = '/tmp/rs-data';
    expect(resolveStorePath(dir, 'settings')).toBe(path.join(dir, 'settings.json'));
    expect(() => resolveStorePath(dir, '../../../../etc/passwd')).toThrow();
    expect(() => resolveStorePath(dir, '/etc/passwd')).toThrow();
  });
});

describe('createPathApprovals (S-20)', () => {
  let tmp;
  let persistPath;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-approvals-'));
    persistPath = path.join(tmp, 'main', 'approved-paths.json');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('approves only through approve(), exact file paths', () => {
    const a = createPathApprovals({ persistPath });
    expect(a.isApproved('/Users/x/u.redstring')).toBe(false);
    expect(a.approve('/Users/x/u.redstring')).toBe(true);
    expect(a.isApproved('/Users/x/u.redstring')).toBe(true);
    expect(a.isApproved('/Users/x/other.redstring')).toBe(false);
    expect(a.isApproved('/Users/x')).toBe(false);
  });

  it('never approves relative paths (the "1.redstring" bug)', () => {
    const a = createPathApprovals({ persistPath });
    expect(a.approve('1.redstring')).toBe(false);
    expect(a.approve('./x/../y')).toBe(false);
    expect(a.isApproved('1.redstring')).toBe(false);
  });

  it('folder approvals cover the subtree and nothing beside it', () => {
    const a = createPathApprovals({ persistPath });
    a.approve('/Users/x/Workspace', { kind: 'folder' });
    expect(a.isApproved('/Users/x/Workspace/new.redstring')).toBe(true);
    expect(a.isApproved('/Users/x/Workspace/sub/deep.redstring')).toBe(true);
    expect(a.isApproved('/Users/x/Workspace2/evil.redstring')).toBe(false);
    expect(a.isApproved('/Users/x/Workspace/../secret')).toBe(false);
  });

  it('refuses the filesystem root as a folder approval', () => {
    const a = createPathApprovals({ persistPath });
    expect(a.approve('/', { kind: 'folder' })).toBe(false);
    expect(a.isApproved('/etc/passwd')).toBe(false);
  });

  it('persists and reloads approvals', () => {
    const a = createPathApprovals({ persistPath });
    a.approve('/Users/x/u.redstring');
    a.approve('/Users/x/W', { kind: 'folder' });
    a.save();
    const b = createPathApprovals({ persistPath });
    expect(b.isApproved('/Users/x/u.redstring')).toBe(false);
    b.load();
    expect(b.isApproved('/Users/x/u.redstring')).toBe(true);
    expect(b.isApproved('/Users/x/W/a.redstring')).toBe(true);
  });

  it('ignores junk and relative entries in the persisted file', () => {
    fs.mkdirSync(path.dirname(persistPath), { recursive: true });
    fs.writeFileSync(persistPath, JSON.stringify({ files: ['rel.redstring', 42, '/ok.redstring'], folders: ['/'] }));
    const a = createPathApprovals({ persistPath });
    expect(a.load().loaded).toBe(1);
    expect(a.isApproved('/ok.redstring')).toBe(true);
    expect(a.isApproved('/etc/hosts')).toBe(false);
  });
});

describe('isSafeExternalUrl (S-22)', () => {
  it('allows https, http and mailto', () => {
    expect(isSafeExternalUrl('https://github.com/login/device')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/a?b=c')).toBe(true);
    expect(isSafeExternalUrl('mailto:someone@example.com')).toBe(true);
  });

  it('rejects everything that can launch local programs or run script', () => {
    for (const url of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)',
      '\u0001javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd',
      'smb://evil/share', 'vscode://file/x', 'redstring://auth?code=1', 'ms-msdt:/id', 'x-apple.systempreferences:',
      'https://user:pass@example.com', 'https://', 'not a url', '', null, undefined, 42
    ]) {
      expect(isSafeExternalUrl(url), String(url)).toBe(false);
    }
  });
});

describe('isAppUrl / isTrustedSender (S-23)', () => {
  const dev = { devOrigins: ['http://localhost:4001'] };
  const ev = (url, parent = null) => ({ senderFrame: url === undefined ? null : { url, parent } });

  it('recognises app://redstring only', () => {
    expect(isAppUrl('app://redstring/index.html')).toBe(true);
    expect(isAppUrl('app://redstring/')).toBe(true);
    expect(isAppUrl('app://evil/index.html')).toBe(false);
    expect(isAppUrl('file:///Applications/Redstring.app/Contents/Resources/app.asar/dist/index.html')).toBe(false);
    expect(isAppUrl('https://redstring.io/')).toBe(false);
    expect(isAppUrl('http://localhost:4001/')).toBe(false);
  });

  it('allows the dev server only when main passes it', () => {
    expect(isAppUrl('http://localhost:4001/?test=true', dev)).toBe(true);
    expect(isAppUrl('http://localhost:4002/', dev)).toBe(false);
  });

  it('trusts only the top frame of an app page', () => {
    expect(isTrustedSender(ev('app://redstring/index.html'))).toBe(true);
    expect(isTrustedSender(ev('app://redstring/index.html', { url: 'app://redstring/' }))).toBe(false);
    expect(isTrustedSender(ev('https://evil.example/'))).toBe(false);
    expect(isTrustedSender(ev('file:///tmp/x.html'))).toBe(false);
    expect(isTrustedSender(ev(undefined))).toBe(false);
    expect(isTrustedSender({})).toBe(false);
    expect(isTrustedSender(ev('http://localhost:4001/'))).toBe(false);
    expect(isTrustedSender(ev('http://localhost:4001/'), dev)).toBe(true);
  });
});
