/**
 * githubSync.js — lean, Node-native GitHub client for headless universe pull/push.
 *
 * API-based (GitHub Contents API over `fetch`), BYOK token, no local `git` and no
 * child processes. It deliberately does NOT reuse the browser provider stack
 * (`gitNativeProvider` → `GitHubAPIWrapper` → `persistentAuth`), which is coupled
 * to `window`/`localStorage`/`document` and would not load cleanly in Node. This
 * module ports only the raw read/write logic those providers use (get SHA → PUT
 * base64 → base64-decode), so headless stays dependency-light and stdout-clean.
 *
 * Logging goes to the injected `log` (stderr by default) — never stdout, which
 * would corrupt the MCP stdio transport.
 */

const GITHUB_API = 'https://api.github.com';

const b64decode = (b64) => Buffer.from(String(b64 || '').replace(/\n/g, ''), 'base64').toString('utf8');
const b64encode = (str) => Buffer.from(String(str), 'utf8').toString('base64');

const authHeaders = (token) => {
  if (!token) {
    throw new Error(
      'GitHub token required. Set REDSTRING_GITHUB_TOKEN (or GITHUB_TOKEN), or run `redstring auth github <token>`.'
    );
  }
  return { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' };
};

/**
 * Parse a repo spec into its parts. Accepts:
 *   user/repo
 *   user/repo/path/to/file.redstring
 *   https://github.com/user/repo(.git)
 * @returns {{ user:string, repo:string, path:string|null }}
 */
export function parseRepoSpec(spec) {
  const s = String(spec || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Invalid repo "${spec}" — expected user/repo[/path/to/file.redstring]`);
  }
  const [user, repo, ...rest] = parts;
  return { user, repo, path: rest.length ? rest.join('/') : null };
}

export class GitHubUniverseSync {
  /**
   * @param {object}   opts
   * @param {string}   opts.user
   * @param {string}   opts.repo
   * @param {string}   opts.token             BYOK personal access / OAuth token
   * @param {string}   [opts.branch='main']
   * @param {function} [opts.log=console.error]
   */
  constructor({ user, repo, token, branch = 'main', log = console.error }) {
    if (!user || !repo) throw new Error('GitHubUniverseSync requires user and repo');
    this.user = user;
    this.repo = repo;
    this.token = token;
    this.branch = branch || 'main';
    this.log = log;
    this.base = `${GITHUB_API}/repos/${user}/${repo}/contents`;
  }

  _contentsUrl(repoPath) {
    const encoded = String(repoPath || '')
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    const url = encoded ? `${this.base}/${encoded}` : this.base;
    return `${url}?ref=${encodeURIComponent(this.branch)}`;
  }

  /** Verify the repo is reachable with the current token. */
  async isAvailable() {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${this.user}/${this.repo}`, {
        headers: authHeaders(this.token)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** List a directory's contents (empty array on 404 / non-directory). */
  async listContents(repoPath = '') {
    const res = await fetch(this._contentsUrl(repoPath), { headers: authHeaders(this.token) });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub list "${repoPath || '/'}" failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  /** Read a file's text, or null if it doesn't exist. */
  async readFile(repoPath) {
    const res = await fetch(this._contentsUrl(repoPath), { headers: authHeaders(this.token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read "${repoPath}" failed: ${res.status} ${await res.text()}`);
    const info = await res.json();
    if (info?.content == null) return null;
    return b64decode(info.content);
  }

  /** Current blob SHA for a file, or null if it doesn't exist. */
  async getSha(repoPath) {
    const res = await fetch(this._contentsUrl(repoPath), { headers: authHeaders(this.token) });
    if (!res.ok) return null;
    const info = await res.json();
    return info?.sha || null;
  }

  /** Create or update a file (auto-fills SHA on update). */
  async writeFile(repoPath, content, message) {
    const sha = await this.getSha(repoPath);
    const body = { message: message || `Update ${repoPath}`, content: b64encode(content), branch: this.branch };
    if (sha) body.sha = sha;
    const url = `${this.base}/${repoPath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(this.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`GitHub write "${repoPath}" failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /**
   * Discover `.redstring` universe files in the repo: scans the root plus one
   * level under `universes/` (the folder convention GitSyncEngine writes to).
   * @returns {Promise<string[]>} repo-relative file paths
   */
  async discoverUniverses() {
    const found = [];
    const isRedstring = (item) => item?.type === 'file' && /\.redstring$/i.test(item.name || '');

    for (const item of await this.listContents('')) {
      if (isRedstring(item)) found.push(item.path);
    }
    for (const item of await this.listContents('universes')) {
      if (isRedstring(item)) {
        found.push(item.path);
      } else if (item?.type === 'dir') {
        for (const sub of await this.listContents(item.path)) {
          if (isRedstring(sub)) found.push(sub.path);
        }
      }
    }
    // de-dupe while preserving order
    return [...new Set(found)];
  }
}
