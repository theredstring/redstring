/**
 * What one save changed, in a line, for its commit message. History's Git
 * list shows it beside the account that saved:
 *
 *     ana    Added "Pressure" and "Volume"; connected "Pressure" to "Volume"
 *     ben    Arranged "Ideal gas law"
 *
 * Both states must be in the same form (two canvas states, or two read from
 * files): an entry that is the same object in both is skipped without a look,
 * so a big universe costs only what changed.
 */
import { deepEqual } from './syncMerge.js';

const COLLECTIONS = ['nodePrototypes', 'graphs', 'edges', 'edgePrototypes'];
const LAYOUT_KEYS = new Set(['x', 'y', 'scale', 'sizeMul', 'width', 'height']);
// A web's camera is where someone was looking, not anything they did.
const CAMERA_KEYS = ['panOffset', 'zoomLevel'];
const MAX_LENGTH = 140;

const quote = (name) => {
  const text = String(name || '').trim();
  if (!text) return null;
  return `"${text.length > 40 ? `${text.slice(0, 39)}…` : text}"`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const webLabel = (graph) => (quote(graph?.name) ? `the web ${quote(graph.name)}` : 'a web');

/** `"A"`, `"A" and "B"`, `"A", "B" and 3 more Things`, or `4 Things` when none have names. */
function nameList(names, noun) {
  const shown = names.map(quote).filter(Boolean).slice(0, 2);
  const rest = names.length - shown.length;
  if (!shown.length) return plural(names.length, noun);
  if (!rest) return shown.join(' and ');
  return `${shown.join(', ')} and ${rest} more ${noun}${rest === 1 ? '' : 's'}`;
}

/** Ids added, removed and changed between two Maps. */
function diffMap(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  const b = before instanceof Map ? before : new Map();
  const a = after instanceof Map ? after : new Map();
  if (b === a) return { added, removed, changed };
  for (const [id, value] of a) {
    if (!b.has(id)) added.push(id);
    else if (b.get(id) !== value && !deepEqual(b.get(id), value)) changed.push(id);
  }
  for (const id of b.keys()) if (!a.has(id)) removed.push(id);
  return { added, removed, changed };
}

/** Did only where things sit change in this placement? (An open box moved with its node counts.) */
const onlyLayout = (before, after) => Object.keys({ ...before, ...after }).every((key) => {
  if (LAYOUT_KEYS.has(key) || deepEqual(before[key], after[key])) return true;
  if (key !== 'openDefinition' || !before[key] || !after[key]) return false;
  return deepEqual(omit(before[key], ['xOffset', 'yOffset']), omit(after[key], ['xOffset', 'yOffset']));
});
const omit = (object, keys) => {
  const rest = { ...object };
  for (const key of keys) delete rest[key];
  return rest;
};
const withoutCamera = (graph) => omit(graph, ['instances', 'edgeIds', ...CAMERA_KEYS]);

/**
 * @param {Object} before - the state the repository held
 * @param {Object} after - the state being saved
 * @returns {string|null} null when nothing shared changed
 */
export function describeChanges(before, after) {
  if (!before || !after) return null;
  const nameOf = (id) => after.nodePrototypes?.get(id)?.name ?? before.nodePrototypes?.get(id)?.name;
  const things = diffMap(before.nodePrototypes, after.nodePrototypes);
  const webs = diffMap(before.graphs, after.graphs);
  const connections = diffMap(before.edges, after.edges);
  const types = diffMap(before.edgePrototypes, after.edgePrototypes);
  const newThings = new Set(things.added);
  const goneThings = new Set(things.removed);

  const clauses = [];
  if (things.added.length) clauses.push(`Added ${nameList(things.added.map(nameOf), 'Thing')}`);
  if (things.removed.length) clauses.push(`Removed ${nameList(things.removed.map(nameOf), 'Thing')}`);

  if (connections.added.length === 1) {
    const edge = after.edges.get(connections.added[0]);
    const end = (instanceId) => {
      for (const graph of after.graphs?.values?.() || []) {
        const inst = graph?.instances?.get?.(instanceId);
        if (inst) return quote(nameOf(inst.prototypeId));
      }
      return null;
    };
    const [from, to] = [end(edge?.sourceId), end(edge?.destinationId)];
    clauses.push(from && to ? `Connected ${from} to ${to}` : 'Added a connection');
  } else if (connections.added.length) {
    clauses.push(`Added ${plural(connections.added.length, 'connection')}`);
  }
  if (connections.removed.length) clauses.push(`Removed ${plural(connections.removed.length, 'connection')}`);

  // Inside webs that were there before and still are: Things placed and taken out.
  const arranged = [];
  const edited = [];
  for (const id of webs.changed) {
    const [was, now] = [before.graphs.get(id), after.graphs.get(id)];
    const placements = diffMap(was?.instances, now?.instances);
    const webName = quote(now?.name) || 'a web';
    const placed = placements.added.map((i) => now.instances.get(i)?.prototypeId).filter((p) => !newThings.has(p));
    const takenOut = placements.removed.map((i) => was.instances.get(i)?.prototypeId).filter((p) => !goneThings.has(p));
    if (placed.length) clauses.push(`Placed ${nameList(placed.map(nameOf), 'Thing')} in ${webName}`);
    if (takenOut.length) clauses.push(`Took ${nameList(takenOut.map(nameOf), 'Thing')} out of ${webName}`);
    if (placed.length || takenOut.length) continue;
    const moved = placements.changed.length > 0
      && placements.changed.every((i) => onlyLayout(was.instances.get(i), now.instances.get(i)));
    const [wasRest, nowRest] = [withoutCamera(was), withoutCamera(now)];
    if (moved && deepEqual(wasRest, nowRest)) arranged.push(now);
    else if (placements.changed.length || !deepEqual(wasRest, nowRest)) edited.push(now);
  }

  if (things.changed.length) clauses.push(`Edited ${nameList(things.changed.map(nameOf), 'Thing')}`);
  if (connections.changed.length) clauses.push(`Edited ${plural(connections.changed.length, 'connection')}`);
  const someWebs = (graphs) => (graphs.length === 1 ? webLabel(graphs[0]) : plural(graphs.length, 'web'));
  if (webs.added.length) clauses.push(`Added ${someWebs(webs.added.map((id) => after.graphs.get(id)))}`);
  if (webs.removed.length) clauses.push(`Removed ${someWebs(webs.removed.map((id) => before.graphs.get(id)))}`);
  // Moving and touching up a web only say so when nothing bigger happened.
  if (!clauses.length && edited.length) clauses.push(`Edited ${someWebs(edited)}`);
  if (!clauses.length && arranged.length) clauses.push(`Arranged ${someWebs(arranged)}`);
  if (!clauses.length && (types.added.length || types.removed.length || types.changed.length)) clauses.push('Edited connection types');
  if (!clauses.length) return null;

  const line = clauses.map((c, i) => (i ? c[0].toLowerCase() + c.slice(1) : c)).join('; ');
  return line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH - 1)}…` : line;
}

/**
 * Someone else's changes just landed on a canvas that still had edits of its
 * own on the way. The repository now holds `after` minus those edits: put back
 * the `base` value of everything edited here since `base` (by identity, down
 * to a web's placements and groups), so the next save describes this person's
 * edits and not theirs.
 *
 * @param {Object} base - what the repository held before (canvas form)
 * @param {Object} before - the canvas just before their changes landed
 * @param {Object} after - the canvas after
 */
export function rebaseSummary(base, before, after) {
  if (!base || !before || !after) return null;
  const out = { ...after };
  for (const key of COLLECTIONS) {
    if (!(base[key] instanceof Map) || !(before[key] instanceof Map) || !(after[key] instanceof Map)) continue;
    out[key] = rebaseMap(base[key], before[key], after[key], 1);
  }
  return out;
}

function rebaseMap(base, before, after, depth) {
  if (base === before) return after;
  const map = new Map(after);
  for (const id of new Set([...base.keys(), ...before.keys()])) {
    const [b, live] = [base.get(id), before.get(id)];
    if (b === live) continue;
    if (!base.has(id)) map.delete(id); // made here
    else if (!before.has(id)) map.set(id, b); // deleted here
    else if (!after.has(id)) continue; // edited here, deleted there: their delete
    else map.set(id, rebaseEntity(b, live, after.get(id), depth));
  }
  return map;
}

/** One entry edited here: its fields edited here go back to `base`, the rest stay as `after` has them. */
function rebaseEntity(base, before, after, depth) {
  const plain = (v) => v && typeof v === 'object' && !(v instanceof Map) && !Array.isArray(v);
  if (!plain(base) || !plain(before) || !plain(after)) return base;
  const out = { ...after };
  for (const key of new Set([...Object.keys(base), ...Object.keys(before)])) {
    if (base[key] === before[key]) continue;
    if (depth > 0 && base[key] instanceof Map && before[key] instanceof Map && after[key] instanceof Map) {
      out[key] = rebaseMap(base[key], before[key], after[key], depth - 1);
    } else if (key in base) out[key] = base[key];
    else delete out[key];
  }
  return out;
}
