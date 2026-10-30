/**
 * The one counter every data-loss guard uses.
 *
 * Every "did this shrink to nothing" check in the save/sync/conflict paths
 * needs the same number: how many prototypes did the USER make. The store
 * seeds `base-thing-prototype` and `base-connection-prototype` on its own,
 * and the UI re-adds "Thing" whenever it goes missing — so a universe that
 * was just emptied by a bad read still reports one or two prototypes. On
 * 2026-09-12 that single seeded prototype was enough to walk an empty state
 * past the engine floor (armed at 1822), the local-file guard, the secondary
 * sync guard and the slot-conflict check, and overwrite a 6.9 MB universe.
 *
 * This module has NO imports so the store, the format layer and the services
 * can all use it without cycles. It accepts every shape the guards see:
 *   - store state: `nodePrototypes` / `graphs` as Map, plain object, or array
 *   - raw .redstring documents: v4 `prototypeSpace.prototypes` /
 *     `spatialGraphs.graphs`, v3 `legacy.*`, v1 flat `nodePrototypes` /
 *     `nodes` / `graphs`
 *   - `{ storeState }` wrappers produced by debug/bridge exports
 *
 * `getRedstringStats` in redstringFormat.js keeps DISPLAY semantics (it counts
 * Thing and Connection because the UI does). Safety decisions use this file.
 */

export const BASE_PROTOTYPE_IDS = new Set(['base-thing-prototype', 'base-connection-prototype']);

const unwrap = (x) => (x && typeof x === 'object' && x.storeState && typeof x.storeState === 'object')
  ? x.storeState
  : x;

const keysOf = (collection) => {
  if (!collection) return [];
  if (collection instanceof Map) return [...collection.keys()];
  if (Array.isArray(collection)) return collection.map((item, index) => item?.id ?? `#${index}`);
  if (typeof collection === 'object') return Object.keys(collection);
  return [];
};

const isCollection = (value) => value instanceof Map || Array.isArray(value) || (!!value && typeof value === 'object');

/** The prototype collection of a store state or document, or null if none is recognizable. */
export const prototypeCollectionOf = (x) => {
  const d = unwrap(x);
  if (!d || typeof d !== 'object') return null;
  const candidates = [
    d.prototypeSpace?.prototypes,
    d.legacy?.nodePrototypes,
    d.nodePrototypes,
    d.nodes
  ];
  for (const candidate of candidates) {
    if (isCollection(candidate)) return candidate;
  }
  return null;
};

/** The graph collection of a store state or document, or null if none is recognizable. */
export const graphCollectionOf = (x) => {
  const d = unwrap(x);
  if (!d || typeof d !== 'object') return null;
  const candidates = [
    d.spatialGraphs?.graphs,
    d.legacy?.graphs,
    d.graphs
  ];
  for (const candidate of candidates) {
    if (isCollection(candidate)) return candidate;
  }
  return null;
};

/**
 * Does this look like Redstring data at all? An unrecognized shape (an API
 * envelope, a random object) must never be reported as "empty" — empty means
 * "safe to write over" to the guards, and unknown is not safe.
 */
export const isRecognizedShape = (x) => prototypeCollectionOf(x) != null || graphCollectionOf(x) != null;

/** Prototypes the user made — the seeded base Thing/Connection are excluded. */
export const countUserPrototypes = (x) =>
  keysOf(prototypeCollectionOf(x)).filter((id) => !BASE_PROTOTYPE_IDS.has(id)).length;

export const countGraphs = (x) => keysOf(graphCollectionOf(x)).length;

/**
 * No user-made things. Deliberately does NOT consult graphs: a state with webs
 * but no things is what a wiped store looks like after the UI re-seeds
 * Thing, and a guard that only fires on "no things AND no webs" would miss
 * it. Guards that fire on this only ever READ the destination before
 * deciding, so being strict here costs one read, not a blocked save.
 */
export const isEffectivelyEmpty = (x) => countUserPrototypes(x) === 0;

const instancesOf = (graph) => graph?.instances ?? graph?.['redstring:instances'];

/**
 * Things placed in webs, summed over every web. Counted apart from Things and
 * webs because a universe can keep every one of those and still be emptied:
 * on 2026-10-23 every web of an 1,886-thing universe was read back with no
 * placements, and guards that counted only Things and webs saved it.
 */
export const countPlacements = (x) => {
  const graphs = graphCollectionOf(x);
  if (!graphs) return 0;
  const list = graphs instanceof Map ? [...graphs.values()] : Array.isArray(graphs) ? graphs : Object.values(graphs);
  let n = 0;
  for (const graph of list) {
    const instances = instancesOf(graph);
    if (instances instanceof Map) n += instances.size;
    else if (Array.isArray(instances)) n += instances.length;
    else if (instances && typeof instances === 'object') n += Object.keys(instances).length;
  }
  return n;
};

const sizeOf = (collection) => {
  if (collection instanceof Map) return collection.size;
  if (Array.isArray(collection)) return collection.length;
  if (collection && typeof collection === 'object') return Object.keys(collection).length;
  return 0;
};

/**
 * Connections, across the universe. Counted apart for the same reason as
 * placements: every Thing, web and placement can survive while the
 * connections between them are lost, and no other count would notice.
 * A store keeps them in one `edges` collection; a v4 document inside each web.
 */
export const countConnections = (x) => {
  const d = unwrap(x);
  if (!d || typeof d !== 'object') return 0;
  if (isCollection(d.edges)) return sizeOf(d.edges);
  if (isCollection(d.legacy?.edges)) return sizeOf(d.legacy.edges);
  const graphs = graphCollectionOf(d);
  if (!graphs) return 0;
  const list = graphs instanceof Map ? [...graphs.values()] : Array.isArray(graphs) ? graphs : Object.values(graphs);
  let n = 0;
  for (const graph of list) n += sizeOf(graph?.edges ?? graph?.['redstring:edges']);
  return n;
};

export const userDataCounts = (x) => ({
  nodes: countUserPrototypes(x),
  graphs: countGraphs(x),
  recognized: isRecognizedShape(x)
});
