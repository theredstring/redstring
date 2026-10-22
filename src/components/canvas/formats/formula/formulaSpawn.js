/**
 * Formulas coming in and going out.
 *
 * Just built (New Formula, the bank): the canvas plays their entrance, the
 * plus sign's morph into a Thing (PlusSign.jsx), grown into the formula's band
 * instead. Opened from the Thing it was combined into, the band grows out of
 * that node instead (withFormulaOpenMorph). A formula loaded or switched to is
 * already there and just drawn. Kept as when it was built, so the object
 * drawing it picks the entrance up where it is, however often it mounts
 * meanwhile; a mark past its entrance (built into a web that isn't showing)
 * lapses.
 *
 * Just deleted: what was drawn is kept a moment, to play the entrance
 * backwards (its tokens leaving right to left, then its band shrinking away),
 * since the store no longer has it to draw. Combined into its Thing, the band
 * shrinks onto that node instead (condenseFormula).
 */
import useGraphStore from '../../../../store/graphStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { storeNodeRect } from '../../groups/boxMorphConnections.js';

export const SPAWN_MS = 640;
export const LEAVE_MS = 480;
const marks = new Map();

// Node.jsx insets a node's painted background this far inside its box.
const NODE_BG_INSET = 6;

/**
 * A node's painted background, as the band grows out of or shrinks onto it
 * ({ x, y, w, h, r, color }, world coordinates), or null.
 */
export function nodeBackgroundOf(graphId, nodeId, fallbackColor = null) {
  const rect = nodeId ? storeNodeRect(graphId, nodeId) : null;
  if (!rect) return null;
  const st = useGraphStore.getState();
  const node = projectGraphView(st, graphId)?.instances?.get(nodeId);
  return {
    x: rect.x + NODE_BG_INSET, y: rect.y + NODE_BG_INSET,
    w: rect.w - 2 * NODE_BG_INSET, h: rect.h - 2 * NODE_BG_INSET,
    r: Math.max(0, rect.r - NODE_BG_INSET),
    color: st.nodePrototypes.get(node?.prototypeId)?.color || fallbackColor,
  };
}

/**
 * Say a formula's group was just built. `from`: it was opened out of this
 * node's painted background (nodeBackgroundOf), not built from nothing.
 */
export function markFormulaSpawn(groupId, from = null) {
  if (groupId) marks.set(groupId, { at: performance.now(), from });
}

/** A formula's entrance while it is still playing ({ at, from }), else null. */
export function formulaSpawnOf(groupId) {
  const mark = marks.get(groupId);
  if (!mark) return null;
  if (performance.now() - mark.at > SPAWN_MS) { marks.delete(groupId); return null; }
  return mark;
}

/** Whether opening this node in place shows a formula: it was one, combined into its Thing. */
export function opensAsFormula(viewGraphId, instanceId) {
  return projectGraphView(useGraphStore.getState(), viewGraphId)?.instances?.get(instanceId)?.format === 'formula';
}

/**
 * Opens a formula's Thing back into the formula, its band growing out of the
 * node, as condenseFormula folds it in. The formula's own drawing plays it: the
 * box morph (groups/boxMorph.js) would grow a Thing-group's box the formula
 * hides. `write` makes the store change and returns the group's id (or null).
 */
export function withFormulaOpenMorph({ viewGraphId, instanceId }, write) {
  const from = nodeBackgroundOf(viewGraphId, instanceId);
  const groupId = write();
  if (groupId && from) markFormulaSpawn(groupId, from);
  return groupId;
}

const NONE = [];
let leaving = NONE;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());

/**
 * Keep a formula's drawing (a formulaObjects object) to play its exit, from
 * now. Gone again once it has played. Returns `{ into(rect) }`, to aim the
 * exit at a node's painted background ({ x, y, w, h, r, color }, world
 * coordinates) rather than at nothing.
 */
export function markFormulaLeaving(obj) {
  if (!obj) return null;
  const start = performance.now();
  const mine = (l) => l.obj === obj && l.start === start;
  leaving = [...leaving.filter(l => l.obj.groupId !== obj.groupId), { obj, start, into: null }];
  emit();
  setTimeout(() => {
    if (!leaving.some(mine)) return;
    const rest = leaving.filter(l => !mine(l));
    leaving = rest.length ? rest : NONE;
    emit();
  }, LEAVE_MS + 40);
  return {
    into(rect) {
      leaving = leaving.map(l => (mine(l) ? { ...l, into: rect } : l));
      emit();
    },
  };
}

/** The formulas playing their exit: { obj, start, into }[]. */
export const leavingFormulasNow = () => leaving;

export function subscribeLeavingFormulas(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
