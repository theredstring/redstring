// Guards shared by every IPC handler in the main process (contract C-3).
//
// Kept free of `require('electron')` so the rules can be unit-tested in plain
// Node: what counts as a valid store name, which filesystem paths the user has
// approved, which URLs may leave the app, and which frames may talk to main.

const path = require('node:path');
const nodeFs = require('node:fs');

// The origin the packaged renderer runs at (C-5). `new URL('app://redstring')`
// reports origin "null" in Node (non-special scheme), so origins are compared
// by protocol + host, never by `.origin`.
const APP_SCHEME = 'app';
const APP_HOST = 'redstring';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// ── Storage store names ─────────────────────────────────────────
// `storage:*` maps a renderer-supplied store name to `<dataDir>/<name>.json`.
// Anything that isn't a plain identifier ("../../x", "a/b", "") is refused.
const STORE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isValidStoreName(name) {
  return typeof name === 'string' && STORE_NAME_RE.test(name);
}

// Resolve `<dir>/<name>.json` and prove it stays inside `dir`. Throws on a bad
// name so a handler can never fall through to an unchecked path.
function resolveStorePath(dir, name) {
  if (!isValidStoreName(name)) {
    throw new Error('Invalid storage name');
  }
  const root = path.resolve(dir);
  const resolved = path.resolve(root, `${name}.json`);
  if (path.dirname(resolved) !== root) {
    throw new Error('Invalid storage name');
  }
  return resolved;
}

// True when `target` is `root` or lives somewhere beneath it.
function isWithin(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  if (t === r) return true;
  const rel = path.relative(r, t);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ── User-approved paths ─────────────────────────────────────────
// A path becomes readable/writable through file IPC only when main itself got
// it back from a system open/save dialog (or from the one-time migration of
// records the user picked under an older version). The renderer can never add
// one: there is no IPC that calls approve(). Approvals persist in a file main
// owns, outside every file-IPC root and outside the storage:* directory, so
// neither file:write nor storage:setItem can plant one.
//
//   files   — exactly that path
//   folders — the folder and everything beneath it (a picked workspace folder)
function createPathApprovals({ persistPath, fs = nodeFs } = {}) {
  if (!persistPath || !path.isAbsolute(persistPath)) {
    throw new Error('createPathApprovals: absolute persistPath required');
  }
  const files = new Set();
  const folders = new Set();

  const normalize = (p) => (typeof p === 'string' && p && path.isAbsolute(p) ? path.resolve(p) : null);

  function approve(filePath, { kind = 'file' } = {}) {
    const resolved = normalize(filePath);
    // Relative paths are never approved: resolving one against main's CWD is
    // how a "1.redstring" handle once reached a file in the launch directory.
    if (!resolved) return false;
    // Approving the filesystem root as a folder would approve everything.
    if (kind === 'folder' && path.dirname(resolved) === resolved) return false;
    (kind === 'folder' ? folders : files).add(resolved);
    return true;
  }

  function isApproved(filePath) {
    const resolved = normalize(filePath);
    if (!resolved) return false;
    if (files.has(resolved) || folders.has(resolved)) return true;
    for (const folder of folders) {
      if (isWithin(folder, resolved)) return true;
    }
    return false;
  }

  function load() {
    let raw;
    try {
      raw = fs.readFileSync(persistPath, 'utf-8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return { loaded: 0 };
      throw err;
    }
    const parsed = JSON.parse(raw);
    let loaded = 0;
    for (const p of Array.isArray(parsed && parsed.files) ? parsed.files : []) {
      if (approve(p, { kind: 'file' })) loaded++;
    }
    for (const p of Array.isArray(parsed && parsed.folders) ? parsed.folders : []) {
      if (approve(p, { kind: 'folder' })) loaded++;
    }
    return { loaded };
  }

  // Atomic (temp + rename): a torn approvals file would unlink every universe.
  function save() {
    fs.mkdirSync(path.dirname(persistPath), { recursive: true });
    const body = JSON.stringify({ version: 1, files: [...files].sort(), folders: [...folders].sort() }, null, 2);
    const tmp = `${persistPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, persistPath);
  }

  return {
    approve,
    isApproved,
    load,
    save,
    list: () => ({ files: [...files], folders: [...folders] })
  };
}

// ── External URLs ───────────────────────────────────────────────
// The only schemes allowed to reach shell.openExternal. Everything else
// (file:, smb:, javascript:, custom app handlers, …) can launch local programs.
const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || !url || url.length > 8192) return false;
  // Control characters and whitespace have no business in a URL we hand to the
  // OS; WHATWG parsing strips some of them, which is how `java\tscript:` works.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f]/.test(url)) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return false;
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) return false;
  // Credentials in a link are a phishing trick, never something the app sends.
  if (parsed.username || parsed.password) return false;
  return true;
}

// ── Trusted senders ─────────────────────────────────────────────
// A URL belongs to the app when it is app://redstring/… or, in development
// only, one of the dev-server origins passed in by main.
function isAppUrl(url, { devOrigins = [] } = {}) {
  if (typeof url !== 'string' || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST) return true;
  for (const origin of devOrigins) {
    let o;
    try { o = new URL(origin); } catch { continue; }
    if (parsed.protocol === o.protocol && parsed.host === o.host) return true;
  }
  return false;
}

// Every ipcMain.handle/on starts with this. The sender must be the top-level
// frame of an app page — never a subframe, never a page that navigated away.
function isTrustedSender(event, { devOrigins = [] } = {}) {
  const frame = event && event.senderFrame;
  if (!frame) return false;
  if (frame.parent) return false;
  return isAppUrl(frame.url, { devOrigins });
}

module.exports = {
  APP_SCHEME,
  APP_HOST,
  APP_ORIGIN,
  isValidStoreName,
  resolveStorePath,
  isWithin,
  createPathApprovals,
  isSafeExternalUrl,
  isAppUrl,
  isTrustedSender
};
