/**
 * config.js — machine-level config for headless Redstring.
 *
 * Stored at ~/.redstring/config.json. Remembers which workspace folder is
 * currently linked, the port to serve on, and (later) a BYOK GitHub token.
 * The per-workspace universe registry lives in the workspace folder itself
 * (see HeadlessWorkspace), not here.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const REDSTRING_HOME = path.join(os.homedir(), '.redstring');
export const CONFIG_PATH = path.join(REDSTRING_HOME, 'config.json');
export const DEFAULT_WORKSPACE = path.join(os.homedir(), 'redstring');
export const DEFAULT_PORT = 3001;

/** Read the machine config, tolerating a missing/corrupt file. */
export function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  } catch { /* corrupt — treat as empty */ }
  // One-time migration: the old single-file config was ~/.redstring/daemon.json.
  try {
    const legacy = path.join(REDSTRING_HOME, 'daemon.json');
    if (fs.existsSync(legacy)) {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8')) || {};
      // Old shape was { universe: "<path>" }; carry its parent as the workspace.
      if (old.universe) return { workspace: path.dirname(path.resolve(old.universe)) };
    }
  } catch { /* ignore */ }
  return {};
}

/** Shallow-merge a patch into the machine config and persist it. */
export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(REDSTRING_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/**
 * Resolve the workspace folder. Precedence:
 *   1. explicit flag  (--workspace / -w)
 *   2. explicit single file (--universe <file>) → its parent folder (back-compat)
 *   3. REDSTRING_WORKSPACE env
 *   4. REDSTRING_UNIVERSE env → its parent folder (back-compat)
 *   5. ~/.redstring/config.json { workspace }
 *   6. default ~/redstring
 *
 * Returns { dir, activeFileHint } — activeFileHint is set only when a specific
 * .redstring file was named (back-compat), so the caller can activate it.
 */
export function resolveWorkspace({ flags = {}, env = process.env } = {}) {
  if (flags.workspace) return { dir: path.resolve(flags.workspace), activeFileHint: null };
  if (flags.universe) return { dir: path.dirname(path.resolve(flags.universe)), activeFileHint: path.resolve(flags.universe) };
  if (env.REDSTRING_WORKSPACE) return { dir: path.resolve(env.REDSTRING_WORKSPACE), activeFileHint: null };
  if (env.REDSTRING_UNIVERSE) return { dir: path.dirname(path.resolve(env.REDSTRING_UNIVERSE)), activeFileHint: path.resolve(env.REDSTRING_UNIVERSE) };
  const cfg = readConfig();
  if (cfg.workspace) return { dir: path.resolve(cfg.workspace), activeFileHint: null };
  return { dir: DEFAULT_WORKSPACE, activeFileHint: null, isDefault: true };
}

/** Persist the linked workspace so future runs remember it. */
export function rememberWorkspace(dir) {
  return writeConfig({ workspace: path.resolve(dir) });
}
