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
import { importFromRedstring, exportToRedstring, PERSISTED_STORE_KEYS } from '../../src/formats/redstringFormat.js';
import { serializeRedstring } from '../../src/formats/universeBytes.js';
import { deepEqual } from '../../src/formats/syncMerge.js';
import { createHash } from 'node:crypto';

export const SLUG = 'forest';
export const PATH = `universes/${SLUG}/${SLUG}.redstring`;
const SNAPSHOT_KEYS = [...PERSISTED_STORE_KEYS, 'graphViews'];

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
// The file form, and comparing universes as the file holds them

export const fileText = (state) => new TextDecoder().decode(serializeRedstring(exportToRedstring(state)));
export const fromFile = (text) => importFromRedstring(JSON.parse(text)).storeState;
export const asFile = (state) => fromFile(fileText(state));

const DOC = ['graphs', 'nodePrototypes', 'edges', 'edgePrototypes'];
const withoutCameras = (graphs) => new Map([...graphs].map(([id, { panOffset, zoomLevel, ...g }]) => [id, g]));
/**
 * Which picture a Thing shows. Saving to Git moves a picture out of the file
 * and leaves a ref (sha256 of its bytes), so the person who added it holds it
 * inline and everyone else holds the ref: the same picture.
 */
const pictureOf = ({ imageSrc, imageRef }) => {
  const inline = typeof imageSrc === 'string' && imageSrc.match(/^data:[^;,]+;base64,(.*)$/);
  if (inline) return `sha256:${createHash('sha256').update(Buffer.from(inline[1], 'base64')).digest('hex')}`;
  return imageRef || imageSrc || null;
};
const byPicture = (prototypes) => new Map([...prototypes].map(([id, { imageSrc, thumbnailSrc, imageRef, imageRefExt, ...rest }]) => {
  const picture = pictureOf({ imageSrc, imageRef });
  return [id, picture ? { ...rest, picture } : rest];
}));
const docOf = (state) => {
  const f = asFile(state);
  return {
    ...Object.fromEntries(DOC.map((k) => [k, f[k] || new Map()])),
    graphs: withoutCameras(f.graphs || new Map()),
    nodePrototypes: byPicture(f.nodePrototypes || new Map())
  };
};

/** The same shared universe? Compared as each would be saved; cameras and personal state aside. */
export function sameDocument(a, b) {
  const [x, y] = [docOf(a), docOf(b)];
  return DOC.every((k) => deepEqual(x[k], y[k]));
}

/** Where two universes differ, briefly, for a failure message. */
export function describeDifference(a, b) {
  const [x, y] = [docOf(a), docOf(b)];
  const lines = [];
  for (const k of DOC) {
    const ids = new Set([...x[k].keys(), ...y[k].keys()]);
    for (const id of ids) {
      const [ea, eb] = [x[k].get(id), y[k].get(id)];
      if (deepEqual(ea, eb)) continue;
      if (!ea || !eb) { lines.push(`${k} ${id}: only in ${ea ? 'first' : 'second'} (${(ea || eb)?.name ?? ''})`); continue; }
      const show = (v) => JSON.stringify(v, (_, val) => (val instanceof Map ? Object.fromEntries(val) : val instanceof Set ? [...val] : val))?.slice(0, 200);
      const diff = (x, y, path) => {
        if (deepEqual(x, y)) return [];
        const kids = (v) => (v instanceof Map ? Object.fromEntries(v) : v);
        const [px, py] = [kids(x), kids(y)];
        if (px && py && typeof px === 'object' && typeof py === 'object' && !Array.isArray(px) && path.split('.').length < 5) {
          return [...new Set([...Object.keys(px), ...Object.keys(py)])].flatMap((f) => diff(px[f], py[f], `${path}.${f}`));
        }
        return [`${path} ${show(x)} vs ${show(y)}`];
      };
      lines.push(`${k} ${id}: ${diff(ea, eb, '').join('; ')}`);
    }
  }
  return lines.slice(0, 12).join('\n') || '(no difference)';
}

/** Connections pointing at Things that aren't there, and the like. */
export function brokenReferences(state) {
  const problems = [];
  const f = asFile(state);
  for (const [gid, g] of f.graphs) {
    for (const [iid, inst] of g.instances || []) if (!f.nodePrototypes.has(inst.prototypeId)) problems.push(`${gid}/${iid} -> missing Thing ${inst.prototypeId}`);
    for (const eid of g.edgeIds || []) if (!f.edges.has(eid)) problems.push(`${gid} lists missing connection ${eid}`);
  }
  for (const [eid, e] of f.edges) {
    const has = (iid) => [...f.graphs.values()].some((g) => g.instances?.has(iid));
    if (!has(e.sourceId) || !has(e.destinationId)) problems.push(`connection ${eid} has a missing end`);
  }
  return problems;
}

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
      commits.push({ path, sha, author });
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
      return commits.filter((c) => c.path === path).reverse().map((c) => ({ sha: c.sha, author: c.author }));
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
  const applyDocument = (doc) => {
    const { state, result } = within(device.state, () => useGraphStore.getState().applyRemoteDocument(doc));
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
    device.state = snapshot();
    engine.markRemoteObserved({ sha: remote.sha, nodeCount: device.state.nodePrototypes.size, contentHash: engine.generateStateHash(device.state) });
  };
  return device;
}
