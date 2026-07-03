/**
 * HeadlessUniverse.js
 *
 * Owns a single `.redstring` file on disk for the headless daemon: loads it
 * into the headless store, then persists store changes back with a debounced,
 * atomic, shrink-guarded writer. This is the Node-side analogue of the browser's
 * SaveCoordinator + file handle — but the daemon writes directly to the path.
 *
 * Design notes:
 *  - One store singleton per process (see createHeadlessStore) → one universe
 *    per daemon. Multi-universe = one daemon process per universe.
 *  - Sync format is exportToRedstring JSON (the full, lossless form), NOT the
 *    lossy bridge payload.
 *  - An exclusive lockfile under ~/.redstring/locks prevents two daemons from
 *    fighting over the same file. Stale locks (dead pid) are stolen.
 *  - Atomic writes: write `<file>.tmp` then rename, so a crash mid-write never
 *    truncates the real file.
 *  - Shrink guard: refuse to overwrite a non-empty universe with an empty one
 *    (ports the intent of graphStore's countUserData collapse tripwire).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { exportToRedstring } from '../formats/redstringFormat.js';

const BASE_PROTOTYPE_IDS = new Set(['base-thing-prototype', 'base-connection-prototype']);

const lockPathFor = (absPath) => {
  const slug = crypto.createHash('sha1').update(absPath).digest('hex');
  return path.join(os.homedir(), '.redstring', 'locks', `${slug}.lock`);
};

export class HeadlessUniverse {
  /**
   * @param {object}   opts
   * @param {string}   opts.filePath      absolute path to the .redstring file
   * @param {object}   opts.useGraphStore the headless store (from createHeadlessStore)
   * @param {number}   [opts.debounceMs=1000]
   * @param {function} [opts.log=console.error]  logger (stderr — never stdout)
   */
  constructor({ filePath, useGraphStore, debounceMs = 1000, log = console.error }) {
    if (!filePath) throw new Error('HeadlessUniverse requires a filePath');
    if (!useGraphStore) throw new Error('HeadlessUniverse requires a useGraphStore');
    this.filePath = path.resolve(filePath);
    this.useGraphStore = useGraphStore;
    this.debounceMs = debounceMs;
    this.log = log;

    this.stateVersion = 0;
    this._highWater = { nodes: 0, graphs: 0 };
    this._saveTimer = null;
    this._savePromise = null;
    this._pendingSave = false;
    this._unsubscribe = null;
    this._lockPath = lockPathFor(this.filePath);
    this._lockHeld = false;
    this._closed = false;
  }

  // ── Lock ────────────────────────────────────────────────────────────────
  acquireLock() {
    fs.mkdirSync(path.dirname(this._lockPath), { recursive: true });
    const payload = JSON.stringify({ pid: process.pid, filePath: this.filePath, startedAt: new Date().toISOString() });
    try {
      fs.writeFileSync(this._lockPath, payload, { flag: 'wx' }); // exclusive create
      this._lockHeld = true;
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    // Lock exists — steal it only if the owning process is gone.
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(this._lockPath, 'utf8')); } catch { /* corrupt lock */ }
    if (owner?.pid && this._pidAlive(owner.pid)) {
      throw new Error(`Universe ${this.filePath} is locked by a live daemon (pid ${owner.pid}). Stop it first.`);
    }
    this.log(`[HeadlessUniverse] Stealing stale lock (dead pid ${owner?.pid ?? '?'})`);
    fs.writeFileSync(this._lockPath, payload); // overwrite stale lock
    this._lockHeld = true;
  }

  releaseLock() {
    if (!this._lockHeld) return;
    try { fs.unlinkSync(this._lockPath); } catch { /* already gone */ }
    this._lockHeld = false;
  }

  _pidAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (err) { return err.code === 'EPERM'; } // EPERM → exists but not ours
  }

  // ── Load ────────────────────────────────────────────────────────────────
  /**
   * Load the file into the store (or start empty if it doesn't exist).
   * Acquires the lock first. Does NOT start autosave — call watch() after.
   */
  async load() {
    this.acquireLock();
    if (fs.existsSync(this.filePath)) {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      let json;
      try { json = JSON.parse(raw); }
      catch (err) { throw new Error(`Universe file is not valid JSON: ${this.filePath} — ${err.message}`); }
      const ok = this.useGraphStore.getState().loadUniverseFromFile(json);
      if (!ok) throw new Error(`loadUniverseFromFile rejected ${this.filePath}`);
      this._highWater = this._countUserData(this.useGraphStore.getState());
      this.log(`[HeadlessUniverse] Loaded ${this.filePath} (${this._highWater.nodes} nodes, ${this._highWater.graphs} graphs)`);
    } else {
      this.log(`[HeadlessUniverse] No file at ${this.filePath} — starting empty; will create on first save`);
    }
    return this;
  }

  // ── Autosave ─────────────────────────────────────────────────────────────
  /** Subscribe to store changes; debounce-persist to disk. */
  watch() {
    if (this._unsubscribe) return this;
    this._unsubscribe = this.useGraphStore.subscribe(() => {
      this.stateVersion += 1;
      this._scheduleSave();
    });
    return this;
  }

  _scheduleSave() {
    if (this._closed) return;
    this._pendingSave = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this._runSave(); }, this.debounceMs);
  }

  async _runSave() {
    // Serialize saves: if one is in flight, mark pending and let it re-run.
    if (this._savePromise) { this._pendingSave = true; return this._savePromise; }
    this._pendingSave = false;
    this._savePromise = this._writeToDisk().catch((err) => {
      this.log(`[HeadlessUniverse] Save failed: ${err.message}`);
    }).finally(() => {
      this._savePromise = null;
      if (this._pendingSave && !this._closed) this._runSave();
    });
    return this._savePromise;
  }

  async _writeToDisk() {
    const state = this.useGraphStore.getState();
    const counts = this._countUserData(state);

    // Shrink guard: never overwrite a non-empty universe with a fully empty one.
    if (this._highWater.nodes > 0 && counts.nodes === 0 && counts.graphs === 0) {
      this.log('[HeadlessUniverse] Shrink guard: refusing to write empty universe over non-empty file');
      return;
    }

    const json = JSON.stringify(exportToRedstring(state));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, this.filePath); // atomic on same filesystem

    this._highWater = {
      nodes: Math.max(this._highWater.nodes, counts.nodes),
      graphs: Math.max(this._highWater.graphs, counts.graphs)
    };
    this.log(`[HeadlessUniverse] Saved ${this.filePath} (v${this.stateVersion}, ${counts.nodes} nodes, ${counts.graphs} graphs)`);
  }

  /** Force an immediate save (cancels the debounce). Used on shutdown. */
  async flush() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._pendingSave || this._savePromise) {
      await this._runSave();
      if (this._savePromise) await this._savePromise;
    }
  }

  async close() {
    this._closed = true;
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
    await this.flush();
    this.releaseLock();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  _countUserData(state) {
    let nodes = 0;
    if (state?.nodePrototypes instanceof Map) {
      for (const id of state.nodePrototypes.keys()) {
        if (!BASE_PROTOTYPE_IDS.has(id)) nodes += 1;
      }
    }
    const graphs = state?.graphs instanceof Map ? state.graphs.size : 0;
    return { nodes, graphs };
  }
}

/**
 * Convenience: create + load + watch a universe in one call.
 */
export async function openHeadlessUniverse(opts) {
  const universe = new HeadlessUniverse(opts);
  await universe.load();
  universe.watch();
  return universe;
}
