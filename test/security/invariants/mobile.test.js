// @vitest-environment node
// Capacitor / native shell invariants (android/, ios/, capacitor.config.ts).
import { describe, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, read, exists, violation, assertRule, allRepoFiles } from './_lib/scan.js';

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const PLIST = 'ios/App/App/Info.plist';
const PRIVACY = 'ios/App/App/PrivacyInfo.xcprivacy';
const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';

const lineAt = (text, idx) => text.slice(0, idx).split('\n').length;

describe('security invariants: mobile', () => {
  it('Android: allowBackup is false and cleartext traffic is off', () => {
    const found = [];
    const text = read(MANIFEST);
    const app = text.match(/<application\b[^>]*>/);
    if (!app) found.push(violation(MANIFEST, 0, 'no <application> element'));
    else {
      const backup = app[0].match(/android:allowBackup\s*=\s*"([^"]*)"/);
      // Absent means the platform default, which is true.
      if (!backup || backup[1] !== 'false') found.push(violation(MANIFEST, lineAt(text, app.index), `android:allowBackup is ${backup ? `"${backup[1]}"` : 'unset (defaults to true)'}`));
      if (/android:usesCleartextTraffic\s*=\s*"true"/.test(app[0])) found.push(violation(MANIFEST, lineAt(text, app.index), 'android:usesCleartextTraffic="true"'));
      // Android 12+ ignores allowBackup for device-to-device transfer; the
      // extraction rules (and fullBackupContent for Android <= 11) must exclude app data too.
      for (const attr of ['dataExtractionRules', 'fullBackupContent']) {
        const m = app[0].match(new RegExp(`android:${attr}\\s*=\\s*"@xml/([^"]+)"`));
        if (!m) found.push(violation(MANIFEST, lineAt(text, app.index), `no android:${attr}="@xml/..." (backup/transfer exclusion rules)`));
        else if (!exists(`android/app/src/main/res/xml/${m[1]}.xml`)) found.push(violation(MANIFEST, lineAt(text, app.index), `android:${attr} points at missing res/xml/${m[1]}.xml`));
      }
    }
    // Any network security config that re-enables cleartext.
    for (const f of allRepoFiles().filter((p) => /^android\/.*\/res\/xml\/.*\.xml$/.test(p))) {
      const x = read(f);
      const i = x.search(/cleartextTrafficPermitted\s*=\s*"true"/);
      if (i !== -1) found.push(violation(f, lineAt(x, i), 'cleartextTrafficPermitted="true"'));
    }
    assertRule('mobile/android-manifest', found);
  });

  it('iOS: no NSAllowsArbitraryLoads; PrivacyInfo.xcprivacy exists and is in the Xcode project', () => {
    const found = [];
    const plist = read(PLIST);
    const ats = plist.search(/<key>\s*NSAllowsArbitraryLoads(InWebContent|ForMedia)?\s*<\/key>\s*<true\s*\/>/);
    if (ats !== -1) found.push(violation(PLIST, lineAt(plist, ats), 'NSAllowsArbitraryLoads is true'));
    if (!exists(PRIVACY)) found.push(violation(PRIVACY, 0, 'missing'));
    else {
      const pbx = read(PBXPROJ);
      // Must be both a file reference and in a resources build phase to ship.
      const refs = (pbx.match(/PrivacyInfo\.xcprivacy/g) || []).length;
      if (!/PrivacyInfo\.xcprivacy in Resources/.test(pbx) || refs < 3) {
        found.push(violation(PBXPROJ, 0, 'PrivacyInfo.xcprivacy is not added to the App target’s Copy Bundle Resources phase'));
      }
      const privacy = read(PRIVACY);
      if (!/<key>\s*NSPrivacyTracking\s*<\/key>\s*<false\s*\/>/.test(privacy)) found.push(violation(PRIVACY, 0, 'NSPrivacyTracking is not declared false'));
      if (!/NSPrivacyAccessedAPITypes/.test(privacy)) found.push(violation(PRIVACY, 0, 'no NSPrivacyAccessedAPITypes (required-reason APIs) declared'));
    }
    assertRule('mobile/ios-plist', found);
  });

  it('capacitor.config.ts does not enable cleartext or mixed content', () => {
    const file = 'capacitor.config.ts';
    const text = read(file);
    const found = [];
    for (const [re, label] of [
      [/\bcleartext\s*:\s*true/, 'server.cleartext: true'],
      [/\ballowMixedContent\s*:\s*true/, 'android.allowMixedContent: true'],
      [/\bwebContentsDebuggingEnabled\s*:\s*true/, 'webContentsDebuggingEnabled: true (release builds must not be inspectable)'],
      [/\bserver\s*:\s*\{[^}]*\burl\s*:/s, 'server.url set (the app would load remote content instead of its bundle)'],
    ]) {
      const i = text.search(re);
      if (i !== -1) found.push(violation(file, lineAt(text, i), label));
    }
    assertRule('mobile/capacitor-config', found);
  });

  it('the Capacitor (store) build aliases heic-to to the stub', async () => {
    const found = [];
    const mod = await import(pathToFileURL(path.join(ROOT, 'vite.config.js')).href);
    const cfg = typeof mod.default === 'function' ? await mod.default({ mode: 'capacitor', command: 'build' }) : mod.default;
    const alias = cfg.resolve?.alias;
    const entries = Array.isArray(alias) ? alias : Object.entries(alias || {}).map(([find, replacement]) => ({ find, replacement }));
    const hit = entries.find((a) => (a.find instanceof RegExp ? a.find.test('heic-to') : a.find === 'heic-to'));
    if (!hit) found.push(violation('vite.config.js', 0, "mode 'capacitor' has no resolve.alias for heic-to (LGPL libheif would ship in the store build)"));
    else if (!/heicUnsupportedStub/.test(String(hit.replacement))) found.push(violation('vite.config.js', 0, `heic-to is aliased to ${hit.replacement}, not the stub`));
    else if (!exists('src/utils/heicUnsupportedStub.js')) found.push(violation('src/utils/heicUnsupportedStub.js', 0, 'missing'));
    assertRule('mobile/no-lgpl-in-store-builds', found);
  });
});
