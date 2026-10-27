/**
 * Devices for the shared-universe tests that edit through the real store.
 *
 * There is one store (a module singleton), so each device keeps its universe
 * as a snapshot and swaps it in to act: load it, run store actions or
 * applyRemoteDocument (what the app does when others' changes arrive), take
 * the snapshot back. Syncing goes through a real GitSyncEngine and the glue in
 * src/services/remoteMerge.js, against an in-memory host that refuses stale
 * writes and can lag its reads, like GitHub's.
 */
import useGraphStore from '../../src/store/graphStore.js';
import { GitSyncEngine } from '../../src/services/gitSyncEngine.js';
import { planMerge, mergeOntoCanvas, bringInRemote, primeImageRefs } from '../../src/services/remoteMerge.js';
import { PERSISTED_STORE_KEYS } from '../../src/formats/redstringFormat.js';
import { createHash } from 'node:crypto';

export const SLUG = 'forest';
export const PATH = `universes/${SLUG}/${SLUG}.redstring`;
const SNAPSHOT_KEYS = [...PERSISTED_STORE_KEYS, 'graphViews', 'syncedDocumentIds'];

// ---------------------------------------------------------------------------
// The store, one universe at a time

export const snapshot = () => {
  const s = useGraphStore.getState();
  const out = {};
  for (const key of SNAPSHOT_KEYS) if (key in s) out[key] = s[key];
  return out;
};
export const load = (state) => useGraphStore.setState({ ...state, _isLoadingUniverse: false });

/** Run `fn` against this universe in the store; returns the universe after. */
export function within(state, fn) {
  load(state);
  const result = fn();
  return { state: snapshot(), result };
}

/** A new universe with one web, made the way the app makes it. */
export function freshUniverse() {
  const s = useGraphStore.getState();
  s.clearUniverse?.();
  useGraphStore.getState().createNewGraph({ id: 'web', name: 'Forest' });
  return snapshot();
}

// ---------------------------------------------------------------------------
// The file form, and comparing universes as the file holds them (documentCompare.js)

export { fileText, fromFile, asFile, sameDocument, describeDifference, brokenReferences } from './documentCompare.js';
import { fromFile } from './documentCompare.js';

// ---------------------------------------------------------------------------
// A host: one repository, compare-and-swap writes, every version kept

export function makeHost({ readLag = 0 } = {}) {
  let shaCounter = 0;
  const files = new Map(); // path -> { content, sha }
  const history = new Map(); // path -> [{ content, sha, at }]
  const blobs = new Map();
  const commits = [];
  let clock = 0; // a step counter for read lag: reads see versions at least `readLag` steps old
  const notFound = (path) => Object.assign(new Error(`File not found: ${path}`), { code: 'FILE_NOT_FOUND', status: 404 });

  const visible = (path) => {
    const versions = history.get(path) || [];
    if (!readLag) return versions[versions.length - 1] || null;
    const ripe = versions.filter((v) => clock - v.at >= readLag);
    // GitHub's lag: the newest version may not be readable yet.
    return ripe[ripe.length - 1] || null;
  };

  const providerFor = (author) => ({
    name: `fake:${author}`,
    online: true,
    async writeFileRaw(path, content, options = {}) {
      if (!this.online) throw new Error('fetch failed: network down');
      const current = files.get(path);
      if ('expectedSha' in options) {
        const expected = options.expectedSha;
        const ok = expected == null ? !current : current && current.sha === expected;
        if (!ok) throw Object.assign(new Error('Remote file changed since last sync'), { code: 'REMOTE_DIVERGED', status: 409 });
      }
      const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
      // Named by content, as Git names blobs (other code caches by SHA).
      const sha = createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
      shaCounter++;
      const version = { content: text, sha, at: clock };
      files.set(path, version);
      if (!history.has(path)) history.set(path, []);
      history.get(path).push(version);
      blobs.set(sha, text);
      commits.push({ path, sha, author, message: options.message || `Update ${path}` });
      return { content: { sha } };
    },
    async readFileRawWithMeta(path) {
      if (!this.online) throw new Error('fetch failed: network down');
      clock++; // a read takes time; a lagging host catches up as you wait
      const file = visible(path);
      if (!file) throw notFound(path);
      return { content: file.content, sha: file.sha, size: file.content.length };
    },
    async readFileAtSha(path, sha) {
      if (!this.online) throw new Error('fetch failed: network down');
      if (!blobs.has(sha)) throw notFound(`${path}@${sha}`);
      return blobs.get(sha);
    },
    async getRemoteFileSha(path) {
      if (!this.online) throw Object.assign(new Error('network down'), { code: 'FILE_INFO_UNKNOWN', status: 0 });
      return visible(path)?.sha || null;
    },
    async listFileHistory(path) {
      return commits.filter((c) => c.path === path).reverse().map((c) => ({ sha: c.sha, author: c.author, message: c.message }));
    },
    async readBinaryFile(path) { throw notFound(path); }
  });

  return {
    files, commits, providerFor,
    tick: () => { clock++; },
    settle: () => { clock += readLag + 1; },
    current: (path = PATH) => files.get(path) || null
  };
}

// ---------------------------------------------------------------------------
// A device: its universe, an engine, and the glue universeBackend wires up

export function makeDevice(host, author) {
  const device = { author, state: null, conflicts: 0, notices: [] };
  const provider = host.providerFor(author);
  const engine = new GitSyncEngine(provider, 'git', SLUG, `${SLUG}.redstring`, SLUG);
  // Devices never share storage; in jsdom they would.
  engine._getFloorStorageKey = () => `redstring-gitengine-floor:${SLUG}:${author}`;
  engine.staleReadRetryMs = [0, 0, 0, 0];
  engine.networkRetryMs = 0;
  Object.assign(device, { provider, engine });

  // What the app does with a merge or a pull: applyRemoteDocument on the store.
  // ...and after it, markDocumentSynced (universeBackend._markSyncedIfShared).
  const applyDocument = (doc) => {
    const { state, result } = within(device.state, () => {
      const ok = useGraphStore.getState().applyRemoteDocument(doc);
      if (ok) useGraphStore.getState().markDocumentSynced();
      return ok;
    });
    if (!result) throw new Error(`${author}: applyRemoteDocument refused`);
    device.state = state;
  };

  engine.onMergeRemote = async (input) => {
    const plan = await planMerge(input);
    if (!plan.ok) {
      device.notices.push(plan.reason);
      return null;
    }
    return {
      content: plan.content,
      message: plan.summary || undefined, // as universeBackend._planRemoteMerge does
      apply: async () => {
        await primeImageRefs(device.state); // as universeBackend._applyMergedState does
        const before = device.state;
        applyDocument(mergeOntoCanvas(plan.applyBase, before, plan.merged));
        return { state: device.state, before };
      }
    };
  };
  engine.onRemoteUpdate = async (input) => {
    await primeImageRefs(device.state); // as universeBackend._applyRemoteUpdate does
    const result = bringInRemote(input, device.state);
    if (!result.ok) {
      device.notices.push(result.reason);
      return null;
    }
    const before = device.state;
    applyDocument(result.merged);
    return { state: device.state, before };
  };
  engine.onRemoteDivergence = async () => {
    device.conflicts++;
    return 'conflict';
  };

  /** Edit through the store. */
  device.act = (fn) => {
    const { state, result } = within(device.state, fn);
    device.state = state;
    return result;
  };
  /** Save now (what autosave does once things settle). Never throws: a failed save stays pending, as in the app. */
  engine.onSaved = () => { device.state = within(device.state, () => useGraphStore.getState().markDocumentSynced()).state; };
  device.save = async () => {
    engine.lastCommitTime = 0;
    try {
      return await engine.forceCommit(device.state);
    } catch (error) {
      device.notices.push(`save failed: ${error?.code || error?.message}`);
      return false;
    }
  };
  /** The every-30-seconds check for others' saves. */
  device.check = () => engine.checkRemote();
  /** Start a universe, or open the one in the repository. */
  device.start = () => { device.state = freshUniverse(); };
  device.open = async () => {
    const remote = await provider.readFileRawWithMeta(PATH);
    // As the app opens a universe: the store's own load.
    if (!useGraphStore.getState().loadUniverseFromFile(JSON.parse(remote.content))) throw new Error(`${author}: load failed`);
    useGraphStore.getState().markDocumentSynced();
    device.state = snapshot();
    engine.markRemoteObserved({ sha: remote.sha, nodeCount: device.state.nodePrototypes.size, contentHash: engine.generateStateHash(device.state), state: device.state });
  };
  return device;
}
