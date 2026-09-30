// @vitest-environment node
// Preload surface (S-22/S-25, C-5/C-6/C-7), packaging config (S-26 fuses,
// S-27 entitlements, S-28), app:// asset resolution (C-5), secrets store (C-7),
// release pipeline (S-30).
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeElectron, loadWithFakes } = require('./helpers/fakeElectron.cjs');
const { resolveAppAsset, mimeTypeFor } = require('../../../electron/appProtocol.cjs');
const { createSecretsStore } = require('../../../electron/secretsStore.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const PRELOAD = path.join(ROOT, 'electron/preload.cjs');

function exposedApi(argv) {
  const fake = createFakeElectron({ userData: os.tmpdir(), documents: os.tmpdir() });
  const saved = process.argv;
  process.argv = [...saved, ...argv];
  try {
    loadWithFakes(PRELOAD, { electron: fake.electron });
  } finally {
    process.argv = saved;
  }
  return fake.calls.exposed;
}

const shape = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'object' && v ? Object.keys(v).sort() : typeof v]));

describe('preload surface', () => {
  it('exposes exactly this API in a packaged build', () => {
    const { name, api } = exposedApi([]);
    expect(name).toBe('electron');
    expect(shape(api)).toEqual({
      isElectron: 'boolean',
      fileSystem: ['deleteFile', 'fileExists', 'folderExists', 'getPathParent', 'mkdir', 'pickFile', 'pickFolder', 'readFile', 'saveAs', 'showItemInFolder', 'writeFile'],
      storage: ['clear', 'getAll', 'getItem', 'getPaths', 'removeItem', 'setAll', 'setItem'],
      secrets: ['delete', 'get', 'isAvailable', 'set'],
      migration: ['complete', 'takeLegacyState'],
      clipboard: ['writeText'],
      github: ['openExternal', 'pollDeviceToken', 'requestDeviceCode'],
      agent: ['getConnection', 'restart', 'status'],
      lifecycle: ['notifyFlushComplete', 'onFlushBeforeQuit'],
      menu: ['onCommand'],
      updater: ['checkNow', 'checkPending', 'clearCache', 'getDiagnostics', 'installUpdate', 'onDiagnosticsUpdated', 'onDownloadProgress', 'onError', 'onOpenDiagnostics', 'onUpdateAvailable', 'onUpdateNotAvailable', 'onUpdateReady', 'openLog', 'openReleases']
    });
  });

  it('debugDowngrade / __devSimulate appear only when main asks for them', () => {
    expect(exposedApi(['--redstring-debug-downgrade']).api.updater.debugDowngrade).toBeTypeOf('function');
    const dev = exposedApi(['--redstring-dev', '--redstring-debug-downgrade']).api.updater;
    expect(dev.__devSimulate).toBeTypeOf('function');
    const prod = exposedApi([]).api.updater;
    expect(prod.debugDowngrade).toBeUndefined();
    expect(prod.__devSimulate).toBeUndefined();
  });
});

describe('packaging config', () => {
  const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf-8'));

  it('flips every fuse the app does not need (S-26)', () => {
    expect(builder.electronFuses).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      grantFileProtocolExtraPrivileges: false,
      enableCookieEncryption: true
    });
  });

  it('registers no custom URL protocol and ships the migration page unpacked', () => {
    for (const platform of ['mac', 'win', 'linux']) expect(builder[platform].protocols).toBeUndefined();
    expect(builder.asarUnpack).toContain('electron/migration/**');
  });

  it('builds only architectures Electron 44 supports, and verifies Windows update signatures', () => {
    const winArchs = builder.win.target.flatMap((t) => t.arch);
    expect(winArchs).not.toContain('ia32');
    expect(builder.win.verifyUpdateCodeSignature).toBe(true);
  });

  it('entitlements keep allow-jit only (S-27)', () => {
    const plist = fs.readFileSync(path.join(ROOT, 'entitlements.mac.plist'), 'utf-8');
    expect(plist).toContain('com.apple.security.cs.allow-jit');
    expect(plist).not.toContain('allow-unsigned-executable-memory');
    expect(plist).not.toContain('disable-library-validation');
  });

  it('depends on a supported Electron and patched builder/updater (S-28)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const major = (v) => Number(String(v).replace(/^[^\d]*/, '').split('.')[0]);
    const minor = (v) => Number(String(v).replace(/^[^\d]*/, '').split('.')[1]);
    expect(major(pkg.devDependencies.electron)).toBeGreaterThanOrEqual(44);
    const eb = pkg.devDependencies['electron-builder'];
    expect(major(eb) > 26 || (major(eb) === 26 && minor(eb) >= 15)).toBe(true);
    const eu = pkg.dependencies['electron-updater'];
    expect(major(eu) > 6 || (major(eu) === 6 && minor(eu) >= 8)).toBe(true);
  });
});

describe('release pipeline (S-30)', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf-8');

  it('uses no third-party builder action and pins every action to a commit SHA', () => {
    expect(yml).not.toMatch(/samuelmeuli/);
    const uses = [...yml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });

  it('is read-only by default and asserts fuses on the built app', () => {
    expect(yml).toMatch(/^permissions:\n\s+contents: read/m);
    expect(yml).toContain('npx @electron/fuses read --app');
    expect(yml).toContain('GrantFileProtocolExtraPrivileges is Disabled');
    expect(yml).toContain('WIN_CSC_LINK');
  });

  it('publish-release.sh refuses to move an existing tag', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts/publish-release.sh'), 'utf-8');
    expect(sh).not.toMatch(/push origin ":refs\/tags/);
    expect(sh).toMatch(/already exists[\s\S]{0,400}exit 1/);
  });
});

describe('app://redstring asset resolution (C-5)', () => {
  const dist = '/opt/app/dist';

  it('serves files inside dist and the SPA shell for extensionless paths', () => {
    expect(resolveAppAsset('app://redstring/index.html', dist)).toBe('/opt/app/dist/index.html');
    expect(resolveAppAsset('app://redstring/', dist)).toBe('/opt/app/dist/index.html');
    expect(resolveAppAsset('app://redstring/assets/canvasWorker-x.js', dist)).toBe('/opt/app/dist/assets/canvasWorker-x.js');
    expect(resolveAppAsset('app://redstring/some/route', dist)).toBe('/opt/app/dist/index.html');
    expect(resolveAppAsset('app://redstring/index.html?test=true#x', dist)).toBe('/opt/app/dist/index.html');
  });

  it('refuses traversal, other hosts and other schemes', () => {
    for (const url of [
      'app://redstring/../package.json', 'app://redstring/%2e%2e/%2e%2e/etc/passwd.txt', 'app://redstring/..%2f..%2fetc%2fhosts.txt',
      'app://redstring/a%00.js', 'app://redstring/a%5c..%5csecret.js', 'app://evil/index.html', 'file:///opt/app/dist/index.html', 'nonsense'
    ]) {
      const r = resolveAppAsset(url, dist);
      if (r !== null) expect(r.startsWith(dist + path.sep), url).toBe(true);
      expect(r === null || !r.includes('..'), url).toBe(true);
    }
    // Encoded dot segments are normalised by the URL parser: they can only
    // ever land back inside dist/.
    expect(resolveAppAsset('app://redstring/%2e%2e/%2e%2e/etc/passwd.txt', dist)).toBe('/opt/app/dist/etc/passwd.txt');
    expect(resolveAppAsset('app://evil/index.html', dist)).toBe(null);
  });

  it('sends wasm and workers with the right types', () => {
    expect(mimeTypeFor('x.wasm')).toBe('application/wasm');
    expect(mimeTypeFor('x.js')).toMatch(/^text\/javascript/);
  });
});

describe('secrets store (C-7)', () => {
  let dir;
  afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
  const fakeSafe = (available = true, backend = 'keychain') => ({
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => Buffer.from('E' + Buffer.from(s).toString('base64')),
    decryptString: (b) => Buffer.from(String(b).slice(1), 'base64').toString()
  });

  it('get never throws; unavailable encryption refuses writes and reads as null', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-secrets-'));
    const s = createSecretsStore({ dir, safeStorage: fakeSafe() });
    s.set('redstring_ai_key.prof_1', 'sk-x');
    expect(s.get('redstring_ai_key.prof_1')).toBe('sk-x');
    expect(s.get('nope')).toBe(null);
    expect(s.get('../../etc/passwd')).toBe(null);
    const off = createSecretsStore({ dir, safeStorage: fakeSafe(false) });
    expect(off.isAvailable()).toBe(false);
    expect(off.get('redstring_ai_key.prof_1')).toBe(null);
    expect(() => off.set('k', 'v')).toThrow();
    expect(createSecretsStore({ dir, safeStorage: fakeSafe(true, 'basic_text') }).isAvailable()).toBe(false);
  });

  it('unlock touches the key once, and never throws when the keychain refuses', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-secrets-'));
    const calls = [];
    const safe = { ...fakeSafe(), encryptString: (v) => { calls.push(v); return Buffer.from('E'); } };
    expect(createSecretsStore({ dir, safeStorage: safe }).unlock()).toBe(true);
    expect(calls).toEqual(['keychain-probe']);
    const refused = { ...fakeSafe(), encryptString: () => { throw new Error('User canceled'); } };
    expect(createSecretsStore({ dir, safeStorage: refused }).unlock()).toBe(false);
    expect(createSecretsStore({ dir, safeStorage: fakeSafe(false) }).unlock()).toBe(false);
  });
});

// A Keychain prompt must be answered before the storage migration starts its
// clock, and development must never use the installed app's Keychain item.
describe('startup keychain handling', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../../electron/main.cjs'), 'utf8');

  it('unlocks the keychain before the origin migration runs', () => {
    const unlockAt = main.indexOf('secretsStore.unlock()');
    const migrateAt = main.indexOf('await runOriginMigration()');
    expect(unlockAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeGreaterThan(unlockAt);
  });

  it('gives development its own keychain item and secrets folder', () => {
    expect(main).toMatch(/if \(isDev\) \{[\s\S]{0,200}app\.setName\('Redstring Dev'\)[\s\S]{0,80}app\.setPath\('userData', sharedUserData\)/);
    expect(main).toMatch(/isDev \? 'secrets-dev' : 'secrets'/);
  });
});
