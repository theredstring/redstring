/**
 * Git-Native Semantic Web Provider
 * Core abstraction for hot-swappable Git providers
 * Enables real-time responsiveness, true decentralization, and distributed resilience
 */

import githubRateLimiter from './githubRateLimiter.js';
import { githubAPI } from './GitHubAPIWrapper.js';

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
      const fileInfo = await this.getFileInfo(fullPath);
      if (!fileInfo) {
        throw new Error(`File not found: ${path}`);
      }

      const content = this.base64ToUtf8(fileInfo.content);
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
      const response = await fetch(url, { headers });

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
    try {
      // Short-circuit if we don't have credentials yet
      if (!this.token || String(this.token).trim().length === 0) {
        return false;
      }
      
      // Check rate limit before making request
      await githubRateLimiter.waitForAvailability(this.authMethod);
      
      // Check if the repository exists by accessing the repo info, not contents
      const repoUrl = `https://api.github.com/repos/${this.user}/${this.repo}`;
      
      githubRateLimiter.recordRequest(this.authMethod);
      const response = await fetch(repoUrl, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (response.ok) {
        return true; // Repository exists and is accessible
      }
      
      // If 404, repository doesn't exist
      if (response.status === 404) {
        console.warn(`[GitHubSemanticProvider] Repository not found: ${this.user}/${this.repo}`);
        return false;
      }
      
      // If 401, authentication failed
      if (response.status === 401) {
        console.warn(`[GitHubSemanticProvider] Authentication failed for ${this.user}/${this.repo}`);
        return false;
      }
      
      // For other errors (403, etc.), log but return false
      console.warn(`[GitHubSemanticProvider] Repository access failed: ${response.status} ${response.statusText}`);
      return false;
    } catch (error) {
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
  async getFileInfo(path) {
    try {
      const { apiPath } = this.resolvePathInput(path, { trimTrailing: false });
      if (!apiPath) {
        return null;
      }
      const response = await githubAPI.request(`${this.rootUrl}/${apiPath}`);
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async writeFileRaw(path, content) {
    const { displayPath: safePath, apiPath } = this.resolvePathInput(path, { trimTrailing: false });
    if (!apiPath) {
      throw new Error('Invalid path provided to writeFileRaw');
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
      
      // First try to get the current file info to get the latest SHA
      let existingFile = null;
      try {
        githubRateLimiter.recordRequest(this.authMethod);
        existingFile = await this.getFileInfo(safePath);
      } catch (error) {
        // File doesn't exist, that's fine for new files
        console.log(`[GitHubSemanticProvider] File ${safePath} doesn't exist, will create new`);
      }

      const body = {
        message: `Update ${safePath}`,
        content: this.utf8ToBase64(content)
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
        
        // Handle 409 conflict with MUCH more aggressive backoff
        if (response.status === 409) {
          console.log(`[GitHubSemanticProvider] 409 conflict for ${safePath}, using AGGRESSIVE backoff...`);
          
          // Retry up to 3 times with reasonable exponential backoff
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              // Reasonable backoff: 1s, 3s, 9s - responsive but prevents conflicts
              const backoffDelay = Math.min(1000 * Math.pow(3, attempt - 1), 9000);
              console.log(`[GitHubSemanticProvider] Retry ${attempt} for ${safePath}, waiting ${backoffDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, backoffDelay));
              
              // Check rate limit before retry
              await githubRateLimiter.waitForAvailability(this.authMethod);
              
              // Get fresh file info
              githubRateLimiter.recordRequest(this.authMethod);
              const freshFile = await this.getFileInfo(safePath);
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

  // Helper to generate content hash for redundancy prevention
  generateContentHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  async readFileRaw(path) {
    const { displayPath: safePath } = this.resolvePathInput(path, { trimTrailing: false });
    try {
      const info = await this.getFileInfo(safePath);
      if (!info) {
        // File not found - this is expected for new files, so don't log as error
        console.log(`[GitHubSemanticProvider] File not found: ${safePath}`);
        throw new Error(`File not found: ${safePath}`);
      }
      return this.base64ToUtf8(info.content);
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
      const response = await fetch(`${this.rootUrl}/${fullPath}?ref=main`, {
        headers: {
          'Authorization': `token ${this.token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`File not found: ${path}`);
      }
      
      const fileInfo = await response.json();
      const content = this.base64ToUtf8(fileInfo.content);
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

  async getFileInfo(path) {
    try {
      const { apiPath } = this.resolvePathInput(path, { trimTrailing: false });
      if (!apiPath) {
        return null;
      }
      const response = await fetch(`${this.rootUrl}/${apiPath}?ref=main`, {
        headers: {
          'Authorization': `token ${this.token}`
        }
      });
      if (response.status === 404) return null;
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      return null;
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
        // File doesn't exist, that's fine for new files
        console.log(`[GiteaSemanticProvider] File ${safePath} doesn't exist, will create new`);
      }

      const method = fileInfo?.sha ? 'PUT' : 'POST';
      const body = {
        message: `Update ${safePath}`,
        content: this.utf8ToBase64(content),
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

  // Helper to generate content hash for redundancy prevention
  generateContentHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  async readFileRaw(path) {
    const { displayPath: safePath } = this.resolvePathInput(path, { trimTrailing: false });
    try {
      const info = await this.getFileInfo(safePath);
      if (!info) {
        // File not found - this is expected for new files, so don't log as error
        console.log(`[GiteaSemanticProvider] File not found: ${safePath}`);
        throw new Error(`File not found: ${safePath}`);
      }
      return this.base64ToUtf8(info.content);
    } catch (e) {
      // Only log as error if it's not a "file not found" error
      if (e.message && e.message.includes('File not found')) {
        // Re-throw without additional error logging since this is expected
        throw e;
      } else {
        console.error('[GiteaSemanticProvider] readFileRaw failed:', e);
        throw e;
      }
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
