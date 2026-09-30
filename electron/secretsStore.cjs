// Secrets at rest for the desktop app (contract C-7).
//
// Each secret is encrypted with Electron's safeStorage (Keychain on macOS,
// DPAPI on Windows, libsecret/kwallet on Linux) and written to its own file in
// `<userData>/secrets/`. That directory sits outside every file-IPC root and
// outside the storage:* directory, so no renderer IPC other than secrets:* can
// reach it. File names are a hash of the key, never the key itself.
//
// `safeStorage` and `fs` are injected so this can be tested without Electron.

const path = require('node:path');
const crypto = require('node:crypto');
const nodeFs = require('node:fs');

// Names in use (A5): github_access_token, github_app_user_token,
// redstring_ai_key.<profileId>, …
const SECRET_KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_SECRET_LENGTH = 64 * 1024;

function isValidSecretKey(key) {
  return typeof key === 'string' && SECRET_KEY_RE.test(key);
}

function createSecretsStore({ dir, safeStorage, fs = nodeFs } = {}) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('createSecretsStore: absolute dir required');
  if (!safeStorage) throw new Error('createSecretsStore: safeStorage required');

  const fileFor = (key) => {
    if (!isValidSecretKey(key)) throw new Error('Invalid secret key');
    const name = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
    return path.join(dir, `${name}.secret`);
  };

  function isAvailable() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      // On Linux without a keyring Chromium falls back to a hard-coded key;
      // that is obfuscation, not encryption, so report it as unavailable.
      if (typeof safeStorage.getSelectedStorageBackend === 'function' &&
          safeStorage.getSelectedStorageBackend() === 'basic_text') {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Touch the encryption key once so the OS keyring is unlocked up front. On
  // macOS the first use can show a Keychain prompt; this blocks until it is
  // answered. Returns whether encryption works. Never throws.
  function unlock() {
    if (!isAvailable()) return false;
    try {
      safeStorage.encryptString('keychain-probe');
      return true;
    } catch (err) {
      console.warn('[Secrets] Keychain access was refused:', err && err.message);
      return false;
    }
  }

  // Never throws: a missing, unreadable or undecryptable secret reads as null
  // (the renderer treats that as "not connected" and can re-ask the user).
  function get(key) {
    if (!isValidSecretKey(key)) return null;
    try {
      const buf = fs.readFileSync(fileFor(key));
      if (!isAvailable()) return null;
      return safeStorage.decryptString(buf);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        console.error('[Secrets] Could not read a stored secret:', err && err.message);
      }
      return null;
    }
  }

  function set(key, value) {
    const file = fileFor(key);
    if (typeof value !== 'string') throw new Error('Secret value must be a string');
    if (value.length > MAX_SECRET_LENGTH) throw new Error('Secret value too large');
    if (!isAvailable()) throw new Error('Secure storage is unavailable');
    const encrypted = safeStorage.encryptString(value);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, encrypted, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  }

  function remove(key) {
    const file = fileFor(key);
    try {
      fs.unlinkSync(file);
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return false;
      throw err;
    }
  }

  return { isAvailable, unlock, get, set, delete: remove };
}

module.exports = { createSecretsStore, isValidSecretKey };
