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
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import useGraphStore from '../../../../store/graphStore.js';
import useCanvasUIStore from '../../../../store/canvasUIStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { useTheme } from '../../../../hooks/useTheme.js';
import { getTextColor, blendColors } from '../../../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR, PLUS_SIGN_SIZE, PLUS_SIGN_STROKE } from '../../../../constants.js';
import { DEFAULT_LIFTED_THING_SHADOW, cssColorToHex } from '../../../../utils/colorUtils.js';
import { formulaSpawnOf, SPAWN_MS, LEAVE_MS, leavingFormulasNow, subscribeLeavingFormulas } from './formulaSpawn.js';
import { GROUP_LAYOUT_CONSTANTS as G } from '../../../../services/groupLayout.js';
import { NODE_GROUP_INTERIOR_TINT, GROUP_SELECTION_STROKE as SELECTION_STROKE, groupLiftShadow } from '../../groups/groupElements.jsx';
import { groupLiftShadowOn } from '../../groups/groupLiftShadow.js';
import { useFormulaObjects } from './useFormulaObjects.js';
import { subscriptOf, vectorOf } from './formulaChain.js';
import { useGlide, GLIDE_MS, FRAME_MS, glideEase } from './useGlide.js';
import { flipFormulaToken } from '../formatsStore.js';
import { traceEdgesIn } from '../../edges/edgeTransitions.js';
import { getCanvasGroupInput } from '../../groups/groupInput.js';
import { tapFormula } from './formulaSelection.js';
import {
  FORMULA_FONT_FAMILY, FORMULA_FONT_WEIGHT, SUBSCRIPT_SCALE, SUBSCRIPT_DROP, TITLE_FONT, PILL_RADIUS, PILL_PAD, arrowOver, measure,
} from './formulaObjects.js';

const MOVE_SLOP_PX = 6;      // a press that wanders this far before the lift is not a hold
const DOUBLE_TAP_MS = 320;   // a second tap this soon on the band is a double tap
const TOKEN_DOUBLE_TAP_MS = 200; // and on a token, which waits this long to switch, in case it is the first of two
const HOVER_TINT = 0.18;
const HOVER_REACH = 0.14;    // a hovered token's tint past its box, either side, in its em
const FADE = { duration: 0.14 };
const LIFT_SCALE = 1.05;     // a dragged Thing-group's (groupElements)
// Coming in, as the plus sign morphs into a new Thing (PlusSign.jsx): its
// rounded square grows into the band over the morph's 400 ms, on its curve,
// the band's color coming in faster; then the title, the ground, and the
// tokens one after another.
const MORPH_SHARE = 400 / SPAWN_MS;   // the band's part of it
// Going back into its Thing-group's box (formulaSwapMorph), the last part of
// the exit: the band is on the box, which shows under it as the formula fades off.
const REVEAL_SHARE = 0.2;
// Coming out of its Thing-group's box, the share of the entrance the box, the
// Things and the tokens run over together.
const SWAP_TRAVEL = 0.8;
// Along the way (0 to 1, before easing): each Thing's copy is on its token by
// GHOST_ARRIVE, and only there do the two cross over, the token coming in from
// TOKEN_IN_AT, the copy going from GHOST_FADE_AT, each over SWAP_FADE. A copy
// fading on its way, with its token coming in where it hasn't reached, reads
// as the formula standing beside the Things.
const GHOST_ARRIVE = 0.65;
const TOKEN_IN_AT = 0.62;
const GHOST_FADE_AT = 0.68;
const SWAP_FADE = 0.28;
// What goes with the Things (their connections, the groups inside) is gone by here.
const SWAP_EXTRAS_GONE = 0.35;
// A Thing's copy sheds its background over this first part of its way to its
// token (0 to 1), its text turning to the token's colour as it does, so only
// the symbol arrives.
const GHOST_BG_GONE = 0.4;
// Out of or into its Thing (condenseFormula), the formula morphs as a Thing's
// box does (groups/boxMorph.js): the node's title takes the formula's
// wrapping over this first part of the way, and tokens that have no words of
// the node's to start from start this small, at its middle.
const TITLE_REWRAP = 0.15;
const SEED_SCALE = 0.04;
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
 * How far a just-built formula is into coming in (`t`): 0 to 1, or 1 when it
 * isn't coming in; `from`, the node it grows out of, when it was opened from
 * one. A deleted one (`leavingStart`) goes the other way, 1 to 0, over its exit.
 */
function useSpawn(groupId, leavingStart = null) {
  const leaving = leavingStart !== null;
  const [{ start, from }] = useState(() => {
    if (leaving) return { start: leavingStart, from: null };
    const mark = reducedMotion() ? null : formulaSpawnOf(groupId);
    return { start: mark?.at ?? null, from: mark?.from || null };
  });
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
  return { t, from };
}
const TITLE_TARGET = '__title__';

/** How far a point is inside a rounded rectangle ({ x, y, w, h, rx }); less than 0 outside it. */
function insideRounded(r, px, py) {
  const rad = Math.min(r.rx, r.w / 2, r.h / 2);
  const qx = Math.abs(px - (r.x + r.w / 2)) - (r.w / 2 - rad);
  const qy = Math.abs(py - (r.y + r.h / 2)) - (r.h / 2 - rad);
  return rad - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0);
}
const TITLE_INK = 0.4;    // a title's letters, above and below its middle, in its em
const TITLE_ROOM = 0.15;  // how far inside the growing band a title's letter must be before it starts to show, in its em
const TITLE_REVEAL = 0.5; // and how much further in until it fully has

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

const NAME_FADE_MS = 130; // a name fading in once its pill holds it
const NAME_GROW_FROM = 0.9; // and growing into place from this much of its size
const NAME_MIDDLE_EM = 0.35; // its middle, above its baseline
const MORPH_MS = 290; // a token's text changing color
const smooth = (t) => t * t * (3 - 2 * t);
const IN_DELAY = 0.22; // of MORPH_MS: a token coming into the formula (the × between names) waits this long to show
const NAME_FIT = 0.1; // em: a name shows once its growing pill holds all but this much of it
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
    let start = null; // its first frame, one frame in, as useGlide's are
    const step = (now) => {
      if (start === null) start = now - FRAME_MS;
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

/**
 * A token's text, sliding to where it is put, and switching between its symbol
 * and its Thing's name. Heading for its symbol, the symbol shows at once and
 * the pill shrinks around it; heading for its name, the symbol goes at once,
 * the pill grows, and the name fades in, growing slightly, once the pill
 * holds it. Decided by where it is heading, so switching back and forth
 * quickly (Show Names, Show Symbols, again) does the same. Its color turns as the pill under it fills
 * or empties, when the color it is going to reads better there than the one
 * it had, so it never sinks into a half-filled pill.
 *
 * @param {number} [reveal] - where the pill's text currently ends (its glided
 *   right edge, less its padding), in the same space as `x`
 * @param {number} [revealEnd] - and where it will end once the pill has grown
 * @param {string} [under] - the color under the text now (the ground, as
 *   far as the pill has filled in)
 * @param {{x: number, y: number}} [start] - where a token that has just come
 *   into the formula starts
 */
function TokenText({ text, x, y, size: sized, fill, opacity = 1, pill = false, reveal = null, revealEnd = null, under = null, start = null }) {
  // Its size glides too (an exponent written inline after ^ grows to the line's).
  const at = useGlide({ x, y, size: sized }, start && { ...start, size: sized });
  const { size } = at;
  // A name shows once its pill holds it (or has all but finished growing), fading in.
  const holds = !pill || reveal == null
    || reveal >= at.x + measure(text, size) - NAME_FIT * size
    || (revealEnd != null && Math.abs(revealEnd - reveal) < 0.5);
  const fadedIn = useGlide({ a: pill && holds ? 1 : 0 }, null, NAME_FADE_MS).a;
  const shown = pill ? (holds ? fadedIn : 0) : 1;
  // Fading in, the name also grows a little into place, about its middle.
  const grow = (node) => {
    if (!pill || shown >= 1) return node;
    const cx = at.x + measure(text, size) / 2;
    const cy = at.y - NAME_MIDDLE_EM * size;
    const k = lerp(NAME_GROW_FROM, 1, shown);
    return <g transform={`translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})`}>{node}</g>;
  };
  const look = { text, fill, opacity, pill };
  const { from, to: toward, p } = useTextMorph(look);
  if (!from) return grow(<TokenTextAt text={text} at={at} size={size} fill={fill} opacity={opacity * shown} />);
  // The change runs toward this look, or (sent back mid-way) backwards from it.
  const forward = lookKey(toward) === lookKey(look);
  const other = forward ? from : toward;
  const q = forward ? p : 1 - p;
  const filled = glideEase(Math.min(1, (q * MORPH_MS) / GLIDE_MS));
  let turned = filled;
  if (under && other.fill !== fill) {
    try { turned = smooth(clamp01(0.5 + Math.log(contrast(fill, under) / contrast(other.fill, under)) / COLOR_TURN)); } catch { /* not hex: on the glide's curve */ }
    // Where the two read about the same, it still ends on its own color.
    turned = Math.max(turned, smooth(clamp01((q - 0.6) / 0.4)));
  }
  const color = other.fill === fill ? fill : mixColor(other.fill, fill, turned);
  const alpha = other.opacity + (opacity - other.opacity) * filled;
  return grow(<TokenTextAt text={text} at={at} size={size} fill={color} opacity={alpha * shown} />);
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
function Token({ t, b, o, fill, ground, textColor, onBand, hot, onEnter, onLeave, enter = 1, rise = true, from = null, going = false }) {
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
        transform={enter < 1 && rise ? `translate(0 ${(1 - enter) * 0.3 * b.size})` : undefined}
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
              revealEnd={mine.pill ? mine.pill.x + mine.pill.w - o.x - PILL_PAD * mine.size : null}
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
 * `into`: it was combined into its Thing, and the band shrinks onto that node's
 * painted background instead ({ x, y, w, h, r, color }, condenseFormula). Opened
 * from that Thing again, it grows out of the node the same way
 * (formulaSpawn.withFormulaOpenMorph).
 */
function FormulaObject({ obj, theme, selected, lifted, leavingStart = null, into = null, reveal = null }) {
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
    const within = press.target === TITLE_TARGET ? DOUBLE_TAP_MS : TOKEN_DOUBLE_TAP_MS;
    if (press.target && last.target === press.target && now - last.at < within) {
      lastTapRef.current = { target: null, at: 0 };
      openThingInPanel(press.protoId);
      return;
    }
    lastTapRef.current = { target: press.target, at: now };
    // A token's tap switches it; that keeps the formula where it is in a selection.
    // A tap on a token acts on it where it is, so selecting doesn't move the camera.
    tapFormula(obj.groupId, obj.anchorId, {
      keep: !!press.flip && press.target !== TITLE_TARGET,
      inPlace: !!press.target && press.target !== TITLE_TARGET,
    });
    if (press.flip && press.target !== TITLE_TARGET) {
      const { flip } = press;
      flipTimerRef.current = setTimeout(() => flipFormulaToken(obj.groupId, flip), TOKEN_DOUBLE_TAP_MS);
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
  const titleFont = obj.titleFont ?? TITLE_FONT;
  // Drawn relative to the formula's middle, so moving it moves it at once and
  // only a change of its own layout slides.
  const o = obj.center;
  const box = (r) => ({ x: r.x - o.x, y: r.y - o.y, w: r.w, h: r.h });
  const liftShadow = useGraphStore(st => (lifted ? (st.liftedThingShadow ?? DEFAULT_LIFTED_THING_SHADOW) : null));
  // Just built: the plus sign's morph, into this band. Opened from its Thing:
  // out of that node instead. Just deleted: back out of it, to nothing.
  // Combined into its Thing: down onto that node.
  const { t: spawn, from: openedFrom } = useSpawn(obj.groupId, leavingStart);
  const node = into || openedFrom;
  // Shown the other way (formulaSwapMorph): its Thing-group's box, which has a
  // ground and a title of its own to run into the formula's.
  const boxMorph = !!node?.inner;
  const spawning = spawn < 1;
  // Going into the box, the band is all the way there with REVEAL_SHARE of the
  // exit left: the box shows under it from then (`reveal`), and it fades off.
  // The box, its Things and the tokens run on one clock.
  const along = clamp01(leaving ? (spawn - REVEAL_SHARE) / (1 - REVEAL_SHARE) : spawn / SWAP_TRAVEL);
  // Out of or into its Thing (withFormulaOpenMorph, condenseFormula): each of
  // the node's parts runs into the formula's, as into a box; going, the node
  // shows under it once it is all the way there.
  const thingMorph = !!node && !boxMorph;
  const progress = boxMorph || (thingMorph && leaving) ? along : clamp01(spawn / MORPH_SHARE);
  const grown = easeMorph(progress);
  const plusScale = useGraphStore(st => st.textSettings?.plusSignScale ?? 1);
  const plusSize = leaving ? 0 : PLUS_SIGN_SIZE * plusScale;
  const plusStroke = Math.max(1, PLUS_SIGN_STROKE * plusScale);
  const f = box(frame);
  const fcx = f.x + f.w / 2;
  const fcy = f.y + f.h / 2;
  const end = node
    ? { ...box(node), rx: node.r }
    : { x: fcx - plusSize / 2, y: fcy - plusSize / 2, w: plusSize, h: plusSize, rx: plusSize / 2 };
  const morph = {
    x: lerp(end.x, f.x, grown), y: lerp(end.y, f.y, grown),
    w: lerp(end.w, f.w, grown), h: lerp(end.h, f.h, grown),
    rx: lerp(end.rx, G.nodeGroupCornerRadius, grown),
  };
  // What the mask has to reach: the band, and the node it may shrink onto.
  const reach = {
    x: Math.min(f.x, end.x) - 50, y: Math.min(f.y, end.y) - 50,
    w: Math.max(f.x + f.w, end.x + end.w) - Math.min(f.x, end.x) + 100,
    h: Math.max(f.y + f.h, end.y + end.h) - Math.min(f.y, end.y) + 100,
  };
  const titleIn = spawning && !node ? clamp01((grown - 0.2) * 1.25) : 1;
  const nodeMiddle = node ? { x: node.x + node.w / 2 - o.x, y: node.y + node.h / 2 - o.y } : null;
  // From or into a Thing-group's box: the ground and the title run between it
  // and the formula's. A Thing has no ground: the formula's opens out of its
  // middle, in its colour.
  const morphGround = node && spawning ? (() => {
    const a = boxMorph ? box(node.inner) : { ...nodeMiddle, w: 0, h: 0 };
    const b = box(inner);
    return {
      x: lerp(a.x, b.x, grown), y: lerp(a.y, b.y, grown), w: lerp(a.w, b.w, grown), h: lerp(a.h, b.h, grown),
      rx: lerp(boxMorph ? node.inner.r : 0, G.innerCanvasCornerRadius, grown),
      fill: boxMorph ? ground : mixColor(node.color || color, ground, grown),
    };
  })() : null;
  const formulaTitleAt = { x: titleBox.x + titleBox.w / 2 - o.x, y: titleBox.y + titleBox.h / 2 - o.y };
  const nodeTitle = node ? (node.title || { x: nodeMiddle.x + o.x, y: nodeMiddle.y + o.y }) : null;
  const titleAt = node && spawning
    ? { x: lerp(nodeTitle.x - o.x, formulaTitleAt.x, grown), y: lerp(nodeTitle.y - o.y, formulaTitleAt.y, grown) }
    : formulaTitleAt;
  // The box's or the Thing's title as it is drawn (its size, its lines). The
  // same words run into the formula's title, growing or shrinking to its size
  // (a Thing's taking the formula's wrapping early, TITLE_REWRAP); other words
  // (an untitled formula has none) give way to the formula's.
  const morphingTitle = !!node && spawning;
  const boxLines = morphingTitle ? (nodeTitle.lines || [node.titleText].filter(Boolean)) : [];
  const sameTitle = morphingTitle && (boxMorph ? boxLines.length === 1 && boxLines[0] === obj.title : boxLines.join(' ') === obj.title);
  const boxTitleSize = morphingTitle ? (nodeTitle.fontSize || titleFont) : titleFont;
  const formulaTitleSize = sameTitle ? lerp(boxTitleSize, titleFont, grown) : titleFont;
  const titleLines = sameTitle && thingMorph && boxLines.length > 1 && progress < TITLE_REWRAP ? boxLines : null;
  const titleFill = sameTitle && thingMorph && nodeTitle.color ? mixColor(nodeTitle.color, onBand, grown) : onBand;
  // A Thing's own words, when they aren't the formula's title, are its text: the tokens carry them (tokenPose).
  const boxTitle = boxMorph && morphingTitle && !sameTitle && boxLines.length ? boxLines : null;
  const boxTitleShown = boxTitle ? clamp01(1 - grown * 2) : 0;
  const formulaTitleShown = morphingTitle && !sameTitle ? clamp01(grown * 2 - 1) : titleIn;
  // Each of the title's letters only once the growing band holds it (the middle
  // ones first), and going, each gone before the shrinking band reaches it, so
  // the band never cuts the title short.
  const titleSpans = useMemo(() => {
    if (!obj.title) return [];
    const letters = [...obj.title];
    const half = measure(obj.title, titleFont) / 2;
    return letters.map((c, i) => ({
      c, x0: measure(letters.slice(0, i).join(''), titleFont) - half, x1: measure(letters.slice(0, i + 1).join(''), titleFont) - half,
    }));
  }, [obj.title, titleFont]);
  const titleLetters = spawning && !boxMorph && obj.title ? (() => {
    const cx = titleBox.x + titleBox.w / 2 - o.x;
    const cy = titleBox.y + titleBox.h / 2 - o.y;
    const top = cy - TITLE_INK * titleFont;
    const bottom = cy + TITLE_INK * titleFont;
    return titleSpans.map(({ c, x0: a, x1: b }) => {
      const x0 = cx + a;
      const x1 = cx + b;
      const room = Math.min(...[[x0, top], [x1, top], [x0, bottom], [x1, bottom]].map(([px, py]) => insideRounded(morph, px, py)));
      return { c, shown: smooth(clamp01((room - TITLE_ROOM * titleFont) / (TITLE_REVEAL * titleFont))) };
    });
  })() : null;
  const groundIn = spawning ? clamp01((grown - 0.35) / 0.5) : 1;
  // Each token after the one before it, left to right, once the band has mostly grown.
  const tokenIn = (i) => {
    if (!spawning) return 1;
    // From or into the box: as its Thing's copy arrives (all at once, the copies travelling together).
    if (boxMorph) return smooth(clamp01((along - TOKEN_IN_AT) / SWAP_FADE));
    if (thingMorph) return 1; // carried in whole (tokenPose)
    const n = Math.max(1, obj.tokens.length - 1);
    return easeMorph(clamp01((spawn - (0.45 + 0.3 * (i / n))) / 0.25));
  };
  const tokenChanges = useTokenChanges(obj);
  // From or into its Thing-group's box: copies of its Things' own drawings
  // (formulaSwapMorph.captureThings), each run between where its Thing stands
  // and its token, shrinking to the token's height and fading as the token
  // comes in; what goes with them (connections, the groups inside) fades.
  // Drawn into a group of their own, imperatively: they are copied elements.
  const ghosts = boxMorph && spawning ? node.ghosts || null : null;
  const ghostHostRef = useRef(null);
  const ghostsDrawnRef = useRef(null);
  useLayoutEffect(() => {
    const host = ghostHostRef.current;
    ghostsDrawnRef.current = null;
    if (!host || !ghosts) return undefined;
    const wrap = (copy) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.appendChild(copy);
      host.appendChild(g);
      return g;
    };
    // Under the Things, what goes with them.
    const fades = ghosts.fades.map(wrap);
    const things = ghosts.things.map(t => ({ ...t, g: wrap(t.copy), label: leaving ? null : asSymbol(t) }));
    ghostsDrawnRef.current = { fades, things };
    return () => { host.replaceChildren(); ghostsDrawnRef.current = null; };
    // Read once, when the copies are drawn; `asSymbol` reads the tokens as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghosts]);
  // Each Thing's first token (its box and what it says), by Thing.
  const tokenOf = useMemo(() => {
    const byThing = new Map();
    obj.tokens.forEach((t, i) => { if (t.target && !byThing.has(t.target)) byThing.set(t.target, { t, b: obj.boxes[i] }); });
    return byThing;
  }, [obj]);
  // Going into its token, a Thing's copy says its symbol from the start: its
  // name becomes what the token says, in the formula's type, and its colour
  // runs from the node's text colour to the token's as its background goes
  // (GHOST_BG_GONE). Returns the copy's label with where its size and colour
  // start, and its background, or null.
  function asSymbol({ id, copy }) {
    const label = copy.querySelector('.node-name-text');
    const tok = tokenOf.get(id);
    if (!label || !tok) return null;
    const fromSize = parseFloat(label.style.fontSize);
    const fromColor = cssColorToHex(getComputedStyle(label).color);
    if (!fromSize) return null;
    const sub = subscriptOf(tok.t.text);
    const { letter } = vectorOf(sub ? sub[0] : tok.t.text);
    label.textContent = letter;
    if (sub) {
      const low = document.createElement('sub');
      low.textContent = sub[1];
      low.style.fontSize = `${SUBSCRIPT_SCALE}em`;
      label.appendChild(low);
    }
    // Placed each frame: the label's own size and colour transitions would trail it.
    Object.assign(label.style, {
      transition: 'none', fontFamily: FORMULA_FONT_FAMILY, fontWeight: String(FORMULA_FONT_WEIGHT),
      whiteSpace: 'nowrap', maxWidth: 'none', lineHeight: '1',
    });
    const protoColor = obj.protoOf.get(tok.t.protoId)?.color || NODE_DEFAULT_COLOR;
    const bg = copy.querySelector('.node-background');
    if (bg) bg.style.transition = 'none';
    return { el: label, bg, fromSize, fromColor, toColor: tok.t.expanded ? getTextColor(protoColor, theme.darkMode) : textColor, toSize: tok.b.size };
  }
  useLayoutEffect(() => {
    const drawn = ghostsDrawnRef.current;
    if (!drawn) return;
    const extras = String(1 - clamp01(grown / SWAP_EXTRAS_GONE));
    drawn.fades.forEach(g => g.setAttribute('opacity', extras));
    // On its token by GHOST_ARRIVE, on the morph's own curve.
    const reach = easeMorph(clamp01(along / GHOST_ARRIVE));
    drawn.things.forEach(({ id, rect, g, label }) => {
      const tb = tokenOf.get(id)?.b;
      if (!tb) { g.setAttribute('opacity', extras); return; }
      const ncx = rect.x + rect.w / 2;
      const ncy = rect.y + rect.h / 2;
      const scale = lerp(1, Math.min(1, tb.h / rect.h), reach);
      const cx = lerp(ncx, tb.x + tb.w / 2, reach);
      const cy = lerp(ncy, tb.y + tb.h / 2, reach);
      g.setAttribute('transform', `translate(${cx} ${cy}) scale(${scale}) translate(${-ncx} ${-ncy})`);
      if (label) {
        // Drawn at the name's size at first and at the token's on it, through the copy's own scale.
        label.el.style.fontSize = `${lerp(label.fromSize, label.toSize, reach) / scale}px`;
        const shed = smooth(clamp01(reach / GHOST_BG_GONE));
        label.el.style.color = mixColor(label.fromColor, label.toColor, shed);
        label.bg?.setAttribute('opacity', String(1 - shed));
      }
      g.setAttribute('opacity', String(1 - smooth(clamp01((along - GHOST_FADE_AT) / SWAP_FADE))));
    });
  });
  // Out of or into its Thing, the tokens are carried whole: an untitled
  // formula's from the node's own words (its name is the formula's text),
  // where they stand and as large; a titled one's from the node's middle, as a
  // box's content grows out of a node. Until the ground is under them they
  // wear the node's title colour.
  const lineBox = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    obj.boxes.forEach((b) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2 - obj.center.x, y: (y0 + y1) / 2 - obj.center.y, w: x1 - x0, h: y1 - y0 } : null;
  }, [obj]);
  const fromWords = thingMorph && !obj.title && nodeTitle.w > 0 && !!lineBox;
  const tokenPose = thingMorph && spawning && lineBox ? (() => {
    const start = fromWords ? { x: nodeTitle.x - o.x, y: nodeTitle.y - o.y } : nodeMiddle;
    // As wide as the words, and no taller than the node (a fraction stands two lines high).
    const s = lerp(fromWords ? Math.min(nodeTitle.w / lineBox.w, node.h / lineBox.h) : SEED_SCALE, 1, grown);
    const c = { x: lerp(start.x, lineBox.x, grown), y: lerp(start.y, lineBox.y, grown) };
    return `translate(${c.x} ${c.y}) scale(${s}) translate(${-lineBox.x} ${-lineBox.y})`;
  })() : undefined;
  const tokenTextColor = fromWords && spawning && grown < 0.5 && nodeTitle.color ? nodeTitle.color : textColor;
  // Into its Thing-group's box: the connections are shown with the box, once
  // the Things have landed, and draw themselves in from there (before paint,
  // so none shows whole first).
  const tracedRef = useRef(false);
  const landed = leaving && boxMorph && spawn <= REVEAL_SHARE;
  useLayoutEffect(() => {
    if (!landed || tracedRef.current) return;
    tracedRef.current = true;
    traceEdgesIn(node.ghosts?.edgeIds);
  }, [landed, node]);
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
        {/* A mask, not a clip: it hides what hasn't grown in yet without
            hiding it from a click, so the formula takes input from its first frame. */}
        {spawning && (
          <defs>
            <mask id={clipId} maskUnits="userSpaceOnUse" x={reach.x} y={reach.y} width={reach.w} height={reach.h}>
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
          {/* Selected, it wears a selected Thing's black stroke. */}
          {boxMorph && spawning ? (
            // Running between the Thing-group's box and the formula's: drawn as it is now, not masked.
            <rect
              x={morph.x} y={morph.y} width={Math.max(0, morph.w)} height={Math.max(0, morph.h)} rx={morph.rx}
              fill={mixColor(node.color || color, color, grown)}
              stroke={selected ? 'black' : 'none'} strokeWidth={SELECTION_STROKE}
            />
          ) : (
            <GlideRect
              r={box(frame)} rx={G.nodeGroupCornerRadius}
              fill={!spawning ? color : node ? mixColor(node.color, color, grown) : mixColor(PLUS_LIGHT, color, grown * 1.5)}
              stroke={selected ? 'black' : 'none'} strokeWidth={SELECTION_STROKE}
            />
          )}
          {boxTitle && (
            <text
              x={titleAt.x} y={titleAt.y}
              fontSize={boxTitleSize} fontFamily="EmOne, sans-serif" fontWeight="bold"
              fill={onBand} textAnchor="middle" dominantBaseline="central"
              opacity={boxTitleShown}
              style={{ userSelect: 'none', pointerEvents: 'none', whiteSpace: 'pre' }}
            >
              {boxTitle.length === 1 ? boxTitle[0] : boxTitle.map((line, i) => (
                // As groupElements centres a wrapped title's lines on its middle.
                <tspan key={i} x={titleAt.x} dy={i === 0 ? -((boxTitle.length - 1) / 2) * node.title.lineHeight : node.title.lineHeight}>{line}</tspan>
              ))}
            </text>
          )}
          {obj.title && (morphingTitle ? (
            // Placed exactly each frame: a gliding title would trail the morph.
            <text
              x={titleAt.x} y={titleAt.y}
              fontSize={formulaTitleSize} fontFamily="EmOne, sans-serif" fontWeight="bold"
              fill={titleFill} textAnchor="middle" dominantBaseline="central"
              opacity={formulaTitleShown}
              style={{ userSelect: 'none', pointerEvents: 'none', whiteSpace: 'pre' }}
            >
              {titleLines ? titleLines.map((line, i) => {
                // Wrapped as the node wraps it, its lines centred on its middle.
                const lh = nodeTitle.lineHeight * (formulaTitleSize / boxTitleSize);
                return <tspan key={i} x={titleAt.x} dy={i === 0 ? -((titleLines.length - 1) / 2) * lh : lh}>{line}</tspan>;
              }) : obj.title}
            </text>
          ) : (
            <TitleText
              at={titleAt}
              fontSize={titleFont} fontFamily="EmOne, sans-serif" fontWeight="bold"
              fill={onBand} textAnchor="middle" dominantBaseline="central"
              opacity={formulaTitleShown}
              style={{ userSelect: 'none', pointerEvents: 'none', whiteSpace: 'pre' }}
            >
              {titleLetters ? titleLetters.map((l, i) => <tspan key={i} fillOpacity={l.shown}>{l.c}</tspan>) : obj.title}
            </TitleText>
          ))}
        </g>
        {morphGround
          ? <rect x={morphGround.x} y={morphGround.y} width={Math.max(0, morphGround.w)} height={Math.max(0, morphGround.h)} rx={morphGround.rx} fill={morphGround.fill} />
          : <GlideRect r={box(inner)} rx={G.innerCanvasCornerRadius} fill={ground} opacity={groundIn} />}
        {/* One list, so a token going keeps gliding from where it was. */}
        <g transform={tokenPose}>
        {[...obj.tokens.map((t, i) => (
          <Token
            key={t.key}
            t={t}
            b={obj.boxes[i]}
            o={o}
            fill={obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR}
            ground={ground}
            textColor={tokenTextColor}
            onBand={getTextColor(obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR, theme.darkMode)}
            hot={!lifted && hoverKey === t.key}
            onEnter={hoverIn(t.key)}
            onLeave={hoverOut(t.key)}
            enter={tokenIn(i)}
            // Taking over from its Thing's copy, it comes in where it stands.
            rise={!boxMorph}
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
            textColor={tokenTextColor}
            onBand={getTextColor(obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR, theme.darkMode)}
            hot={false}
            going
          />
        ))]}
        </g>
        </g>
        {/* The plus sign it grew from: its outline turning the band's color, its cross fading first. */}
        {spawning && !leaving && !node && (
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
    // Into a Thing-group's box or its Thing: what it makes way for is held
    // hidden until the formula has become it, then shown at once under it, the
    // formula going off it.
    return (
      <>
        {reveal && (!node || spawn > REVEAL_SHARE) && <style>{`${reveal}{opacity:0 !important}`}</style>}
        <g className="formula-object is-leaving" style={{ pointerEvents: 'none' }} opacity={node ? clamp01(spawn / REVEAL_SHARE) : clamp01(grown * 3)}>
          {drawing()}
          <g ref={ghostHostRef} />
        </g>
      </>
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
      <g ref={ghostHostRef} style={{ pointerEvents: 'none' }} />
    </g>
  );
}

/**
 * `draggingGroupId`: the group the canvas's drag is carrying, if any. `lift`:
 * the lifted Thing-group (groupLift.js), whose formulas only the `lifted`
 * instance draws.
 */
function FormulaObjectsLayer({ draggingGroupId = null, lift = null, lifted = false }) {
  const formulaObjects = useFormulaObjects();
  const selectedGroupId = useCanvasUIStore(s => s.selectedGroupId);
  // Selected on its own (its group), or among several (its anchor, formulaSelection).
  const selectedInstanceIds = useCanvasUIStore(s => s.selectedInstanceIds);
  const activeGraphId = useGraphStore(s => s.activeGraphId);
  const leavingAll = useSyncExternalStore(subscribeLeavingFormulas, leavingFormulasNow);
  const leaving = leavingAll.filter(l => l.obj.graphId === activeGraphId);
  const theme = useTheme();
  const objects = formulaObjects.objects.filter(obj => !!lift?.groupIds.has(obj.groupId) === lifted);
  const drawObject = (obj) => (
    <FormulaObject
      key={obj.groupId} obj={obj} theme={theme}
      selected={selectedGroupId === obj.groupId || selectedInstanceIds.has(obj.anchorId)} lifted={draggingGroupId === obj.groupId}
    />
  );
  if (lifted) return objects.length ? <g className="formula-objects-layer">{objects.map(drawObject)}</g> : null;
  if (!formulaObjects.objects.length && !leaving.length) return null;
  const hideGroups = [...formulaObjects.hiddenGroupIds].map(id => `[data-group-id=${JSON.stringify(id)}]`).join(',');
  return (
    <g className="formula-objects-layer">
      {hideGroups && <style>{`${hideGroups}{display:none}`}</style>}
      {objects.map(drawObject)}
      {leaving.map(({ obj, start, into, reveal }) => (
        <FormulaObject key={`leaving-${obj.groupId}-${start}`} obj={obj} theme={theme} leavingStart={start} into={into} reveal={reveal} />
      ))}
    </g>
  );
}

export default memo(FormulaObjectsLayer);
