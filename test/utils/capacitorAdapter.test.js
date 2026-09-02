import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isCapacitor,
  usesPathHandles,
  isCapacitorHandle,
  makeCapacitorHandle,
  parseCapacitorHandle,
  universeFileHandle,
  sanitizeFileBaseName,
  universesFolderHandle,
  capacitorPlatform
} from '../../src/utils/capacitorAdapter.js';

describe('capacitorAdapter handle codec', () => {
  afterEach(() => {
    delete window.Capacitor;
    delete window.electron;
    delete window.androidBridge;
  });

  it('detects Capacitor only when the native bridge reports native platform', () => {
    expect(isCapacitor()).toBe(false);
    window.Capacitor = { isNativePlatform: () => false };
    expect(isCapacitor()).toBe(false);
    window.Capacitor = { isNativePlatform: () => true };
    expect(isCapacitor()).toBe(true);
  });

  it('usesPathHandles covers both native shells', () => {
    expect(usesPathHandles()).toBe(false);
    window.electron = { isElectron: true };
    expect(usesPathHandles()).toBe(true);
    delete window.electron;
    window.Capacitor = { isNativePlatform: () => true };
    expect(usesPathHandles()).toBe(true);
  });

  it('round-trips handles', () => {
    const h = makeCapacitorHandle('Documents', 'Universes/my-universe.redstring');
    expect(h).toBe('capacitor://Documents/Universes/my-universe.redstring');
    expect(isCapacitorHandle(h)).toBe(true);
    expect(parseCapacitorHandle(h)).toEqual({
      directory: 'Documents',
      path: 'Universes/my-universe.redstring'
    });
  });

  it('does not mistake Electron absolute paths for Capacitor handles', () => {
    expect(isCapacitorHandle('/Users/me/Documents/x.redstring')).toBe(false);
    expect(isCapacitorHandle('C:\\Users\\me\\x.redstring')).toBe(false);
    expect(isCapacitorHandle(null)).toBe(false);
    expect(isCapacitorHandle({ name: 'x' })).toBe(false);
  });

  it('rejects directories outside the allowlist', () => {
    expect(() => makeCapacitorHandle('Library', 'x')).toThrow();
    expect(() => parseCapacitorHandle('capacitor://Cache/x.redstring')).toThrow();
  });

  it('parses the folder handle with a trailing slash', () => {
    expect(parseCapacitorHandle(universesFolderHandle())).toEqual({
      directory: 'Documents',
      path: 'Universes'
    });
  });

  it('derives deterministic universe handles from slugs', () => {
    expect(universeFileHandle('my-universe')).toBe(
      'capacitor://Documents/Universes/my-universe.redstring'
    );
    // idempotent when the name already carries the extension
    expect(universeFileHandle('my-universe.redstring')).toBe(
      'capacitor://Documents/Universes/my-universe.redstring'
    );
  });

  it('roots the managed folder per platform', () => {
    // iOS (and the web/test default): Directory.Documents is the app's own
    // private container.
    expect(universesFolderHandle()).toBe('capacitor://Documents/Universes/');

    // Android: Directory.Documents is PUBLIC shared storage
    // (/storage/emulated/0/Documents) gated behind WRITE_EXTERNAL_STORAGE,
    // which is undeclared and dead under scoped storage on API 33+. Every
    // write there fails, so the managed root must be Directory.External —
    // app-scoped, permission-free, and still visible over USB/MTP.
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    expect(universesFolderHandle()).toBe('capacitor://External/Universes/');
    expect(universeFileHandle('my-universe')).toBe(
      'capacitor://External/Universes/my-universe.redstring'
    );
  });

  it('resolves the platform from the native bridge global', () => {
    // getPlatformId's own signal: readable before @capacitor/core has
    // initialized window.Capacitor, which is when isCapacitor() would
    // otherwise silently drop the app into mobile-web mode.
    expect(capacitorPlatform()).toBe(null);
    window.androidBridge = {};
    expect(capacitorPlatform()).toBe('android');
    expect(isCapacitor()).toBe(true);
    expect(universesFolderHandle()).toBe('capacitor://External/Universes/');
  });

  it('sanitizes names that would break the path', () => {
    expect(sanitizeFileBaseName('a/b:c*d')).toBe('a-b-c-d');
    expect(sanitizeFileBaseName('')).toBe('universe');
    expect(sanitizeFileBaseName(null)).toBe('universe');
    expect(universeFileHandle('Grant\'s / Universe')).not.toContain('/Universes/Grant\'s /');
  });
});
