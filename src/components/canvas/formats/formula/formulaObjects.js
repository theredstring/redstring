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
 *
 * It is drawn the way a Thing-group is: a band in its Thing's color with the
 * equation's title on it (the Thing's name: "Ideal Gas Law", or its text while
 * it has none), and the formula inside. Connections to the equation itself land
 * on the title.
 */
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { getNodeDimensions } from '../../../../utils.js';
import { isGroupInsideGroup, GROUP_LAYOUT_CONSTANTS, labelHeightConst, computeGroupLayout, buildGroupsByMemberIdIndex, groupLabelSizing, groupTitleScaleOf } from '../../../../services/groupLayout.js';
import { measureTextWidth } from '../../../../services/textMeasurement.js';
import { readFormulaGroup, tokensOf, chainText, subscriptOf, expandFor, rowsOf, VECTOR_MARK } from './formulaChain.js';
import { setReplaced } from '../replaced.js';
import { RAISE_SCALE, RAISE_STEP, RAISE_GAP_IN, RAISE_GAP_OUT, SUBSCRIPT_SCALE, SUBSCRIPT_DROP } from './formulaScale.js';

export { SUBSCRIPT_SCALE, SUBSCRIPT_DROP };

/** Canvas units, so a formula reads at the size of the Things it stands for. */
export const FORMULA_FONT = 50;
export const FORMULA_FONT_FAMILY = 'EmOne, sans-serif';
export const FORMULA_FONT_WEIGHT = 'bold';
const BOX_EM = 1.5;      // token box height, in its own em
const STACKED_BOX_EM = 1.15; // in a fraction, where the rows above and below are close
const BASELINE_EM = 0.36; // baseline below the line's middle, in the line's em
export const FRAME_PAD_X = 0.55; // em
export const FRAME_PAD_Y = 0.42; // em
// A fraction, in the line's em: numerator and denominator centred over each
// other, the bar a little wider than both and level with the minus sign.
const FRACTION_GAP = 0.14;   // between the bar and the letters above and below it
const FRACTION_BAR = 0.07;   // the bar's thickness
const FRACTION_OVERHANG = 0.14; // the bar past the wider of the two
const FRACTION_MARGIN = 0.12; // either side of the fraction
const FRACTION_AXIS = 0.08;  // the bar below the line's middle, where − and = sit
const BAR_HIT_EM = 0.5;      // the bar's box, for pointing at the division
const LINE_CLEAR = 0.12;     // between a fraction's letters and the frame
// A root, in its sign's em: the sign as tall as what it holds, its bar over all of it.
const ROOT_LEAD = 0.1;       // before the sign
const ROOT_SIGN_W = 0.6;     // the sign's hook, up to where the bar starts
const ROOT_PAD = 0.08;       // between the hook and what it holds
const ROOT_GAP = 0.14;       // between the bar and the letters under it
const ROOT_DROP = 0.1;       // the hook's foot below the letters
const ROOT_OVERHANG = 0.08;  // the bar past what it holds
const ROOT_TRAIL = 0.1;      // after it
const ROOT_STROKE = 0.075;
// A sum's ∑, an integral's ∫ and a limit's lim, in the size of the line they are on.
const SUM_SCALE = 1.45;      // ∑, drawn larger than the letters it runs over
const INTEGRAL_SCALE = 1.6;  // ∫, taller still
const BIG_MARGIN = 0.1;      // either side of the sign and its limits
const BIG_GAP = 0.06;        // between ∑ (or lim) and the limits over and under it
const INTEGRAL_KERN = -0.12; // its upper limit in against the ∫'s top, which leans right
const INTEGRAL_UNDER = -0.34; // and its lower limit further in, under the lean
const BIG_PAD = 0.06;        // the sign's box, past its ink
// A vector's arrow over its letter, in the letter's em.
const ARROW_RISE = 0.14;     // above the letter's top
const ARROW_INSET = 0.08;    // in from either side of the letter
const ARROW_HEAD = 0.13;
export const ARROW_STROKE = 0.065;
/** The title, as a Thing-group's (groupElements.jsx), before the title size (groupTitleScaleOf): each object carries its `titleFont`. */
export const TITLE_FONT = 45;
const G = GROUP_LAYOUT_CONSTANTS;

let measureCtx = null;
function ensureMeasure() {
  if (measureCtx === null) {
    try {
      // undefined, not null, when there's no 2D context: null means "not tried yet".
      measureCtx = (typeof document !== 'undefined' && document.createElement('canvas').getContext('2d')) || undefined;
    } catch { measureCtx = undefined; }
  }
  return measureCtx;
}

// Without a canvas to measure on (tests), letters that hang below the line, by sight.
const DESCENDERS = /[gjpqyβγζημξρςφχψ,∫]/;
const unmarked = (text) => String(text).split(VECTOR_MARK).join('');
/** How far one run of text's letters reach above and below its baseline (a vector's arrow too). */
function inkOfRun(text, size) {
  const ctx = ensureMeasure();
  const arrow = String(text).includes(VECTOR_MARK) ? (ARROW_RISE + ARROW_HEAD) * size : 0;
  if (ctx) {
    ctx.font = `${FORMULA_FONT_WEIGHT} ${size}px ${FORMULA_FONT_FAMILY}`;
    const m = ctx.measureText(unmarked(text));
    if (Number.isFinite(m.actualBoundingBoxAscent)) return { above: m.actualBoundingBoxAscent + arrow, below: m.actualBoundingBoxDescent };
  }
  return { above: 0.72 * size + arrow, below: (DESCENDERS.test(text) ? 0.22 : 0.02) * size };
}

/**
 * A vector's arrow over its letter (F⃗), drawn rather than left to the font,
 * which rarely places U+20D7 well: from just inside the letter's left to just
 * inside its right, a little above its top. `x` is where the letter starts.
 */
export function arrowOver(letter, x, baseline, size) {
  const w = measure(letter, size);
  const ctx = ensureMeasure();
  let above = 0.72 * size;
  if (ctx) {
    ctx.font = `${FORMULA_FONT_WEIGHT} ${size}px ${FORMULA_FONT_FAMILY}`;
    const m = ctx.measureText(letter);
    if (Number.isFinite(m.actualBoundingBoxAscent)) above = m.actualBoundingBoxAscent;
  }
  const y = baseline - above - ARROW_RISE * size;
  const x1 = x + ARROW_INSET * size;
  const x2 = x + Math.max(w - ARROW_INSET * size, ARROW_INSET * size + 0.3 * size);
  return { x1, x2, y, head: ARROW_HEAD * size, stroke: ARROW_STROKE * size };
}

/**
 * How far a token's letters reach above and below its baseline, measured from
 * the font as TeX measures a glyph's height and depth: a q's tail and a
 * subscript (k_e) reach below it, so a fraction's bar clears them.
 */
function inkOf(text, size) {
  const sub = subscriptOf(text);
  if (!sub) return inkOfRun(text, size);
  const main = inkOfRun(sub[0], size);
  const low = inkOfRun(sub[1], size * SUBSCRIPT_SCALE);
  const drop = SUBSCRIPT_DROP * size;
  return { above: Math.max(main.above, low.above - drop), below: Math.max(main.below, drop + low.below) };
}

/** How wide a run of a formula's text is at a size, as its layout measures it (and its text morph, letter by letter). */
export function measure(text, size) {
  if (!text) return 0;
  const shown = unmarked(text);
  ensureMeasure();
  if (!measureCtx) return shown.length * size * 0.62;
  measureCtx.font = `${FORMULA_FONT_WEIGHT} ${size}px ${FORMULA_FONT_FAMILY}`;
  return measureCtx.measureText(shown).width;
}

function padsFor(t) {
  if (t.sub) return [0.03, 0.07]; // a logarithm's base, against its "log"
  if (t.subNext) return [t.joined ? 0.2 : 0.13, 0.02];
  // A function's name keeps a little room from what it multiplies (B log₂, 2 sin).
  if (t.joined) return [t.kind === 'function' ? 0.2 : 0.05, t.kind === 'operator' ? 0.34 : 0.13];
  if (t.kind === 'operator') return t.prefix ? [0.13, 0.06] : [0.34, 0.34];
  if (t.kind === 'comma') return [0, 0.38];
  if (t.kind === 'paren') return [0.05, 0.05];
  return [0.13, 0.13];
}

// A token written by its Thing's name is drawn as that Thing, a pill in its color.
const PILL_EM = 1.7;     // height, in the token's em
export const PILL_PAD = 0.5;    // inside, either side of the name
const PILL_MARGIN = 0.14; // outside, either side
export const PILL_RADIUS = 0.4; // of its height, as a node's corners are of its

/**
 * Where each token goes, relative to the line's left end and vertical middle.
 * Each box: { x, y, w, h, size, baseline, textX, pill?, bar?, root? } in canvas
 * units; `pill` ({ x, y, w, h }) for a token written by name, `bar` for a
 * division stacked as a fraction (its token is the bar), `root` ({ x, y, w, h,
 * signW, stroke }) for a square root drawn over what it holds (its token is the sign). A sum's ∑, an
 * integral's ∫ or a limit's lim is its token's text, drawn larger, its limits
 * placed around it. `top` and `bottom` are how far the line reaches above and
 * below its middle (negative above).
 */
export function layoutFormulaLine(tokens, font = FORMULA_FONT) {
  const boxes = new Array(tokens.length);
  const move = (indices, dx, dy) => {
    for (const i of indices) {
      const b = boxes[i];
      boxes[i] = {
        ...b, x: b.x + dx, y: b.y + dy, textX: b.textX + dx, baseline: b.baseline + dy,
        ...(b.pill ? { pill: { ...b.pill, x: b.pill.x + dx, y: b.pill.y + dy } } : {}),
        ...(b.bar ? { bar: { ...b.bar, x: b.bar.x + dx, y: b.bar.y + dy } } : {}),
        ...(b.root ? { root: { ...b.root, x: b.root.x + dx, y: b.root.y + dy } } : {}),
      };
    }
  };
  // One row from x = 0: its width, how far its letters reach (top, bottom), and its tokens.
  const layRow = (row, depth) => {
    let x = 0;
    let prevLevel = 0;
    let top = 0;
    let bottom = 0;
    const indices = [];
    const boxEm = depth > 0 ? STACKED_BOX_EM : BOX_EM;
    for (const entry of row) {
      if (typeof entry !== 'number' && entry.kind === 'big') {
        const sign = tokens[entry.sign];
        const level = sign.level || 0;
        const base = font * Math.pow(RAISE_SCALE, level);
        if (level > prevLevel) x += RAISE_GAP_IN * font;
        else if (level < prevLevel) x += RAISE_GAP_OUT * font;
        prevLevel = level;
        // lim is a word on the line; ∑ and ∫ are larger, centred where − sits.
        const word = sign.kind === 'function';
        const size = word ? base : base * (entry.scripts ? INTEGRAL_SCALE : SUM_SCALE);
        const textW = measure(sign.text, size);
        const ink = inkOfRun(sign.text, size);
        const baseline = word ? BASELINE_EM * font : FRACTION_AXIS * font + (ink.above - ink.below) / 2;
        const signTop = baseline - ink.above;
        const signBottom = baseline + ink.below;
        const over = layRow(entry.over, depth + 1);
        const under = layRow(entry.under, depth + 1);
        const left = x + BIG_MARGIN * base;
        let signX;
        let end;
        let overDy = 0;
        let underDy = 0;
        if (entry.scripts) {
          // ∫ₐᵇ: the limits at its side, the upper level with its top, the lower with its foot.
          signX = left;
          const overX = signX + textW + INTEGRAL_KERN * base;
          const underX = signX + textW + INTEGRAL_UNDER * base;
          overDy = signTop - over.top;
          underDy = signBottom - under.bottom;
          move(over.indices, overX, overDy);
          move(under.indices, underX, underDy);
          end = Math.max(signX + textW, over.indices.length ? overX + over.width : 0, under.indices.length ? underX + under.width : 0);
        } else {
          // ∑ and lim: what they run over centred under them, where they stop over them.
          const w = Math.max(textW, over.width, under.width);
          signX = left + (w - textW) / 2;
          overDy = signTop - BIG_GAP * base - over.bottom;
          underDy = signBottom + BIG_GAP * base - under.top;
          move(over.indices, left + (w - over.width) / 2, overDy);
          move(under.indices, left + (w - under.width) / 2, underDy);
          end = left + w;
        }
        const pad = BIG_PAD * size;
        boxes[entry.sign] = {
          x: signX - pad, y: signTop - pad, w: textW + 2 * pad, h: signBottom - signTop + 2 * pad, size, baseline, textX: signX,
        };
        indices.push(entry.sign, ...over.indices, ...under.indices);
        top = Math.min(top, signTop, over.indices.length ? over.top + overDy : 0);
        bottom = Math.max(bottom, signBottom, under.indices.length ? under.bottom + underDy : 0);
        x = end + BIG_MARGIN * base;
        continue;
      }
      if (typeof entry !== 'number' && entry.kind === 'root') {
        const sign = tokens[entry.sign];
        const level = sign.level || 0;
        const size = font * Math.pow(RAISE_SCALE, level);
        if (level > prevLevel) x += RAISE_GAP_IN * font;
        else if (level < prevLevel) x += RAISE_GAP_OUT * font;
        prevLevel = level;
        const body = layRow(entry.body, depth + 1);
        const stroke = ROOT_STROKE * size;
        const barY = body.top - ROOT_GAP * size;
        const footY = body.bottom + ROOT_DROP * size;
        const signX = x + ROOT_LEAD * size;
        const bodyX = signX + ROOT_SIGN_W * size + ROOT_PAD * size;
        move(body.indices, bodyX, 0);
        const end = bodyX + body.width + ROOT_OVERHANG * size;
        boxes[entry.sign] = {
          x, y: barY, w: end - x, h: footY - barY, size, baseline: footY, textX: signX,
          root: { x: signX, y: barY, w: end - signX, h: footY - barY, signW: ROOT_SIGN_W * size, stroke },
        };
        indices.push(entry.sign, ...body.indices);
        top = Math.min(top, barY - stroke / 2);
        bottom = Math.max(bottom, footY + stroke / 2);
        x = end + ROOT_TRAIL * size;
        continue;
      }
      if (typeof entry !== 'number') {
        const num = layRow(entry.num, depth + 1);
        const den = layRow(entry.den, depth + 1);
        x += (prevLevel > 0 ? RAISE_GAP_OUT : 0) * font + FRACTION_MARGIN * font;
        prevLevel = 0;
        const w = Math.max(num.width, den.width) + 2 * FRACTION_OVERHANG * font;
        const barY = FRACTION_AXIS * font;
        const barH = FRACTION_BAR * font;
        const numDy = barY - barH / 2 - FRACTION_GAP * font - num.bottom;
        const denDy = barY + barH / 2 + FRACTION_GAP * font - den.top;
        move(num.indices, x + (w - num.width) / 2, numDy);
        move(den.indices, x + (w - den.width) / 2, denDy);
        if (entry.bar !== null) {
          const hitH = BAR_HIT_EM * font;
          boxes[entry.bar] = {
            x, y: barY - hitH / 2, w, h: hitH, size: font, baseline: barY, textX: x,
            bar: { x, y: barY - barH / 2, w, h: barH },
          };
          indices.push(entry.bar);
        }
        indices.push(...num.indices, ...den.indices);
        top = Math.min(top, num.top + numDy);
        bottom = Math.max(bottom, den.bottom + denDy);
        x += w + FRACTION_MARGIN * font;
        continue;
      }
      const t = tokens[entry];
      const level = t.level || 0;
      const levelSize = font * Math.pow(RAISE_SCALE, level);
      // A logarithm's base is lowered and smaller, as a subscript is; a sum's limits are small.
      const size = (t.sub ? levelSize * SUBSCRIPT_SCALE : levelSize) * (t.script ? RAISE_SCALE : 1);
      let lift = 0;
      for (let i = 0; i < level; i++) lift += RAISE_STEP * font * Math.pow(RAISE_SCALE, i);
      if (level > prevLevel) x += RAISE_GAP_IN * font;
      else if (level < prevLevel) x += RAISE_GAP_OUT * font;
      prevLevel = level;
      const sub = subscriptOf(t.text);
      const textW = sub ? measure(sub[0], size) + measure(sub[1], size * SUBSCRIPT_SCALE) : measure(t.text, size);
      const baseline = BASELINE_EM * font - lift + (t.sub ? SUBSCRIPT_DROP * levelSize : 0);
      const middle = baseline - BASELINE_EM * size;
      let box;
      if (t.expanded) {
        const ph = PILL_EM * size;
        const pill = { x: x + PILL_MARGIN * size, y: middle - ph / 2, w: textW + 2 * PILL_PAD * size, h: ph };
        box = { x, y: pill.y, w: pill.w + 2 * PILL_MARGIN * size, h: ph, size, baseline, textX: pill.x + PILL_PAD * size, pill };
        top = Math.min(top, pill.y);
        bottom = Math.max(bottom, pill.y + ph);
      } else {
        const [padL, padR] = padsFor(t);
        const h = boxEm * size;
        box = { x, y: middle - h / 2, w: textW + (padL + padR) * size, h, size, baseline, textX: x + padL * size };
        const ink = inkOf(t.text, size);
        top = Math.min(top, baseline - ink.above);
        bottom = Math.max(bottom, baseline + ink.below);
      }
      boxes[entry] = box;
      indices.push(entry);
      x += box.w;
    }
    return { width: x, top, bottom, indices };
  };
  const line = layRow(rowsOf(tokens), 0);
  // A plain line is as tall as its tokens' boxes; a fraction makes it taller.
  const top = Math.min(-BOX_EM * font / 2, line.top - LINE_CLEAR * font);
  const bottom = Math.max(BOX_EM * font / 2, line.bottom + LINE_CLEAR * font);
  return { boxes, width: line.width, height: bottom - top, top, bottom };
}

const EMPTY = Object.freeze({ objects: [], hiddenIds: new Set(), hiddenGroupIds: new Set(), tokenBoxById: new Map(), standIns: new Map(), anchors: new Map() });

let last = null;

/**
 * The formula objects to draw in the active web.
 *
 * @param {object} state - graphStore state
 */
export function computeFormulaObjects(state, { standard = true, namesShown = NO_NAMES, flipped = NO_FLIPS } = {}) {
  const result = formulaObjectsOf(state, standard, namesShown, flipped);
  // What the formulas replace can't be hit, and is drawn at its token (formats/replaced.js).
  setReplaced(result.hiddenIds, result.hiddenGroupIds, result.standIns, result.anchors);
  return result;
}

const NO_NAMES = new Set();
const NO_FLIPS = new Map();

/** Whether EmOne has loaded: widths measured before are the fallback font's. */
export const formulaFontsReady = () => typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';

/**
 * A group's box as the canvas draws it when shown as its Things (its band:
 * computeGroupLayout's `rect`, laid out as groupLayouts.computeGroupLayouts
 * does), or null. Measured as Things, not as formats: this is the box the
 * formula and its Things swap between.
 */
function thingBoxesOf(state, view) {
  const named = new Map();
  view.groups.forEach((g, id) => {
    const name = (g.linkedNodePrototypeId && state.nodePrototypes.get(g.linkedNodePrototypeId)?.name) || g.name || 'Group';
    named.set(id, name === g.name ? g : { ...g, name });
  });
  const dims = new Map();
  const context = {
    nodesById: view.instances,
    dimsById: {
      get: (id) => {
        if (!dims.has(id)) {
          const inst = view.instances.get(id);
          const proto = inst && state.nodePrototypes.get(inst.prototypeId);
          dims.set(id, inst ? getNodeDimensions({ ...proto, ...inst, name: proto?.name }, false, null) : undefined);
        }
        return dims.get(id);
      },
    },
    groupsById: named,
    groupsByMemberId: buildGroupsByMemberIdIndex(named),
    gridSize: state.gridSettings?.size || 200,
    // Measured as the canvas measures it; without a canvas (tests), a title never widens a box.
    ...groupLabelSizing(state.textSettings, (text, font) => (ensureMeasure() ? measureTextWidth(text, font) : 0)),
    _cache: new Map(),
  };
  return (group) => {
    const layout = computeGroupLayout(named.get(group.id) || group, context);
    return layout?.ok ? layout.rect : null;
  };
}

/**
 * Where a formula is centred, where its Things were: across, on the middle of
 * its box as its Things (`box`; the groups inside it widen that on their
 * side, so swapping between the two stays in place); down, on its Things.
 * Null when it has no Things to stand for.
 */
function centreOf(state, view, memberIds, box) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of memberIds) {
    const inst = view.instances.get(id);
    if (!inst || inst.isGroupAnchor) continue; // drawn as its group's title, from the members
    const proto = state.nodePrototypes.get(inst.prototypeId);
    const dims = getNodeDimensions({ ...proto, ...inst, name: proto?.name }, false, null);
    minX = Math.min(minX, inst.x); minY = Math.min(minY, inst.y);
    maxX = Math.max(maxX, inst.x + dims.currentWidth); maxY = Math.max(maxY, inst.y + dims.currentHeight);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: box ? box.x + box.w / 2 : (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Where a group's formula is centred in a web (as formulaObjects draws it),
 * whether or not it is shown as its formula now; null when it has no Things.
 */
export function formulaCentreOf(state, graphId, groupId) {
  const view = projectGraphView(state, graphId);
  const group = view?.groups?.get(groupId);
  if (!group) return null;
  return centreOf(state, view, group.memberInstanceIds || [], thingBoxesOf(state, view)(group));
}

function formulaObjectsOf(state, standard, namesShown, flipped) {
  const graphId = state?.activeGraphId;
  if (!graphId) return EMPTY;
  const view = projectGraphView(state, graphId);
  if (!view?.instances || !view.groups?.size) return EMPTY;
  // Measured before EmOne has loaded, the widths are the fallback font's: kept
  // only until it has (useFormulaObjects re-reads then), never past it. Kept
  // all the same, so the same inputs give the same object (React re-reads a
  // store snapshot and loops forever on one that is new each time).
  const fontsReady = formulaFontsReady();
  if (last && last.fontsReady === fontsReady && last.view === view && last.text === state.textSettings && last.grid === state.gridSettings && last.protos === state.nodePrototypes && last.edges === state.edges && last.standard === standard && last.namesShown === namesShown && last.flipped === flipped) {
    return last.result;
  }
  const result = formulaObjectsIn(state, view, graphId, { standard, namesShown, flipped });
  last = { fontsReady, view, text: state.textSettings, grid: state.gridSettings, protos: state.nodePrototypes, edges: state.edges, standard, namesShown, flipped, result };
  return result;
}

/**
 * The formula objects of any web `view` (a projectGraphView, or the same shape:
 * `instances`, `groups`, `edgeIds`, `openView.edges`), worked out fresh: no
 * cache, and nothing written to formats/replaced.js. The active web's go
 * through computeFormulaObjects; a web drawn small (webPreview) reads this.
 */
export function formulaObjectsIn(state, view, graphId, { standard = true, namesShown = NO_NAMES, flipped = NO_FLIPS } = {}) {
  if (!view?.instances || !view.groups?.size) return EMPTY;
  const shownGroups = [];
  view.groups.forEach((group) => { if (group.format === 'formula') shownGroups.push(group); });
  if (shownGroups.length === 0) return EMPTY;

  const objects = [];
  const hiddenIds = new Set();
  const hiddenGroupIds = new Set();
  const tokenBoxById = new Map();

  const allGroups = [...view.groups.values()];
  const thingBoxOf = thingBoxesOf(state, view);
  // The title tab, at the group title's size: it runs into and out of one.
  const titleScale = groupTitleScaleOf(state.textSettings);
  const titleFont = TITLE_FONT * titleScale;
  for (const group of shownGroups) {
    const memberIds = (group.memberInstanceIds || []).filter(id => view.instances.has(id));
    if (memberIds.some(id => hiddenIds.has(id))) continue; // one formula per Thing
    const chain = readFormulaGroup(state, view, group);
    if (!chain) continue; // no longer a formula: its Things come back on their own

    const centre = centreOf(state, view, memberIds, thingBoxOf(group));
    if (!centre) continue;
    const { x: cx, y: cy } = centre;

    const tokens = tokensOf(chain, { standard, expand: expandFor(namesShown.has(group.id), flipped.get(group.id)) });
    const line = layoutFormulaLine(tokens);
    const left = cx - line.width / 2;
    // Centred on its middle: a tall numerator and a short denominator share the room evenly.
    const lineY = cy - (line.top + line.bottom) / 2;
    const boxes = line.boxes.map(b => ({
      ...b, x: b.x + left, y: b.y + lineY, textX: b.textX + left, baseline: b.baseline + lineY,
      ...(b.pill ? { pill: { ...b.pill, x: b.pill.x + left, y: b.pill.y + lineY } } : {}),
      ...(b.bar ? { bar: { ...b.bar, x: b.bar.x + left, y: b.bar.y + lineY } } : {}),
      ...(b.root ? { root: { ...b.root, x: b.root.x + left, y: b.root.y + lineY } } : {}),
    }));

    // The equation: its Thing when it is a Thing-group, else the group itself.
    const equationProto = group.linkedNodePrototypeId ? state.nodePrototypes.get(group.linkedNodePrototypeId) : null;
    const named = equationProto?.name || group.name || '';
    // Untitled, its name is just its text: the band carries no title, rather than say the formula twice.
    const compact = (t) => String(t).replace(/\s+/g, '');
    const title = named && compact(named) !== compact(chainText(chain)) ? named : '';
    const color = equationProto?.color || group.color || null;
    const titleH = title ? labelHeightConst(titleScale, titleFont) : 0;
    const titleW = title ? Math.max(G.titleMinWidth * titleScale, measure(title, titleFont) + G.titlePaddingHorizontal * 2 * titleScale) : 0;
    // The formula's own ground, inside a band the title sits on.
    let innerW = line.width + 2 * FRAME_PAD_X * FORMULA_FONT;
    innerW = Math.max(innerW, titleW + G.titlePaddingHorizontal * 2 - G.innerCanvasBorder * 2);
    const innerH = line.height + 2 * FRAME_PAD_Y * FORMULA_FONT;
    const inner = { x: cx - innerW / 2, y: cy - innerH / 2, w: innerW, h: innerH };
    const bandTop = title ? inner.y - G.titleBottomMargin - titleH - G.titleTopMargin : inner.y - G.innerCanvasBorder;
    const frame = {
      x: inner.x - G.innerCanvasBorder,
      y: bandTop,
      w: inner.w + G.innerCanvasBorder * 2,
      h: inner.y + inner.h + G.innerCanvasBorder - bandTop,
    };
    // Where the equation itself is: its title, or the band's top edge without one.
    const titleBox = title
      ? { x: cx - titleW / 2, y: bandTop + G.titleTopMargin, w: titleW, h: titleH }
      : { x: inner.x, y: bandTop, w: inner.w, h: G.innerCanvasBorder };

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
    if (group.anchorInstanceId && view.instances.has(group.anchorInstanceId)) {
      hiddenIds.add(group.anchorInstanceId);
      tokenBoxById.set(group.anchorInstanceId, { ...titleBox });
    }
    hiddenGroupIds.add(group.id);
    const memberSet = new Set(memberIds);
    allGroups.forEach(g => { if (isGroupInsideGroup(g, group, memberSet)) hiddenGroupIds.add(g.id); });
    objects.push({
      graphId, groupId: group.id, memberIds, chain, text: chainText(chain),
      tokens, boxes, frame, inner, title, titleBox, titleFont, color, equationProtoId: equationProto?.id || null,
      anchorId: group.anchorInstanceId && view.instances.has(group.anchorInstanceId) ? group.anchorInstanceId : null,
      // One of its Things (not a part's anchor, whose drag position is derived):
      // the canvas's drag moves the formula as it moves that Thing.
      dragProxyId: memberIds.find(id => !view.instances.get(id)?.isGroupAnchor) || null,
      center: { x: cx, y: cy }, protoOf, groupColor: group.color,
    });
  }

  // Each token box, with the Thing whose drag carries the formula it is in, and
  // the formula's band, which a connection into the token stops at as it would
  // at a Thing-group's box.
  const standIns = new Map();
  for (const o of objects) {
    const frame = { ...o.frame, r: G.nodeGroupCornerRadius };
    for (const id of [...o.memberIds, o.anchorId]) {
      const box = id && tokenBoxById.get(id);
      if (box) standIns.set(id, { ...box, rideOn: o.dragProxyId, frame });
    }
  }
  // Each formula, whole, where its group's anchor is: connections are drawn from it and dropped on it.
  const anchors = new Map();
  for (const o of objects) if (o.anchorId) anchors.set(o.anchorId, { ...o.frame, groupId: o.groupId, memberIds: o.memberIds });
  return objects.length ? { objects, hiddenIds, hiddenGroupIds, tokenBoxById, standIns, anchors } : EMPTY;
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
