/**
 * Formulas shown in place: one canvas object per formula group, drawn where its
 * Things are (formulaObjects.js says where). Drawn by NodeLayer after the
 * nodes, inside the canvas SVG, so it pans and zooms with the web.
 *
 * It looks like the Thing-group it is: a band in the equation's color, its
 * title on the band, the formula on the ground inside. It replaces the Things
 * it stands for entirely: they are not drawn, hit or selected while it is shown.
 *
 * It takes input the way a Thing does:
 * - a tap on a token whose Thing means more than what is written (P for
 *   Pressure, a named part's parentheses) switches it between its symbol and
 *   its Thing, drawn by name in its color; the rest of the formula slides
 *   aside to make room. Hover only lights it, to say it can. A bare symbol (an
 *   x that means nothing yet) and the standard operations (+, =, √) are just
 *   text;
 * - a tap also selects the formula's group, which brings up its control panel
 *   (the format mode of UnifiedBottomControlPanel: swap formats, write this
 *   formula by names or every operation);
 * - a double tap on a token opens that Thing in the panel (and switches
 *   nothing); on the band, the equation's own Thing;
 * - hold, then drag, is the canvas's own group drag, the one a Thing-group's
 *   title starts (groupInput.getCanvasGroupInput): edge panning, panning and
 *   zooming mid-drag, grid snap, one undo step. It moves this object with
 *   the group because the object carries one of its Things' ids, as that
 *   Thing's own element would. While it is the dragged group it lifts as a
 *   Thing-group does: scaled up a little, over the group's own shadow.
 */
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import useGraphStore from '../../../../store/graphStore.js';
import useCanvasUIStore from '../../../../store/canvasUIStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { useTheme } from '../../../../hooks/useTheme.js';
import { getTextColor, blendColors } from '../../../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR, PLUS_SIGN_SIZE } from '../../../../constants.js';
import { DEFAULT_LIFTED_THING_SHADOW } from '../../../../utils/colorUtils.js';
import { formulaSpawnStart, SPAWN_MS, LEAVE_MS, leavingFormulasNow, subscribeLeavingFormulas } from './formulaSpawn.js';
import { GROUP_LAYOUT_CONSTANTS as G } from '../../../../services/groupLayout.js';
import { NODE_GROUP_INTERIOR_TINT, groupLiftShadow } from '../../groups/groupElements.jsx';
import { groupLiftShadowOn } from '../../groups/groupLiftShadow.js';
import { useFormulaObjects } from './useFormulaObjects.js';
import { subscriptOf, vectorOf } from './formulaChain.js';
import { useGlide, GLIDE_MS, glideEase } from './useGlide.js';
import { flipFormulaToken } from '../formatsStore.js';
import { getCanvasGroupInput } from '../../groups/groupInput.js';
import {
  FORMULA_FONT_FAMILY, FORMULA_FONT_WEIGHT, SUBSCRIPT_SCALE, SUBSCRIPT_DROP, TITLE_FONT, PILL_RADIUS, PILL_PAD, arrowOver, measure,
} from './formulaObjects.js';

const MOVE_SLOP_PX = 6;      // a press that wanders this far before the lift is not a hold
const DOUBLE_TAP_MS = 320;   // a tap waits this long to switch its token, in case it is the first of two
const HOVER_TINT = 0.18;
const HOVER_REACH = 0.14;    // a hovered token's tint past its box, either side, in its em
const FADE = { duration: 0.14 };
const LIFT_SCALE = 1.05;     // a dragged Thing-group's (groupElements)
// Coming in, as the plus sign morphs into a new Thing (PlusSign.jsx): its
// rounded square grows into the band over the morph's 400 ms, on its curve,
// the band's color coming in faster; then the title, the ground, and the
// tokens one after another.
const MORPH_SHARE = 400 / SPAWN_MS;   // the band's part of it
const PLUS_LIGHT = '#DEDADA';
const PLUS_STROKE = 'maroon';
const easeMorph = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mixColor = (from, to, t) => { try { return blendColors(from, to, t); } catch { return to; } };
// WCAG relative luminance of a #rrggbb color, and the contrast between two.
const luminance = (hex) => {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * c((n >> 16) & 255) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
};
const contrast = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const COLOR_TURN = 0.5; // how sharply a token's text turns color as the pill under it fills or empties

const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/**
 * How far a just-built formula is into coming in: 0 to 1, or 1 when it isn't
 * coming in. A deleted one (`leavingStart`) goes the other way, 1 to 0, over
 * its exit.
 */
function useSpawn(groupId, leavingStart = null) {
  const leaving = leavingStart !== null;
  const [start] = useState(() => (leaving ? leavingStart : reducedMotion() ? null : formulaSpawnStart(groupId)));
  const span = leaving ? LEAVE_MS : SPAWN_MS;
  const at = (now) => {
    const p = clamp01((now - start) / span);
    return leaving ? 1 - p : p;
  };
  const [t, setT] = useState(() => (start === null ? 1 : at(performance.now())));
  useEffect(() => {
    if (start === null) return undefined;
    let frame = requestAnimationFrame(function step(now) {
      const next = at(now);
      setT(next);
      if (leaving ? next > 0 : next < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
    // `at` stands for `start`, `span` and `leaving`, which don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  return t;
}
const TITLE_TARGET = '__title__';

/** Select a group from the canvas, the way a click on its title does (groupInput.titleClick). */
function selectGroup(groupId) {
  const ui = useCanvasUIStore.getState();
  ui.setSelectedGroupId(groupId);
  ui.setSelectedInstanceIds(new Set());
  ui.setSelectedEdgeId(null);
  ui.clearSelectedEdgeIds();
  ui.setGroupControlPanelShouldShow(true);
  ui.setNodeControlPanelShouldShow(false);
  ui.setNodeControlPanelVisible(false);
  ui.setAbstractionControlPanelVisible(false);
  ui.setAbstractionControlPanelShouldShow(false);
  ui.setConnectionControlPanelVisible(false);
  ui.setConnectionControlPanelShouldShow(false);
}

function openThingInPanel(protoId) {
  const st = useGraphStore.getState();
  const prototype = protoId ? st.nodePrototypes.get(protoId) : null;
  if (!prototype) return;
  st.openRightPanelNodeTab(prototype.id, prototype.name);
  if (!st.rightPanelExpanded) st.setRightPanelExpanded(true);
}

/** A vector's arrow over its letter (F⃗). */
function VectorArrow({ letter, x, y, size, stroke }) {
  const a = arrowOver(letter, x, y, size);
  const h = a.head;
  return (
    <path
      d={`M${a.x1},${a.y} L${a.x2},${a.y} M${a.x2 - h},${a.y - h * 0.7} L${a.x2},${a.y} L${a.x2 - h},${a.y + h * 0.7}`}
      fill="none" stroke={stroke} strokeWidth={a.stroke} strokeLinecap="round" strokeLinejoin="round"
      style={{ pointerEvents: 'none' }}
    />
  );
}

/** A token's text, its subscript (v_0) lowered and smaller, a vector's arrow over it. */
function TokenTextAt({ text, at, size, fill, opacity }) {
  const sub = subscriptOf(text);
  const { letter, vector } = vectorOf(sub ? sub[0] : text);
  return (
    <>
      <text
        x={at.x} y={at.y}
        fontSize={size} fontFamily={FORMULA_FONT_FAMILY} fontWeight={FORMULA_FONT_WEIGHT}
        fill={fill} opacity={opacity}
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {sub ? (
          <>
            {letter}
            <tspan dy={size * SUBSCRIPT_DROP} fontSize={size * SUBSCRIPT_SCALE}>{sub[1]}</tspan>
          </>
        ) : letter}
      </text>
      {vector && <VectorArrow letter={letter} x={at.x} y={at.y} size={size} stroke={fill} />}
    </>
  );
}

const MORPH_MS = 290;
const smooth = (t) => t * t * (3 - 2 * t);
const REVEAL_EM = 0.6; // how far behind a pill's edge a letter takes to come fully in
const LETTER_LAG_EM = 0.3; // how far a pill's edge is past a letter before it starts to come in
const IN_DELAY = 0.22; // of MORPH_MS: no letter comes into a pill before this
const OUT_STAGGER = 0.14; // of MORPH_MS: the first leaving letter starts this much after the last
const OUT_MS = 0.14; // of MORPH_MS: how long each leaving letter takes
const GOING_MS = 90; // a token leaving the formula (the × between names) fading out
const FILL_MS = GLIDE_MS * 0.6; // a token's fill (its pill's color, its hover tint) coming in or going
const SWAP_MS = GLIDE_MS * 0.4; // a token drawn another way (a fraction's bar as ÷) crossing over
const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * What a token's text is turning from and into, and how far it is (`p`, 0 to
 * 1): `from` is null once it has. Sent back mid-way (Show Names, then at once
 * Show Symbols), the same change runs backwards from where it is, so nothing
 * that had not come in yet flashes in; any other change mid-way starts from
 * what it was becoming.
 */
const lookKey = (look) => `${look.text}\u0000${look.fill}\u0000${look.opacity}\u0000${look.pill}`;
function useTextMorph(look) {
  const key = lookKey(look);
  const [state, setState] = useState({ key, from: null, to: look, p: 1 });
  const ref = useRef({ key, look, frame: 0, from: null, to: look, p: 1 });
  useEffect(() => {
    const m = ref.current;
    if (m.key === key) return undefined;
    const back = m.from && m.p < 1 && lookKey(m.from) === key;
    const run = back ? { from: m.from, to: m.to, p0: m.p, dir: -1 } : { from: m.look, to: look, p0: 0, dir: 1 };
    m.key = key;
    m.look = look;
    cancelAnimationFrame(m.frame);
    const settle = () => { m.from = null; m.to = look; m.p = 1; setState({ key, from: null, to: look, p: 1 }); };
    if (prefersReducedMotion()) { settle(); return undefined; }
    const start = performance.now();
    const step = (now) => {
      const p = clamp01(run.p0 + (run.dir * (now - start)) / MORPH_MS);
      if (run.dir > 0 ? p >= 1 : p <= 0) { settle(); return; }
      m.from = run.from; m.to = run.to; m.p = p;
      setState({ key, from: run.from, to: run.to, p });
      m.frame = requestAnimationFrame(step);
    };
    m.frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(m.frame);
    // `key` stands for `look`'s values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.key === key) return state;
  // The render the change arrives in, before the effect: as it was.
  const m = ref.current;
  return m.from && m.p < 1 ? { key, from: m.from, to: m.to, p: m.p } : { key, from: m.look, to: look, p: 0 };
}

const isPlain = (text) => !subscriptOf(text) && !vectorOf(text).vector;
const lettersOf = (text) => [...String(text)];

/**
 * A token's text, sliding to where it is put, and changing letter by letter
 * when it switches between its symbol and its Thing's name. What the two share
 * stays (the P of Pressure). The name's other letters wait for their pill:
 * each comes in a little after the pill's growing edge has passed it and the
 * pill has had a moment to fill, so no letter stands in a pill too small for
 * it. Going back they leave at once, right to left, ahead of the shrinking
 * edge, never left behind it. A plain symbol coming or going fades meanwhile;
 * with no letter in common with the name (p, Pressure), the two swap in place.
 * Its color turns as the pill under it fills or empties, when the color it
 * is going to reads better there than the one it had, so it never sinks into
 * a half-filled pill. Written another way (a subscript, a vector's arrow), the
 * two cross-fade instead.
 *
 * @param {number} [reveal] - where the pill's text currently ends (its glided
 *   right edge, less its padding), in the same space as `x`
 * @param {string} [under] - the color under the text now (the ground, as
 *   far as the pill has filled in)
 * @param {{x: number, y: number}} [start] - where a token that has just come
 *   into the formula starts
 */
function TokenText({ text, x, y, size: sized, fill, opacity = 1, pill = false, reveal = null, under = null, start = null }) {
  // Its size glides too (an exponent written inline after ^ grows to the line's).
  const at = useGlide({ x, y, size: sized }, start && { ...start, size: sized });
  const { size } = at;
  const { from, to: toward, p } = useTextMorph({ text, fill, opacity, pill });
  if (!from) return <TokenTextAt text={text} at={at} size={size} fill={fill} opacity={opacity} />;
  // What it is turning into (sent back mid-way, what it was turning into, run backwards).
  ({ text, fill, opacity, pill } = toward);
  const filled = glideEase(Math.min(1, (p * MORPH_MS) / GLIDE_MS));
  let turned = filled;
  if (under && from.fill !== fill) {
    try { turned = smooth(clamp01(0.5 + Math.log(contrast(fill, under) / contrast(from.fill, under)) / COLOR_TURN)); } catch { /* not hex: on the glide's curve */ }
    // Where the two read about the same, it still ends on its own color.
    turned = Math.max(turned, smooth(clamp01((p - 0.6) / 0.4)));
  }
  const color = from.fill === fill ? fill : mixColor(from.fill, fill, turned);
  const alpha = from.opacity + (opacity - from.opacity) * filled;
  if (!isPlain(text) || !isPlain(from.text)) {
    return (
      <>
        <TokenTextAt text={from.text} at={at} size={size} fill={color} opacity={alpha * (1 - smooth(clamp01(p * 2)))} />
        <TokenTextAt text={text} at={at} size={size} fill={color} opacity={alpha * smooth(clamp01((p - (pill ? IN_DELAY : 0.2)) / 0.45))} />
      </>
    );
  }
  const to = lettersOf(text);
  const was = lettersOf(from.text);
  let shared = 0;
  while (shared < to.length && shared < was.length && to[shared] === was[shared]) shared++;
  // How far the pill's edge has passed a letter's right edge (plus `lag`, but no
  // further than where the edge ends up, less REVEAL_EM), over REVEAL_EM.
  const fade = REVEAL_EM * size;
  const passed = (letters, i, lag) => {
    if (reveal == null) return 1;
    const right = measure(letters.slice(0, i + 1).join(''), size);
    const end = measure(letters.join(''), size) - fade;
    return clamp01((reveal - (at.x + Math.max(right - fade, Math.min(right + lag, end)))) / fade);
  };
  // Leaving a pill: quickly, the last letter first, and gone before the edge reaches it.
  const going = was.length - shared;
  const outAt = (i) => OUT_STAGGER * (was.length - 1 - i) / Math.max(1, going);
  // Nothing in common (p, Pressure): the symbol and the name's first letter
  // swap in place, the one mostly gone as the other comes, so the token is
  // never empty and the two never stand over each other.
  const swapping = shared === 0 && was.length > 0 && to.length > 0;
  const swapAt = from.pill ? outAt(0) : 0;
  const goingOut = (i) => {
    if (swapping && i === 0) return 1 - smooth(clamp01((p - swapAt) / OUT_MS));
    return from.pill
      ? Math.min(passed(was, i, -fade), 1 - smooth(clamp01((p - outAt(i)) / OUT_MS)))
      : 1 - smooth(clamp01(p / 0.4));
  };
  // Coming into a pill: once the edge is well past, and not before the pill has begun to fill.
  const comingIn = (i) => {
    if (swapping && i === 0) return smooth(clamp01((p - swapAt - OUT_MS * 0.6) / OUT_MS));
    return pill
      ? Math.min(passed(to, i, LETTER_LAG_EM * size), smooth(clamp01((p - IN_DELAY) / 0.4)))
      : smooth(clamp01((p - (from.pill && shared === 0 ? outAt(0) : 0.2)) / 0.4));
  };
  const textProps = {
    x: at.x, y: at.y, fontSize: size, fontFamily: FORMULA_FONT_FAMILY, fontWeight: FORMULA_FONT_WEIGHT,
    fill: color, opacity: alpha, style: { userSelect: 'none', pointerEvents: 'none', whiteSpace: 'pre' },
  };
  return (
    <>
      {was.length > shared && (
        <text {...textProps}>
          {shared > 0 && <tspan fillOpacity={0}>{was.slice(0, shared).join('')}</tspan>}
          {was.slice(shared).map((c, i) => <tspan key={i} fillOpacity={goingOut(shared + i)}>{c}</tspan>)}
        </text>
      )}
      <text {...textProps}>
        {shared > 0 && <tspan>{to.slice(0, shared).join('')}</tspan>}
        {to.slice(shared).map((c, i) => <tspan key={i} fillOpacity={comingIn(shared + i)}>{c}</tspan>)}
      </text>
    </>
  );
}

/** The title, gliding to stay centred on its band. */
function TitleText({ at, children, ...rest }) {
  const now = useGlide(at);
  return <text x={now.x} y={now.y} {...rest}>{children}</text>;
}

/** A rectangle that glides to its new place and size (from `from`, when it first shows). */
function GlideRect({ r, from = null, ...rest }) {
  const at = useGlide(r, from);
  return <rect x={at.x} y={at.y} width={Math.max(0, at.w)} height={Math.max(0, at.h)} {...rest} />;
}

/** A square root's sign, as tall as what it holds, its bar running over all of it. */
function GlideRoot({ r, from = null, stroke }) {
  const at = useGlide(r, from);
  const hook = (fx, fy) => `${at.x + at.signW * fx},${at.y + at.h * fy}`;
  return (
    <polyline
      points={`${hook(0, 0.58)} ${hook(0.22, 0.5)} ${hook(0.5, 1)} ${hook(1, 0)} ${at.x + at.w},${at.y}`}
      fill="none" stroke={stroke} strokeWidth={at.stroke} strokeLinejoin="round" strokeLinecap="round"
      style={{ pointerEvents: 'none' }}
    />
  );
}

/** Fades in or out as `on` says; from `from` (0 or 1) when it first shows, else at once. */
function Fade({ on, from = null, children }) {
  const { a } = useGlide({ a: on ? 1 : 0 }, from === null ? null : { a: from }, SWAP_MS);
  return <g opacity={a}>{children}</g>;
}

const drawnAs = (b) => (b.root ? 'root' : b.bar ? 'bar' : 'text');

/**
 * How a token is drawn (`kind`: a root's sign, a fraction's bar, or text) and,
 * a moment after that changes (writing every operation turns the bar into ÷
 * and the sign into √), how it was drawn and where (`was`), so the one can
 * turn into the other where they are instead of one vanishing and the other
 * standing at its end from the start.
 */
function useDrawnAs(b) {
  const kind = drawnAs(b);
  const last = useRef(b);
  const [state, setState] = useState({ kind, was: null });
  let now = state;
  if (state.kind !== kind) {
    now = { kind, was: { kind: state.kind, b: last.current } };
    setState(now);
  }
  useEffect(() => { last.current = b; });
  useEffect(() => {
    if (!now.was) return undefined;
    const timer = setTimeout(() => setState(s => (s === now ? { kind: s.kind, was: null } : s)), GLIDE_MS + 40);
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

const shapeOf = (b, o, hot) => {
  const reach = hot ? HOVER_REACH * b.size : 0;
  return b.pill
    ? { x: b.pill.x - o.x, y: b.pill.y - o.y, w: b.pill.w, h: b.pill.h, rx: b.pill.h * PILL_RADIUS, a: 1 }
    : { x: b.x - o.x - reach, y: b.y - o.y, w: b.w + 2 * reach, h: b.h, rx: Math.min(b.h * 0.4, (b.w + 2 * reach) / 2), a: hot ? HOVER_TINT : 0 };
};

/**
 * One token, placed by sliding: when a token near it switches between its
 * symbol and its name, it moves to its new place rather than jumping there. A
 * token written by name is its Thing: a pill in its color, grown from the
 * symbol's box. A token that only some ways of writing it have (the × between
 * names) opens out of the gap it comes into, appearing as the names' letters
 * do (`from`, where it starts), and going, closes into that gap, fading at once
 * (`going`), so the formula never stays wider than what it is becoming.
 */
function Token({ t, b, o, fill, ground, textColor, onBand, hot, onEnter, onLeave, enter = 1, from = null, going = false }) {
  const defined = !going && !!t.target && !!t.defined;
  const { a, ...outline } = shapeOf(b, o, hot && !going);
  const was = from && shapeOf(from, o, false);
  const shape = useGlide(outline, was);
  // Its fill comes in, or goes, ahead of its outline, so no half-filled box trails behind.
  const tint = useGlide({ a }, was && { a: was.a }, FILL_MS).a;
  const drawn = useDrawnAs(b);
  const { kind } = drawn;
  const fade = going
    ? { opacity: 0, transition: { duration: (GOING_MS / 1000), ease: 'easeOut' } }
    : { opacity: 1, transition: from ? { duration: (MORPH_MS * 0.4) / 1000, delay: (MORPH_MS * IN_DELAY) / 1000 } : FADE };
  return (
    <motion.g
      className={`formula-object-token${defined ? ' is-defined' : ''}${t.expanded ? ' is-expanded' : ''}`}
      data-formula-target={t.target || undefined}
      data-formula-proto={t.protoId || undefined}
      data-formula-defined={defined ? 'true' : undefined}
      data-formula-flip={defined && t.flip ? t.flip : undefined}
      initial={from ? { opacity: 0 } : false}
      animate={fade}
      onPointerEnter={defined ? onEnter : undefined}
      onPointerLeave={defined ? onLeave : undefined}
      style={going ? { pointerEvents: 'none' } : defined ? undefined : { cursor: 'default' }}
    >
      <g
        opacity={enter}
        transform={enter < 1 ? `translate(0 ${(1 - enter) * 0.3 * b.size})` : undefined}
      >
      <rect
        x={shape.x} y={shape.y} width={Math.max(0, shape.w)} height={Math.max(0, shape.h)}
        rx={Math.max(0, shape.rx)} fill={fill} fillOpacity={tint}
      />
      {[kind, ...(drawn.was && drawn.was.kind !== kind ? [drawn.was.kind] : [])].map(k => {
        // Drawn this way now, or a moment ago: what it is becoming starts where
        // the other was, and the other goes to where it is going, fading.
        const current = k === kind;
        const other = drawn.was && (current ? drawn.was.b : b);
        const mine = current ? b : drawn.was.b;
        const into = !current && other;
        const fromOther = current && other;
        if (k === 'root') {
          const r = mine.root;
          // The sign over the √ written as text: as wide as its letter, where it is.
          const onLetter = (x) => {
            const w = Math.max(1, x.w - 2 * (x.textX - x.x));
            return { x: x.textX - o.x, y: x.y - o.y, w, h: x.h, signW: w, stroke: r.stroke };
          };
          return (
            <Fade key={k} on={current} from={fromOther ? 0 : null}>
              <GlideRoot
                r={into ? onLetter(into) : { ...r, x: r.x - o.x, y: r.y - o.y }}
                from={fromOther && onLetter(other)}
                stroke={textColor}
              />
            </Fade>
          );
        }
        if (k === 'bar') {
          // A division stacked as a fraction: its token is the bar.
          const bar = mine.bar;
          const across = (x) => ({ x: x.x - o.x, y: x.y + x.h / 2 - bar.h / 2 - o.y, w: x.w, h: bar.h });
          return (
            <Fade key={k} on={current} from={fromOther ? 0 : null}>
              <GlideRect
                r={into ? across(into) : { x: bar.x - o.x, y: bar.y - o.y, w: bar.w, h: bar.h }}
                from={fromOther && across(other)}
                rx={bar.h / 2} fill={textColor} style={{ pointerEvents: 'none' }}
              />
            </Fade>
          );
        }
        // Text where the other is: on a bar's middle, at a root's sign.
        const textAt = (x) => (x.bar
          ? { x: x.bar.x + x.bar.w / 2 - mine.w / 2 + (mine.textX - mine.x) - o.x, y: x.bar.y + x.bar.h / 2 + (mine.baseline - (mine.y + mine.h / 2)) - o.y }
          : { x: x.textX - o.x, y: x.baseline - o.y });
        const at = into ? textAt(into) : { x: mine.textX - o.x, y: mine.baseline - o.y };
        return (
          <Fade key={k} on={current} from={fromOther ? 0 : null}>
            <TokenText
              text={t.text} x={at.x} y={at.y} size={mine.size}
              fill={t.expanded ? onBand : textColor}
              opacity={t.kind === 'paren' && !t.expanded ? 0.75 : 1}
              pill={!!mine.pill}
              reveal={shape.x + shape.w - PILL_PAD * mine.size}
              under={ground && mixColor(ground, fill, clamp01(tint))}
              start={from ? { x: from.textX - o.x, y: from.baseline - o.y } : fromOther ? textAt(other) : null}
            />
          </Fade>
        );
      })}
      </g>
    </motion.g>
  );
}

/**
 * The formula's group as the canvas's group input takes it: the entry a title
 * press passes (groupInput.js), read fresh from the store when pressed.
 */
function groupEntryOf(obj) {
  const st = useGraphStore.getState();
  const view = projectGraphView(st, obj.graphId);
  const group = view?.groups?.get(obj.groupId);
  if (!group) return null;
  const members = (group.memberInstanceIds || []).map(id => view.instances.get(id)).filter(Boolean);
  return { group, members, isNodeGroup: !!group.linkedNodePrototypeId, effectiveGroupName: obj.title || group.name };
}

const NO_CHANGES = { coming: new Map(), going: [] };

/** A token's box moved by (dx, dy), whatever it draws. */
function shiftBox(b, dx, dy) {
  const by = (r) => r && { ...r, x: r.x + dx, y: r.y + dy };
  return {
    ...b, x: b.x + dx, y: b.y + dy, textX: b.textX + dx, baseline: b.baseline + dy,
    ...(b.pill ? { pill: by(b.pill) } : {}), ...(b.root ? { root: by(b.root) } : {}), ...(b.bar ? { bar: by(b.bar) } : {}),
  };
}

/**
 * Where a token only one of two layouts has (`here`, its boxes by key, the
 * token at `i` of `keys`) sits in the other (`there`): centred in the gap
 * between its nearest neighbours that both have, moved as they move.
 */
function intoGap(keys, i, here, there) {
  const own = here.get(keys[i]);
  let left = null;
  let right = null;
  for (let j = i - 1; j >= 0 && !left; j--) if (there.has(keys[j])) left = keys[j];
  for (let j = i + 1; j < keys.length && !right; j++) if (there.has(keys[j])) right = keys[j];
  const near = left ?? right;
  if (!near) return own;
  const dy = there.get(near).baseline - here.get(near).baseline;
  const l = left && there.get(left);
  const r = right && there.get(right);
  const gap = l && r && Math.abs(l.baseline - r.baseline) < 1 ? (l.x + l.w + r.x) / 2
    : l ? l.x + l.w : r.x;
  return shiftBox(own, gap - (own.x + own.w / 2), dy);
}

/**
 * The tokens a change of how the formula is written brings in and takes out
 * (the × only names have): where each one coming starts (`coming`, by key),
 * and those going, kept a moment, each with where it closes into. Boxes as
 * the formula's are, the old ones moved onto its middle now.
 */
function useTokenChanges(obj) {
  const [state, setState] = useState({ obj, changes: NO_CHANGES });
  if (state.obj !== obj) {
    const was = state.obj;
    const boxesOf = (x, shift = { x: 0, y: 0 }) => new Map(x.tokens.map((t, i) => [t.key, shiftBox(x.boxes[i], shift.x, shift.y)]));
    const now = boxesOf(obj);
    const before = boxesOf(was, { x: obj.center.x - was.center.x, y: obj.center.y - was.center.y });
    const coming = new Map();
    const going = [];
    const nowKeys = obj.tokens.map(t => t.key);
    const wasKeys = was.tokens.map(t => t.key);
    // A formula drawn anew (opened, rebuilt) just shows: only a few tokens changing is a change of writing.
    const kept = nowKeys.filter(k => before.has(k)).length;
    if (kept > 0 && kept >= Math.min(nowKeys.length, wasKeys.length) / 2) {
      nowKeys.forEach((k, i) => { if (!before.has(k)) coming.set(k, intoGap(nowKeys, i, now, before)); });
      was.tokens.forEach((t, i) => { if (!now.has(t.key)) going.push({ t, b: intoGap(wasKeys, i, before, now) }); });
    }
    // Still going from a change before, unless back again.
    const still = state.changes.going.filter(g => !now.has(g.t.key) && !going.some(x => x.t.key === g.t.key));
    setState({ obj, changes: coming.size || going.length || still.length ? { coming, going: [...still, ...going] } : NO_CHANGES });
  }
  const { going } = state.changes;
  useEffect(() => {
    if (!going.length) return undefined;
    const timer = setTimeout(() => setState(s => (s.changes.going === going ? { ...s, changes: { ...s.changes, going: [] } } : s)), GLIDE_MS + 40);
    return () => clearTimeout(timer);
  }, [going]);
  return state.changes;
}

/**
 * One formula on the canvas. `leavingStart`: it was just deleted, and this is
 * what it was drawn as, playing its entrance backwards from then (its tokens
 * leaving right to left, its band shrinking away to nothing) and taking no input.
 */
function FormulaObject({ obj, theme, selected, lifted, leavingStart = null }) {
  const leaving = leavingStart !== null;
  const [hoverKey, setHoverKey] = useState(null);
  const pressRef = useRef(null);
  const lastTapRef = useRef({ target: null, at: 0 });
  const flipTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(flipTimerRef.current), []);

  // A press is the canvas's own: held, it lifts the formula into the group drag
  // a Thing-group's title starts (edge panning, panning and zooming mid-drag,
  // grid snap, one undo step), which moves this object with the group because
  // it carries one of its Things' ids. Only a tap is the formula's own.
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const tokenEl = e.target.closest?.('[data-formula-target]');
    pressRef.current = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
      target: tokenEl?.getAttribute('data-formula-target') || null,
      protoId: tokenEl?.getAttribute('data-formula-proto') || null,
      flip: tokenEl?.getAttribute('data-formula-flip') || null,
    };
    // A tap keeps its token lit while it waits to switch, so the pill grows out
    // of the lit box; a hold that lifts the formula drops it (`lifted`, below).
    if (e.pointerType === 'touch') return; // the touch handlers below take it
    const input = getCanvasGroupInput();
    const entry = groupEntryOf(obj);
    if (input && entry) input.handlers.titleMouseDown(e, entry);
  };
  const onMouseUp = () => {
    const input = getCanvasGroupInput();
    const entry = groupEntryOf(obj);
    if (input && entry) input.handlers.titleMouseUp(entry);
  };
  const onTouchStart = (e) => {
    const input = getCanvasGroupInput();
    const entry = groupEntryOf(obj);
    if (input && entry) input.handlers.titleTouchStart(e, entry);
    else e.stopPropagation();
  };
  const onTouchEnd = (e) => {
    const input = getCanvasGroupInput();
    if (!input || input.isDragging()) return; // the drag's own end takes it
    const entry = groupEntryOf(obj);
    if (entry) input.claimTouchTap(entry);
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  };

  const onPointerUp = (e) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    pressRef.current = null;
    const input = getCanvasGroupInput();
    if (input?.isDragging()) return; // a drag, which the canvas finishes
    if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) > MOVE_SLOP_PX) return;
    // A tap. Twice on the same token opens its Thing; once switches it (if it
    // can be), after waiting to see that it was only once. Either way the
    // formula is selected.
    const now = performance.now();
    const last = lastTapRef.current;
    clearTimeout(flipTimerRef.current);
    if (press.target && last.target === press.target && now - last.at < DOUBLE_TAP_MS) {
      lastTapRef.current = { target: null, at: 0 };
      openThingInPanel(press.protoId);
      return;
    }
    lastTapRef.current = { target: press.target, at: now };
    selectGroup(obj.groupId);
    if (press.flip && press.target !== TITLE_TARGET) {
      const { flip } = press;
      flipTimerRef.current = setTimeout(() => flipFormulaToken(obj.groupId, flip), DOUBLE_TAP_MS);
    }
  };

  const hoverIn = (key) => (e) => {
    if (e.pointerType === 'touch' || pressRef.current) return;
    setHoverKey(key);
  };
  const hoverOut = (key) => () => setHoverKey(prev => (prev === key ? null : prev));

  const color = obj.color || NODE_DEFAULT_COLOR;
  const onBand = getTextColor(color, theme.darkMode);
  const ground = blendColors(theme.surface.bg, color, NODE_GROUP_INTERIOR_TINT);
  const textColor = theme.canvas.textPrimary;
  const { frame, inner, titleBox } = obj;
  // Drawn relative to the formula's middle, so moving it moves it at once and
  // only a change of its own layout slides.
  const o = obj.center;
  const box = (r) => ({ x: r.x - o.x, y: r.y - o.y, w: r.w, h: r.h });
  const liftShadow = useGraphStore(st => (lifted ? (st.liftedThingShadow ?? DEFAULT_LIFTED_THING_SHADOW) : null));
  // Just built: the plus sign's morph, into this band. Just deleted: back out of it, to nothing.
  const spawn = useSpawn(obj.groupId, leavingStart);
  const spawning = spawn < 1;
  const grown = easeMorph(clamp01(spawn / MORPH_SHARE));
  const plusScale = useGraphStore(st => st.textSettings?.plusSignScale ?? 1);
  const plusSize = leaving ? 0 : PLUS_SIGN_SIZE * plusScale;
  const plusStroke = Math.max(1, 10 * plusScale);
  const f = box(frame);
  const fcx = f.x + f.w / 2;
  const fcy = f.y + f.h / 2;
  const morph = {
    x: lerp(fcx - plusSize / 2, f.x, grown), y: lerp(fcy - plusSize / 2, f.y, grown),
    w: lerp(plusSize, f.w, grown), h: lerp(plusSize, f.h, grown),
    rx: lerp(plusSize / 2, G.nodeGroupCornerRadius, grown),
  };
  const titleIn = spawning ? clamp01((grown - 0.2) * 1.25) : 1;
  const groundIn = spawning ? clamp01((grown - 0.35) / 0.5) : 1;
  // Each token after the one before it, left to right, once the band has mostly grown.
  const tokenIn = (i) => {
    if (!spawning) return 1;
    const n = Math.max(1, obj.tokens.length - 1);
    return easeMorph(clamp01((spawn - (0.45 + 0.3 * (i / n))) / 0.25));
  };
  const tokenChanges = useTokenChanges(obj);
  const clipId = `formula-${leaving ? 'leave' : 'spawn'}-${obj.groupId}`;
  // Lifted as a dragged Thing-group is: at once on the way up, eased back down.
  const lx = frame.x + frame.w / 2 - o.x;
  const ly = frame.y + frame.h / 2 - o.y;
  const liftStyle = {
    transform: lifted ? `translate(${lx}px, ${ly}px) scale(${LIFT_SCALE}) translate(${-lx}px, ${-ly}px)` : 'none',
    transformOrigin: '0px 0px',
    transition: lifted ? 'none' : 'transform 0.2s ease-out',
  };

  const drawing = () => (
    <g transform={`translate(${o.x} ${o.y})`}>
      <g style={liftStyle}>
        {lifted && groupLiftShadowOn(liftShadow) && groupLiftShadow('box', box(frame), G.nodeGroupCornerRadius)}
        {selected && (
          <GlideRect
            r={{ x: frame.x - 10 - o.x, y: frame.y - 10 - o.y, w: frame.w + 20, h: frame.h + 20 }}
            rx={G.nodeGroupCornerRadius + 10} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={8}
          />
        )}
        {/* A mask, not a clip: it hides what hasn't grown in yet without
            hiding it from a click, so the formula takes input from its first frame. */}
        {spawning && (
          <defs>
            <mask id={clipId} maskUnits="userSpaceOnUse" x={f.x - 50} y={f.y - 50} width={f.w + 100} height={f.h + 100}>
              <rect x={morph.x} y={morph.y} width={morph.w} height={morph.h} rx={morph.rx} fill="white" />
            </mask>
          </defs>
        )}
        <g mask={spawning ? `url(#${clipId})` : undefined}>
        {/* The band is the equation itself: a double tap on it, or its title, opens its Thing. */}
        <g
          className="formula-object-title"
          data-formula-target={TITLE_TARGET}
          data-formula-proto={obj.equationProtoId || undefined}
        >
          <GlideRect r={box(frame)} rx={G.nodeGroupCornerRadius} fill={spawning ? mixColor(PLUS_LIGHT, color, grown * 1.5) : color} />
          {obj.title && (
            <TitleText
              at={{ x: titleBox.x + titleBox.w / 2 - o.x, y: titleBox.y + titleBox.h / 2 - o.y }}
              fontSize={TITLE_FONT} fontFamily="EmOne, sans-serif" fontWeight="bold"
              fill={onBand} textAnchor="middle" dominantBaseline="central"
              opacity={titleIn}
              style={{ userSelect: 'none', pointerEvents: 'none' }}
            >
              {obj.title}
            </TitleText>
          )}
        </g>
        <GlideRect r={box(inner)} rx={G.innerCanvasCornerRadius} fill={ground} opacity={groundIn} />
        {/* One list, so a token going keeps gliding from where it was. */}
        {[...obj.tokens.map((t, i) => (
          <Token
            key={t.key}
            t={t}
            b={obj.boxes[i]}
            o={o}
            fill={obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR}
            ground={ground}
            textColor={textColor}
            onBand={getTextColor(obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR, theme.darkMode)}
            hot={!lifted && hoverKey === t.key}
            onEnter={hoverIn(t.key)}
            onLeave={hoverOut(t.key)}
            enter={tokenIn(i)}
            from={tokenChanges.coming.get(t.key) || null}
          />
        )), ...tokenChanges.going.map(({ t, b }) => (
          <Token
            key={t.key}
            t={t}
            b={b}
            o={o}
            fill={obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR}
            ground={ground}
            textColor={textColor}
            onBand={getTextColor(obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR, theme.darkMode)}
            hot={false}
            going
          />
        ))]}
        </g>
        {/* The plus sign it grew from: its outline turning the band's color, its cross fading first. */}
        {spawning && !leaving && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={morph.x} y={morph.y} width={morph.w} height={morph.h} rx={morph.rx}
              fill="none" stroke={mixColor('#800000', color, grown)} strokeWidth={plusStroke} opacity={1 - grown}
            />
            {[[-1, 0, 1, 0], [0, -1, 0, 1]].map(([x1, y1, x2, y2]) => (
              <line
                key={`${x1}${y1}`}
                x1={fcx + x1 * morph.w / 4} y1={fcy + y1 * morph.w / 4} x2={fcx + x2 * morph.w / 4} y2={fcy + y2 * morph.w / 4}
                stroke={PLUS_STROKE} strokeWidth={plusStroke} strokeLinecap="round" opacity={Math.max(0, 1 - grown * 4)}
              />
            ))}
          </g>
        )}
      </g>
    </g>
  );
  if (leaving) {
    return (
      <g className="formula-object is-leaving" style={{ pointerEvents: 'none' }} opacity={clamp01(grown * 3)}>
        {drawing()}
      </g>
    );
  }
  return (
    <g
      className={`formula-object${selected ? ' is-selected' : ''}`}
      data-formula-group={obj.groupId}
      // The canvas's group drag moves what carries a dragged Thing's id. The
      // formula is drawn from its Things, so it rides on one of them.
      data-instance-id={obj.dragProxyId || undefined}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { pressRef.current = null; }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={onMouseUp}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ cursor: 'pointer' }}
    >
      {drawing()}
    </g>
  );
}

/** `draggingGroupId`: the group the canvas's drag is carrying, if any. */
function FormulaObjectsLayer({ draggingGroupId = null }) {
  const formulaObjects = useFormulaObjects();
  const selectedGroupId = useCanvasUIStore(s => s.selectedGroupId);
  const activeGraphId = useGraphStore(s => s.activeGraphId);
  const leavingAll = useSyncExternalStore(subscribeLeavingFormulas, leavingFormulasNow);
  const leaving = leavingAll.filter(l => l.obj.graphId === activeGraphId);
  const theme = useTheme();
  if (!formulaObjects.objects.length && !leaving.length) return null;
  const hideGroups = [...formulaObjects.hiddenGroupIds].map(id => `[data-group-id=${JSON.stringify(id)}]`).join(',');
  return (
    <g className="formula-objects-layer">
      {hideGroups && <style>{`${hideGroups}{display:none}`}</style>}
      {formulaObjects.objects.map(obj => (
        <FormulaObject
          key={obj.groupId} obj={obj} theme={theme}
          selected={selectedGroupId === obj.groupId} lifted={draggingGroupId === obj.groupId}
        />
      ))}
      {leaving.map(({ obj, start }) => (
        <FormulaObject key={`leaving-${obj.groupId}-${start}`} obj={obj} theme={theme} leavingStart={start} />
      ))}
    </g>
  );
}

export default memo(FormulaObjectsLayer);
