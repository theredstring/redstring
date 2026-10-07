/**
 * The Druid's way to a local model, from the main process.
 *
 *   afm(request)   Apple's on-device model through native/afm-bridge, spawned
 *                  once and spoken to over stdio (no port, nothing else can
 *                  reach it). Shipped in the Mac app's Resources; in a checkout,
 *                  built with swift build. Used by the Druid and the Wizard's chat.
 *   chat(endpoint, body)
 *                  a chat-completions call to a model server on this machine
 *                  (LM Studio), made here because the renderer's fetch would
 *                  need the server to allow cross-origin requests. Loopback only.
 *
 * Only requests of the bridge's own shape pass: the renderer cannot choose the
 * executable, its arguments, or a non-local address.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const CHAT_TIMEOUT_MS = 120000;

function createDruidBridge({ executable }) {
  let child = null;
  let pending = new Map();
  let nextId = 1;

  const start = () => {
    if (child) return child;
    if (!fs.existsSync(executable)) {
      throw new Error(`Apple's on-device model needs the afm-bridge helper. Build it: swift build -c release --package-path native/afm-bridge`);
    }
    child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const mine = child;
    readline.createInterface({ input: mine.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      p.resolve(msg);
    });
    mine.on('exit', () => {
      if (child === mine) child = null;
      for (const p of pending.values()) p.reject(new Error('afm-bridge exited'));
      pending = new Map();
    });
    mine.on('error', () => {});
    return child;
  };

  const clean = (req) => {
    if (!req || typeof req !== 'object') throw new Error('bad request');
    if (req.op === 'health' || req.op === 'prewarm') return { op: req.op };
    if (req.op !== 'complete') throw new Error(`unknown op ${req.op}`);
    const str = (v) => (typeof v === 'string' ? v.slice(0, 64000) : '');
    const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      op: 'complete',
      system: str(req.system),
      user: str(req.user),
      schema: req.schema && typeof req.schema === 'object' ? JSON.parse(JSON.stringify(req.schema)) : undefined,
      maxTokens: num(req.maxTokens, 1, 4096, 256),
      temperature: num(req.temperature, 0, 2, 0.6)
    };
  };

  const afm = (req) => new Promise((resolve, reject) => {
    let body;
    try { body = clean(req); start(); } catch (err) { reject(err); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
  });

  const chat = async (endpoint, body) => {
    let url;
    try { url = new URL(endpoint); } catch { throw new Error('not a URL'); }
    if (!/^https?:$/.test(url.protocol) || !LOOPBACK.has(url.hostname)) {
      throw new Error('The Druid only talks to a model server on this machine (localhost).');
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CHAT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer local' },
        body: JSON.stringify(body || {}),
        signal: ac.signal
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  };

  const close = () => {
    if (child) { try { child.stdin.end(); child.kill(); } catch {} }
    child = null;
  };

  return { afm, chat, close };
}

/** Where the helper is built in a checkout (the app's own folder in development). */
/**
 * Where the helper is: in a packaged app, its Resources (electron-builder.json
 * extraResources); in a checkout, where `swift build` leaves it.
 */
function defaultBridgePath(appPath, resourcesPath = process.resourcesPath) {
  if (process.env.DRUID_AFM_BRIDGE) return process.env.DRUID_AFM_BRIDGE;
  const shipped = resourcesPath ? path.join(resourcesPath, 'afm-bridge') : null;
  if (shipped && fs.existsSync(shipped)) return shipped;
  return path.join(appPath, 'native', 'afm-bridge', '.build', 'release', 'afm-bridge');
}

module.exports = { createDruidBridge, defaultBridgePath };
