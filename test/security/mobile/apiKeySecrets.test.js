/**
 * S-71: BYOK API keys. On a platform with a native secret store the profile
 * record keeps only a pointer; existing profiles (AES ciphertext or the legacy
 * obfuscation) move across losslessly; the web keeps its current format.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import apiKeyManager from '../../../src/services/apiKeyManager.js';
import {
  __setSecretBackendForTests,
  encryptSecret,
  isEncrypted,
  isSecureRef,
  PLAIN_HANDOFF_MARKER
} from '../../../src/utils/secureStore.js';

function installLocalStorage() {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
  globalThis.localStorage = ls;
  return store;
}

const memoryBackend = () => {
  const data = new Map();
  return {
    kind: 'native',
    data,
    get: async (k) => (data.has(k) ? data.get(k) : null),
    set: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); }
  };
};

const PROFILES = 'redstring_ai_api_profiles';
const ACTIVE = 'redstring_ai_active_profile';
const MIRROR = 'redstring_ai_api_key';
const KEY = 'sk-or-v1-0123456789abcdef';

let ls;
beforeEach(() => {
  ls = installLocalStorage();
  apiKeyManager._migrationPromise = null;
});
afterEach(() => __setSecretBackendForTests(undefined));

const profiles = () => JSON.parse(ls.get(PROFILES) || '{}');

describe('web (no native store): unchanged format', () => {
  it('stores AES ciphertext inside the profile and reads it back', async () => {
    __setSecretBackendForTests(null);
    await apiKeyManager.storeAPIKey(KEY, 'openrouter');
    const [record] = Object.values(profiles());
    expect(isEncrypted(record.key)).toBe(true);
    expect(await apiKeyManager.getAPIKey()).toBe(KEY);
  });
});

describe('native store', () => {
  it('new keys go to the native store; the profile keeps a pointer', async () => {
    const backend = memoryBackend();
    __setSecretBackendForTests(backend);
    const { id } = await apiKeyManager.storeAPIKey(KEY, 'openrouter');
    const record = profiles()[id];
    expect(isSecureRef(record.key)).toBe(true);
    expect(record.key).not.toContain(KEY);
    expect(ls.get(MIRROR)).not.toContain(KEY);
    expect(backend.data.get(`redstring_ai_key.${id}`)).toBe(KEY);
    expect(await apiKeyManager.getAPIKey()).toBe(KEY);
    expect(await apiKeyManager.getAPIKeyForProvider('openrouter')).toBe(KEY);
  });

  it('migrates an existing encrypted profile and the legacy mirror, losslessly', async () => {
    __setSecretBackendForTests(null);
    const enc = await encryptSecret(KEY);
    const record = { key: enc, provider: 'openrouter', version: '2.0', name: 'openrouter' };
    ls.set(PROFILES, JSON.stringify({ prof_1: record }));
    ls.set(ACTIVE, 'prof_1');
    ls.set(MIRROR, JSON.stringify(record));

    const backend = memoryBackend();
    __setSecretBackendForTests(backend);
    apiKeyManager._migrationPromise = null;

    expect(await apiKeyManager.getAPIKey()).toBe(KEY);
    expect(isSecureRef(profiles().prof_1.key)).toBe(true);
    expect(backend.data.get('redstring_ai_key.prof_1')).toBe(KEY);
    // The mirror shares the active profile's pointer; no second copy.
    expect(JSON.parse(ls.get(MIRROR)).key).toBe(profiles().prof_1.key);
    expect([...ls.values()].some((v) => String(v).includes('rsenc:v1:'))).toBe(false);
  });

  it('migrates a legacy obfuscated (v1) key', async () => {
    const obfuscated = apiKeyManager.obfuscate(KEY);
    ls.set(PROFILES, JSON.stringify({ prof_legacy: { key: obfuscated, provider: 'anthropic', version: '1.0' } }));
    ls.set(ACTIVE, 'prof_legacy');
    const backend = memoryBackend();
    __setSecretBackendForTests(backend);
    expect(await apiKeyManager.getAPIKey()).toBe(KEY);
    expect(backend.data.get('redstring_ai_key.prof_legacy')).toBe(KEY);
  });

  it('migrates a storage-origin handoff value', async () => {
    ls.set(PROFILES, JSON.stringify({ prof_1: { key: `${PLAIN_HANDOFF_MARKER}${KEY}`, provider: 'openrouter' } }));
    ls.set(ACTIVE, 'prof_1');
    const backend = memoryBackend();
    __setSecretBackendForTests(backend);
    expect(await apiKeyManager.getAPIKey()).toBe(KEY);
    expect(ls.get(PROFILES)).not.toContain(KEY);
  });

  it('leaves the profile untouched when the native store refuses (no loss)', async () => {
    __setSecretBackendForTests(null);
    const enc = await encryptSecret(KEY);
    ls.set(PROFILES, JSON.stringify({ prof_1: { key: enc, provider: 'openrouter' } }));
    ls.set(ACTIVE, 'prof_1');
    const backend = memoryBackend();
    backend.set = async () => { throw new Error('keystore unavailable'); };
    __setSecretBackendForTests(backend);
    expect(await apiKeyManager.getAPIKey()).toBe(KEY);
    expect(profiles().prof_1.key).toBe(enc);
  });

  it('deleting a profile deletes its native secret unless the mirror still points at it', async () => {
    const backend = memoryBackend();
    __setSecretBackendForTests(backend);
    const a = await apiKeyManager.storeAPIKey('key-a-123456', 'openai');
    const b = await apiKeyManager.storeAPIKey('key-b-123456', 'anthropic'); // mirror now = b
    await apiKeyManager.deleteProfile(a.id);
    expect(backend.data.has(`redstring_ai_key.${a.id}`)).toBe(false);
    await apiKeyManager.deleteProfile(b.id);
    // The legacy mirror (kept "for safety") still references b.
    expect(backend.data.has(`redstring_ai_key.${b.id}`)).toBe(true);
  });
});
