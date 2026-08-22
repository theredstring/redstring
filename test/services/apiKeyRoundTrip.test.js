import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A Google API key came back from storage as binary garbage and reached the
 * provider as "API key not valid".
 *
 * The chain: `crypto.subtle` exists only in a secure context, so reaching the
 * dev server over a LAN IP (http://192.168.x.x:4001) has no WebCrypto.
 * encryptSecret then returns the key UNMARKED, and the read path reads
 * "unmarked" as "legacy obfuscated" and runs atob() on it. An API key uses the
 * base64 alphabet, so atob does not throw — it silently yields binary junk.
 *
 * Both halves are pinned here: storage must never leave a plaintext key
 * unmarked, and the reader must recover one that already is.
 */

const GOOGLE_KEY = 'AIzaSyD-1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuV';

// jsdom lacks localStorage in this config; a Map-backed stub is enough.
function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  return store;
}

/**
 * Simulate a non-secure context: `crypto` present, but no `subtle` — exactly
 * what a browser exposes over plain http on a LAN IP.
 *
 * `globalThis.crypto` is an accessor property here, so it has to be redefined
 * rather than assigned.
 */
function withoutWebCrypto() {
  const real = globalThis.crypto;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: real?.getRandomValues?.bind(real) },
    configurable: true,
    writable: true
  });
  return () => Object.defineProperty(globalThis, 'crypto', descriptor);
}

let apiKeyManager;
beforeEach(async () => {
  installLocalStorage();
  vi.resetModules();
  ({ default: apiKeyManager } = await import('../../src/services/apiKeyManager.js'));
});

describe('API key round-trip without WebCrypto (non-secure context)', () => {
  it('returns the key unchanged after a store/retrieve cycle', async () => {
    const restore = withoutWebCrypto();
    try {
      await apiKeyManager.storeAPIKey(GOOGLE_KEY, 'google');
      expect(await apiKeyManager.getAPIKey()).toBe(GOOGLE_KEY);
    } finally {
      restore();
    }
  });

  it('never persists the key as unmarked plaintext', async () => {
    const restore = withoutWebCrypto();
    try {
      await apiKeyManager.storeAPIKey(GOOGLE_KEY, 'google');
      const profiles = JSON.parse(localStorage.getItem('redstring_ai_api_profiles'));
      const stored = Object.values(profiles)[0].key;
      // Unmarked must mean obfuscated — that is the invariant the reader uses.
      expect(stored).not.toBe(GOOGLE_KEY);
      expect(atob(stored).split('').reverse().join('')).toBe(GOOGLE_KEY);
    } finally {
      restore();
    }
  });

  it('recovers a key already stored as plaintext by the old code', async () => {
    // Reproduces existing corrupted installs: plaintext written straight in.
    const keyData = {
      key: GOOGLE_KEY, provider: 'google', endpoint: '', model: 'gemini',
      settings: {}, timestamp: Date.now(), version: '2.0', name: 'google'
    };
    localStorage.setItem('redstring_ai_api_profiles', JSON.stringify({ p1: keyData }));
    localStorage.setItem('redstring_ai_active_profile', 'p1');

    expect(await apiKeyManager.getAPIKey()).toBe(GOOGLE_KEY);
  });

  it('does not mangle a plaintext key into control characters', async () => {
    localStorage.setItem('redstring_ai_api_profiles', JSON.stringify({
      p1: { key: GOOGLE_KEY, provider: 'google', settings: {}, version: '2.0' }
    }));
    localStorage.setItem('redstring_ai_active_profile', 'p1');

    const got = await apiKeyManager.getAPIKey();
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x08\x0e-\x1f\x7f]/.test(got)).toBe(false);
  });

  it('still reads a genuinely obfuscated legacy key', async () => {
    const obfuscated = btoa(GOOGLE_KEY.split('').reverse().join(''));
    localStorage.setItem('redstring_ai_api_profiles', JSON.stringify({
      p1: { key: obfuscated, provider: 'google', settings: {}, version: '2.0' }
    }));
    localStorage.setItem('redstring_ai_active_profile', 'p1');

    expect(await apiKeyManager.getAPIKey()).toBe(GOOGLE_KEY);
  });
});

describe('API key round-trip with WebCrypto (secure context)', () => {
  it('encrypts at rest and returns the key unchanged', async () => {
    await apiKeyManager.storeAPIKey(GOOGLE_KEY, 'google');

    const profiles = JSON.parse(localStorage.getItem('redstring_ai_api_profiles'));
    const stored = Object.values(profiles)[0].key;
    expect(stored.startsWith('rsenc:v1:')).toBe(true);
    expect(await apiKeyManager.getAPIKey()).toBe(GOOGLE_KEY);
  });
});
