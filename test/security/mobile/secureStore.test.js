/**
 * S-71 / C-7: secrets at rest. Backend selection (Electron safeStorage →
 * native Keychain/Keystore → web AES-GCM) and the lossless, idempotent move
 * of legacy localStorage copies into the native store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSecret,
  setSecret,
  deleteSecret,
  getSecretBackendKind,
  encryptSecret,
  isEncrypted,
  PLAIN_HANDOFF_MARKER,
  decryptSecret,
  assertSecretName,
  __setSecretBackendForTests
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

function memoryBackend(kind = 'native') {
  const data = new Map();
  return {
    kind,
    data,
    get: vi.fn(async (k) => (data.has(k) ? data.get(k) : null)),
    set: vi.fn(async (k, v) => { data.set(k, v); }),
    delete: vi.fn(async (k) => { data.delete(k); })
  };
}

let ls;
beforeEach(() => {
  ls = installLocalStorage();
  __setSecretBackendForTests(undefined);
});
afterEach(() => {
  __setSecretBackendForTests(undefined);
  delete window.electron;
  delete window.Capacitor;
});

describe('backend selection', () => {
  it('uses window.electron.secrets when present and available', async () => {
    const api = { isAvailable: vi.fn(async () => true), get: vi.fn(async () => null), set: vi.fn(), delete: vi.fn() };
    window.electron = { isElectron: true, secrets: api };
    expect(await getSecretBackendKind()).toBe('electron');
  });

  it('falls back to the web layer when safeStorage is unavailable', async () => {
    window.electron = { isElectron: true, secrets: { isAvailable: async () => false, get: vi.fn(), set: vi.fn(), delete: vi.fn() } };
    expect(await getSecretBackendKind()).toBe('web');
  });

  it('falls back to the web layer when the Electron secrets API is absent (A2 not merged yet)', async () => {
    window.electron = { isElectron: true };
    expect(await getSecretBackendKind()).toBe('web');
  });

  it('uses the native plugin inside Capacitor', async () => {
    const plugin = {
      SecureStorage: {
        setKeyPrefix: vi.fn(async () => {}),
        setSynchronize: vi.fn(async () => {}),
        setDefaultKeychainAccess: vi.fn(async () => {}),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {})
      },
      KeychainAccess: { afterFirstUnlockThisDeviceOnly: 3 }
    };
    vi.doMock('@aparajita/capacitor-secure-storage', () => plugin);
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    expect(await getSecretBackendKind()).toBe('native');
    // Never iCloud; after-first-unlock, this device only.
    expect(plugin.SecureStorage.setSynchronize).toHaveBeenCalledWith(false);
    expect(plugin.SecureStorage.setDefaultKeychainAccess).toHaveBeenCalledWith(3);
    vi.doUnmock('@aparajita/capacitor-secure-storage');
  });

  it('is the web layer in a plain browser', async () => {
    expect(await getSecretBackendKind()).toBe('web');
  });
});

describe('web layer (unchanged behaviour)', () => {
  beforeEach(() => __setSecretBackendForTests(null));

  it('stores AES-GCM ciphertext under the same localStorage key', async () => {
    await setSecret('github_access_token', 'gho_web');
    expect(isEncrypted(ls.get('github_access_token'))).toBe(true);
    expect(await getSecret('github_access_token')).toBe('gho_web');
  });

  it('reads legacy plaintext and upgrades it to ciphertext', async () => {
    ls.set('github_app_user_token', 'ghu_plain');
    expect(await getSecret('github_app_user_token')).toBe('ghu_plain');
    expect(isEncrypted(ls.get('github_app_user_token'))).toBe(true);
    expect(await getSecret('github_app_user_token')).toBe('ghu_plain');
  });

  it('an empty value deletes', async () => {
    await setSecret('github_refresh_token', 'r');
    await setSecret('github_refresh_token', '');
    expect(ls.has('github_refresh_token')).toBe(false);
    expect(await getSecret('github_refresh_token')).toBeNull();
  });
});

describe('native backend: lossless migration of legacy copies', () => {
  it('moves an AES-encrypted localStorage token into the native store, verified, then removes the old copy', async () => {
    __setSecretBackendForTests(null);
    ls.set('github_access_token', await encryptSecret('gho_legacy'));

    const backend = memoryBackend('native');
    __setSecretBackendForTests(backend);

    expect(await getSecret('github_access_token')).toBe('gho_legacy');
    expect(backend.data.get('github_access_token')).toBe('gho_legacy');
    expect(ls.has('github_access_token')).toBe(false);
    // Idempotent: a second read comes from the native store.
    expect(await getSecret('github_access_token')).toBe('gho_legacy');
    expect(backend.set).toHaveBeenCalledTimes(1);
  });

  it('keeps the legacy copy when the native write does not verify', async () => {
    ls.set('github_access_token', 'gho_plain_legacy');
    const backend = memoryBackend('native');
    backend.set.mockImplementation(async (k) => { backend.data.set(k, 'CORRUPTED'); });
    __setSecretBackendForTests(backend);

    expect(await getSecret('github_access_token')).toBe('gho_plain_legacy');
    expect(ls.get('github_access_token')).toBe('gho_plain_legacy');
    // The bad native copy is removed so it cannot shadow the good one.
    expect(backend.data.has('github_access_token')).toBe(false);
    expect(await getSecret('github_access_token')).toBe('gho_plain_legacy');
  });

  it('keeps the legacy copy when the native write throws', async () => {
    ls.set('github_access_token', 'gho_plain_legacy');
    const backend = memoryBackend('native');
    backend.set.mockRejectedValue(new Error('keychain locked'));
    __setSecretBackendForTests(backend);

    expect(await getSecret('github_access_token')).toBe('gho_plain_legacy');
    expect(ls.get('github_access_token')).toBe('gho_plain_legacy');
  });

  it('never deletes a legacy value it cannot decrypt here (another origin\'s AES key)', async () => {
    ls.set('github_access_token', 'rsenc:v1:AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB');
    const backend = memoryBackend('native');
    __setSecretBackendForTests(backend);

    expect(await getSecret('github_access_token')).toBeNull();
    expect(ls.get('github_access_token')).toMatch(/^rsenc:v1:/);
    expect(backend.set).not.toHaveBeenCalled();
  });

  it('does not migrate into a store it cannot read back', async () => {
    ls.set('github_access_token', 'gho_x');
    const backend = memoryBackend('native');
    backend.get.mockRejectedValue(new Error('io'));
    __setSecretBackendForTests(backend);
    expect(await getSecret('github_access_token')).toBe('gho_x');
    expect(backend.set).not.toHaveBeenCalled();
    expect(ls.get('github_access_token')).toBe('gho_x');
  });

  it('accepts a migration handoff (rsplain:v1:) and scrubs it', async () => {
    ls.set('github_access_token', `${PLAIN_HANDOFF_MARKER}gho_handoff`);
    const backend = memoryBackend('electron');
    __setSecretBackendForTests(backend);
    expect(await getSecret('github_access_token')).toBe('gho_handoff');
    expect(backend.data.get('github_access_token')).toBe('gho_handoff');
    expect(ls.has('github_access_token')).toBe(false);
  });
});

describe('native backend: writes and deletes', () => {
  it('writes to the native store and leaves nothing in localStorage', async () => {
    const backend = memoryBackend('native');
    __setSecretBackendForTests(backend);
    ls.set('github_access_token', 'stale');
    await setSecret('github_access_token', 'gho_new');
    expect(backend.data.get('github_access_token')).toBe('gho_new');
    expect(ls.has('github_access_token')).toBe(false);
  });

  it('falls back to encrypted localStorage rather than dropping a token the keychain refused', async () => {
    const backend = memoryBackend('native');
    backend.data.set('github_access_token', 'old');
    backend.set.mockRejectedValue(new Error('refused'));
    __setSecretBackendForTests(backend);
    expect(await setSecret('github_access_token', 'gho_new')).toBe(true);
    // The stale native value must not shadow the fallback copy.
    expect(backend.data.has('github_access_token')).toBe(false);
    expect(isEncrypted(ls.get('github_access_token'))).toBe(true);
    __setSecretBackendForTests(null);
    expect(await getSecret('github_access_token')).toBe('gho_new');
  });

  it('deleteSecret removes both copies', async () => {
    const backend = memoryBackend('native');
    backend.data.set('github_app_user_token', 'ghu');
    ls.set('github_app_user_token', 'ghu-legacy');
    __setSecretBackendForTests(backend);
    await deleteSecret('github_app_user_token');
    expect(backend.data.has('github_app_user_token')).toBe(false);
    expect(ls.has('github_app_user_token')).toBe(false);
  });
});

describe('names and markers', () => {
  it('rejects names outside the shared charset', () => {
    expect(() => assertSecretName('github_access_token')).not.toThrow();
    expect(() => assertSecretName('redstring_ai_key.prof_1_abc')).not.toThrow();
    expect(() => assertSecretName('../etc/passwd')).toThrow();
    expect(() => assertSecretName('a:b')).toThrow();
    expect(() => assertSecretName('')).toThrow();
  });

  it('decryptSecret unwraps a handoff value', async () => {
    expect(await decryptSecret(`${PLAIN_HANDOFF_MARKER}sk-or-v1-x`)).toBe('sk-or-v1-x');
  });
});
