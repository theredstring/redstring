// The iOS and Android version fields, from package.json's version.
//
// Both stores refuse an upload whose build number isn't higher than the last
// one, so the build number comes from the version itself rather than a counter
// someone has to remember:
//
//   major * 10,000,000 + minor * 100,000 + patch * 100 + pre
//
// where `pre` is N for a "-rc.N" (or any "-tag.N") prerelease and 99 for the
// release, so 1.0.0-rc.1 (10000001) < 1.0.0-rc.2 (10000002) < 1.0.0 (10000099).
// Minor and patch can each go to 999, a prerelease number to 98. Android's
// versionCode tops out at 2,100,000,000, which is major 209.
//
// The display version (Android versionName, iOS MARKETING_VERSION) is
// major.minor.patch: Apple allows only three integers there, and the
// prerelease shows in the build number instead.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.(\d+))?)?$/;

export function mobileVersion(version) {
  const m = SEMVER.exec(String(version).replace(/^v/, ''));
  if (!m) throw new Error(`Cannot derive a mobile version from "${version}"`);
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  const isPre = /-/.test(version);
  const pre = isPre ? Number(m[4] ?? 0) : 99;
  if (minor > 999 || patch > 999) throw new Error(`"${version}": minor and patch must be 999 or less`);
  if (isPre && pre > 98) throw new Error(`"${version}": a prerelease number must be 98 or less`);
  const code = major * 10_000_000 + minor * 100_000 + patch * 100 + pre;
  if (code > 2_100_000_000) throw new Error(`"${version}": build number ${code} is past Android's limit`);
  return { name: `${major}.${minor}.${patch}`, code };
}

/** android/app/build.gradle with this version's versionCode and versionName. */
export function setGradleVersion(gradle, { name, code }) {
  if (!/versionCode \d+/.test(gradle) || !/versionName "[^"]*"/.test(gradle)) {
    throw new Error('build.gradle has no versionCode/versionName to update');
  }
  return gradle
    .replace(/versionCode \d+/, `versionCode ${code}`)
    .replace(/versionName "[^"]*"/, `versionName "${name}"`);
}

/** The Xcode project with this version in every build configuration. */
export function setXcodeVersion(pbxproj, { name, code }) {
  if (!/MARKETING_VERSION = [^;]+;/.test(pbxproj) || !/CURRENT_PROJECT_VERSION = [^;]+;/.test(pbxproj)) {
    throw new Error('project.pbxproj has no MARKETING_VERSION/CURRENT_PROJECT_VERSION to update');
  }
  return pbxproj
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${name};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${code};`);
}
