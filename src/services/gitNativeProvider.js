/**
 * Git-Native Semantic Web Provider
 * Core abstraction for hot-swappable Git providers
 * Enables real-time responsiveness, true decentralization, and distributed resilience
 */

import githubRateLimiter from './githubRateLimiter.js';
import { githubAPI } from './GitHubAPIWrapper.js';

/**
 * Base64-encode raw bytes.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the argument limit and
 * throws RangeError on anything past a few hundred KB — which is precisely the
 * size range of the image blobs this exists to write.
 */
const bytesToBase64 = (bytes) => {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  if (typeof btoa !== 'undefined') return btoa(binary);
  // eslint-disable-next-line no-undef
  return Buffer.from(bytes).toString('base64');
};

/**
 * Every read of the contents endpoint opts out of the HTTP cache.
 *
 * GitHub serves two different representations of the same URL depending on the
 * Accept header (`Vary: Accept`, `cache-control: private, max-age=60`, and the
 * SAME ETag for both). On 2026-09-12 Chromium ignored that Vary and answered
 * the raw-media-type fallback fetch with the cached JSON envelope from the
 * preceding probe — so a 6.9 MB universe read as a 10 KB metadata object,
 * imported as empty, and was written back over the real file.
 *
 * Never remove this. The two requests differ ONLY by a request header, which
 * is exactly the case browser caches get wrong.
 */
const NO_HTTP_CACHE = 'no-store';

/** An error the callers treat as "the remote content is UNKNOWN, not empty". */
const readTruncated = (message) => {
  const error = new Error(message);
  error.code = 'READ_TRUNCATED';
  return error;
};

/**
 * Does this parsed object look like a git contents-API response rather than a
 * file's bytes? Both GitHub and Gitea return this shape, and it is never a
 * valid payload for any file this app reads.
 */
export const isContentsEnvelope = (obj) =>
  !!obj
  && typeof obj === 'object'
  && !Array.isArray(obj)
  && obj.type === 'file'
  && typeof obj.sha === 'string'
  && 'encoding' in obj
  && 'content' in obj;

/**
 * Assert that a body we are about to hand back really is the file's content.
 *
 * Two independent checks, because either alone has a blind spot:
 *   1. Byte length must equal the blob size the API reported. The envelope is
 *      ~10 KB where the blob is 6.9 MB, so this catches it outright.
 *   2. The body must not itself parse as a contents envelope. This covers a
 *      missing/zero `size` (Gitea, or a probe that didn't report one), where
 *      check 1 has nothing to compare against.
 *
 * `actualBytes` must be the byte length measured BEFORE UTF-8 decoding.
 * Re-encoding the decoded string is not equivalent: `TextDecoder` strips a
 * leading BOM and substitutes U+FFFD for invalid sequences, so a legitimate
 * BOM-prefixed file would re-encode three bytes short and be rejected as
 * truncated. Callers that only have a string may omit it, and then only
 * check 2 applies.
 *
 * @throws {Error} with `code: 'READ_TRUNCATED'`
 */
export function assertRawBodyMatches(content, size, label = 'file', actualBytes = null) {
  if (typeof content !== 'string') {
    throw readTruncated(`${label}: expected text content, got ${typeof content}`);
  }
  if (!content && size > 0) {
    throw readTruncated(`${label}: no content despite reported size ${size}`);
  }

  if (Number.isFinite(size) && size > 0 && Number.isFinite(actualBytes)) {
    if (actualBytes !== size) {
      throw readTruncated(`${label}: body is ${actualBytes} bytes but the blob is ${size} — the read did not return the file`);
    }
  }

  // Cheap pre-filter so we never JSON.parse a multi-megabyte universe just to
  // reject it: an envelope is small and always mentions "encoding".
  if (content.length < 64 * 1024 && content.trimStart().startsWith('{') && content.includes('"encoding"')) {
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null; // Not JSON at all — fine, it is not an envelope.
    }
    if (isContentsEnvelope(parsed)) {
      throw readTruncated(`${label}: body is a contents-API envelope, not file bytes (cached response?)`);
    }
  }
}

/**
 * Read a response body as text AND report the byte length actually received.
 *
 * Falls back to `text()` when the response has no `arrayBuffer` (hand-rolled
 * test doubles), in which case the byte length is unknown and the size check
 * is skipped rather than guessed at.
 */
async function responseToTextWithBytes(response) {
  if (typeof response.arrayBuffer === 'function') {
    const buffer = await response.arrayBuffer();
    return { content: new TextDecoder().decode(buffer), byteLength: buffer.byteLength };
  }
  // No arrayBuffer means something replaced global fetch with a shim (a
  // Capacitor HTTP patch, an interceptor). The size check silently stops
  // applying, so say so loudly rather than degrading in silence.
  console.warn(
    '[GitHubSemanticProvider] Response has no arrayBuffer() — the read-size verification is DISABLED for this request. '
    + 'Something has replaced global fetch; a truncated body cannot be detected.'
  );
  return { content: await response.text(), byteLength: null };
}

/** Decode base64 to raw bytes, so callers can measure the true byte length. */
const base64ToBytes = (b64) => {
  const clean = String(b64 || '').replace(/\s/g, '');
  let binary;
  if (typeof atob !== 'undefined') {
    binary = atob(clean);
  } else {
    // eslint-disable-next-line no-undef
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * Universal Semantic Provider Interface
 * All Git providers must implement this interface
 */
export class SemanticProvider {
  constructor(config) {
    this.name = config.name;
    this.rootUrl = config.rootUrl;
    this.authMechanism = config.authMechanism; // "oauth" | "token" | "basic" | "webid"
    this.config = config;
  }

  /**
   * Normalize arbitrary path-like inputs into a predictable string.
   * Accept plain strings, arrays of segments, or objects with common fields.
   */
  normalizePathInput(input) {
    if (input == null) {
      return '';
    }

    if (typeof input === 'string') {
      return input;
    }

    if (Array.isArray(input)) {
      return input.filter(Boolean).join('/');
    }

    if (typeof input === 'object') {
      if (typeof input.path === 'string') {
        return input.path;
      }
      if (typeof input.fullPath === 'string') {
        return input.fullPath;
      }
      if (typeof input.relativePath === 'string') {
        return input.relativePath;
      }
      if (typeof input.dir === 'string') {
        return input.dir;
      }
      if (Array.isArray(input.segments)) {
        return input.segments.filter(Boolean).join('/');
      }
      if (typeof input.pathname === 'string') {
        return input.pathname.replace(/^\//, '');
      }
      if (typeof input.toString === 'function' && input.toString !== Object.prototype.toString) {
        const stringValue = input.toString();
        if (stringValue && stringValue !== '[object Object]') {
          return stringValue;
        }
      }
      return '';
    }

    return String(input);
  }

  /**
   * Produce display and API-safe variants of a path.
   */
  resolvePathInput(input, { trimTrailing = true } = {}) {
    let normalized = this.normalizePathInput(input);

    if (!normalized) {
      return { displayPath: '', apiPath: '' };
    }

    normalized = normalized.replace(/^\/+/, '');
    if (trimTrailing) {
      normalized = normalized.replace(/\/+$/, '');
    }

    if (!normalized) {
      return { displayPath: '', apiPath: '' };
    }

    const segments = normalized.split('/').filter(segment => segment.length > 0);
    const apiPath = segments.map(segment => encodeURIComponent(segment)).join('/');

    return {
      displayPath: normalized,
      apiPath
    };
  }

  /**
   * Authenticate with the provider
   * @returns {Promise<AuthToken>} Authentication token
   */
  async authenticate() {
    throw new Error('authenticate() must be implemented by provider');
  }

  /**
   * Create a new semantic space
   * @param {string} name - Name of the semantic space
   * @returns {Promise<SpaceInfo>} Space information
   */
  async createSemanticSpace(name) {
    throw new Error('createSemanticSpace() must be implemented by provider');
  }

  /**
   * Write semantic content to a file
   * @param {string} path - File path within semantic space
   * @param {string} ttlContent - TTL content to write
   * @returns {Promise<void>}
   */
  async writeSemanticFile(path, ttlContent) {
    throw new Error('writeSemanticFile() must be implemented by provider');
  }

  /**
   * Read semantic content from a file
   * @param {string} path - File path within semantic space
   * @returns {Promise<string>} TTL content
   */
  async readSemanticFile(path) {
    throw new Error('readSemanticFile() must be implemented by provider');
  }

  /**
   * List contents of a directory
   * @param {string} dirPath - Directory path to list
   * @returns {Promise<Array>} Array of directory contents
   */
  async listDirectoryContents(dirPath) {
    throw new Error('listDirectoryContents() must be implemented by provider');
  }

  /**
   * Commit changes to the repository
   * @param {string} message - Commit message
   * @param {string[]} files - Array of changed file paths
   * @returns {Promise<void>}
   */
  async commitChanges(message, files) {
    throw new Error('commitChanges() must be implemented by provider');
  }

  /**
   * Export the full semantic graph
   * @returns {Promise<SemanticArchive>} Complete semantic archive
   */
  async exportFullGraph() {
    throw new Error('exportFullGraph() must be implemented by provider');
  }

  /**
   * Import a full semantic graph
   * @param {SemanticArchive} archive - Semantic archive to import
   * @returns {Promise<void>}
   */
  async importFullGraph(archive) {
    throw new Error('importFullGraph() must be implemented by provider');
  }

  /**
   * Check if provider is available
   * @returns {Promise<boolean>} True if provider is accessible
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented by provider');
  }

  /**
   * Get provider status information
   * @returns {Promise<ProviderStatus>} Provider status
   */
  async getStatus() {
    throw new Error('getStatus() must be implemented by provider');
  }

  /**
   * Raw file write (no semantic path or TTL extension assumptions)
   */
  async writeFileRaw(path, content) {
    throw new Error('writeFileRaw() must be implemented by provider');
  }

  /**
   * Raw file read (no semantic path or TTL extension assumptions)
   */
  async readFileRaw(path) {
    throw new Error('readFileRaw() must be implemented by provider');
  }

  /**
   * Raw byte read, for content-addressed image blobs.
   * @returns {Promise<Uint8Array>}
   */
  async readBinaryFile(path) {
    throw new Error('readBinaryFile() must be implemented by provider');
  }

  /**
   * Every revision of one file, newest first.
   *
   * The repository already holds every version a universe has ever had — a
   * write that destroys data leaves the previous content sitting in history,
   * untouched. Until this existed nothing in the app could look at it, so a
   * recoverable loss was indistinguishable from a permanent one.
   *
   * `size` comes back without downloading the revision: the contents endpoint
   * reports a blob's size in its metadata, and for anything over 1MB it omits
   * the content entirely. That makes size the cheap signal — a universe that
   * went from megabytes to kilobytes is visible without reading a byte.
   *
   * @param {string} path
   * @param {Object} [options]
   * @param {number} [options.limit=20] - Most recent revisions to return.
   * @param {boolean} [options.withSize=true] - Fetch each revision's size
   *   (one small request per revision). `false` returns commits only.
   * @returns {Promise<Array<{sha: string, date: string, message: string, size: number|null}>>}
   */
  async listFileHistory(path, options) {
    throw new Error('listFileHistory() must be implemented by provider');
  }

  /**
   * Base64-encode write content that may be either text or raw bytes.
   *
   * Every write path funnels through here so binary payloads (content-addressed
   * image blobs) reuse each provider's existing SHA/conflict/retry machinery
   * unchanged. Handing a Uint8Array to utf8ToBase64 would stringify it to
   * "137,80,78,71,…" and commit that text as though it were the image.
   */
  contentToBase64(content) {
    if (content instanceof Uint8Array) return bytesToBase64(content);
    if (content instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(content));
    return this.utf8ToBase64(content);
  }

  /**
   * Cheap content hash used by providers to suppress duplicate writes.
   *
   * Hoisted to the base class from the two identical per-provider copies, so
   * the byte-payload handling below only had to be got right once.
   */
  generateContentHash(content) {
    // Byte payloads (image blobs) have no charCodeAt; index them directly.
    const isBytes = content instanceof Uint8Array;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = isBytes ? content[i] : content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * UTF-8 safe base64 encode. Subclasses override with their own copy; this is
   * the fallback so `contentToBase64` above is never left dangling.
   */
  utf8ToBase64(str) {
    return bytesToBase64(new TextEncoder().encode(str));
  }
}

/**
 * GitHub Semantic Provider Implementation
 */
export class GitHubSemanticProvider extends SemanticProvider {
  constructor(config) {
    super({
      name: 'GitHub',
      rootUrl: `https://api.github.com/repos/${config.user}/${config.repo}/contents`,
      authMechanism: 'oauth',
      ...config
    });
    
    this.user = config.user;
    this.repo = config.repo;
    this.token = config.token;
    this.semanticPath = config.semanticPath || 'schema';
    this.authMethod = config.authMethod || 'oauth';
  }

  // Prefer correct auth scheme for GitHub App tokens
  getAuthHeader() {
    if (!this.token) {
      throw new Error('GitHub provider missing authentication token');
    }

    if (this.authMethod === 'github-app') {
      return `token ${this.token}`;
    }

    // OAuth and legacy tokens still require the historic `token` prefix
    return `token ${this.token}`;
  }

  // UTF-8 safe base64 helpers
  utf8ToBase64(str) {
    try {
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      if (typeof btoa !== 'undefined') return btoa(binary);
      // eslint-disable-next-line no-undef
      return Buffer.from(bytes).toString('base64');
    } catch (e) {
      if (typeof btoa !== 'undefined') return btoa(str);
      // eslint-disable-next-line no-undef
      return Buffer.from(str, 'utf8').toString('base64');
    }
  }

  base64ToUtf8(b64) {
    try {
      let binary;
      if (typeof atob !== 'undefined') {
        binary = atob(b64);
      } else {
        // eslint-disable-next-line no-undef
        binary = Buffer.from(b64, 'base64').toString('binary');
      }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (e) {
      // eslint-disable-next-line no-undef
      return Buffer.from(b64, 'base64').toString('utf8');
    }
  }

  async authenticate() {
    if (!this.token) {
      throw new Error('GitHub token required for authentication');
    }
    return { token: this.token, type: 'oauth' };
  }

  async createSemanticSpace(name) {
    const spacePath = `${this.semanticPath}/${name}`;
    
    // Create initial directory structure
    const structure = this.generateStandardStructure(name);
    
    for (const [path, content] of Object.entries(structure)) {
      await this.writeSemanticFile(`${spacePath}/${path}`, content);
    }

    return {
      name,
      url: `https://github.com/${this.user}/${this.repo}/tree/main/${spacePath}`,
      apiUrl: `${this.rootUrl}/${spacePath}`,
      createdAt: new Date().toISOString()
    };
  }

  async initializeEmptyRepository() {
    try {
      console.log('[GitHubSemanticProvider] Initializing empty repository...');
      console.log('[GitHubSemanticProvider] Repository:', `${this.user}/${this.repo}`);
      console.log('[GitHubSemanticProvider] Semantic path:', this.semanticPath);
      
      // Create the semantic path directory with a README
      const readmeContent = `# Semantic Knowledge Base

This repository contains semantic data for the Redstring UI React application.

## Structure

- \`${this.semanticPath}/\` - Contains semantic files in Turtle (.ttl) format
- \`profile/\` - User profile and preferences
- \`vocabulary/\` - Ontology and schema definitions
- \`federation/\` - Federation and subscription data

## Getting Started

This repository was automatically initialized by Redstring UI React. You can now start adding semantic data through the application interface.
`;

      console.log('[GitHubSemanticProvider] Creating README file...');
      // Write a README at repo root (not inside semantic path)
      await this.writeFileRaw('README.md', readmeContent);
      
      console.log('[GitHubSemanticProvider] Creating standard directory structure...');
      
      // Create the standard directory structure
      const structure = this.generateStandardStructure(`${this.user}-${this.repo}`);
      
      for (const [path, content] of Object.entries(structure)) {
        console.log('[GitHubSemanticProvider] Creating file:', path);
        await this.writeSemanticFile(path, content);
      }
      
      console.log('[GitHubSemanticProvider] Repository initialized successfully');
      return true;
    } catch (error) {
      console.error('[GitHubSemanticProvider] Failed to initialize repository:', error);
      throw error;
    }
  }

  async writeSemanticFile(path, ttlContent) {
    // Don't add .ttl if the path already ends with it
    const fullPath = path.endsWith('.ttl') 
      ? `${this.semanticPath}/${path}`
      : `${this.semanticPath}/${path}.ttl`;
    
    console.log('[GitHubSemanticProvider] Writing file:', fullPath);
    
    try {
      // Check if file exists to get current SHA
      const existingFile = await this.getFileInfo(fullPath);
      
      const requestBody = {
        message: `Update ${path} semantic data`,
        content: this.utf8ToBase64(ttlContent)
      };
      
      // Only include SHA if file exists (for updates)
      if (existingFile?.sha) {
        requestBody.sha = existingFile.sha;
        console.log('[GitHubSemanticProvider] Updating existing file with SHA:', existingFile.sha.substring(0, 8));
      } else {
        console.log('[GitHubSemanticProvider] Creating new file');
      }
      
      const response = await githubAPI.requestWithRetry(`${this.rootUrl}/${fullPath}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      console.log('[GitHubSemanticProvider] Write response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[GitHubSemanticProvider] Write failed:', response.status, errorText);
        
        // Handle 409 conflict by retrying with fresh SHA
        if (response.status === 409) {
          console.log('[GitHubSemanticProvider] 409 conflict detected, retrying with fresh SHA...');
          
          // Retry up to 3 times with exponential backoff
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              // Wait a bit before retrying (exponential backoff)
              if (attempt > 1) {
                const delay = Math.pow(2, attempt - 1) * 100; // 100ms, 200ms, 400ms
                console.log(`[GitHubSemanticProvider] Retry attempt ${attempt}, waiting ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
              
              // Get fresh file info
              const freshFile = await this.getFileInfo(fullPath);
              if (freshFile?.sha) {
                requestBody.sha = freshFile.sha;
                console.log(`[GitHubSemanticProvider] Retry attempt ${attempt} with fresh SHA:`, freshFile.sha.substring(0, 8));
                
                const retryResponse = await fetch(`${this.rootUrl}/${fullPath}`, {
                  method: 'PUT',
                  headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(requestBody)
                });
                
                if (retryResponse.ok) {
                  const retryResult = await retryResponse.json();
                  console.log(`[GitHubSemanticProvider] File written successfully after retry attempt ${attempt}:`, path);
                  return retryResult;
                } else if (retryResponse.status !== 409) {
                  // If it's not a 409, don't retry further
                  const retryErrorText = await retryResponse.text();
                  throw new Error(`GitHub API error (retry): ${retryResponse.status} - ${retryErrorText}`);
                }
                
                // If it's still 409, continue to next attempt
                console.log(`[GitHubSemanticProvider] Retry attempt ${attempt} still got 409, trying again...`);
              }
            } catch (retryError) {
              if (attempt === 3) {
                // Last attempt failed
                throw retryError;
              }
              console.log(`[GitHubSemanticProvider] Retry attempt ${attempt} failed:`, retryError.message);
            }
          }
          
          // All retries failed
          throw new Error(`GitHub API error: Failed after 3 retry attempts - ${errorText}`);
        }
        
        throw new Error(`GitHub API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[GitHubSemanticProvider] File written successfully:', path);
      return result;
    } catch (error) {
      console.error('[GitHubSemanticProvider] Write failed:', error);
      throw error;
    }
  }

  async readSemanticFile(path) {
    // Don't add .ttl if the path already ends with it
    const fullPath = path.endsWith('.ttl')
      ? `${this.semanticPath}/${path}`
      : `${this.semanticPath}/${path}.ttl`;

    try {
      // Share the one verified reader: a .ttl past 1MB hits the same contents
      // API cliff, and decoding an empty `content` field to '' silently is how
      // a large file reads as an empty one.
      const { content } = await this.readFileRawWithMeta(fullPath);
      return content;
    } catch (error) {
      console.error('[GitHubProvider] Read failed:', error);
      throw error;
    }
  }

  async listDirectoryContents(dirPath = '') {
    const { displayPath, apiPath } = this.resolvePathInput(dirPath);
    const resolvedLabel = displayPath || 'root';

    try {
      const url = apiPath ? `${this.rootUrl}/${apiPath}` : `${this.rootUrl}/`;

      const headers = {
        'Authorization': this.getAuthHeader(),
        'Accept': 'application/vnd.github.v3+json'
      };

      console.log(`[GitHubSemanticProvider] Checking for universes in: ${resolvedLabel}`);

      // Use direct fetch instead of githubRateLimiter to avoid import issues
      const response = await fetch(url, { cache: NO_HTTP_CACHE, headers });

      if (response.status === 404) {
        console.log(`[GitHubSemanticProvider] Directory '${resolvedLabel}' not found (expected during discovery)`);
        return []; // Directory doesn't exist
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // GitHub returns an array for directory contents
      if (!Array.isArray(data)) {
        return []; // Not a directory
      }

      const suspiciousNames = new Set(['[object Object]', 'object Object']);

      const normalizedItems = data.map(item => {
        const safePath = this.normalizePathInput(item.path).replace(/^\/+/, '').replace(/\/+$/, '');
        const name = typeof item.name === 'string' ? item.name : '';
        if (
          !name ||
          suspiciousNames.has(name.trim()) ||
          (safePath && (safePath.includes('[object Object]') || safePath.includes('object Object')))
        ) {
          return null;
        }

        return {
          name,
          type: item.type, // 'file' or 'dir'
          path: safePath,
          size: item.size,
          sha: item.sha
        };
      }).filter(Boolean);

      return normalizedItems;

    } catch (error) {
      console.error(`[GitHubSemanticProvider] Failed to list directory ${resolvedLabel}:`, error);
      return [];
    }
  }

  async commitChanges(message, files) {
    // GitHub automatically commits on each file write
    // This method is for batch operations if needed
    return Promise.resolve();
  }

  async exportFullGraph() {
    const archive = {
      provider: 'github',
      user: this.user,
      repo: this.repo,
      exportedAt: new Date().toISOString(),
      files: {}
    };

    // Recursively fetch all semantic files
    const files = await this.listSemanticFiles();
    
    for (const file of files) {
      if (file.path.startsWith(this.semanticPath) && file.path.endsWith('.ttl')) {
        const content = await this.readSemanticFile(file.path.replace(`${this.semanticPath}/`, '').replace('.ttl', ''));
        archive.files[file.path] = content;
      }
    }

    return archive;
  }

  async importFullGraph(archive) {
    if (archive.provider !== 'github') {
      throw new Error('Archive is not from GitHub provider');
    }

    for (const [path, content] of Object.entries(archive.files)) {
      const relativePath = path.replace(`${this.semanticPath}/`, '').replace('.ttl', '');
      await this.writeSemanticFile(relativePath, content);
    }
  }

  async isAvailable() {
    // Record the reason on each false-return so callers (and the on-screen
    // sync diagnostic panel) can surface *why* the provider is unavailable —
    // otherwise the failure looks identical for missing token, 401, 404, 403,
    // and network errors.
    try {
      if (!this.token || String(this.token).trim().length === 0) {
        this.lastUnavailableReason = 'No auth token on provider';
        return false;
      }

      await githubRateLimiter.waitForAvailability(this.authMethod);

      const repoUrl = `https://api.github.com/repos/${this.user}/${this.repo}`;
      githubRateLimiter.recordRequest(this.authMethod);
      const response = await fetch(repoUrl, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      // GitHub returns different identifying headers depending on the auth
      // method: OAuth/PAT tokens get x-github-user-login + x-oauth-scopes;
      // GitHub App installation tokens get x-github-installation-id (no user,
      // because installs aren't user-scoped). Capture all of them so we can
      // distinguish "wrong OAuth scope" from "App not installed on this repo"
      // from "completely unauthenticated."
      const grantedScopes = response.headers.get('x-oauth-scopes');
      const acceptedScopes = response.headers.get('x-accepted-oauth-scopes');
      const tokenUserLogin = response.headers.get('x-github-user-login');
      const installationId = response.headers.get('x-github-installation-id');
      const requestId = response.headers.get('x-github-request-id');
      const authPrefix = (this.getAuthHeader?.() || '').split(' ')[0] || '?';
      const tokenLen = this.token ? String(this.token).length : 0;
      // First 4 chars of the token identify its *type* (ghs_=App installation,
      // gho_=OAuth, ghp_=classic PAT, github_pat_=fine-grained). Not sensitive.
      const tokenKind = this.token ? String(this.token).slice(0, 4) : '?';
      const tokenContext = `[auth method=${this.authMethod || '?'} prefix='${authPrefix}' tokenKind=${tokenKind} tokenLen=${tokenLen} user=${tokenUserLogin || '?'} install=${installationId || '?'} scopes=${grantedScopes || '?'} reqId=${requestId || '?'}]`;

      if (response.ok) {
        this.lastUnavailableReason = null;
        this.lastTokenContext = tokenContext;
        return true;
      }

      // Try to pull GitHub's own error message — it's usually specific
      // (e.g. "Bad credentials", "Not Found", "Resource not accessible by integration").
      let apiMessage = null;
      try {
        const body = await response.json();
        apiMessage = body?.message || null;
      } catch { /* body not JSON */ }

      const where = `${this.user}/${this.repo}`;
      if (response.status === 404) {
        this.lastUnavailableReason = `404 Not Found for ${where} ${tokenContext}${apiMessage ? ` — ${apiMessage}` : ''} (repo missing OR token lacks access to it; check that token user owns/has access to repo and that 'repo' scope is granted for private repos)`;
      } else if (response.status === 401) {
        this.lastUnavailableReason = `401 Unauthorized for ${where} ${tokenContext}${apiMessage ? ` — ${apiMessage}` : ''} (token rejected — expired, revoked, or wrong type)`;
      } else if (response.status === 403) {
        this.lastUnavailableReason = `403 Forbidden for ${where} ${tokenContext}${apiMessage ? ` — ${apiMessage}` : ''} (token lacks the required scope/permission, or app install not granted to this repo)`;
      } else {
        this.lastUnavailableReason = `${response.status} ${response.statusText} for ${where} ${tokenContext}${apiMessage ? ` — ${apiMessage}` : ''}`;
      }
      this.lastTokenContext = tokenContext;
      console.warn(`[GitHubSemanticProvider] ${this.lastUnavailableReason}`);
      return false;
    } catch (error) {
      this.lastUnavailableReason = `fetch threw: ${error?.name || 'Error'} — ${error?.message || String(error)}`;
      console.error('[GitHubSemanticProvider] isAvailable error:', error);
      return false;
    }
  }

  async getStatus() {
    const isAvailable = await this.isAvailable();
    return {
      provider: 'github',
      available: isAvailable,
      user: this.user,
      repo: this.repo,
      semanticPath: this.semanticPath,
      lastChecked: new Date().toISOString()
    };
  }

  // Helper methods
  //
  // Returns:
  //   { exists: false }                       — confirmed 404 (file does not exist)
  //   { exists: true, info: <fileInfo> }      — confirmed file exists, with sha
  //   { exists: 'unknown', status, message }  — could NOT determine existence
  //                                              (401/403/5xx/network). Caller
  //                                              should treat as "unknown",
  //                                              NOT "doesn't exist", to avoid
  //                                              PUTting without a sha and
  //                                              getting 422 sha-missing.
  //
  // Legacy callers expecting the file object directly should use getFileInfo()
  // which preserves the null-on-not-found contract but THROWS on auth errors.
  async probeFile(path, { ref = null } = {}) {
    const { apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) {
      return { exists: false };
    }
    // `?ref=` selects a revision. Absent, GitHub answers with the default
    // branch tip, which is the behaviour every existing caller expects.
    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : '';

    // Use raw fetch here, not githubAPI.request, because the wrapper throws on
    // ALL non-2xx responses (including 404). For a probe we MUST see the
    // status code: 404 → file doesn't exist (safe to create), 401/403/5xx →
    // we can't determine existence (refuse to PUT without sha).
    let response;
    try {
      response = await fetch(`${this.rootUrl}/${apiPath}${refQuery}`, {
        cache: NO_HTTP_CACHE,
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/vnd.github.v3+json'
        }
      });
    } catch (networkError) {
      return {
        exists: 'unknown',
        status: 0,
        message: `network: ${networkError?.message || networkError}`
      };
    }

    if (response.status === 404) {
      return { exists: false };
    }

    if (response.ok) {
      try {
        const info = await response.json();
        return { exists: true, info };
      } catch (parseError) {
        return {
          exists: 'unknown',
          status: response.status,
          message: `parse error: ${parseError?.message || parseError}`
        };
      }
    }

    // 401/403/5xx — file may or may not exist; we just can't see it.
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch { /* body not JSON */ }
    return {
      exists: 'unknown',
      status: response.status,
      message
    };
  }

  async getFileInfo(path, { ref = null } = {}) {
    const probe = await this.probeFile(path, { ref });
    if (probe.exists === true) return probe.info;
    if (probe.exists === false) return null;
    // 'unknown' — auth error or transient. Throw so writeFileRaw won't
    // silently fall through to a PUT-without-sha and trigger 422.
    this._maybeDispatchAuthExpired(probe.status);
    const err = new Error(`getFileInfo(${path}) status=${probe.status}: ${probe.message}`);
    err.code = 'FILE_INFO_UNKNOWN';
    err.status = probe.status;
    throw err;
  }

  /**
   * Dispatches the re-authentication event on a 401 probe result. The PUT
   * path already does this, but with GitHub App tokens (~1h expiry) the
   * FIRST failure after expiry is always the pre-write probe — without this,
   * the auth-expired dialog is unreachable from the common failure path and
   * the engine just cycles through error backoff with a dead token.
   */
  _maybeDispatchAuthExpired(status) {
    if (status !== 401) return;
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('redstring:auth-expired', {
          detail: {
            error: '401 Bad credentials',
            authMethod: this.authMethod,
            message: 'GitHub authentication expired. Please re-connect.'
          }
        }));
      }
    } catch { /* noop */ }
  }

  /**
   * Replaces the provider's token in place. Used by token-refresh flows so a
   * long-lived engine doesn't keep failing with a token that expired an hour
   * into the session.
   */
  updateToken(token) {
    if (token && typeof token === 'string') {
      this.token = token;
      console.log('[GitHubSemanticProvider] Token updated in place');
    }
  }

  async writeFileRaw(path, content, options = {}) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) {
      throw new Error('Invalid path provided to writeFileRaw');
    }

    // Optimistic-concurrency mode: the caller supplies the SHA it believes is
    // current (from its last read/write). We PUT with exactly that SHA and
    // NEVER retry with a re-fetched one — a mismatch means another writer
    // moved the remote, and blindly re-PUTting would overwrite their work.
    // `expectedSha: null` asserts "the file should not exist yet".
    if ('expectedSha' in options) {
      return this._writeWithExpectedSha(safePath, apiPath, content, options.expectedSha);
    }

    try {
      // AGGRESSIVE RATE LIMITING: Check and enforce stricter limits
      await githubRateLimiter.waitForAvailability(this.authMethod);
      
      // Additional rate limiting: Prevent identical content writes
      const contentHash = this.generateContentHash(content);
      const cacheKey = `${safePath}_${contentHash}`;
      const lastWrite = this.lastWrites?.get?.(cacheKey);
      const now = Date.now();
      
      if (lastWrite && (now - lastWrite) < 1500) {
        console.log(`[GitHubSemanticProvider] Redundant write prevented for ${safePath} (identical content within 1.5s)`);
        return { message: 'Redundant write prevented' };
      }
      
      // Initialize lastWrites cache if needed
      if (!this.lastWrites) {
        this.lastWrites = new Map();
      }
      
      // First try to get the current file info to get the latest SHA.
      // probeFile distinguishes 404 (file missing → safe to create) from
      // 401/403/5xx (we just can't see it → MUST surface so we don't PUT
      // without a sha and get 422 sha-missing on a file that actually exists).
      githubRateLimiter.recordRequest(this.authMethod);
      const probe = await this.probeFile(safePath);
      if (probe.exists === 'unknown') {
        const err = new Error(`[GitHubSemanticProvider] Cannot determine if ${safePath} exists (status ${probe.status}: ${probe.message}). Refusing to PUT without sha — this would corrupt an existing file if the token simply can't see it.`);
        err.code = 'FILE_INFO_UNKNOWN';
        err.status = probe.status;
        throw err;
      }
      const existingFile = probe.exists ? probe.info : null;

      const body = {
        message: `Update ${safePath}`,
        content: this.contentToBase64(content)
      };

      // Only include SHA if we have a valid existing file
      if (existingFile?.sha) {
        body.sha = existingFile.sha;
        console.log(`[GitHubSemanticProvider] OVERWRITER: Updating ${safePath} with SHA: ${existingFile.sha.substring(0, 8)}`);
      } else {
        console.log(`[GitHubSemanticProvider] OVERWRITER: Creating new file ${safePath}`);
      }

      // Record the main request
      githubRateLimiter.recordRequest(this.authMethod);
      
      const response = await fetch(`${this.rootUrl}/${apiPath}`, {
        method: 'PUT',
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text();
        
        // Handle 401 authentication errors - token expired or invalid
        if (response.status === 401) {
          console.error('[GitHubSemanticProvider] 401 Authentication failed - token expired or revoked');
          
          // Emit event to trigger re-authentication
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('redstring:auth-expired', {
              detail: { 
                error: '401 Bad credentials',
                authMethod: this.authMethod,
                message: 'GitHub authentication expired. Please re-connect.'
              }
            }));
          }
          
          // Try to clear the invalid token
          try {
            const { persistentAuth } = await import('./persistentAuth.js');
            if (this.authMethod === 'github-app') {
              if (typeof persistentAuth.clearAppInstallation === 'function') {
                await persistentAuth.clearAppInstallation();
              }
            } else {
              if (typeof persistentAuth.clearTokens === 'function') {
                await persistentAuth.clearTokens();
              }
            }
          } catch (error) {
            console.warn('[GitHubSemanticProvider] Failed to clear invalid tokens:', error);
          }
          
          throw new Error(`GitHub authentication failed (401). Please reconnect in the Git Federation panel.`);
        }
        
        // Handle 409 conflict AND 422 "sha wasn't supplied" the same way.
        // 409 = the SHA we supplied is stale (file changed under us).
        // 422 sha-missing = we supplied no SHA, but GitHub knows the file
        // exists (often because getFileInfo silently returned null on a
        // transient error, masking an existing file). Same fix in both
        // cases: refetch the file's current SHA and PUT again.
        const isShaMissing422 = response.status === 422 && /\bsha\b/i.test(text || '');
        if (response.status === 409 || isShaMissing422) {
          const reason = isShaMissing422 ? '422 sha-missing' : '409 conflict';
          console.log(`[GitHubSemanticProvider] ${reason} for ${safePath}, using AGGRESSIVE backoff...`);
          
          // Retry up to 3 times with reasonable exponential backoff
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              // Reasonable backoff: 1s, 3s, 9s - responsive but prevents conflicts
              const backoffDelay = Math.min(1000 * Math.pow(3, attempt - 1), 9000);
              console.log(`[GitHubSemanticProvider] Retry ${attempt} for ${safePath}, waiting ${backoffDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
              
              // Check rate limit before retry
              await githubRateLimiter.waitForAvailability(this.authMethod);
              
              // Get fresh file info via probe so auth errors surface explicitly
              // rather than masquerading as "doesn't exist".
              githubRateLimiter.recordRequest(this.authMethod);
              const freshProbe = await this.probeFile(safePath);
              if (freshProbe.exists === 'unknown') {
                const probeErr = new Error(`Retry probe ${attempt} could not see ${safePath} (status ${freshProbe.status}: ${freshProbe.message}) — likely auth issue. Bailing.`);
                probeErr.code = 'FILE_INFO_UNKNOWN';
                probeErr.status = freshProbe.status;
                throw probeErr;
              }
              const freshFile = freshProbe.exists ? freshProbe.info : null;
              if (freshFile?.sha) {
                body.sha = freshFile.sha;
                console.log(`[GitHubSemanticProvider] Retry ${attempt} with fresh SHA: ${freshFile.sha.substring(0, 8)}`);
                
                githubRateLimiter.recordRequest(this.authMethod);
                const retryResponse = await fetch(`${this.rootUrl}/${apiPath}`, {
                  method: 'PUT',
                  headers: {
                    'Authorization': this.getAuthHeader(),
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(body)
                });
                
                if (retryResponse.ok) {
                  console.log(`[GitHubSemanticProvider] OVERWRITER conflict resolved on attempt ${attempt}`);
                  // Cache successful write
                  this.lastWrites.set(cacheKey, now);
                  return await retryResponse.json();
                } else if (retryResponse.status !== 409) {
                  // Different error, don't retry further
                  const retryText = await retryResponse.text();
                  throw new Error(`GitHub OVERWRITER retry failed: ${retryResponse.status} ${retryText}`);
                }
                
                // Still 409, continue to next attempt
                console.log(`[GitHubSemanticProvider] Attempt ${attempt} still got 409, continuing with longer backoff...`);
              } else {
                throw new Error('Could not get fresh SHA for OVERWRITER retry');
              }
            } catch (retryError) {
              if (attempt === 3) {
                // Last attempt failed
                throw new Error(`GitHub OVERWRITER failed after ${attempt} aggressive attempts: ${retryError.message}`);
              }
              console.warn(`[GitHubSemanticProvider] AGGRESSIVE retry ${attempt} failed:`, retryError.message);
            }
          }
          
          // All retries exhausted
          throw new Error(`GitHub OVERWRITER failed after 3 aggressive retry attempts`);
        }
        
        throw new Error(`GitHub OVERWRITER failed: ${response.status} ${text}`);
      }
      
      // Cache successful write
      this.lastWrites.set(cacheKey, now);
      console.log(`[GitHubSemanticProvider] OVERWRITER write successful for ${safePath}`);
      return await response.json();
    } catch (e) {
      console.error('[GitHubSemanticProvider] OVERWRITER writeFileRaw failed:', e);
      throw e;
    }
  }

  /**
   * PUT with a caller-asserted SHA (optimistic concurrency).
   *
   * On 409 (stale SHA) or 422 sha-mismatch/sha-missing, throws a typed
   * REMOTE_DIVERGED error instead of retrying — the caller must pull, compare,
   * and decide. This is the only honest behavior when multiple devices write
   * the same file.
   *
   * @private
   */
  async _writeWithExpectedSha(safePath, apiPath, content, expectedSha) {
    await githubRateLimiter.waitForAvailability(this.authMethod);

    const body = {
      message: `Update ${safePath}`,
      content: this.contentToBase64(content)
    };
    if (typeof expectedSha === 'string' && expectedSha) {
      body.sha = expectedSha;
    }

    githubRateLimiter.recordRequest(this.authMethod);
    const response = await fetch(`${this.rootUrl}/${apiPath}`, {
      method: 'PUT',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      if (!this.lastWrites) this.lastWrites = new Map();
      this.lastWrites.set(`${safePath}_${this.generateContentHash(content)}`, Date.now());
      return await response.json();
    }

    const text = await response.text();

    if (response.status === 401) {
      this._maybeDispatchAuthExpired(401);
      throw new Error('GitHub authentication failed (401). Please reconnect in the Git Federation panel.');
    }

    const isShaProblem422 = response.status === 422 && /\bsha\b/i.test(text || '');
    if (response.status === 409 || isShaProblem422) {
      console.warn(`[GitHubSemanticProvider] Remote diverged for ${safePath} (expected SHA ${expectedSha ? String(expectedSha).substring(0, 8) : 'none'}) — NOT retrying blindly`);
      const err = new Error(`Remote file changed since last sync: ${safePath}`);
      err.code = 'REMOTE_DIVERGED';
      err.status = response.status;
      throw err;
    }

    throw new Error(`GitHub write failed: ${response.status} ${text}`);
  }

  /**
   * Read a file as raw bytes.
   *
   * Uses the raw media type rather than the contents API's base64 field: it
   * sidesteps the 1MB JSON cliff entirely (full-resolution photographs are
   * routinely past it) and skips a base64 decode we'd only have to undo.
   *
   * @param {string} path
   * @returns {Promise<Uint8Array>}
   * @throws {Error} with `code: 'FILE_NOT_FOUND'` on 404
   */
  async readBinaryFile(path) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) throw new Error('Invalid path provided to readBinaryFile');

    await githubRateLimiter.waitForAvailability(this.authMethod);
    githubRateLimiter.recordRequest(this.authMethod);

    const response = await fetch(`${this.rootUrl}/${apiPath}`, {
      cache: NO_HTTP_CACHE,
      headers: {
        'Authorization': this.getAuthHeader(),
        'Accept': 'application/vnd.github.raw'
      }
    });

    if (response.status === 404) {
      const err = new Error(`File not found: ${safePath}`);
      err.code = 'FILE_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    if (!response.ok) {
      const err = new Error(`GitHub binary read failed for ${safePath}: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Read a file and return `{ content, sha, size }`.
   *
   * Handles the GitHub contents-API 1MB cliff: for files between 1MB and
   * 100MB the JSON response has `"content": "", "encoding": "none"` — which
   * MUST NOT be interpreted as an empty file (that misread was capable of
   * making a grown universe look empty and getting it overwritten). Falls
   * back to a raw-media-type fetch for the actual bytes.
   */
  async readFileRawWithMeta(path, { ref = null } = {}) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const info = await this.getFileInfo(safePath, { ref });
    if (!info) {
      console.log(`[GitHubSemanticProvider] File not found: ${safePath}`);
      const err = new Error(`File not found: ${safePath}`);
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }

    const size = typeof info.size === 'number' ? info.size : 0;
    const truncated = (info.encoding === 'none') || (size > 0 && (!info.content || info.content === ''));

    if (!truncated) {
      // Measure the base64-decoded BYTES, then decode to text. Re-encoding the
      // decoded string would be wrong: TextDecoder strips a leading BOM, so a
      // legitimate BOM-prefixed file would look three bytes short.
      const bytes = base64ToBytes(info.content);
      const decoded = new TextDecoder().decode(bytes);
      assertRawBodyMatches(decoded, size, safePath, bytes.length);
      return { content: decoded, sha: info.sha, size };
    }

    console.log(`[GitHubSemanticProvider] Contents API truncated ${safePath} (${size} bytes) — fetching raw`);
    githubRateLimiter.recordRequest(this.authMethod);
    const rawResponse = await fetch(`${this.rootUrl}/${apiPath}${refQuery}`, {
      cache: NO_HTTP_CACHE,
      headers: {
        'Authorization': this.getAuthHeader(),
        // Plain `vnd.github.raw`, matching readBinaryFile. The `+json` variant
        // reads as a JSON media type, which makes a cached JSON envelope an
        // even likelier match for this request.
        'Accept': 'application/vnd.github.raw'
      }
    });
    if (!rawResponse.ok) {
      // NEVER degrade to "empty file" — the file demonstrably has bytes.
      throw readTruncated(`Raw fetch failed for ${safePath} (${size} bytes reported, HTTP ${rawResponse.status})`);
    }

    // A raw read must not come back as JSON. If it does, we were served the
    // contents envelope (from a cache, or by a proxy that rewrote Accept).
    const contentType = rawResponse.headers?.get?.('content-type') || '';
    if (/^application\/json/i.test(contentType)) {
      throw readTruncated(`Raw fetch for ${safePath} answered with a JSON envelope (content-type ${contentType})`);
    }

    // Read as bytes so the length check sees what the server actually sent.
    const { content, byteLength } = await responseToTextWithBytes(rawResponse);
    assertRawBodyMatches(content, size, safePath, byteLength);
    return { content, sha: info.sha, size };
  }

  /**
   * Every revision of one file, newest first. See the base class for why.
   *
   * Two request shapes, both under the Contents permission the app already
   * holds — no new scope, no re-consent:
   *   - one call to list the commits that touched this path
   *   - one small call per revision for its size (the contents endpoint
   *     reports size in metadata and omits content above 1MB, so this stays
   *     cheap even for a multi-megabyte universe)
   */
  async listFileHistory(path, { limit = 20, withSize = true } = {}) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) throw new Error('Invalid path provided to listFileHistory');

    // rootUrl ends in /contents; commits live beside it on the repo root.
    const repoUrl = this.rootUrl.replace(/\/contents$/, '');
    const url = `${repoUrl}/commits?path=${encodeURIComponent(safePath)}&per_page=${Math.max(1, Math.min(100, limit))}`;

    await githubRateLimiter.waitForAvailability(this.authMethod);
    githubRateLimiter.recordRequest(this.authMethod);

    const response = await fetch(url, {
      cache: NO_HTTP_CACHE,
      headers: {
        'Authorization': this.getAuthHeader(),
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (response.status === 404) {
      const err = new Error(`File not found: ${safePath}`);
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }
    if (!response.ok) {
      const err = new Error(`Could not read the history of ${safePath}: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const commits = await response.json();
    if (!Array.isArray(commits)) return [];

    const revisions = commits.map((commit) => ({
      sha: commit?.sha,
      date: commit?.commit?.author?.date || commit?.commit?.committer?.date || null,
      message: (commit?.commit?.message || '').split('\n')[0],
      size: null
    })).filter((revision) => !!revision.sha);

    if (!withSize) return revisions;

    // Sizes are fetched in series on purpose: the rate limiter enforces a
    // minimum gap between calls anyway, and a burst here would stall real
    // saves queued behind it. A revision whose size cannot be read keeps
    // `size: null`, which reads as "unknown" rather than "empty".
    for (const revision of revisions) {
      try {
        const info = await this.getFileInfo(safePath, { ref: revision.sha });
        revision.size = typeof info?.size === 'number' ? info.size : null;
      } catch (error) {
        console.warn(`[GitHubSemanticProvider] Could not size ${safePath} at ${revision.sha?.slice(0, 8)}:`, error?.message || error);
      }
    }

    return revisions;
  }

  async readFileRaw(path, options) {
    try {
      const { content } = await this.readFileRawWithMeta(path, options);
      return content;
    } catch (e) {
      // Only log as error if it's not a "file not found" error
      if (e.message && e.message.includes('File not found')) {
        // Re-throw without additional error logging since this is expected
        throw e;
      } else {
        console.error('[GitHubSemanticProvider] readFileRaw failed:', e);
        throw e;
      }
    }
  }

  async listSemanticFiles() {
    try {
      const response = await fetch(`${this.rootUrl}/${this.semanticPath}`, {
        cache: NO_HTTP_CACHE,
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      // If 404, the semantic path doesn't exist (empty repo or no schema folder)
      if (response.status === 404) {
        return [];
      }
      
      if (!response.ok) {
        // console.error('[GitHubSemanticProvider] listSemanticFiles error:', response.status, response.statusText);
        return [];
      }
      
      return await response.json();
    } catch (error) {
      // console.error('[GitHubSemanticProvider] listSemanticFiles error:', error);
      return [];
    }
  }

  generateStandardStructure(spaceName) {
    return {
      'profile/webid.ttl': `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix schema: <http://schema.org/> .

<#me> a foaf:Person ;
    foaf:name "${spaceName} Owner" ;
    schema:url <https://github.com/${this.user}/${this.repo}> .`,
      
      'profile/preferences.ttl': `@prefix pref: <https://redstring.io/vocab/preferences/> .

pref:DisplaySettings a pref:Settings ;
    pref:theme "dark" ;
    pref:language "en" .`,
      
      'vocabulary/schemas/core-schema.ttl': `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

<#Concept> a owl:Class ;
    rdfs:label "Concept" ;
    rdfs:comment "A semantic concept in the knowledge space" .`,
      
      'federation/subscriptions.ttl': `@prefix fed: <https://redstring.io/vocab/federation/> .

fed:Subscriptions a fed:SubscriptionList ;
    fed:lastUpdated "${new Date().toISOString()}" .`,
      
      'federation/permissions.ttl': `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

acl:DefaultPermissions a acl:AccessControl ;
    acl:mode acl:Read ;
    acl:agentClass foaf:Agent .`
    };
  }
}

/**
 * Self-Hosted Gitea Provider Implementation
 */
export class GiteaSemanticProvider extends SemanticProvider {
  constructor(config) {
    super({
      name: 'Self-Hosted Gitea',
      rootUrl: `${config.endpoint}/api/v1/repos/${config.user}/${config.repo}/contents`,
      authMechanism: 'token',
      ...config
    });
    
    this.endpoint = config.endpoint;
    this.user = config.user;
    this.repo = config.repo;
    this.token = config.token;
    this.semanticPath = config.semanticPath || 'schema';
  }

  // UTF-8 safe base64 helpers (match GitHub implementation)
  utf8ToBase64(str) {
    try {
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      if (typeof btoa !== 'undefined') return btoa(binary);
      // eslint-disable-next-line no-undef
      return Buffer.from(bytes).toString('base64');
    } catch (e) {
      if (typeof btoa !== 'undefined') return btoa(str);
      // eslint-disable-next-line no-undef
      return Buffer.from(str, 'utf8').toString('base64');
    }
  }

  base64ToUtf8(b64) {
    try {
      let binary;
      if (typeof atob !== 'undefined') {
        binary = atob(b64);
      } else {
        // eslint-disable-next-line no-undef
        binary = Buffer.from(b64, 'base64').toString('binary');
      }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (e) {
      // eslint-disable-next-line no-undef
      return Buffer.from(b64, 'base64').toString('utf8');
    }
  }

  async authenticate() {
    if (!this.token) {
      throw new Error('Gitea token required for authentication');
    }
    return { token: this.token, type: 'token' };
  }

  async createSemanticSpace(name) {
    const spacePath = `${this.semanticPath}/${name}`;
    
    // Create initial directory structure
    const structure = this.generateStandardStructure(name);
    
    for (const [path, content] of Object.entries(structure)) {
      await this.writeSemanticFile(`${spacePath}/${path}`, content);
    }

    return {
      name,
      url: `${this.endpoint}/${this.user}/${this.repo}/src/branch/main/${spacePath}`,
      apiUrl: `${this.rootUrl}/${spacePath}`,
      createdAt: new Date().toISOString()
    };
  }

  async writeSemanticFile(path, ttlContent) {
    // Don't add .ttl if the path already ends with it
    const fullPath = path.endsWith('.ttl') 
      ? `${this.semanticPath}/${path}`
      : `${this.semanticPath}/${path}.ttl`;
    
    try {
      // Determine if file exists to choose POST (create) vs PUT (update)
      const fileInfo = await this.getFileInfo(fullPath);
      const method = fileInfo?.sha ? 'PUT' : 'POST';
      const response = await fetch(`${this.rootUrl}/${fullPath}`, {
        method,
        headers: {
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Update ${path} semantic data`,
          content: this.utf8ToBase64(ttlContent),
          branch: 'main',
          sha: fileInfo?.sha
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gitea API error: ${response.status} ${text}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[GiteaProvider] Write failed:', error);
      throw error;
    }
  }

  async readSemanticFile(path) {
    // Don't add .ttl if the path already ends with it
    const fullPath = path.endsWith('.ttl') 
      ? `${this.semanticPath}/${path}`
      : `${this.semanticPath}/${path}.ttl`;
    
    try {
      // Share the one verified reader (it also path-encodes properly, which
      // the hand-built URL here did not).
      const { content } = await this.readFileRawWithMeta(fullPath);
      return content;
    } catch (error) {
      console.error('[GiteaProvider] Read failed:', error);
      throw error;
    }
  }

  async commitChanges(message, files) {
    // Gitea automatically commits on each file write
    return Promise.resolve();
  }

  async exportFullGraph() {
    const archive = {
      provider: 'gitea',
      endpoint: this.endpoint,
      user: this.user,
      repo: this.repo,
      exportedAt: new Date().toISOString(),
      files: {}
    };

    // Recursively fetch all semantic files
    const files = await this.listSemanticFiles();
    
    for (const file of files) {
      if (file.path.startsWith(this.semanticPath) && file.path.endsWith('.ttl')) {
        const content = await this.readSemanticFile(file.path.replace(`${this.semanticPath}/`, '').replace('.ttl', ''));
        archive.files[file.path] = content;
      }
    }

    return archive;
  }

  async importFullGraph(archive) {
    if (archive.provider !== 'gitea') {
      throw new Error('Archive is not from Gitea provider');
    }

    for (const [path, content] of Object.entries(archive.files)) {
      const relativePath = path.replace(`${this.semanticPath}/`, '').replace('.ttl', '');
      await this.writeSemanticFile(relativePath, content);
    }
  }

  async isAvailable() {
    try {
      const response = await fetch(`${this.endpoint}/api/v1/version`, {
        headers: {
          'Authorization': `token ${this.token}`
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getStatus() {
    const isAvailable = await this.isAvailable();
    return {
      provider: 'gitea',
      available: isAvailable,
      endpoint: this.endpoint,
      user: this.user,
      repo: this.repo,
      semanticPath: this.semanticPath,
      lastChecked: new Date().toISOString()
    };
  }

  // Helper methods
  async listSemanticFiles() {
    try {
      const response = await fetch(`${this.rootUrl}/${this.semanticPath}?ref=main`, {
        headers: {
          'Authorization': `token ${this.token}`
        }
      });
      
      if (!response.ok) {
        return [];
      }
      
      return await response.json();
    } catch (error) {
      return [];
    }
  }

  /**
   * File metadata, or `null` ONLY when the file is confirmed absent.
   *
   * Previously every failure — 401, 500, a network drop, a parse error —
   * returned `null`, which reads identically to "the file does not exist".
   * Callers then created a fresh empty file on top of data they simply could
   * not see. Matches the GitHub provider's contract now: `null` means 404,
   * anything else throws `FILE_INFO_UNKNOWN`.
   *
   * @throws {Error} with `code: 'FILE_INFO_UNKNOWN'`
   */
  async getFileInfo(path, { ref = null } = {}) {
    const { apiPath, displayPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) return null;

    const unknown = (status, message) => {
      const err = new Error(`getFileInfo(${displayPath}) status=${status}: ${message}`);
      err.code = 'FILE_INFO_UNKNOWN';
      err.status = status;
      return err;
    };

    let response;
    try {
      response = await fetch(`${this.rootUrl}/${apiPath}?ref=${encodeURIComponent(ref || 'main')}`, {
        cache: NO_HTTP_CACHE,
        headers: {
          'Authorization': `token ${this.token}`
        }
      });
    } catch (networkError) {
      throw unknown(0, `network: ${networkError?.message || networkError}`);
    }

    if (response.status === 404) return null;
    if (!response.ok) throw unknown(response.status, response.statusText || `HTTP ${response.status}`);

    try {
      return await response.json();
    } catch (parseError) {
      throw unknown(response.status, `parse error: ${parseError?.message || parseError}`);
    }
  }

  async writeFileRaw(path, content) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) {
      throw new Error('Invalid path provided to writeFileRaw');
    }

    try {
      // Rate limiting: Prevent identical content writes
      const contentHash = this.generateContentHash(content);
      const cacheKey = `${safePath}_${contentHash}`;
      const lastWrite = this.lastWrites?.get?.(cacheKey);
      const now = Date.now();
      
      if (lastWrite && (now - lastWrite) < 1500) {
        console.log(`[GiteaSemanticProvider] Redundant write prevented for ${safePath} (identical content within 1.5s)`);
        return { message: 'Redundant write prevented' };
      }
      
      // Initialize lastWrites cache if needed
      if (!this.lastWrites) {
        this.lastWrites = new Map();
      }
      
      // First try to get the current file info to get the latest SHA
      let fileInfo = null;
      try {
        fileInfo = await this.getFileInfo(safePath);
      } catch (error) {
        // "I could not determine whether this file exists" is NOT "it doesn't".
        // Creating here would POST a new file over one we just failed to read.
        if (error?.code === 'FILE_INFO_UNKNOWN') throw error;
        console.log(`[GiteaSemanticProvider] File ${safePath} doesn't exist, will create new`);
      }

      const method = fileInfo?.sha ? 'PUT' : 'POST';
      const body = {
        message: `Update ${safePath}`,
        content: this.contentToBase64(content),
        branch: 'main'
      };

      // Only include SHA if we have a valid existing file
      if (fileInfo?.sha) {
        body.sha = fileInfo.sha;
        console.log(`[GiteaSemanticProvider] OVERWRITER: Updating ${safePath} with SHA: ${fileInfo.sha.substring(0, 8)}`);
      } else {
        console.log(`[GiteaSemanticProvider] OVERWRITER: Creating new file ${safePath}`);
      }

      const response = await fetch(`${this.rootUrl}/${apiPath}`, {
        method,
        headers: {
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text();
        
        // Handle 409 conflict with aggressive backoff
        if (response.status === 409) {
          console.log(`[GiteaSemanticProvider] 409 conflict for ${safePath}, using AGGRESSIVE backoff...`);
          
          // Retry up to 3 times with reasonable backoff
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              // Reasonable backoff: 1s, 3s, 9s - responsive but prevents conflicts
              const backoffDelay = Math.min(1000 * Math.pow(3, attempt - 1), 9000);
              console.log(`[GiteaSemanticProvider] Retry ${attempt} for ${safePath}, waiting ${backoffDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
              
              // Get the latest SHA and retry
              const freshFile = await this.getFileInfo(safePath);
              if (freshFile?.sha) {
                body.sha = freshFile.sha;
                console.log(`[GiteaSemanticProvider] Retry ${attempt} with fresh SHA: ${freshFile.sha.substring(0, 8)}`);
                
                const retryResponse = await fetch(`${this.rootUrl}/${apiPath}`, {
                  method: 'PUT',
                  headers: {
                    'Authorization': `token ${this.token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(body)
                });
                
                if (retryResponse.ok) {
                  console.log(`[GiteaSemanticProvider] OVERWRITER conflict resolved on attempt ${attempt}`);
                  // Cache successful write
                  this.lastWrites.set(cacheKey, now);
                  return await retryResponse.json();
                } else if (retryResponse.status !== 409) {
                  // Different error, don't retry further
                  const retryText = await retryResponse.text();
                  throw new Error(`Gitea OVERWRITER retry failed: ${retryResponse.status} ${retryText}`);
                }
                
                // Still 409, continue to next attempt
                console.log(`[GiteaSemanticProvider] Attempt ${attempt} still got 409, continuing with longer backoff...`);
              } else {
                throw new Error('Could not get fresh SHA for OVERWRITER retry');
              }
            } catch (retryError) {
              if (attempt === 3) {
                // Last attempt failed
                throw new Error(`Gitea OVERWRITER failed after ${attempt} aggressive attempts: ${retryError.message}`);
              }
              console.warn(`[GiteaSemanticProvider] AGGRESSIVE retry ${attempt} failed:`, retryError.message);
            }
          }
          
          // All retries exhausted
          throw new Error(`Gitea OVERWRITER failed after 3 aggressive retry attempts`);
        }
        
        throw new Error(`Gitea OVERWRITER failed: ${response.status} ${text}`);
      }
      
      // Cache successful write
      this.lastWrites.set(cacheKey, now);
      console.log(`[GiteaSemanticProvider] OVERWRITER write successful for ${safePath}`);
      return await response.json();
    } catch (e) {
      console.error('[GiteaSemanticProvider] OVERWRITER writeFileRaw failed:', e);
      throw e;
    }
  }

  /**
   * Read a file as raw bytes.
   *
   * Gitea's contents API returns base64 in JSON like GitHub's, but it also
   * serves the bytes directly from `/raw/`, which avoids decoding a
   * multi-megabyte base64 string just to re-encode it into a Blob.
   *
   * @param {string} path
   * @returns {Promise<Uint8Array>}
   * @throws {Error} with `code: 'FILE_NOT_FOUND'` on 404
   */
  async readBinaryFile(path) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) throw new Error('Invalid path provided to readBinaryFile');

    const response = await fetch(`${this.rootUrl}/${apiPath}`, {
      cache: NO_HTTP_CACHE,
      headers: {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/octet-stream'
      }
    });

    if (response.status === 404) {
      const err = new Error(`File not found: ${safePath}`);
      err.code = 'FILE_NOT_FOUND';
      err.status = 404;
      throw err;
    }
    if (!response.ok) {
      const err = new Error(`Gitea binary read failed for ${safePath}: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const buffer = await response.arrayBuffer();
    // Gitea may answer the contents endpoint with the JSON envelope rather than
    // the bytes; detect that and take the base64 field instead of handing a
    // JSON document to the image decoder.
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const info = JSON.parse(new TextDecoder().decode(buffer));
      if (!info?.content) {
        const err = new Error(`File not found: ${safePath}`);
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      const binary = atob(info.content.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }

    return new Uint8Array(buffer);
  }

  /**
   * Read a file and return `{ content, sha, size }`, verified.
   *
   * Mirrors the GitHub provider's contract so the sync engine's first-contact
   * check, `_commitToRemote` and `loadFromGit` work against Gitea too — they
   * all call `readFileRawWithMeta`, and its absence here meant self-hosted
   * universes fell through to an unverified read.
   */
  async readFileRawWithMeta(path, { ref = null } = {}) {
    const { displayPath: safePath } = this.resolvePathInput(path, { trimTrailing: false });
    const info = await this.getFileInfo(safePath, { ref }); // throws FILE_INFO_UNKNOWN on ambiguity
    if (!info) {
      console.log(`[GiteaSemanticProvider] File not found: ${safePath}`);
      const err = new Error(`File not found: ${safePath}`);
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }

    const size = typeof info.size === 'number' ? info.size : 0;
    const truncated = info.encoding === 'none' || (size > 0 && (!info.content || info.content === ''));

    if (!truncated) {
      // Byte length is measured pre-decode; see the GitHub twin for why.
      const bytes = base64ToBytes(info.content);
      const content = new TextDecoder().decode(bytes);
      assertRawBodyMatches(content, size, safePath, bytes.length);
      return { content, sha: info.sha, size };
    }

    // Oversized/omitted content — go get the bytes. readBinaryFile already
    // handles Gitea answering with an envelope instead of octets.
    console.log(`[GiteaSemanticProvider] Contents API truncated ${safePath} (${size} bytes) — fetching raw`);
    const bytes = await this.readBinaryFile(safePath);
    const content = new TextDecoder().decode(bytes);
    assertRawBodyMatches(content, size, safePath, bytes.length);
    return { content, sha: info.sha, size };
  }

  /** Every revision of one file, newest first. See the base class for why. */
  async listFileHistory(path, { limit = 20, withSize = true } = {}) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) throw new Error('Invalid path provided to listFileHistory');

    const repoUrl = this.rootUrl.replace(/\/contents$/, '');
    const url = `${repoUrl}/commits?path=${encodeURIComponent(safePath)}&limit=${Math.max(1, Math.min(100, limit))}`;

    const response = await fetch(url, {
      cache: NO_HTTP_CACHE,
      headers: { 'Authorization': `token ${this.token}` }
    });

    if (response.status === 404) {
      const err = new Error(`File not found: ${safePath}`);
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }
    if (!response.ok) {
      const err = new Error(`Could not read the history of ${safePath}: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const commits = await response.json();
    if (!Array.isArray(commits)) return [];

    const revisions = commits.map((commit) => ({
      sha: commit?.sha,
      date: commit?.commit?.author?.date || commit?.commit?.committer?.date || null,
      message: (commit?.commit?.message || '').split('\n')[0],
      size: null
    })).filter((revision) => !!revision.sha);

    if (!withSize) return revisions;

    for (const revision of revisions) {
      try {
        const info = await this.getFileInfo(safePath, { ref: revision.sha });
        revision.size = typeof info?.size === 'number' ? info.size : null;
      } catch (error) {
        console.warn(`[GiteaSemanticProvider] Could not size ${safePath} at ${revision.sha?.slice(0, 8)}:`, error?.message || error);
      }
    }

    return revisions;
  }

  async readFileRaw(path, options) {
    try {
      const { content } = await this.readFileRawWithMeta(path, options);
      return content;
    } catch (e) {
      // Only log as error if it's not a "file not found" error
      if (e?.code === 'FILE_NOT_FOUND' || (e.message && e.message.includes('File not found'))) {
        // Re-throw without additional error logging since this is expected
        throw e;
      }
      console.error('[GiteaSemanticProvider] readFileRaw failed:', e);
      throw e;
    }
  }

  generateStandardStructure(spaceName) {
    return {
      'profile/webid.ttl': `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix schema: <http://schema.org/> .

<#me> a foaf:Person ;
    foaf:name "${spaceName} Owner" ;
    schema:url <${this.endpoint}/${this.user}/${this.repo}> .`,
      
      'profile/preferences.ttl': `@prefix pref: <https://redstring.io/vocab/preferences/> .

pref:DisplaySettings a pref:Settings ;
    pref:theme "dark" ;
    pref:language "en" .`,
      
      'vocabulary/schemas/core-schema.ttl': `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

<#Concept> a owl:Class ;
    rdfs:label "Concept" ;
    rdfs:comment "A semantic concept in the knowledge space" .`,
      
      'federation/subscriptions.ttl': `@prefix fed: <https://redstring.io/vocab/federation/> .

fed:Subscriptions a fed:SubscriptionList ;
    fed:lastUpdated "${new Date().toISOString()}" .`,
      
      'federation/permissions.ttl': `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

acl:DefaultPermissions a acl:AccessControl ;
    acl:mode acl:Read ;
    acl:agentClass foaf:Agent .`
    };
  }
}

/**
 * Provider Factory
 * Creates provider instances based on configuration
 */
export class SemanticProviderFactory {
  static createProvider(config) {
    switch (config.type) {
      case 'github':
        return new GitHubSemanticProvider(config);
      case 'gitea':
        return new GiteaSemanticProvider(config);
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  static getAvailableProviders() {
    return [
      {
        type: 'github',
        name: 'GitHub',
        description: 'GitHub-hosted semantic spaces',
        authMechanism: 'oauth',
        configFields: ['user', 'repo', 'token', 'semanticPath']
      },
      {
        type: 'gitea',
        name: 'Self-Host',
        description: 'Self-hosted Gitea instance',
        authMechanism: 'token',
        configFields: ['endpoint', 'user', 'repo', 'token', 'semanticPath']
      }
    ];
  }
} 
