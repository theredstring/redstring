import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  pickPreviousRelease,
  pickAssetForArch,
  buildSwapAndRelaunchScript,
  deriveTargetBundlePath
} from '../../electron/updater-install-helpers.cjs';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('0.6.13', '0.6.13')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('handles v-prefixed tags', () => {
    expect(compareVersions('v0.6.13', '0.6.13')).toBe(0);
    expect(compareVersions('v0.6.12', 'v0.6.13')).toBe(-1);
  });

  it('compares major/minor/patch correctly', () => {
    expect(compareVersions('0.6.12', '0.6.13')).toBe(-1);
    expect(compareVersions('0.6.13', '0.6.12')).toBe(1);
    expect(compareVersions('0.5.99', '0.6.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
  });

  it('pads short versions with zeros', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.1')).toBe(-1);
  });

  it('treats non-numeric components as 0', () => {
    expect(compareVersions('1.0.beta', '1.0.0')).toBe(0);
  });
});

describe('pickPreviousRelease', () => {
  const mk = (tag, opts = {}) => ({
    tag_name: tag,
    draft: opts.draft || false,
    prerelease: opts.prerelease || false,
    assets: opts.assets || []
  });

  it('returns null for non-arrays', () => {
    expect(pickPreviousRelease(null, '0.6.13')).toBe(null);
    expect(pickPreviousRelease(undefined, '0.6.13')).toBe(null);
    expect(pickPreviousRelease({}, '0.6.13')).toBe(null);
  });

  it('returns null when no releases are older', () => {
    const releases = [mk('v0.6.13'), mk('v0.6.14')];
    expect(pickPreviousRelease(releases, '0.6.13')).toBe(null);
  });

  it('returns immediate predecessor of currentVersion', () => {
    const releases = [
      mk('v0.6.14'),
      mk('v0.6.13'),
      mk('v0.6.12'),
      mk('v0.6.11'),
      mk('v0.6.10')
    ];
    const result = pickPreviousRelease(releases, '0.6.13');
    expect(result?.tag).toBe('v0.6.12');
    expect(result?.version).toBe('0.6.12');
  });

  it('skips drafts and prereleases', () => {
    const releases = [
      mk('v0.6.13'),
      mk('v0.6.12-beta', { prerelease: true }),
      mk('v0.6.12-draft', { draft: true }),
      mk('v0.6.11')
    ];
    expect(pickPreviousRelease(releases, '0.6.13')?.tag).toBe('v0.6.11');
  });

  it('returns the highest predecessor when input is unsorted', () => {
    const releases = [
      mk('v0.6.9'),
      mk('v0.6.12'),
      mk('v0.6.13'),
      mk('v0.6.11'),
      mk('v0.6.10')
    ];
    expect(pickPreviousRelease(releases, '0.6.13')?.tag).toBe('v0.6.12');
  });

  it('skips entries without tag_name', () => {
    const releases = [
      { draft: false, prerelease: false, assets: [] },
      mk('v0.6.12')
    ];
    expect(pickPreviousRelease(releases, '0.6.13')?.tag).toBe('v0.6.12');
  });

  it('exposes the release assets on the picked entry', () => {
    const assets = [{ name: 'Redstring-mac-arm64.zip' }];
    const releases = [mk('v0.6.12', { assets })];
    expect(pickPreviousRelease(releases, '0.6.13')?.assets).toEqual(assets);
  });
});

describe('pickAssetForArch', () => {
  const release = {
    tag: 'v0.6.12',
    assets: [
      { name: 'Redstring-mac-x64.zip', browser_download_url: 'x64-zip' },
      { name: 'Redstring-mac-arm64.zip', browser_download_url: 'arm64-zip' },
      { name: 'Redstring-mac-x64.dmg', browser_download_url: 'x64-dmg' },
      { name: 'Redstring-mac-arm64.dmg', browser_download_url: 'arm64-dmg' }
    ]
  };

  it('picks the arm64 zip for arm64 arch', () => {
    expect(pickAssetForArch(release, 'arm64')?.name).toBe('Redstring-mac-arm64.zip');
  });

  it('picks the x64 zip for x64 arch', () => {
    expect(pickAssetForArch(release, 'x64')?.name).toBe('Redstring-mac-x64.zip');
  });

  it('defaults to x64 zip for unknown arches', () => {
    expect(pickAssetForArch(release, 'mips')?.name).toBe('Redstring-mac-x64.zip');
  });

  it('returns null when no matching asset exists', () => {
    const r = { assets: [{ name: 'Redstring-mac-x64.zip' }] };
    expect(pickAssetForArch(r, 'arm64')).toBe(null);
  });

  it('returns null for invalid input', () => {
    expect(pickAssetForArch(null, 'arm64')).toBe(null);
    expect(pickAssetForArch({}, 'arm64')).toBe(null);
    expect(pickAssetForArch({ assets: 'not-an-array' }, 'arm64')).toBe(null);
  });
});

describe('deriveTargetBundlePath', () => {
  it('walks up three levels from the executable', () => {
    expect(deriveTargetBundlePath('/Applications/Redstring.app/Contents/MacOS/Redstring'))
      .toBe('/Applications/Redstring.app');
  });

  it('handles arbitrary install locations', () => {
    expect(deriveTargetBundlePath('/Users/u/Apps/Foo.app/Contents/MacOS/Foo'))
      .toBe('/Users/u/Apps/Foo.app');
  });

  it('returns null for invalid input', () => {
    expect(deriveTargetBundlePath('')).toBe(null);
    expect(deriveTargetBundlePath(null)).toBe(null);
    expect(deriveTargetBundlePath('/too/short')).toBe(null);
  });
});

describe('buildSwapAndRelaunchScript', () => {
  const baseArgs = {
    stagedBundlePath: '/tmp/staged/Redstring.app',
    targetBundlePath: '/Applications/Redstring.app',
    parentPid: 12345,
    logPath: '/tmp/installer.log'
  };

  it('throws when required args are missing', () => {
    expect(() => buildSwapAndRelaunchScript({})).toThrow();
    expect(() => buildSwapAndRelaunchScript({ ...baseArgs, stagedBundlePath: '' })).toThrow();
    expect(() => buildSwapAndRelaunchScript({ ...baseArgs, parentPid: 0 })).toThrow();
  });

  it('embeds all paths into the script', () => {
    const script = buildSwapAndRelaunchScript(baseArgs);
    expect(script).toContain('/tmp/staged/Redstring.app');
    expect(script).toContain('/Applications/Redstring.app');
    expect(script).toContain('/tmp/installer.log');
    expect(script).toContain('12345');
  });

  it('waits on the parent pid via kill -0', () => {
    const script = buildSwapAndRelaunchScript(baseArgs);
    expect(script).toContain('kill -0 12345');
  });

  it('aborts if staged bundle is missing', () => {
    const script = buildSwapAndRelaunchScript(baseArgs);
    expect(script).toMatch(/staged bundle missing/);
  });

  it('clears the quarantine xattr after swap', () => {
    const script = buildSwapAndRelaunchScript(baseArgs);
    expect(script).toContain('xattr -dr com.apple.quarantine');
  });

  it('defaults to "open" as the launch command', () => {
    const script = buildSwapAndRelaunchScript(baseArgs);
    expect(script).toMatch(/^[^#]*?open "\/Applications\/Redstring\.app"/m);
  });

  it('honors a custom openCommand for tests', () => {
    const script = buildSwapAndRelaunchScript({ ...baseArgs, openCommand: 'echo OPENED' });
    expect(script).toContain('echo OPENED "/Applications/Redstring.app"');
    expect(script).not.toContain('^open "');
  });

  it('respects maxWaitSeconds', () => {
    const script = buildSwapAndRelaunchScript({ ...baseArgs, maxWaitSeconds: 5 });
    // 5 seconds * 2 iterations/sec = 10
    expect(script).toContain('seq 1 10');
  });
});
