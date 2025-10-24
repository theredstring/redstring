import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const DEFAULT_ROOT = process.env.REDSTRING_SECURE_STORE ||
  path.join(os.homedir(), '.redstring', 'credentials');
const DEFAULT_VAULT_PATH = process.env.GITHUB_TOKEN_VAULT_PATH ||
  path.join(DEFAULT_ROOT, 'github-credentials.vault');
const DEFAULT_KEY_PATH = process.env.GITHUB_TOKEN_KEY_PATH ||
  path.join(DEFAULT_ROOT, 'github-credentials.key');

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function deriveKeyFromSecret(secret) {
  if (!secret) {
    throw new Error('TokenVault secret is undefined');
  }

  // Accept hex, base64, or plain text secrets
  const trimmed = secret.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/=]{43,44}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'base64');
  }
  // Fallback: hash arbitrary string into 32 bytes
  return crypto.createHash('sha256').update(trimmed).digest();
}

function writeAtomic(filePath, contentBuffer) {
  const dir = path.dirname(filePath);
  ensureDirectory(dir);
  const tempPath = path.join(
    dir,
    `${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  );
  fs.writeFileSync(tempPath, contentBuffer, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

class TokenVault {
  constructor({
    vaultPath = DEFAULT_VAULT_PATH,
    keyPath = DEFAULT_KEY_PATH
  } = {}) {
    this.vaultPath = vaultPath;
    this.keyPath = keyPath;
    this.secretBuffer = null;
    this.cache = { oauth: null, githubApp: null };
    this.loaded = false;
  }

  getKey() {
    if (this.secretBuffer) {
      return this.secretBuffer;
    }

    const envSecret = process.env.TOKEN_VAULT_SECRET || process.env.GITHUB_TOKEN_SECRET || null;
    if (envSecret && envSecret.trim().length > 0) {
      this.secretBuffer = deriveKeyFromSecret(envSecret);
      return this.secretBuffer;
    }

    try {
      if (fs.existsSync(this.keyPath)) {
        const stored = fs.readFileSync(this.keyPath, 'utf8').trim();
        if (stored) {
          this.secretBuffer = deriveKeyFromSecret(stored);
          return this.secretBuffer;
        }
      }
    } catch (error) {
      console.warn('[TokenVault] Failed to read existing key:', error.message);
    }

    const generated = crypto.randomBytes(32);
    try {
      ensureDirectory(path.dirname(this.keyPath));
      fs.writeFileSync(this.keyPath, generated.toString('hex'), { mode: 0o600 });
    } catch (error) {
      console.warn('[TokenVault] Failed to persist generated key:', error.message);
    }
    this.secretBuffer = generated;
    return this.secretBuffer;
  }

  encryptPayload(data) {
    const key = this.getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  decryptPayload(buffer) {
    const key = this.getKey();
    const iv = buffer.subarray(0, 12);
    const authTag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  load() {
    if (this.loaded) {
      return this.cache;
    }

    try {
      if (!fs.existsSync(this.vaultPath)) {
        this.cache = { oauth: null, githubApp: null };
        this.loaded = true;
        return this.cache;
      }
      const content = fs.readFileSync(this.vaultPath);
      const payload = this.decryptPayload(content);
      this.cache = {
        oauth: payload.oauth || null,
        githubApp: payload.githubApp || null
      };
      this.loaded = true;
      return this.cache;
    } catch (error) {
      console.error('[TokenVault] Failed to load vault, starting fresh:', error.message);
      this.cache = { oauth: null, githubApp: null };
      this.loaded = true;
      return this.cache;
    }
  }

  persist() {
    try {
      const payload = {
        oauth: this.cache.oauth || null,
        githubApp: this.cache.githubApp || null,
        savedAt: Date.now()
      };
      const encrypted = this.encryptPayload(payload);
      writeAtomic(this.vaultPath, encrypted);
    } catch (error) {
      console.error('[TokenVault] Failed to persist vault:', error.message);
    }
  }

  getOAuthCredentials() {
    this.load();
    return this.cache.oauth;
  }

  setOAuthCredentials(credentials) {
    this.load();
    this.cache.oauth = {
      ...credentials,
      storedAt: Date.now()
    };
    this.persist();
    return this.cache.oauth;
  }

  clearOAuthCredentials() {
    this.load();
    this.cache.oauth = null;
    this.persist();
  }

  getGitHubAppInstallation() {
    this.load();
    return this.cache.githubApp;
  }

  setGitHubAppInstallation(installation) {
    this.load();
    this.cache.githubApp = {
      ...installation,
      storedAt: Date.now()
    };
    this.persist();
    return this.cache.githubApp;
  }

  clearGitHubAppInstallation() {
    this.load();
    this.cache.githubApp = null;
    this.persist();
  }
}

export const tokenVault = new TokenVault();
export default tokenVault;
