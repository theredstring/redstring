/**
 * Formulas coming in and going out.
 *
 * Shown the other way (formulaSwapMorph): as its formula, the band grows out
 * of the Thing-group's box; as its Things, it goes back into that box.
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
import { formulaCentreOf } from './formulaObjects.js';
import { detachedCopy } from '../../groups/boxMorph.js';

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
 * How far a formula's middle is from its Thing's ({ dx, dy }, the Thing's
 * minus the formula's), or null. A formula and the Thing it folds into share
 * a middle, so each grows out of or shrinks into the other where it stands.
 */
function formulaOffFromThing(graphId, groupId, nodeId) {
  const centre = formulaCentreOf(useGraphStore.getState(), graphId, groupId);
  const rect = storeNodeRect(graphId, nodeId);
  if (!centre || !rect) return null;
  return { dx: rect.x + rect.w / 2 - centre.x, dy: rect.y + rect.h / 2 - centre.y };
}

/**
 * Opens a formula's Thing back into the formula, its band growing out of the
 * node, as condenseFormula folds it in. The formula's own drawing plays it: the
 * box morph (groups/boxMorph.js) would grow a Thing-group's box the formula
 * hides. `write` makes the store change and returns the group's id (or null).
 *
 * An open definition's top-left sits on its node (initialOpenOffset), and a
 * formula's row runs far wider than one Thing: it is moved, in the same step,
 * to stand centred on its node.
 */
export function withFormulaOpenMorph({ viewGraphId, instanceId }, write) {
  const bg = nodeBackgroundOf(viewGraphId, instanceId);
  // The node as drawn, fading off the band as it grows out of it.
  const el = bg && typeof document !== 'undefined'
    ? document.querySelector(`svg.canvas g.node[data-instance-id=${JSON.stringify(instanceId)}]`)
    : null;
  const from = bg && { ...bg, copy: el ? detachedCopy(el) : null };
  const st = useGraphStore.getState();
  const groupId = st.withHistoryTransaction('Opened in place', () => {
    const id = write();
    const off = id ? formulaOffFromThing(viewGraphId, id, instanceId) : null;
    if (off && (off.dx || off.dy)) {
      useGraphStore.getState().updateNodeInstance(viewGraphId, instanceId, (draft) => {
        const at = draft.openDefinition?.offset;
        if (at) draft.openDefinition.offset = { x: at.x + off.dx, y: at.y + off.dy };
      });
    }
    return id;
  });
  if (groupId && from) markFormulaSpawn(groupId, from);
  return groupId;
}

const NONE = [];
let leaving = NONE;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());

/**
 * Keep a formula's drawing (a formulaObjects object) to play its exit, from
 * now. Gone again once it has played. Returns `{ into(rect, { reveal }) }`,
 * to aim the exit at a node's painted background ({ x, y, w, h, r, color },
 * world coordinates) rather than at nothing, or at a Thing-group's box (the
 * same, with its `inner` ground and `title`: formulaSwapMorph.groupBoxOf);
 * `reveal` there is the node, coming in as the formula fades off it.
 *
 * `reveal`: a CSS selector for what the exit makes way for (shown as its
 * Things, the group's box, its Things and their connections), held hidden
 * until the exit is nearly done and then faded in under it.
 */
export function markFormulaLeaving(obj, { reveal = null } = {}) {
  if (!obj) return null;
  const start = performance.now();
  const mine = (l) => l.obj === obj && l.start === start;
  leaving = [...leaving.filter(l => l.obj.groupId !== obj.groupId), { obj, start, into: null, reveal }];
  emit();
  setTimeout(() => {
    if (!leaving.some(mine)) return;
    const rest = leaving.filter(l => !mine(l));
    leaving = rest.length ? rest : NONE;
    emit();
  }, LEAVE_MS + 40);
  return {
    into(rect, { reveal: shown = null } = {}) {
      leaving = leaving.map(l => (mine(l) ? { ...l, into: rect, ...(shown ? { reveal: shown } : {}) } : l));
      emit();
    },
  };
}

/** The formulas playing their exit: { obj, start, into, reveal }[]. */
export const leavingFormulasNow = () => leaving;

export function subscribeLeavingFormulas(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
