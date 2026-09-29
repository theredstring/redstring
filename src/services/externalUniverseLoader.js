/**
 * External Universe Loader
 *
 * Pure functions for loading .redstring files from arbitrary web URLs:
 *   - GitHub file URLs (github.com/.../blob/... or raw.githubusercontent.com/...)
 *   - GitHub folder URLs (github.com/.../tree/...)
 *   - GitHub repo URLs (github.com/owner/repo)
 *   - Arbitrary direct URLs whose path ends in .redstring
 *
 * No React, no store imports. Just URL classification, fetch, and GitHub API listing.
 * GitHub calls are unauthenticated (60 req/hr limit per IP — acceptable for one-shot load).
 */

const REDSTRING_EXT_RE = /\.redstring$/i;

const GITHUB_FILE_BLOB_RE = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;
const GITHUB_FOLDER_TREE_RE = /^\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/;
const GITHUB_REPO_RE = /^\/([^/]+)\/([^/]+)\/?$/;
const RAW_GITHUB_RE = /^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;

/**
 * Classify a URL into one of the recognized kinds.
 *
 * @param {string} input — the URL to classify
 * @returns {{
 *   kind: 'github-file' | 'github-folder' | 'github-repo' | 'raw-file' | 'invalid',
 *   owner?: string, repo?: string, branch?: string, path?: string,
 *   rawUrl?: string,
 *   reason?: string
 * }}
 */
export function classifyUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { kind: 'invalid', reason: 'Empty URL' };
  }

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return { kind: 'invalid', reason: 'Not a valid URL' };
  }

  // https only: a universe fetched over plain http can be rewritten by anyone
  // on the network path before it is imported.
  if (url.protocol !== 'https:') {
    return { kind: 'invalid', reason: 'URL must use https' };
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === 'raw.githubusercontent.com') {
    const m = path.match(RAW_GITHUB_RE);
    if (m) {
      const [, owner, repo, branch, filePath] = m;
      if (!REDSTRING_EXT_RE.test(filePath)) {
        return { kind: 'invalid', reason: 'GitHub raw URL must point to a .redstring file' };
      }
      return {
        kind: 'github-file',
        owner, repo, branch, path: filePath,
        rawUrl: url.toString()
      };
    }
    return { kind: 'invalid', reason: 'Unrecognized raw.githubusercontent.com URL shape' };
  }

  if (host === 'github.com' || host === 'www.github.com') {
    let m = path.match(GITHUB_FILE_BLOB_RE);
    if (m) {
      const [, owner, repo, branch, filePath] = m;
      if (!REDSTRING_EXT_RE.test(filePath)) {
        return { kind: 'invalid', reason: 'GitHub URL must point to a .redstring file' };
      }
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      return { kind: 'github-file', owner, repo, branch, path: filePath, rawUrl };
    }

    m = path.match(GITHUB_FOLDER_TREE_RE);
    if (m) {
      const [, owner, repo, branch, folderPath] = m;
      return {
        kind: 'github-folder',
        owner, repo, branch,
        path: folderPath || ''
      };
    }

    m = path.match(GITHUB_REPO_RE);
    if (m) {
      const [, owner, repo] = m;
      return { kind: 'github-repo', owner, repo };
    }

    return { kind: 'invalid', reason: 'Unrecognized github.com URL shape' };
  }

  // Arbitrary host: only accept direct .redstring file URLs.
  if (REDSTRING_EXT_RE.test(path)) {
    return { kind: 'raw-file', rawUrl: url.toString() };
  }

  return { kind: 'invalid', reason: 'URL must end in .redstring or be a GitHub URL' };
}

const MB = 1024 * 1024;

/**
 * Largest file we will download from a link. A phone's web view has far less
 * memory to hold the text, the parse and the imported store at once.
 */
export const maxExternalUniverseBytes = () => {
  const native = typeof window !== 'undefined'
    && typeof window.Capacitor?.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform() === true;
  return native ? 25 * MB : 50 * MB;
};

/** Deepest bracket nesting accepted. Real .redstring files sit well under 32. */
export const MAX_JSON_DEPTH = 256;

/**
 * Deepest `{`/`[` nesting in a JSON text, ignoring brackets inside strings.
 * Linear and allocation-free, so it runs before JSON.parse and the recursive
 * import walkers ever see a pathologically nested document.
 */
export function jsonNestingDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92 /* \ */) i++;
      else if (c === 34 /* " */) inString = false;
      continue;
    }
    if (c === 34) inString = true;
    else if (c === 123 || c === 91) { if (++depth > max) max = depth; }
    else if (c === 125 || c === 93) depth--;
  }
  return max;
}

const tooLarge = (limit) => new Error(`File is too large to load from a link (over ${Math.round(limit / MB)} MB)`);

/** Read a response body as text, refusing to buffer more than `limit` bytes. */
async function readTextCapped(res, limit) {
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(limit);

  if (!res.body?.getReader) {
    const text = await res.text();
    // UTF-16 length is a lower bound on the byte count, good enough as a cap.
    if (text.length > limit) throw tooLarge(limit);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw tooLarge(limit);
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

/**
 * Fetch and parse a .redstring file from a direct URL.
 *
 * @param {string} rawUrl - must be https
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<object>} parsed JSON ready for importFromRedstring()
 */
export async function fetchRedstringJson(rawUrl, { maxBytes = maxExternalUniverseBytes() } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(rawUrl));
  } catch {
    throw new Error('Not a valid URL');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('URL must use https');
  }

  let res;
  try {
    res = await fetch(parsedUrl.href, { credentials: 'omit' });
  } catch (err) {
    throw new Error(`Network error: ${err.message || err}`);
  }

  if (!res.ok) {
    throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText}`);
  }

  const text = await readTextCapped(res, maxBytes);
  if (!text || !text.trim()) {
    throw new Error('File is empty');
  }

  if (jsonNestingDepth(text) > MAX_JSON_DEPTH) {
    throw new Error('Invalid JSON: nested too deeply to be a Redstring file');
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }
}

/**
 * List .redstring files in a GitHub repo or folder (unauthenticated).
 *
 * For kind='github-folder', lists files in the specified folder.
 * For kind='github-repo', scans repo root AND a "universes/" subfolder (if present).
 *
 * @param {{ owner: string, repo: string, branch?: string, path?: string, scope?: 'folder' | 'repo' }} args
 * @returns {Promise<Array<{ name: string, path: string, downloadUrl: string, size: number }>>}
 */
export async function listRedstringFilesInGithub({ owner, repo, branch, path = '', scope = 'folder' }) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required');
  }

  const branches = branch ? [branch] : [null]; // null → no ?ref param, GitHub uses default branch

  const tryListAt = async (apiPath) => {
    const branchToUse = branches[0];
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(apiPath || '')}${branchToUse ? `?ref=${encodeURIComponent(branchToUse)}` : ''}`;
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new Error(`GitHub API error: HTTP ${res.status} ${res.statusText} (rate limit?)`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(item => item.type === 'file' && REDSTRING_EXT_RE.test(item.name))
      .map(item => ({
        name: item.name,
        path: item.path,
        downloadUrl: item.download_url,
        size: typeof item.size === 'number' ? item.size : 0
      }));
  };

  if (scope === 'folder') {
    return tryListAt(path);
  }

  // scope === 'repo' → scan root + universes/
  const rootResults = await tryListAt('');
  const universesResults = await tryListAt('universes').catch(() => []);

  // De-dupe by path (shouldn't overlap, but be defensive)
  const seen = new Set();
  const merged = [];
  for (const item of [...rootResults, ...universesResults]) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    merged.push(item);
  }
  return merged;
}

/**
 * Derive a suggested universe name from a URL or filename.
 *
 * Strips the .redstring extension and falls back to "External Universe" if nothing usable.
 */
export function suggestUniverseNameFromUrl(urlOrFilename) {
  try {
    const fileName = urlOrFilename.includes('/')
      ? urlOrFilename.split(/[?#]/)[0].split('/').filter(Boolean).pop()
      : urlOrFilename;
    const base = (fileName || '').replace(REDSTRING_EXT_RE, '').trim();
    return base || 'External Universe';
  } catch {
    return 'External Universe';
  }
}
