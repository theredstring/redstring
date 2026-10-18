/**
 * Formula objects: formulas shown in place on the canvas.
 *
 * While a piece of a web is shown as its formula, the canvas draws one object
 * where its Things were: the formula on one line, token by token. The Things
 * and the connections among them are hidden, and connections from outside land
 * on the token their Thing became. A group is shown this way when it says so
 * (`group.format === 'formula'`, saved with the group); everything else is
 * worked out at draw time. No position is written, so a drag or a save never
 * sees a token's place.
 */
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { getNodeDimensions } from '../../../../utils.js';
import { sliceOfView } from '../formatCandidates.js';
import { readFormula, linearize, formulaToText } from './formulaNotation.js';

/** Canvas units, so a formula reads at the size of the Things it stands for. */
export const FORMULA_FONT = 44;
export const FORMULA_FONT_FAMILY = 'EmOne, sans-serif';
export const FORMULA_FONT_WEIGHT = 'bold';
const RAISE_SCALE = 0.62;
const RAISE_STEP = 0.48;
const BOX_EM = 1.5;      // token box height, in its own em
const BASELINE_EM = 0.36; // baseline below the line's middle, in the line's em
export const FRAME_PAD_X = 0.55; // em
export const FRAME_PAD_Y = 0.42; // em

let measureCtx = null;
function measure(text, size) {
  if (!text) return 0;
  if (measureCtx === null) {
    try {
      // undefined, not null, when there's no 2D context: null means "not tried yet".
      measureCtx = (typeof document !== 'undefined' && document.createElement('canvas').getContext('2d')) || undefined;
    } catch { measureCtx = undefined; }
  }
  if (!measureCtx) return text.length * size * 0.62;
  measureCtx.font = `${FORMULA_FONT_WEIGHT} ${size}px ${FORMULA_FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
}

function padsFor(t) {
  if (t.raise) return [0, 0];
  if (t.kind === 'operator') return t.prefix ? [0.1, 0.04] : [0.3, 0.3];
  if (t.kind === 'comma') return [0, 0.35];
  if (t.kind === 'paren') return [0.03, 0.03];
  return [0.1, 0.1];
}

/**
 * Where each token goes on one line, relative to the line's left end and
 * vertical middle. Each box: { x, y, w, h, size, baseline } in canvas units.
 */
export function layoutFormulaLine(tokens, font = FORMULA_FONT) {
  let x = 0;
  const boxes = tokens.map((t) => {
    const level = t.level || 0;
    const size = font * Math.pow(RAISE_SCALE, level);
    let lift = 0;
    for (let i = 0; i < level; i++) lift += RAISE_STEP * font * Math.pow(RAISE_SCALE, i);
    const [padL, padR] = padsFor(t);
    const w = t.raise ? 0.14 * font : measure(t.text, size) + (padL + padR) * size;
    const baseline = BASELINE_EM * font - lift;
    const h = BOX_EM * size;
    const box = { x, y: baseline - BASELINE_EM * size - h / 2, w, h, size, baseline, textX: x + padL * size };
    x += w;
    return box;
  });
  return { boxes, width: x, height: BOX_EM * font };
}

const EMPTY = Object.freeze({ objects: [], hiddenIds: new Set(), hiddenGroupIds: new Set(), tokenBoxById: new Map() });

let last = null;

/**
 * The formula objects to draw in the active web.
 *
 * @param {object} state - graphStore state
 */
export function computeFormulaObjects(state) {
  const graphId = state?.activeGraphId;
  if (!graphId) return EMPTY;
  const view = projectGraphView(state, graphId);
  if (!view?.instances || !view.groups?.size) return EMPTY;
  if (last && last.view === view && last.protos === state.nodePrototypes && last.edges === state.edges) {
    return last.result;
  }
  const shownGroups = [];
  view.groups.forEach((group) => { if (group.format === 'formula') shownGroups.push(group); });
  if (shownGroups.length === 0) {
    last = { view, protos: state.nodePrototypes, edges: state.edges, result: EMPTY };
    return EMPTY;
  }

  const objects = [];
  const hiddenIds = new Set();
  const hiddenGroupIds = new Set();
  const tokenBoxById = new Map();

  for (const group of shownGroups) {
    const memberIds = (group.memberInstanceIds || []).filter(id => view.instances.has(id));
    if (memberIds.some(id => hiddenIds.has(id))) continue; // one formula per Thing

    const slice = sliceOfView(state, view, memberIds);
    const tree = slice && readFormula(slice);
    if (!tree) continue; // no longer a formula: its Things come back on their own

    // Centred where its Things were.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of memberIds) {
      const inst = view.instances.get(id);
      const proto = state.nodePrototypes.get(inst.prototypeId);
      const dims = getNodeDimensions({ ...proto, ...inst, name: proto?.name }, false, null);
      minX = Math.min(minX, inst.x); minY = Math.min(minY, inst.y);
      maxX = Math.max(maxX, inst.x + dims.currentWidth); maxY = Math.max(maxY, inst.y + dims.currentHeight);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const { tokens, spans } = linearize(tree);
    const line = layoutFormulaLine(tokens);
    const left = cx - line.width / 2;
    const boxes = line.boxes.map(b => ({ ...b, x: b.x + left, y: b.y + cy, textX: b.textX + left, baseline: b.baseline + cy }));
    const frame = {
      x: left - FRAME_PAD_X * FORMULA_FONT,
      y: cy - line.height / 2 - FRAME_PAD_Y * FORMULA_FONT,
      w: line.width + 2 * FRAME_PAD_X * FORMULA_FONT,
      h: line.height + 2 * FRAME_PAD_Y * FORMULA_FONT,
    };

    // A Thing's connections from outside land on its (first) token.
    tokens.forEach((t, i) => {
      if (t.nodeId && !tokenBoxById.has(t.nodeId)) {
        const b = boxes[i];
        tokenBoxById.set(t.nodeId, { x: b.x, y: b.y, w: Math.max(b.w, 0.3 * FORMULA_FONT), h: b.h });
      }
    });

    const protoOf = new Map(memberIds.map(id => [id, state.nodePrototypes.get(view.instances.get(id).prototypeId)]));
    memberIds.forEach(id => hiddenIds.add(id));
    hiddenGroupIds.add(group.id);
    objects.push({
      graphId, groupId: group.id, memberIds, tree, text: formulaToText(tree),
      tokens, spans, boxes, frame, center: { x: cx, y: cy }, protoOf, groupColor: group.color,
    });
  }

  const result = objects.length ? { objects, hiddenIds, hiddenGroupIds, tokenBoxById } : EMPTY;
  // Measured before EmOne has loaded, the widths are the fallback font's: don't keep them.
  const fontsReady = typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';
  last = fontsReady ? { view, protos: state.nodePrototypes, edges: state.edges, result } : null;
  return result;
}

/**
 * The connection layer's inputs with each hidden Thing standing at its token,
 * so a connection from outside lands there. Returns `ctx` itself when nothing
 * is shown, which keeps the layer's hover-only shortcut.
 */
export function redirectEdgeCtx(ctx, formulaObjects) {
  if (!formulaObjects.tokenBoxById.size) return ctx;
  const nodeById = new Map(ctx.nodeById);
  const baseDimsById = new Map(ctx.baseDimsById);
  formulaObjects.tokenBoxById.forEach((box, id) => {
    const node = nodeById.get(id);
    if (!node) return;
    nodeById.set(id, { ...node, x: box.x, y: box.y });
    const dims = baseDimsById.get(id) || {};
    baseDimsById.set(id, { ...dims, currentWidth: box.w, currentHeight: box.h });
  });
  return { ...ctx, nodeById, baseDimsById };
}

/** Connections drawn: none between two Things of the same shown formula. */
export function filterFormulaEdges(edges, formulaObjects) {
  if (!formulaObjects.hiddenIds.size) return edges;
  const formulaOf = new Map();
  formulaObjects.objects.forEach(o => o.memberIds.forEach(id => formulaOf.set(id, o.groupId)));
  const kept = edges.filter(e => {
    const a = formulaOf.get(e.sourceId);
    return !a || a !== formulaOf.get(e.destinationId);
  });
  return kept.length === edges.length ? edges : kept;
}
