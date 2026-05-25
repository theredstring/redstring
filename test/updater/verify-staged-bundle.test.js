import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { verifyStagedBundle } from '../../electron/updater-bundle-verify.cjs';

describe('verifyStagedBundle', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-staged-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeBundle(name, { contents = true, infoPlist = 'valid', macOsExecutable = 'redstring' } = {}) {
    const bundlePath = path.join(tmpDir, name);
    if (!contents) {
      fs.mkdirSync(bundlePath, { recursive: true });
      return bundlePath;
    }
    const contentsDir = path.join(bundlePath, 'Contents');
    fs.mkdirSync(contentsDir, { recursive: true });
    if (infoPlist === 'valid') {
      const plistXml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
        '<plist version="1.0"><dict>\n' +
        '  <key>CFBundleShortVersionString</key><string>0.6.9</string>\n' +
        '</dict></plist>\n';
      fs.writeFileSync(path.join(contentsDir, 'Info.plist'), plistXml);
    } else if (infoPlist === 'empty') {
      fs.writeFileSync(path.join(contentsDir, 'Info.plist'), '');
    } else if (infoPlist === 'truncated') {
      fs.writeFileSync(path.join(contentsDir, 'Info.plist'), '<?xml version="1.0"?><pli');
    } else if (infoPlist === 'no-version') {
      fs.writeFileSync(path.join(contentsDir, 'Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict></dict></plist>\n');
    }
    if (macOsExecutable && macOsExecutable !== 'none') {
      const macOsDir = path.join(contentsDir, 'MacOS');
      fs.mkdirSync(macOsDir, { recursive: true });
      if (macOsExecutable === 'empty') {
        fs.writeFileSync(path.join(macOsDir, 'redstring'), '');
      } else {
        fs.writeFileSync(path.join(macOsDir, macOsExecutable), 'fake-binary-content');
      }
    }
    return bundlePath;
  }

  it('returns valid for a complete bundle', () => {
    const bundlePath = makeBundle('Redstring.app');
    const result = verifyStagedBundle(bundlePath);
    expect(result.valid).toBe(true);
    expect(result.version).toBe('0.6.9');
  });

  it('rejects missing path', () => {
    expect(verifyStagedBundle(null).valid).toBe(false);
    expect(verifyStagedBundle('').valid).toBe(false);
  });

  it('rejects nonexistent bundle dir', () => {
    const result = verifyStagedBundle(path.join(tmpDir, 'Nope.app'));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing/);
  });

  it('rejects bundle with no Contents/ subdir', () => {
    const bundlePath = makeBundle('Empty.app', { contents: false });
    const result = verifyStagedBundle(bundlePath);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Contents\//);
  });

  it('rejects empty Info.plist (mid-write truncation)', () => {
    const bundlePath = makeBundle('Empty.app', { infoPlist: 'empty' });
    const result = verifyStagedBundle(bundlePath);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Info\.plist empty/);
  });

  it('rejects truncated Info.plist', () => {
    const bundlePath = makeBundle('Trunc.app', { infoPlist: 'truncated' });
    const result = verifyStagedBundle(bundlePath);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unparseable/);
  });

  it('rejects Info.plist without CFBundleShortVersionString', () => {
    const bundlePath = makeBundle('NoVer.app', { infoPlist: 'no-version' });
    const result = verifyStagedBundle(bundlePath);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/CFBundleShortVersionString/);
  });

  it('rejects missing Contents/MacOS/ directory', () => {
    const bundlePath = makeBundle('NoMac.app', { macOsExecutable: 'none' });
    const result = verifyStagedBundle(bundlePath);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/MacOS\//);
  });

  it('rejects empty Contents/MacOS/ executable (mid-extract truncation)', () => {
    const bundlePath = makeBundle('Empty.app', { macOsExecutable: 'empty' });
    const result = verifyStagedBundle(bundlePath);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/executable/);
  });
});
