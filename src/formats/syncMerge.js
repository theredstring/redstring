/**
 * syncMerge(base, ours, theirs, options) → { merged, report, safe, reason }
 *
 * Pure function — no store access, no I/O. The three-way merge behind shared
 * universes (documentation/core-system/SHARED_UNIVERSE_SYNC.md).
 *
 *   base   — the universe as it was at the last sync (the file at
 *            `lastKnownRemoteSha`). The common ancestor of the other two.
 *   ours   — this device's universe now.
 *   theirs — the universe on the host now (someone else's work on top of base).
 *
 * All three are STORE states (Maps, as importFromRedstring returns them), and
 * should all come through the same import, so that a difference between them is
 * a real edit and not an artefact of how one side was read.
 *
 * Why three-way and not mergeUniverses: a two-way union cannot tell "they
 * deleted it" from "we added it", so it brings deleted things back. The base
 * settles that question.
 *
 * THE RULES
 *
 * Every entity has a stable id. For each id, compare base / ours / theirs:
 *   unchanged on a side           → the other side's version
 *   added on a side               → added
 *   deleted on a side, untouched  → deleted
 *   deleted on one, edited on other → the edit wins (nothing new is lost)
 *   changed on both               → merged field by field
 * Field by field, the same rules apply one level down; nested objects and
 * Maps recurse. A field changed to two different values is a conflict:
 * `conflictWinner` ('theirs' by default — the value already shared wins, and
 * the person merging is the one who is present to see the notice) decides,
 * and the losing value is kept in the entity's `_preserved.merge`, the same
 * bag mergeUniverses banks into. Nothing is silently dropped.
 *
 * Set-like arrays (edgeIds, definitionGraphIds, …) and Sets merge as sets:
 * additions from both sides are kept, a removal on either side removes.
 *
 * Personal state — which webs are open, the active web, panel tabs — belongs
 * to the person, not the universe: it always keeps OURS (pruned of anything
 * the merge removed). Otherwise every sync would replace your open tabs with a
 * collaborator's. Each web's pan/zoom rides in the file but lives in the
 * store's graphViews, which applying a merge leaves alone.
 *
 * After merging, one pass checks every reference. Merging entities one at a
 * time can leave a connection pointing at a Thing the other side deleted. A
 * deleted target comes back only when the side that kept it actively made or
 * changed the reference since base; a reference both sides left alone was
 * already handled by the deleting side, which cleaned it or tolerated it.
 *
 * SAFETY
 *
 * If either side deleted a large share of the universe, `safe` is false and
 * the caller must not apply the result automatically: a mass deletion arriving
 * through a merge is exactly what a wipe looks like (the 2026-07 mobile wipe,
 * the 2026-09 cache wipe). The caller falls back to asking the user.
 */

import { PERSISTED_STORE_KEYS } from './redstringFormat.js';

/** Keys that belong to the person on this device, not to the shared universe. */
export const PERSONAL_KEYS = [
  'openGraphIds',
  'activeGraphId',
  'activeDefinitionNodeId',
  'expandedGraphIds',
  'rightPanelTabs',
  'showConnectionNames'
];

/** Entity maps at the top of a store state, and what each entry is. */
const ENTITY_MAPS = {
  nodePrototypes: 'prototype',
  graphs: 'graph',
  edges: 'edge',
  edgePrototypes: 'edgePrototype'
};

/** Maps nested inside a graph, keyed by entity id. */
const NESTED_ENTITY_MAPS = {
  instances: 'instance',
  groups: 'group'
};

/** Array fields that are sets of ids: merged as sets, order kept from ours. */
const SET_LIKE_ARRAY_FIELDS = new Set([
  'edgeIds',
  'definitionGraphIds',
  'definingNodeIds',
  'externalLinks',
  'equivalentClasses',
  'memberInstanceIds',
  'definitionNodeIds'
]);

/**
 * Stamps rewritten as a side effect of editing (or of importing an old file).
 * A difference here alone is not an edit.
 */
const NOISE_KEYS = new Set(['lastModified', 'updatedAt', 'modifiedAt']);

/**
 * Losing values for these are not banked: they change constantly, a lost one
 * is a position, and banking them would fill the bag with noise.
 */
const UNBANKED_FIELDS = new Set(['x', 'y', 'scale', 'sizeMul', 'panOffset', 'zoomLevel', 'openDefinition']);

/** How many losing values to keep per field before the oldest goes. */
const BANK_LIMIT = 5;

/** A side deleting more than this share of base's Things + webs is not auto-merged… */
const MASS_DELETE_SHARE = 0.3;
/** …provided it is also more than this many. Small universes edit in big proportions. */
const MASS_DELETE_MIN = 20;

const ABSENT = Symbol('absent');

// ---------------------------------------------------------------------------
// Images
//
// One picture can be held two ways: inline as a data URL (the store, a local
// file), or as a content-addressed ref with the inline copy cleared (what Git
// holds, gitSyncEngine._externalizeImages). Compared field by field, every
// Thing with an image would read as edited between the two — so a
// collaborator's delete would be undone ("the edit wins"), and a replaced
// image would end up as the old inline copy beside the new ref. So the image
// fields are one unit, compared by what picture they show.

/** The fields that together say which picture a Thing shows. */
const IMAGE_FIELDS = new Set(['imageSrc', 'thumbnailSrc', 'imageAspectRatio', 'imageRef', 'imageRefExt']);

/** data URL → its content ref, learned by remoteMerge.primeImageRefs (hashing is async). */
const inlineImageRefs = new Map();
const INLINE_REF_LIMIT = 512;

export function rememberInlineImageRef(dataUrl, ref) {
  if (typeof dataUrl !== 'string' || typeof ref !== 'string') return;
  inlineImageRefs.delete(dataUrl);
  inlineImageRefs.set(dataUrl, ref);
  if (inlineImageRefs.size > INLINE_REF_LIMIT) inlineImageRefs.delete(inlineImageRefs.keys().next().value);
}

export const knowsInlineImageRef = (dataUrl) => inlineImageRefs.has(dataUrl);

const hasImage = (o) => isPlainObject(o) && (o.imageSrc != null || o.imageRef != null);

/**
 * Which picture an entity shows: [kind, value]. An inline copy is the truth
 * when present (replacing an image leaves the old ref beside the new data
 * URL, and the next commit externalizes the inline one).
 */
function imageKey(o) {
  if (!isPlainObject(o)) return null;
  const src = o.imageSrc;
  if (typeof src === 'string' && src.startsWith('data:')) {
    const ref = inlineImageRefs.get(src);
    return ref ? ['ref', ref] : ['inline', src];
  }
  if (typeof o.imageRef === 'string' && o.imageRef) return ['ref', o.imageRef];
  if (typeof src === 'string' && src) return ['url', src];
  return null;
}

function sameImage(a, b) {
  const ka = imageKey(a);
  const kb = imageKey(b);
  if (!ka || !kb) return !ka && !kb;
  return ka[0] === kb[0] && ka[1] === kb[1];
}

// ---------------------------------------------------------------------------
// Equality

const isPlainObject = (v) => v !== null && typeof v === 'object'
  && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v);

/** Deep equality over JSON-ish values plus Map and Set; NOISE_KEYS ignored. */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === ABSENT || b === ABSENT) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== 'object') return false;

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    }
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b)) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }

  // Plain objects. A missing key, an undefined one and a null one all mean
  // "none": the exporter writes absent optional fields as null (an older file
  // reads back with `semanticMetadata: null` where it had nothing), and that
  // upgrade is not an edit.
  const none = (v) => v === undefined || v === null;
  // The image fields are one unit, compared by the picture they show.
  const images = hasImage(a) || hasImage(b);
  if (images && !sameImage(a, b)) return false;
  const skip = (k) => NOISE_KEYS.has(k) || (images && IMAGE_FIELDS.has(k));
  for (const k of Object.keys(a)) {
    if (skip(k) || none(a[k])) continue;
    if (none(b[k]) || !deepEqual(a[k], b[k])) return false;
  }
  for (const k of Object.keys(b)) {
    if (skip(k) || none(b[k])) continue;
    if (none(a[k])) return false;
  }
  return true;
}

const eq = (a, b) => {
  if (a === ABSENT || b === ABSENT || a === null || b === null) {
    return (a === ABSENT || a === null) && (b === ABSENT || b === null);
  }
  return deepEqual(a, b);
};

// ---------------------------------------------------------------------------
// Merging values

const read = (container, key) => {
  if (container instanceof Map) return container.has(key) ? container.get(key) : ABSENT;
  if (isPlainObject(container) && Object.prototype.hasOwnProperty.call(container, key) && container[key] !== undefined) {
    return container[key];
  }
  return ABSENT;
};


/** Merge a set of keys three ways. Used for plain objects and entity Maps alike. */
function mergeKeyed(b, o, t, ctx, path, kind) {
  const asMap = o instanceof Map || t instanceof Map;
  const keys = new Set();
  const collect = (c) => {
    if (c instanceof Map) for (const k of c.keys()) keys.add(k);
    else if (isPlainObject(c)) for (const k of Object.keys(c)) keys.add(k);
  };
  collect(o); collect(t); collect(b);

  const out = asMap ? new Map() : {};

  // A picture is one unit: take all its fields from the side whose picture wins.
  let imageFrom = null;
  if (!asMap && (hasImage(o) || hasImage(t) || hasImage(b))) {
    imageFrom = mergeImage(b, o, t, ctx, path);
    for (const field of IMAGE_FIELDS) {
      const v = read(imageFrom, field);
      if (v !== ABSENT) out[field] = v;
      keys.delete(field);
    }
  }

  for (const key of keys) {
    const bv = read(b, key);
    const ov = read(o, key);
    const tv = read(t, key);
    const childPath = path.concat(key);
    const value = kind
      ? mergeEntity(bv, ov, tv, ctx, childPath, kind, key)
      : mergeValue(bv, ov, tv, ctx, childPath);
    if (value === ABSENT) continue;
    if (asMap) out.set(key, value);
    else out[key] = value;
  }
  return out;
}

/** One entity (a Thing, a web, a placement, …): presence first, then fields. */
function mergeEntity(bv, ov, tv, ctx, path, kind, id) {
  if (ov === ABSENT && tv === ABSENT) return ABSENT;

  // Report what each side did to it, relative to base.
  noteSide(ctx, 'ours', kind, id, bv, ov);
  noteSide(ctx, 'theirs', kind, id, bv, tv);

  if (bv !== ABSENT && (ov === ABSENT || tv === ABSENT)) {
    const kept = ov === ABSENT ? tv : ov;
    const deletedBy = ov === ABSENT ? 'ours' : 'theirs';
    if (eq(bv, kept)) return ABSENT; // deleted on one side, untouched on the other
    // Deleted on one side, edited on the other: the edit wins.
    ctx.report.restored.push({ kind, id, deletedBy, reason: 'edited-after-delete' });
    ctx.restoredIds.add(id);
    return kept;
  }

  if (eq(ov, tv)) return ov;
  if (eq(bv, ov)) return tv;
  if (eq(bv, tv)) return ov;

  // Changed on both sides: field by field, banking whatever loses.
  const frame = { kind, id, banked: [] };
  ctx.frames.push(frame);
  let merged;
  try {
    merged = mergeValue(bv === ABSENT ? {} : bv, ov, tv, ctx, path, { entityRoot: true });
  } finally {
    ctx.frames.pop();
  }
  if (frame.banked.length && isPlainObject(merged)) merged = bank(merged, frame.banked);
  return merged;
}

/** Which side's picture an entity ends up with. */
function mergeImage(b, o, t, ctx, path) {
  if (sameImage(o, t)) return o;
  if (sameImage(b, o)) return t;
  if (sameImage(b, t)) return o;
  // Both changed the picture. Not banked: a picture is megabytes.
  const winnerIsTheirs = ctx.conflictWinner !== 'ours';
  const frame = ctx.frames[ctx.frames.length - 1] || null;
  ctx.report.conflicts.push({ kind: frame?.kind || 'universe', id: frame?.id ?? null, field: 'image', kept: winnerIsTheirs ? 'theirs' : 'ours', banked: false });
  return winnerIsTheirs ? t : o;
}

function mergeValue(bv, ov, tv, ctx, path, { entityRoot = false } = {}) {
  if (eq(ov, tv)) return ov;
  if (eq(bv, ov)) return tv;
  if (eq(bv, tv)) return ov;

  const field = path[path.length - 1];

  // One side removed the field, the other changed it: the change wins.
  if (ov === ABSENT) return tv;
  if (tv === ABSENT) return ov;

  if (ov instanceof Map && tv instanceof Map) {
    const nestedKind = !entityRoot && ctx.isInsideGraph(path) ? (NESTED_ENTITY_MAPS[field] || null) : null;
    return mergeKeyed(bv instanceof Map ? bv : new Map(), ov, tv, ctx, path, nestedKind);
  }
  if (ov instanceof Set && tv instanceof Set) {
    return mergeSet(bv instanceof Set ? bv : new Set(), ov, tv);
  }
  if (Array.isArray(ov) && Array.isArray(tv) && (SET_LIKE_ARRAY_FIELDS.has(field) || ctx.inPreserved(path))) {
    return mergeOrderedSet(Array.isArray(bv) ? bv : [], ov, tv);
  }
  if (isPlainObject(ov) && isPlainObject(tv)) {
    return mergeKeyed(isPlainObject(bv) ? bv : {}, ov, tv, ctx, path, null);
  }

  // A real conflict: the same field changed to two different values.
  return conflict(bv, ov, tv, ctx, path);
}

function conflict(bv, ov, tv, ctx, path) {
  const winnerIsTheirs = ctx.conflictWinner !== 'ours';
  const kept = winnerIsTheirs ? tv : ov;
  const lost = winnerIsTheirs ? ov : tv;
  const frame = ctx.frames[ctx.frames.length - 1] || null;
  const fieldPath = frame ? path.slice(frameDepth(path, frame)).join('.') : path.join('.');
  const field = path[path.length - 1];
  const bankable = !!frame && !UNBANKED_FIELDS.has(field) && !ctx.inPreserved(path);

  ctx.report.conflicts.push({
    kind: frame?.kind || 'universe',
    id: frame?.id ?? null,
    field: fieldPath,
    kept: winnerIsTheirs ? 'theirs' : 'ours',
    banked: bankable
  });
  if (bankable) frame.banked.push({ field: fieldPath, value: lost });
  return kept;
}

/** Where the entity's own fields start within a full path. */
function frameDepth(path, frame) {
  const i = path.lastIndexOf(frame.id);
  return i === -1 ? 0 : i + 1;
}

/** Add losing values to `_preserved.merge` on a copy of the entity. */
function bank(entity, banked) {
  const preserved = isPlainObject(entity._preserved) ? { ...entity._preserved } : {};
  const bag = isPlainObject(preserved.merge) ? { ...preserved.merge } : {};
  for (const { field, value } of banked) {
    const existing = bag[field];
    const list = existing === undefined ? [] : [].concat(existing);
    if (!list.some((v) => deepEqual(v, value))) list.push(value);
    bag[field] = list.length === 1 ? list[0] : list.slice(-BANK_LIMIT);
  }
  preserved.merge = bag;
  return { ...entity, _preserved: preserved };
}

/**
 * What makes two set members the same member. Ids are themselves; an object
 * (an equivalentClasses entry, say) is its `@id`, or else its content — two
 * imports of one object are never the same reference.
 */
function memberKey(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v['@id'] === 'string') return `@id:${v['@id']}`;
  return `json:${stableStringify(v)}`;
}

function stableStringify(v) {
  if (v instanceof Map) return stableStringify(Object.fromEntries(v));
  if (v instanceof Set) return stableStringify([...v]);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function mergeSet(b, o, t) {
  const merged = mergeOrderedSet([...b], [...o], [...t]);
  return new Set(merged);
}

/** Set semantics, ours' order, theirs' additions appended. */
function mergeOrderedSet(b, o, t) {
  const bs = new Set(b.map(memberKey));
  const ts = new Set(t.map(memberKey));
  const out = [];
  const seen = new Set();
  for (const v of o) {
    const k = memberKey(v);
    if (seen.has(k)) continue;
    if (ts.has(k) || !bs.has(k)) { out.push(v); seen.add(k); }
  }
  for (const v of t) {
    const k = memberKey(v);
    if (seen.has(k)) continue;
    if (!bs.has(k)) { out.push(v); seen.add(k); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reporting

function noteSide(ctx, side, kind, id, bv, sv) {
  if (!ctx.trackKinds.has(kind)) return;
  const bucket = ctx.report[side];
  if (bv === ABSENT && sv !== ABSENT) bucket.added.push({ kind, id });
  else if (bv !== ABSENT && sv === ABSENT) bucket.deleted.push({ kind, id });
  else if (bv !== ABSENT && sv !== ABSENT && !eq(bv, sv)) bucket.changed.push({ kind, id });
}

const emptySide = () => ({ added: [], changed: [], deleted: [] });

// ---------------------------------------------------------------------------
// Reference integrity

/**
 * Every reference one entity holds to another, as
 * { from: [kind, id, graphId?], to: [kind, id, graphId?] }.
 */
function collectReferences(state, instanceIndex) {
  const refs = [];
  const proto = (from, id) => { if (id != null) refs.push({ from, to: { kind: 'prototype', id } }); };

  for (const [gid, graph] of state.graphs || []) {
    const fromGraph = { kind: 'graph', id: gid };
    for (const pid of graph?.definingNodeIds || []) proto(fromGraph, pid);
    for (const [iid, inst] of graph?.instances || []) {
      proto({ kind: 'instance', id: iid, graphId: gid }, inst?.prototypeId);
    }
    for (const [grid, group] of graph?.groups || []) {
      const fromGroup = { kind: 'group', id: grid, graphId: gid };
      proto(fromGroup, group?.linkedNodePrototypeId);
      if (group?.anchorInstanceId != null) {
        refs.push({ from: fromGroup, to: { kind: 'instance', id: group.anchorInstanceId, graphId: gid } });
      }
    }
  }
  for (const [eid, edge] of state.edges || []) {
    const fromEdge = { kind: 'edge', id: eid };
    for (const end of [edge?.sourceId, edge?.destinationId]) {
      if (end != null) refs.push({ from: fromEdge, to: { kind: 'instance', id: end, graphId: instanceIndex.get(end) ?? null } });
    }
    if (edge?.typeNodeId != null) refs.push({ from: fromEdge, to: { kind: 'type', id: edge.typeNodeId } });
    for (const pid of edge?.definitionNodeIds || []) proto(fromEdge, pid);
  }
  for (const [pid, p] of state.nodePrototypes || []) {
    const fromProto = { kind: 'prototype', id: pid };
    proto(fromProto, p?.typeNodeId);
    for (const gid of p?.definitionGraphIds || []) refs.push({ from: fromProto, to: { kind: 'graph', id: gid } });
    for (const chain of Object.values(p?.abstractionChains || {})) {
      if (Array.isArray(chain)) for (const id of chain) proto(fromProto, id);
    }
  }
  return refs;
}

function indexInstances(state) {
  const index = new Map(); // instanceId → graphId
  for (const [gid, graph] of state.graphs || []) {
    for (const iid of graph?.instances?.keys?.() || []) index.set(iid, gid);
  }
  return index;
}

function lookup(state, ref, instanceIndex) {
  switch (ref.kind) {
    case 'prototype': return state.nodePrototypes?.get(ref.id);
    case 'graph': return state.graphs?.get(ref.id);
    case 'edge': return state.edges?.get(ref.id);
    case 'type': return state.nodePrototypes?.get(ref.id) ?? state.edgePrototypes?.get(ref.id);
    case 'instance': {
      const gid = ref.graphId ?? instanceIndex?.get(ref.id);
      return gid != null ? state.graphs?.get(gid)?.instances?.get(ref.id) : undefined;
    }
    case 'group': return state.graphs?.get(ref.graphId)?.groups?.get(ref.id);
    default: return undefined;
  }
}

/**
 * Was this entity made or changed since base (on whichever side it came from)?
 * Anything the merge itself brought back counts: restoring a placement is
 * pointless unless the Thing it places comes back with it.
 */
function isFresh(merged, base, ref, mergedIndex, baseIndex, restoredIds) {
  if (restoredIds.has(ref.id)) return true;
  const now = lookup(merged, ref, mergedIndex);
  const then = lookup(base, ref, baseIndex);
  return then === undefined || !deepEqual(now, then);
}

/**
 * Bring back targets that a fresh reference still needs. Mutates `merged`
 * (which the merge built and owns), copying any shared object it touches.
 */
function repairReferences(merged, sides, ctx) {
  const { base, ours, theirs } = sides;
  const baseIndex = indexInstances(base);
  const sideIndexes = [indexInstances(theirs), indexInstances(ours), baseIndex];
  const sources = [theirs, ours, base];

  for (let pass = 0; pass < 8; pass++) {
    const mergedIndex = indexInstances(merged);
    let changed = false;
    for (const { from, to } of collectReferences(merged, mergedIndex)) {
      if (lookup(merged, to, mergedIndex) !== undefined) continue;
      if (!isFresh(merged, base, from, mergedIndex, baseIndex, ctx.restoredIds)) continue;

      // Find the target on a side that still has it, newest first.
      let found = null;
      for (let i = 0; i < sources.length && !found; i++) {
        const where = to.kind === 'instance' ? { ...to, graphId: sideIndexes[i].get(to.id) ?? null } : to;
        const value = lookup(sources[i], where, sideIndexes[i]);
        if (value !== undefined) found = { value, where, side: sources[i] };
      }
      if (!found) continue; // dangling on every side: nothing to restore

      restore(merged, found, ctx);
      ctx.restoredIds.add(to.id);
      ctx.report.restored.push({ kind: to.kind === 'type' ? 'prototype' : to.kind, id: to.id, reason: 'still-referenced', by: from });
      changed = true;
    }
    if (!changed) break;
  }
}

function restore(merged, { value, where, side }, ctx) {
  switch (where.kind) {
    case 'prototype':
      merged.nodePrototypes.set(where.id, value);
      break;
    case 'type':
      if (side.nodePrototypes?.get(where.id) === value) merged.nodePrototypes.set(where.id, value);
      else merged.edgePrototypes.set(where.id, value);
      break;
    case 'graph':
      merged.graphs.set(where.id, value);
      break;
    case 'instance': {
      let graph = merged.graphs.get(where.graphId);
      if (!graph) {
        // The whole web went; bring it back from the side the placement came from.
        graph = side.graphs.get(where.graphId);
        merged.graphs.set(where.graphId, graph);
        ctx.restoredIds.add(where.graphId);
        ctx.report.restored.push({ kind: 'graph', id: where.graphId, reason: 'still-referenced' });
        return;
      }
      const instances = new Map(graph.instances || []);
      instances.set(where.id, value);
      merged.graphs.set(where.graphId, { ...graph, instances });
      break;
    }
    default:
      break;
  }
}

/** Drop ids from id lists whose targets are gone. These are lists, not facts. */
function pruneIdLists(merged) {
  for (const [gid, graph] of merged.graphs) {
    let next = graph;
    if (Array.isArray(graph.edgeIds) && graph.edgeIds.some((id) => !merged.edges.has(id))) {
      next = { ...next, edgeIds: graph.edgeIds.filter((id) => merged.edges.has(id)) };
    }
    if (graph.groups instanceof Map) {
      let groups = null;
      for (const [grid, group] of graph.groups) {
        const members = group?.memberInstanceIds;
        if (Array.isArray(members) && members.some((id) => !graph.instances?.has(id))) {
          groups = groups || new Map(graph.groups);
          groups.set(grid, { ...group, memberInstanceIds: members.filter((id) => graph.instances?.has(id)) });
        }
      }
      if (groups) next = { ...next, groups };
    }
    if (next !== graph) merged.graphs.set(gid, next);
  }
  for (const key of ['savedNodeIds', 'savedGraphIds']) {
    const set = merged[key];
    if (set instanceof Set) {
      for (const id of [...set]) if (!merged.nodePrototypes.has(id)) set.delete(id);
    }
  }
}

/** Ours' personal state, minus anything the merge took away. */
function personalState(ours, merged) {
  const has = (gid) => merged.graphs.has(gid);
  const openGraphIds = (ours.openGraphIds || []).filter(has);
  const expandedGraphIds = new Set([...(ours.expandedGraphIds || [])].filter(has));
  let activeGraphId = ours.activeGraphId ?? null;
  if (activeGraphId != null && !has(activeGraphId)) activeGraphId = openGraphIds[0] ?? null;
  let activeDefinitionNodeId = ours.activeDefinitionNodeId ?? null;
  if (activeDefinitionNodeId != null && !merged.nodePrototypes.has(activeDefinitionNodeId)) activeDefinitionNodeId = null;

  let rightPanelTabs = Array.isArray(ours.rightPanelTabs) ? ours.rightPanelTabs : [];
  const tabAlive = (tab) => {
    if (!tab || typeof tab !== 'object') return false;
    if (tab.nodeId != null && !merged.nodePrototypes.has(tab.nodeId)) return false;
    if (tab.graphId != null && !has(tab.graphId)) return false;
    return true;
  };
  if (rightPanelTabs.some((tab) => !tabAlive(tab))) {
    rightPanelTabs = rightPanelTabs.filter(tabAlive);
    if (!rightPanelTabs.some((tab) => tab.isActive)) {
      const home = rightPanelTabs.find((tab) => tab.type === 'home');
      if (home) rightPanelTabs = rightPanelTabs.map((tab) => (tab === home ? { ...tab, isActive: true } : tab));
      else rightPanelTabs = [{ type: 'home', isActive: true }, ...rightPanelTabs];
    }
  }

  return {
    openGraphIds,
    activeGraphId,
    activeDefinitionNodeId,
    expandedGraphIds,
    rightPanelTabs,
    showConnectionNames: !!ours.showConnectionNames
  };
}

// ---------------------------------------------------------------------------
// Safety

function massDeletion(base, side) {
  const total = (base.nodePrototypes?.size || 0) + (base.graphs?.size || 0);
  if (total === 0) return null;
  let deleted = 0;
  for (const id of base.nodePrototypes?.keys() || []) if (!side.nodePrototypes?.has(id)) deleted++;
  for (const id of base.graphs?.keys() || []) if (!side.graphs?.has(id)) deleted++;
  if (deleted > MASS_DELETE_MIN && deleted > total * MASS_DELETE_SHARE) return { deleted, total };
  // A collapse, whatever the count: the shape of a store a failed load left
  // nearly empty. Same rule as SaveCoordinator._isCatastrophicShrinkage, which
  // not every Git commit path passes through.
  const things = base.nodePrototypes?.size || 0;
  const thingsLeft = side.nodePrototypes?.size || 0;
  const collapsedThings = things >= 5 && thingsLeft <= Math.max(2, Math.floor(things * 0.1));
  const lostEveryWeb = (base.graphs?.size || 0) >= 1 && (side.graphs?.size || 0) === 0;
  if (deleted > 0 && (collapsedThings || lostEveryWeb)) return { deleted, total };
  // Everything gone is a wipe however small the universe (emptying a universe
  // completely is refused everywhere else too).
  if (deleted > 0 && deleted === total) return { deleted, total };
  return null;
}

// ---------------------------------------------------------------------------

const DOCUMENT_KEYS = PERSISTED_STORE_KEYS.filter((k) => !PERSONAL_KEYS.includes(k)).concat('_preserved');

/**
 * @param {Object} base   store state at the last sync
 * @param {Object} ours   this device's store state
 * @param {Object} theirs the host's store state
 * @param {Object} [options]
 * @param {'theirs'|'ours'} [options.conflictWinner='theirs'] who wins a field
 *   both sides changed to different values. The loser is banked either way.
 * @param {boolean} [options.checkDeletions=true] refuse mass deletions. Off
 *   only for re-applying a merge that already passed this check.
 * @returns {{ merged: Object, report: Object, safe: boolean, reason: string|null }}
 */
export function syncMerge(base, ours, theirs, options = {}) {
  const { conflictWinner = 'theirs', checkDeletions = true } = options;
  base = base || {};
  ours = ours || {};
  theirs = theirs || {};

  const report = {
    ours: emptySide(),
    theirs: emptySide(),
    conflicts: [],
    restored: [],
    massDeletion: null
  };

  const oursMass = checkDeletions ? massDeletion(base, ours) : null;
  const theirsMass = checkDeletions ? massDeletion(base, theirs) : null;
  if (oursMass || theirsMass) {
    report.massDeletion = oursMass ? { side: 'ours', ...oursMass } : { side: 'theirs', ...theirsMass };
    const { side, deleted, total } = report.massDeletion;
    return {
      merged: null,
      report,
      safe: false,
      reason: `${side === 'ours' ? 'This device' : 'The repository'} removed ${deleted} of ${total} Things and webs since the last sync`
    };
  }

  const ctx = {
    conflictWinner,
    report,
    frames: [],
    restoredIds: new Set(),
    trackKinds: new Set(['prototype', 'graph', 'edge', 'edgePrototype']),
    isInsideGraph: (path) => path.length === 3 && path[0] === 'graphs',
    inPreserved: (path) => path.includes('_preserved')
  };

  const merged = {};
  for (const key of DOCUMENT_KEYS) {
    const bv = key in base ? base[key] : ABSENT;
    const ov = key in ours ? ours[key] : ABSENT;
    const tv = key in theirs ? theirs[key] : ABSENT;
    const kind = ENTITY_MAPS[key] || null;
    let value;
    if (kind) {
      value = mergeKeyed(bv instanceof Map ? bv : new Map(), ov instanceof Map ? ov : new Map(), tv instanceof Map ? tv : new Map(), ctx, [key], kind);
    } else {
      value = mergeValue(bv, ov, tv, ctx, [key]);
    }
    if (value !== ABSENT && value !== undefined) merged[key] = value;
  }

  // A merged map must never alias an input's: repair and pruning mutate it.
  for (const key of Object.keys(ENTITY_MAPS)) {
    if (!(merged[key] instanceof Map)) merged[key] = new Map();
  }
  for (const key of ['savedNodeIds', 'savedGraphIds']) {
    merged[key] = new Set(merged[key] instanceof Set ? merged[key] : []);
  }

  repairReferences(merged, { base, ours, theirs }, ctx);
  pruneIdLists(merged);

  Object.assign(merged, personalState(ours, merged));
  return { merged, report, safe: true, reason: null };
}

/** Did a side change anything in the shared document? (Personal state excluded.) */
export function documentChanged(base, side) {
  for (const key of DOCUMENT_KEYS) {
    if (!eq(key in base ? base[key] : ABSENT, key in side ? side[key] : ABSENT)) return true;
  }
  return false;
}

/** One-line summary of a side's changes, for notices: { things, webs, connections }. */
export function summarizeSide(sideReport) {
  const count = (kinds) => {
    const ids = new Set();
    for (const bucket of ['added', 'changed', 'deleted']) {
      for (const entry of sideReport[bucket]) if (kinds.includes(entry.kind)) ids.add(entry.id);
    }
    return ids.size;
  };
  return {
    things: count(['prototype']),
    webs: count(['graph']),
    connections: count(['edge', 'edgePrototype'])
  };
}
