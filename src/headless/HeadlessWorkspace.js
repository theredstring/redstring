/**
 * HeadlessWorkspace.js
 *
 * A workspace is a local folder that holds `.redstring` universe files. This is
 * the Node analogue of the browser's universe registry (universeBackend) — but
 * lean and filesystem-based: the folder IS the registry (existence = files on
 * disk), and a small manifest at `<dir>/.redstring/workspace.json` adds the
 * active pointer, display names, and git links.
 *
 * One universe is "active" and loaded into the singleton store at a time.
 * Switching flushes the current file and loads the new one (mirrors the
 * browser's switchActiveUniverse). Universe object shapes mirror the browser's
 * so a folder of `.redstring` files interoperates between browser and headless.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HeadlessUniverse } from './HeadlessUniverse.js';

const MANIFEST_DIR = '.redstring';
const MANIFEST_FILE = 'workspace.json';

const slugify = (name) =>
  String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'universe';

const sanitizeFileName = (name) =>
  (String(name || '').trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-') || 'Universe');

const emptyManifest = () => ({ version: 1, activeUniverse: null, universes: {} });

export class HeadlessWorkspace {
  /**
   * @param {object}   opts
   * @param {string}   opts.dir            workspace folder (absolute)
   * @param {object}   opts.useGraphStore  the headless store
   * @param {number}   [opts.debounceMs=1000]
   * @param {function} [opts.log=console.error]
   */
  constructor({ dir, useGraphStore, debounceMs = 1000, log = console.error }) {
    if (!dir) throw new Error('HeadlessWorkspace requires a dir');
    if (!useGraphStore) throw new Error('HeadlessWorkspace requires a useGraphStore');
    this.dir = path.resolve(dir);
    this.useGraphStore = useGraphStore;
    this.debounceMs = debounceMs;
    this.log = log;
    this.manifest = emptyManifest();
    this.universe = null;      // the active HeadlessUniverse persister
    this.createdDefault = false;
  }

  // ── Open ──────────────────────────────────────────────────────────────────
  /**
   * @param {object}  [opts]
   * @param {boolean} [opts.autoCreateDefault=true]  create a "Universe" when the folder has none
   * @param {string}  [opts.activeFileHint]          a specific .redstring file to activate (back-compat)
   */
  async open({ autoCreateDefault = true, activeFileHint = null } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    this.manifest = this._readManifest();
    this._reconcileWithDisk();

    if (activeFileHint) {
      const slug = this._ensureFileRegistered(activeFileHint);
      this.manifest.activeUniverse = slug;
    }

    if (Object.keys(this.manifest.universes).length === 0 && autoCreateDefault) {
      const slug = this._registerUniverse('Universe');
      this.manifest.activeUniverse = slug;
      this.createdDefault = true;
      this.log(`[workspace] No universes found — created default "Universe" in ${this.dir}`);
    }

    let activeSlug = this.manifest.activeUniverse;
    if (!activeSlug || !this.manifest.universes[activeSlug]) {
      activeSlug = Object.keys(this.manifest.universes)[0] || null;
      this.manifest.activeUniverse = activeSlug;
    }

    if (activeSlug) {
      const filePath = this._filePath(activeSlug);
      const existed = fs.existsSync(filePath);
      this.universe = new HeadlessUniverse({ filePath, useGraphStore: this.useGraphStore, debounceMs: this.debounceMs, log: this.log });
      await this.universe.load();
      this.universe.watch();
      if (!existed) await this.universe.forceSave(); // materialize the new file
    }

    this._writeManifest();
    return this;
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  listUniverses() {
    return Object.values(this.manifest.universes).map((u) => ({ ...u, active: u.slug === this.manifest.activeUniverse }));
  }

  getActive() {
    const slug = this.manifest.activeUniverse;
    return slug ? (this.manifest.universes[slug] || null) : null;
  }

  get activeSlug() { return this.manifest.activeUniverse; }
  get activeFilePath() { return this.manifest.activeUniverse ? this._filePath(this.manifest.activeUniverse) : null; }
  get stateVersion() { return this.universe?.stateVersion ?? 0; }

  // ── Mutations ─────────────────────────────────────────────────────────────
  /** Create a new universe (and activate it by default). Returns its entry. */
  async createUniverse(name, { activate = true } = {}) {
    const slug = this._registerUniverse(name);
    this._writeManifest();
    if (activate) await this.switchActive(slug);
    return this.manifest.universes[slug];
  }

  /** Make `slug` the active universe: flush current, load its file into the store. */
  async switchActive(slug) {
    const entry = this.manifest.universes[slug];
    if (!entry) throw new Error(`No such universe: ${slug}`);
    if (!this.universe) throw new Error('workspace is not open');
    await this.universe.switchTo(this._filePath(slug));
    await this.universe.forceSave(); // ensure the (possibly new) active file exists on disk
    this.manifest.activeUniverse = slug;
    this._writeManifest();
    return entry;
  }

  /** Delete a universe. If it was active, switch to another (or a fresh default). */
  async deleteUniverse(slug, { keepFile = false } = {}) {
    const entry = this.manifest.universes[slug];
    if (!entry) throw new Error(`No such universe: ${slug}`);
    const filePath = this._filePath(slug);
    const wasActive = this.manifest.activeUniverse === slug;

    delete this.manifest.universes[slug];

    if (wasActive) {
      const others = Object.keys(this.manifest.universes);
      const nextSlug = others[0] || this._registerUniverse('Universe');
      await this.switchActive(nextSlug);
    }
    if (!keepFile) { try { fs.unlinkSync(filePath); } catch { /* already gone */ } }
    this._writeManifest();
    return { deleted: slug, active: this.manifest.activeUniverse };
  }

  /** Detach a storage slot ('git' | 'local') from a universe (does not delete the file). */
  unlink(slug, slotType) {
    const entry = this.manifest.universes[slug];
    if (!entry) throw new Error(`No such universe: ${slug}`);
    if (slotType === 'git') {
      entry.gitRepo = { enabled: false, linkedRepo: null };
      if (entry.sourceOfTruth === 'git') entry.sourceOfTruth = 'local';
    } else if (slotType === 'local') {
      if (!entry.gitRepo?.enabled) throw new Error('Cannot unlink the only (local) source of a universe');
      entry.sourceOfTruth = 'git';
    } else {
      throw new Error(`Unknown slot: ${slotType} (expected 'git' or 'local')`);
    }
    this._writeManifest();
    return entry;
  }

  /**
   * Register/replace a git link on a universe (Phase D wires the sync engine).
   * @param {string} slug
   * @param {object} linkedRepo  { type:'github', user, repo, authMethod, branch? }
   * @param {object} [opts]      { universeFolder, universeFile, sourceOfTruth }
   */
  setGitLink(slug, linkedRepo, { universeFolder = null, universeFile = null, sourceOfTruth = 'git' } = {}) {
    const entry = this.manifest.universes[slug];
    if (!entry) throw new Error(`No such universe: ${slug}`);
    entry.gitRepo = {
      enabled: true,
      linkedRepo,
      universeFolder: universeFolder || slug,
      universeFile: universeFile || `${slug}.redstring`
    };
    entry.sourceOfTruth = sourceOfTruth;
    this._writeManifest();
    return entry;
  }

  async close() {
    if (this.universe) { await this.universe.close(); this.universe = null; }
    this._writeManifest();
  }

  // ── Internals ─────────────────────────────────────────────────────────────
  _manifestPath() { return path.join(this.dir, MANIFEST_DIR, MANIFEST_FILE); }

  _readManifest() {
    try {
      const raw = fs.readFileSync(this._manifestPath(), 'utf8');
      const m = JSON.parse(raw);
      if (m && typeof m === 'object' && m.universes) return { ...emptyManifest(), ...m };
    } catch { /* missing/corrupt → fresh */ }
    return emptyManifest();
  }

  _writeManifest() {
    fs.mkdirSync(path.join(this.dir, MANIFEST_DIR), { recursive: true });
    fs.writeFileSync(this._manifestPath(), JSON.stringify(this.manifest, null, 2), 'utf8');
  }

  _filePath(slug) {
    const entry = this.manifest.universes[slug];
    return path.join(this.dir, entry.localFile.path);
  }

  /** Add any `.redstring` FILES on disk that aren't already in the manifest. */
  _reconcileWithDisk() {
    const known = new Set(Object.values(this.manifest.universes).map((u) => u.localFile?.path));
    let entries = [];
    try { entries = fs.readdirSync(this.dir, { withFileTypes: true }); } catch { entries = []; }
    for (const ent of entries) {
      const f = ent.name;
      if (f === MANIFEST_DIR) continue;              // skip the .redstring manifest DIR
      if (!f.toLowerCase().endsWith('.redstring')) continue;
      if (!ent.isFile()) continue;                    // only real files, not dirs
      if (known.has(f)) continue;
      this._registerUniverseFromFile(f);
    }
  }

  _registerUniverse(name) {
    const slug = this._uniqueSlug(slugify(name));
    const fileName = this._uniqueFileName(`${sanitizeFileName(name)}.redstring`);
    this.manifest.universes[slug] = {
      slug,
      name: String(name || 'Universe'),
      sourceOfTruth: 'local',
      localFile: { path: fileName },
      gitRepo: { enabled: false, linkedRepo: null }
    };
    return slug;
  }

  _registerUniverseFromFile(fileName) {
    const base = fileName.replace(/\.redstring$/i, '');
    const slug = this._uniqueSlug(slugify(base));
    this.manifest.universes[slug] = {
      slug,
      name: base,
      sourceOfTruth: 'local',
      localFile: { path: fileName },
      gitRepo: { enabled: false, linkedRepo: null }
    };
    return slug;
  }

  /** Ensure an absolute .redstring file is registered; returns its slug. */
  _ensureFileRegistered(absFile) {
    const fileName = path.basename(absFile);
    for (const u of Object.values(this.manifest.universes)) {
      if (u.localFile?.path === fileName) return u.slug;
    }
    return this._registerUniverseFromFile(fileName);
  }

  _uniqueSlug(base) {
    if (!this.manifest.universes[base]) return base;
    let i = 2;
    while (this.manifest.universes[`${base}-${i}`]) i += 1;
    return `${base}-${i}`;
  }

  _uniqueFileName(fileName) {
    const used = new Set(Object.values(this.manifest.universes).map((u) => u.localFile?.path));
    if (!used.has(fileName)) return fileName;
    const base = fileName.replace(/\.redstring$/i, '');
    let i = 2;
    while (used.has(`${base}-${i}.redstring`)) i += 1;
    return `${base}-${i}.redstring`;
  }
}

/** Convenience: construct + open a workspace in one call. */
export async function openHeadlessWorkspace(opts, openOpts) {
  const ws = new HeadlessWorkspace(opts);
  await ws.open(openOpts);
  return ws;
}
