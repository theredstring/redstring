import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isCapacitor,
  usesPathHandles,
  isCapacitorHandle,
  makeCapacitorHandle,
  parseCapacitorHandle,
  universeFileHandle,
  sanitizeFileBaseName,
  UNIVERSES_FOLDER_HANDLE
} from '../../src/utils/capacitorAdapter.js';

describe('capacitorAdapter handle codec', () => {
  afterEach(() => {
    delete window.Capacitor;
    delete window.electron;
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
    expect(() => parseCapacitorHandle('capacitor://External/x.redstring')).toThrow();
  });

  it('parses the folder handle with a trailing slash', () => {
    expect(parseCapacitorHandle(UNIVERSES_FOLDER_HANDLE)).toEqual({
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

  it('sanitizes names that would break the path', () => {
    expect(sanitizeFileBaseName('a/b:c*d')).toBe('a-b-c-d');
    expect(sanitizeFileBaseName('')).toBe('universe');
    expect(sanitizeFileBaseName(null)).toBe('universe');
    expect(universeFileHandle('Grant\'s / Universe')).not.toContain('/Universes/Grant\'s /');
  });
});
