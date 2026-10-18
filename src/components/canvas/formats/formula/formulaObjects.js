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
import { isGroupInsideGroup } from '../../../../services/groupLayout.js';
import { readFormulaGroup, tokensOf, chainText } from './formulaChain.js';

/** Canvas units, so a formula reads at the size of the Things it stands for. */
export const FORMULA_FONT = 44;
export const FORMULA_FONT_FAMILY = 'EmOne, sans-serif';
export const FORMULA_FONT_WEIGHT = 'bold';
const RAISE_SCALE = 0.62;  // a raised token's size, per level
const RAISE_STEP = 0.5;    // how far each level lifts, in the size it is lifted from
const RAISE_GAP_IN = 0.08; // space before an exponent, in the line's em
const RAISE_GAP_OUT = 0.18; // and after it, so what follows doesn't crowd it
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
  if (t.joined) return [0.02, t.kind === 'operator' ? 0.3 : 0.1];
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
  let prevLevel = 0;
  const boxes = tokens.map((t) => {
    const level = t.level || 0;
    const size = font * Math.pow(RAISE_SCALE, level);
    let lift = 0;
    for (let i = 0; i < level; i++) lift += RAISE_STEP * font * Math.pow(RAISE_SCALE, i);
    if (level > prevLevel) x += RAISE_GAP_IN * font;
    else if (level < prevLevel) x += RAISE_GAP_OUT * font;
    prevLevel = level;
    const [padL, padR] = padsFor(t);
    const w = measure(t.text, size) + (padL + padR) * size;
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
export function computeFormulaObjects(state, { standard = true } = {}) {
  const graphId = state?.activeGraphId;
  if (!graphId) return EMPTY;
  const view = projectGraphView(state, graphId);
  if (!view?.instances || !view.groups?.size) return EMPTY;
  if (last && last.view === view && last.protos === state.nodePrototypes && last.edges === state.edges && last.standard === standard) {
    return last.result;
  }
  const shownGroups = [];
  view.groups.forEach((group) => { if (group.format === 'formula') shownGroups.push(group); });
  if (shownGroups.length === 0) {
    last = { view, protos: state.nodePrototypes, edges: state.edges, standard, result: EMPTY };
    return EMPTY;
  }

  const objects = [];
  const hiddenIds = new Set();
  const hiddenGroupIds = new Set();
  const tokenBoxById = new Map();

  const allGroups = [...view.groups.values()];
  for (const group of shownGroups) {
    const memberIds = (group.memberInstanceIds || []).filter(id => view.instances.has(id));
    if (memberIds.some(id => hiddenIds.has(id))) continue; // one formula per Thing
    const chain = readFormulaGroup(state, view, group);
    if (!chain) continue; // no longer a formula: its Things come back on their own

    // Centred where its Things were.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of memberIds) {
      const inst = view.instances.get(id);
      if (inst.isGroupAnchor) continue; // drawn as its group's title, from the members
      const proto = state.nodePrototypes.get(inst.prototypeId);
      const dims = getNodeDimensions({ ...proto, ...inst, name: proto?.name }, false, null);
      minX = Math.min(minX, inst.x); minY = Math.min(minY, inst.y);
      maxX = Math.max(maxX, inst.x + dims.currentWidth); maxY = Math.max(maxY, inst.y + dims.currentHeight);
    }
    if (!Number.isFinite(minX)) continue;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const tokens = tokensOf(chain, { standard });
    const line = layoutFormulaLine(tokens);
    const left = cx - line.width / 2;
    const boxes = line.boxes.map(b => ({ ...b, x: b.x + left, y: b.y + cy, textX: b.textX + left, baseline: b.baseline + cy }));
    const frame = {
      x: left - FRAME_PAD_X * FORMULA_FONT,
      y: cy - line.height / 2 - FRAME_PAD_Y * FORMULA_FONT,
      w: line.width + 2 * FRAME_PAD_X * FORMULA_FONT,
      h: line.height + 2 * FRAME_PAD_Y * FORMULA_FONT,
    };

    // A connection from outside lands on the first token of the Thing it reaches:
    // an operand, or a part's opening parenthesis (or sign, or function name).
    const protoOf = new Map();
    tokens.forEach((t, i) => {
      if (t.protoId && !protoOf.has(t.protoId)) protoOf.set(t.protoId, state.nodePrototypes.get(t.protoId));
      if (t.target && !t.target.startsWith('edge:') && !tokenBoxById.has(t.target)) {
        const b = boxes[i];
        tokenBoxById.set(t.target, { x: b.x, y: b.y, w: Math.max(b.w, 0.3 * FORMULA_FONT), h: b.h });
      }
    });

    memberIds.forEach(id => hiddenIds.add(id));
    hiddenGroupIds.add(group.id);
    const memberSet = new Set(memberIds);
    allGroups.forEach(g => { if (isGroupInsideGroup(g, group, memberSet)) hiddenGroupIds.add(g.id); });
    objects.push({
      graphId, groupId: group.id, memberIds, chain, text: chainText(chain),
      tokens, boxes, frame, center: { x: cx, y: cy }, protoOf, groupColor: group.color,
    });
  }

  const result = objects.length ? { objects, hiddenIds, hiddenGroupIds, tokenBoxById } : EMPTY;
  // Measured before EmOne has loaded, the widths are the fallback font's: don't keep them.
  const fontsReady = typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';
  last = fontsReady ? { view, protos: state.nodePrototypes, edges: state.edges, standard, result } : null;
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

// The last scene handed to sceneWithFormulas, and what it became.
let lastScene = null;

/**
 * A connection hit-test scene (see utils/canvas/edgeHitTest.js) as the canvas
 * draws it: no connections inside a shown formula, and the ones from outside
 * at their tokens. Without this a click on the formula's empty surroundings
 * picked up its hidden operations, and outside connections answered where
 * their Things used to be drawn. Returns the scene itself while nothing is shown.
 */
export function sceneWithFormulas(scene, state, options) {
  const fo = computeFormulaObjects(state, options);
  if (!fo.hiddenIds.size) return scene;
  if (lastScene && lastScene.scene === scene && lastScene.fo === fo) return lastScene.result;
  const result = { ...redirectEdgeCtx(scene, fo), visibleEdges: filterFormulaEdges(scene.visibleEdges || [], fo) };
  lastScene = { scene, fo, result };
  return result;
}
