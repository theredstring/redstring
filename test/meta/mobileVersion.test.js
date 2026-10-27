import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mobileVersion, setGradleVersion, setXcodeVersion } from '../../scripts/mobile-version.js';

const ROOT = path.resolve(__dirname, '../..');

describe('mobile version (scripts/mobile-version.js)', () => {
  it('numbers builds so every later version is higher', () => {
    const order = ['0.15.9', '0.15.10', '0.16.0', '1.0.0-rc.1', '1.0.0-rc.2', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    const codes = order.map((v) => mobileVersion(v).code);
    for (let i = 1; i < codes.length; i++) expect(codes[i], order[i]).toBeGreaterThan(codes[i - 1]);
    expect(mobileVersion('1.0.0')).toEqual({ name: '1.0.0', code: 10_000_099 });
    expect(mobileVersion('1.0.0-rc.3')).toEqual({ name: '1.0.0', code: 10_000_003 });
  });

  it('refuses versions it cannot number', () => {
    expect(() => mobileVersion('1.0')).toThrow();
    expect(() => mobileVersion('1.1000.0')).toThrow();
    expect(() => mobileVersion('1.0.0-rc.99')).toThrow();
  });

  it('writes the real build.gradle and Xcode project', () => {
    const v = mobileVersion('1.2.3');
    const gradle = setGradleVersion(fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8'), v);
    expect(gradle).toContain('versionCode 10200399');
    expect(gradle).toContain('versionName "1.2.3"');
    const pbx = setXcodeVersion(fs.readFileSync(path.join(ROOT, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8'), v);
    expect(pbx.match(/MARKETING_VERSION = 1\.2\.3;/g)).toHaveLength(2);
    expect(pbx.match(/CURRENT_PROJECT_VERSION = 10200399;/g)).toHaveLength(2);
    expect(pbx).not.toMatch(/MARKETING_VERSION = (?!1\.2\.3;)/);
  });

  it('keeps the checked-in store versions in step with package.json', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const v = mobileVersion(version);
    const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
    expect(gradle).toContain(`versionCode ${v.code}`);
    expect(gradle).toContain(`versionName "${v.name}"`);
  });
});
