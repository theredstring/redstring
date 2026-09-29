/**
 * localServerGuard.js — request guard for Redstring's loopback servers
 * (the agent/wizard server and the MCP server's opt-in HTTP listener).
 *
 * Binding to 127.0.0.1 is not enough on its own: any website the user has open
 * can fire requests at localhost (CSRF with text/plain or form bodies), and a
 * DNS-rebinding page can make those requests same-origin and read the answers.
 * Every request must therefore pass, in order:
 *
 *   1. Host    ∈ {127.0.0.1:PORT, localhost:PORT, [::1]:PORT}      else 403
 *   2. Origin  absent, or ∈ allowedOrigins (never "null")           else 403
 *   3. Token   X-Redstring-Token (or Authorization: Bearer) matches else 401
 *   4. Body    non-GET requests that carry a body must be JSON      else 415
 *
 * CORS is answered here too (allowed origins only), so a server using this
 * guard needs no separate CORS middleware. Preflights (OPTIONS) pass steps 1–2 and
 * are answered without a token: browsers never send custom headers on them.
 *
 * Framework-light: works as express middleware and on a bare node:http
 * request/response pair. ESM, Node built-ins only, never console.log (the MCP
 * server's stdout is its stdio transport).
 */
import crypto from 'node:crypto';

export const AGENT_TOKEN_HEADER = 'x-redstring-token';

// app://redstring is the packaged Electron app (C-5); 4001 is the vite dev
// server (web dev and Electron dev both load from it).
export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'app://redstring',
  'http://localhost:4001',
  'http://127.0.0.1:4001',
]);

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Redstring-Token';

const resolveValue = (v) => (typeof v === 'function' ? v() : v);

/** The only Host header values a loopback server should ever see. */
export function allowedHostsFor(port) {
  const p = String(port);
  return new Set([`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`]);
}

/**
 * Constant-time token comparison. Both sides are hashed to a fixed length
 * first so neither the comparison nor an early length check leaks timing.
 */
export function tokensMatch(expected, provided) {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const b = crypto.createHash('sha256').update(provided, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function headerValue(req, name) {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

function requestPath(req) {
  const raw = req.originalUrl || req.url || '/';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

function queryToken(req) {
  try {
    const url = new URL(req.originalUrl || req.url || '/', 'http://guard.invalid');
    return url.searchParams.get('rs_token');
  } catch {
    return null;
  }
}

/**
 * The caller's token. X-Redstring-Token wins; Authorization: Bearer is only a
 * fallback, because some routes carry the user's LLM key in Authorization.
 * `?rs_token=` is accepted only on GET paths listed in queryTokenPaths
 * (EventSource cannot set headers).
 */
export function extractToken(req, { queryTokenPaths = [] } = {}) {
  const header = headerValue(req, AGENT_TOKEN_HEADER);
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = headerValue(req, 'authorization');
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && queryTokenPaths.includes(requestPath(req))) {
    const t = queryToken(req);
    if (t) return t;
  }
  return null;
}

function hasBody(req) {
  if (headerValue(req, 'transfer-encoding') !== undefined) return true;
  const len = Number(headerValue(req, 'content-length'));
  if (Number.isFinite(len) && len > 0) return true;
  // A Content-Type with no body is still a statement of intent; judge it.
  return headerValue(req, 'content-type') !== undefined;
}

function isJsonContentType(req) {
  const ct = String(headerValue(req, 'content-type') || '').split(';')[0].trim().toLowerCase();
  return ct === 'application/json' || (ct.startsWith('application/') && ct.endsWith('+json'));
}

function deny(res, status, code) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: code }));
}

/**
 * @param {object} opts
 * @param {string|(() => string)} opts.token   expected token (or getter; empty → every request 503s)
 * @param {number|string|(() => number)} opts.port  the port the server listens on (or getter)
 * @param {string[]} [opts.allowedOrigins]      exact Origin values allowed; "null" is always dropped
 * @param {string[]} [opts.queryTokenPaths]     GET paths that may carry ?rs_token= (EventSource)
 * @returns {(req, res, next) => void}
 */
export function createLocalServerGuard({
  token,
  port,
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  queryTokenPaths = [],
} = {}) {
  const origins = new Set(
    (allowedOrigins || [])
      .map((o) => String(o || '').trim())
      .filter((o) => o && o.toLowerCase() !== 'null')
  );

  return function localServerGuard(req, res, next) {
    const expectedPort = resolveValue(port);
    const host = String(headerValue(req, 'host') || '').toLowerCase();
    if (expectedPort === undefined || expectedPort === null || !allowedHostsFor(expectedPort).has(host)) {
      return deny(res, 403, 'forbidden_host');
    }

    const origin = headerValue(req, 'origin');
    if (origin !== undefined) {
      if (!origins.has(origin)) return deny(res, 403, 'forbidden_origin');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      return res.end();
    }

    const expectedToken = resolveValue(token);
    if (typeof expectedToken !== 'string' || !expectedToken) {
      // Fail closed: a server that has no token yet serves nothing.
      return deny(res, 503, 'agent_token_unconfigured');
    }
    if (!tokensMatch(expectedToken, extractToken(req, { queryTokenPaths }))) {
      return deny(res, 401, 'unauthorized');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && hasBody(req) && !isJsonContentType(req)) {
      return deny(res, 415, 'json_required');
    }

    return next();
  };
}

/**
 * Allowed origins for a server: the defaults, plus any comma-separated extras
 * in the given env value (e.g. a different vite port). "null" is never allowed.
 */
export function allowedOriginsFromEnv(extra) {
  const list = [...DEFAULT_ALLOWED_ORIGINS];
  for (const o of String(extra || '').split(',')) {
    const t = o.trim();
    if (t && t.toLowerCase() !== 'null') list.push(t);
  }
  return list;
}
