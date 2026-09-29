/**
 * S-70, S-79, S-80, S-83, S-84: static assertions on the native projects.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

describe('Android manifest and resources', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('disables backup and points at exclusion rules (S-70)', () => {
    expect(manifest).toMatch(/android:allowBackup="false"/);
    expect(manifest).not.toMatch(/android:allowBackup="true"/);
    expect(manifest).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
    expect(manifest).toMatch(/android:fullBackupContent="@xml\/backup_rules"/);
  });

  it('excludes the WebView store and secure prefs from device transfer and backup', () => {
    const rules = read('android/app/src/main/res/xml/data_extraction_rules.xml');
    const deviceTransfer = rules.split('<device-transfer>')[1];
    expect(deviceTransfer).toMatch(/domain="root" path="app_webview\/"/);
    expect(deviceTransfer).toMatch(/domain="sharedpref"/);
    const cloud = rules.split('<cloud-backup>')[1].split('</cloud-backup>')[0];
    for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
      expect(cloud).toContain(`domain="${domain}"`);
    }
    const legacy = read('android/app/src/main/res/xml/backup_rules.xml');
    expect(legacy).toMatch(/app_webview\//);
    expect(legacy).toMatch(/domain="sharedpref"/);
  });

  it('allows no cleartext traffic', () => {
    expect(manifest).not.toMatch(/usesCleartextTraffic="true"/);
    expect(existsSync(resolve(root, 'android/app/src/main/res/xml/network_security_config.xml'))).toBe(false);
  });

  it('FileProvider exposes only the camera-capture folder and cache (S-84)', () => {
    const paths = read('android/app/src/main/res/xml/file_paths.xml');
    expect(paths).not.toMatch(/<external-path/);
    expect(paths).not.toMatch(/<root-path/);
    expect(paths).toMatch(/<external-files-path name="my_images" path="Pictures\/" \/>/);
  });

  it('targets and compiles against API 36 (S-80)', () => {
    const vars = read('android/variables.gradle');
    expect(vars).toMatch(/compileSdkVersion = 36/);
    expect(vars).toMatch(/targetSdkVersion = 36/);
  });

  it('includes the secure-storage plugin', () => {
    expect(read('android/capacitor.settings.gradle')).toContain("':aparajita-capacitor-secure-storage'");
  });
});

describe('iOS project (S-79)', () => {
  const plist = read('ios/App/App/Info.plist');

  it('declares no non-exempt encryption and arm64', () => {
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>/);
    expect(plist).not.toMatch(/armv7/);
  });

  it('allows no arbitrary loads', () => {
    expect(plist).not.toMatch(/NSAllowsArbitraryLoads/);
  });

  it('ships a privacy manifest with no tracking and required-reason APIs declared', () => {
    const privacy = read('ios/App/App/PrivacyInfo.xcprivacy');
    expect(privacy).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(privacy).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
    expect(privacy).toMatch(/NSPrivacyAccessedAPICategoryFileTimestamp[\s\S]*C617\.1/);
    expect(privacy).toMatch(/NSPrivacyAccessedAPICategoryUserDefaults[\s\S]*CA92\.1/);
  });

  it('adds PrivacyInfo.xcprivacy to the App target resources', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    const ref = pbx.match(/([0-9A-F]{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;/);
    expect(ref).not.toBeNull();
    const build = pbx.match(/([0-9A-F]{24}) \/\* PrivacyInfo\.xcprivacy in Resources \*\/ = \{isa = PBXBuildFile; fileRef = ([0-9A-F]{24})/);
    expect(build?.[2]).toBe(ref[1]);
    const resources = pbx.split('/* Begin PBXResourcesBuildPhase section */')[1].split('/* End PBXResourcesBuildPhase section */')[0];
    expect(resources).toContain(`${build[1]} /* PrivacyInfo.xcprivacy in Resources */`);
    // IDs are unique.
    expect(pbx.split(`${ref[1]} `).length - 1).toBeGreaterThanOrEqual(2);
    expect(pbx.match(new RegExp(`${ref[1]} /\\* PrivacyInfo\\.xcprivacy \\*/ = `, 'g'))).toHaveLength(1);
  });

  it('copies security-scoped documents before handing them to Capacitor (S-82)', () => {
    const delegate = read('ios/App/App/AppDelegate.swift');
    expect(delegate).toMatch(/startAccessingSecurityScopedResource/);
    expect(delegate).toMatch(/ApplicationDelegateProxy\.shared\.application\(app, open: forwarded/);
  });

  it('includes the secure-storage pod', () => {
    expect(read('ios/App/Podfile')).toContain("pod 'AparajitaCapacitorSecureStorage'");
  });
});

describe('HEIC stub for store builds (S-83)', () => {
  it('exports the heic-to API and fails clearly', async () => {
    const stub = await import('../../../src/utils/heicUnsupportedStub.js');
    await expect(stub.heicTo({ blob: new Blob([]), type: 'image/jpeg' })).rejects.toMatchObject({ code: 'HEIC_UNSUPPORTED' });
    expect(await stub.isHeic({ type: 'image/heic', name: 'x.HEIC' })).toBe(true);
    expect(await stub.isHeic({ type: 'image/png', name: 'x.png' })).toBe(false);
  });
});
