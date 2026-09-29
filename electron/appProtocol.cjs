// The packaged renderer's origin: app://redstring (contract C-5).
//
// Serving dist/ from a custom privileged scheme instead of file:// gives the
// app a real, single origin: CSP 'self' means the app and nothing else, the
// renderer can't fetch arbitrary file:// URLs, and the grantFileProtocolExtra-
// Privileges fuse can be switched off.
//
// resolveAppAsset() is pure (tested in test/security/electron); the Electron
// wiring (registerAppScheme / handleAppProtocol) stays thin.

const path = require('node:path');
const { APP_SCHEME, APP_HOST } = require('./ipcGuards.cjs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Map an app:// request URL to a file inside `distDir`, or null. Refuses other
// hosts, encoded traversal ("%2e%2e"), NUL bytes and anything that resolves
// outside dist/. A path without an extension is the SPA shell (index.html).
function resolveAppAsset(requestUrl, distDir) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;

  const root = path.resolve(distDir);
  let relative = pathname.replace(/^\/+/, '');
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  if (!path.extname(relative)) relative = 'index.html';

  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

// Must run before app 'ready'.
function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true, // real origin, relative URLs, localStorage/IndexedDB
        secure: true, // secure context: WebCrypto (secureStore) needs it
        supportFetchAPI: true, // fetch() of the app's own assets
        corsEnabled: true,
        stream: true, // media range requests
        codeCache: true
      }
    }
  ]);
}

// Serve dist/ on app://redstring for one session. Reads go through Electron's
// asar-aware fs, so files packed in app.asar and asarUnpack'd workers both
// resolve.
function handleAppProtocol(targetSession, { distDir, fs = require('node:fs') }) {
  targetSession.protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppAsset(request.url, distDir);
    if (!filePath) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    try {
      const body = await fs.promises.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': mimeTypeFor(filePath),
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-cache'
        }
      });
    } catch (err) {
      const status = err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 404 : 500;
      return new Response(status === 404 ? 'Not found' : 'Error', { status, headers: { 'content-type': 'text/plain' } });
    }
  });
}

module.exports = {
  resolveAppAsset,
  mimeTypeFor,
  registerAppScheme,
  handleAppProtocol
};
