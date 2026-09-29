/**
 * agentToken.js — how local clients find the agent server's auth token.
 *
 * The agent server (wizard-server.js) and the MCP server's opt-in HTTP listener
 * require an `X-Redstring-Token` on every request (see
 * src/security/localServerGuard.js). Local clients that aren't the Electron
 * renderer — the CLI, the MCP server, the vite dev proxy — read the token from
 *
 *   ~/.redstring/agent.json   (file 0600, directory 0700)
 *   { version: 1,
 *     agents: { "<port>": { token, pid, updatedAt } },   // wizard-server(s)
 *     mcp:    { "<port>": { token, pid, updatedAt } } }  // MCP HTTP listener(s)
 *
 * Tokens are keyed by port so a second server on another port (tests, a CLI
 * daemon beside Electron) never clobbers the first one's entry.
 *
 * Node only. No console.log: the MCP server imports this and stdout is its
 * stdio transport.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import process from 'node:process';

export const AGENT_TOKEN_HEADER = 'X-Redstring-Token';
export const DEFAULT_AGENT_PORT = 3001;

/** ~/.redstring, overridable with REDSTRING_HOME (tests, portable installs). */
export function redstringHome(env = process.env) {
  const override = env && typeof env.REDSTRING_HOME === 'string' && env.REDSTRING_HOME.trim();
  return override ? path.resolve(override) : path.join(os.homedir(), '.redstring');
}

export function agentFilePath(env = process.env) {
  return path.join(redstringHome(env), 'agent.json');
}

/** mkdir -p with 0700, tightening an existing directory too. */
export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* not ours / unsupported (Windows) */ }
}

/**
 * Write a file readable only by the current user: 0600 temp file in the same
 * directory, then rename over the target, so the secret is never briefly
 * world-readable and a crash never leaves a half-written file.
 */
export function writePrivateFile(file, contents) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, contents, { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch { /* unsupported */ }
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
  try { fs.chmodSync(file, 0o600); } catch { /* unsupported */ }
}

/** chmod an existing secrets file to 0600 if it is group/world accessible. */
export function tightenFileMode(file) {
  try {
    const st = fs.statSync(file);
    if ((st.mode & 0o077) !== 0) fs.chmodSync(file, 0o600);
  } catch { /* missing or unsupported */ }
}

export function generateAgentToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function readAgentFile(env = process.env) {
  try {
    const raw = fs.readFileSync(agentFilePath(env), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeEntry(kind, port, token, env) {
  const file = agentFilePath(env);
  const current = readAgentFile(env) || {};
  const section = current[kind] && typeof current[kind] === 'object' ? { ...current[kind] } : {};
  section[String(port)] = { token, pid: process.pid, updatedAt: new Date().toISOString() };
  const next = { ...current, version: 1, [kind]: section };
  writePrivateFile(file, JSON.stringify(next, null, 2));
  return next;
}

function removeEntry(kind, port, env) {
  const current = readAgentFile(env);
  const entry = current?.[kind]?.[String(port)];
  // Only remove our own entry — a newer server on the same port may have
  // replaced it after we lost the port.
  if (!entry || entry.pid !== process.pid) return;
  const section = { ...current[kind] };
  delete section[String(port)];
  try { writePrivateFile(agentFilePath(env), JSON.stringify({ ...current, [kind]: section }, null, 2)); } catch { /* best effort */ }
}

/** wizard-server: record the token for its port. */
export function recordAgentToken({ port, token, env = process.env }) {
  return writeEntry('agents', port, token, env);
}
export function forgetAgentToken({ port, env = process.env }) {
  removeEntry('agents', port, env);
}

/** MCP server's opt-in HTTP listener: record its own token. */
export function recordMcpHttpToken({ port, token, env = process.env }) {
  return writeEntry('mcp', port, token, env);
}
export function forgetMcpHttpToken({ port, env = process.env }) {
  removeEntry('mcp', port, env);
}

/**
 * Token for the agent server on `port`. The env var wins (Electron passes it to
 * the agent server it forks; anything that inherits that env reuses it), then
 * the file entry for that port.
 */
export function readAgentToken({ port = DEFAULT_AGENT_PORT, env = process.env } = {}) {
  const fromEnv = env && typeof env.REDSTRING_AGENT_TOKEN === 'string' && env.REDSTRING_AGENT_TOKEN.trim();
  if (fromEnv) return fromEnv;
  const entry = readAgentFile(env)?.agents?.[String(port)];
  return typeof entry?.token === 'string' && entry.token ? entry.token : null;
}

export function readMcpHttpToken({ port, env = process.env } = {}) {
  const fromEnv = env && typeof env.REDSTRING_MCP_TOKEN === 'string' && env.REDSTRING_MCP_TOKEN.trim();
  if (fromEnv) return fromEnv;
  const entry = readAgentFile(env)?.mcp?.[String(port)];
  return typeof entry?.token === 'string' && entry.token ? entry.token : null;
}

/** Headers to add to a request to the agent server on `port` ({} if no token is known). */
export function agentAuthHeaders({ port = DEFAULT_AGENT_PORT, env = process.env } = {}) {
  const token = readAgentToken({ port, env });
  return token ? { [AGENT_TOKEN_HEADER]: token } : {};
}
