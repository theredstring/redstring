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
import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useGraphStore from '../../../../store/graphStore.js';
import useCanvasUIStore from '../../../../store/canvasUIStore.js';
import { projectGraphView } from '../../../../core/openDefinitions.js';
import { useTheme } from '../../../../hooks/useTheme.js';
import { getTextColor, blendColors } from '../../../../utils/colorUtils.js';
import { NODE_DEFAULT_COLOR, PLUS_SIGN_SIZE } from '../../../../constants.js';
import { DEFAULT_LIFTED_THING_SHADOW } from '../../../../utils/colorUtils.js';
import { formulaSpawnStart, SPAWN_MS } from './formulaSpawn.js';
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

const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** How far a just-built formula is into coming in: 0 to 1, or 1 when it isn't coming in. */
function useSpawn(groupId) {
  const [start] = useState(() => (reducedMotion() ? null : formulaSpawnStart(groupId)));
  const [t, setT] = useState(() => (start === null ? 1 : clamp01((performance.now() - start) / SPAWN_MS)));
  useEffect(() => {
    if (start === null) return undefined;
    let frame = requestAnimationFrame(function step(now) {
      const next = clamp01((now - start) / SPAWN_MS);
      setT(next);
      if (next < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
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

const MORPH_MS = 340;
const smooth = (t) => t * t * (3 - 2 * t);
const REVEAL_EM = 0.6; // how far behind a pill's edge a letter takes to come fully in
const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * What a token's text looked like and how far it is through becoming what it
 * is (`p`, 0 to 1): `from` is null once it has. A change mid-way starts from
 * what it was becoming.
 */
function useTextMorph(look) {
  const key = `${look.text}\u0000${look.fill}\u0000${look.opacity}\u0000${look.pill}`;
  const [state, setState] = useState({ key, from: null, p: 1 });
  const ref = useRef({ key, look, frame: 0 });
  useEffect(() => {
    const m = ref.current;
    if (m.key === key) return undefined;
    const from = m.look;
    m.key = key;
    m.look = look;
    cancelAnimationFrame(m.frame);
    if (prefersReducedMotion()) { setState({ key, from: null, p: 1 }); return undefined; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / MORPH_MS);
      setState({ key, from: p < 1 ? from : null, p });
      if (p < 1) m.frame = requestAnimationFrame(step);
    };
    m.frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(m.frame);
    // `key` stands for `look`'s values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The render the change arrives in, before the effect: all of what it was.
  return state.key === key ? state : { key, from: ref.current.look, p: 0 };
}

const isPlain = (text) => !subscriptOf(text) && !vectorOf(text).vector;
const lettersOf = (text) => [...String(text)];

/**
 * A token's text, sliding to where it is put, and changing letter by letter
 * when it switches between its symbol and its Thing's name. What the two share
 * stays (the P of Pressure). The name's other letters are uncovered by its
 * pill: each comes in as the pill's growing edge passes it, and going back
 * each leaves as the shrinking edge reaches it, so no letter is ever outside
 * the pill or left behind it. A plain symbol coming or going fades meanwhile.
 * Its color crosses over as the pill fills in. Written another way (a
 * subscript, a vector's arrow), the two cross-fade instead.
 *
 * @param {number} [reveal] - where the pill's text currently ends (its glided
 *   right edge, less its padding), in the same space as `x`
 */
function TokenText({ text, x, y, size, fill, opacity = 1, pill = false, reveal = null }) {
  const at = useGlide({ x, y });
  const { from, p } = useTextMorph({ text, fill, opacity, pill });
  if (!from) return <TokenTextAt text={text} at={at} size={size} fill={fill} opacity={opacity} />;
  // The pill's fill and the color cross over together (useGlide's curve).
  const filled = glideEase(Math.min(1, (p * MORPH_MS) / GLIDE_MS));
  const color = from.fill === fill ? fill : mixColor(from.fill, fill, filled);
  const alpha = from.opacity + (opacity - from.opacity) * filled;
  if (!isPlain(text) || !isPlain(from.text)) {
    return (
      <>
        <TokenTextAt text={from.text} at={at} size={size} fill={color} opacity={alpha * (1 - smooth(clamp01(p * 2)))} />
        <TokenTextAt text={text} at={at} size={size} fill={color} opacity={alpha * smooth(clamp01(p * 1.6 - 0.3))} />
      </>
    );
  }
  const to = lettersOf(text);
  const was = lettersOf(from.text);
  let shared = 0;
  while (shared < to.length && shared < was.length && to[shared] === was[shared]) shared++;
  // A letter in a pill shows as far as the pill's edge has passed its own right edge.
  const fade = REVEAL_EM * size;
  const uncovered = (letters, i) => (reveal == null ? 1
    : clamp01((reveal - (at.x + measure(letters.slice(0, i + 1).join(''), size) - fade)) / fade));
  const comingIn = (i) => (pill ? uncovered(to, i) : smooth(clamp01((p - 0.1) / 0.45)));
  const goingOut = (i) => (from.pill ? uncovered(was, i) : 1 - smooth(clamp01(p / 0.4)));
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

/** A rectangle that glides to its new place and size. */
function GlideRect({ r, ...rest }) {
  const at = useGlide(r);
  return <rect x={at.x} y={at.y} width={Math.max(0, at.w)} height={Math.max(0, at.h)} {...rest} />;
}

/** A square root's sign, as tall as what it holds, its bar running over all of it. */
function GlideRoot({ r, stroke }) {
  const at = useGlide(r);
  const hook = (fx, fy) => `${at.x + at.signW * fx},${at.y + at.h * fy}`;
  return (
    <polyline
      points={`${hook(0, 0.58)} ${hook(0.22, 0.5)} ${hook(0.5, 1)} ${hook(1, 0)} ${at.x + at.w},${at.y}`}
      fill="none" stroke={stroke} strokeWidth={at.stroke} strokeLinejoin="round" strokeLinecap="round"
      style={{ pointerEvents: 'none' }}
    />
  );
}

/**
 * One token, placed by sliding: when a token near it switches between its
 * symbol and its name, it moves to its new place rather than jumping there. A
 * token written by name is its Thing: a pill in its color, grown from the
 * symbol's box.
 */
function Token({ t, b, o, fill, textColor, onBand, hot, onEnter, onLeave, enter = 1 }) {
  const defined = !!t.target && !!t.defined;
  const reach = hot ? HOVER_REACH * b.size : 0;
  const shape = useGlide(b.pill
    ? { x: b.pill.x - o.x, y: b.pill.y - o.y, w: b.pill.w, h: b.pill.h, rx: b.pill.h * PILL_RADIUS, a: 1 }
    : { x: b.x - o.x - reach, y: b.y - o.y, w: b.w + 2 * reach, h: b.h, rx: Math.min(b.h * 0.4, (b.w + 2 * reach) / 2), a: hot ? HOVER_TINT : 0 });
  return (
    <motion.g
      className={`formula-object-token${defined ? ' is-defined' : ''}${t.expanded ? ' is-expanded' : ''}`}
      data-formula-target={t.target || undefined}
      data-formula-proto={t.protoId || undefined}
      data-formula-defined={defined ? 'true' : undefined}
      data-formula-flip={defined && t.flip ? t.flip : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: FADE }}
      transition={FADE}
      onPointerEnter={defined ? onEnter : undefined}
      onPointerLeave={defined ? onLeave : undefined}
      style={defined ? undefined : { cursor: 'default' }}
    >
      <g
        opacity={enter}
        transform={enter < 1 ? `translate(0 ${(1 - enter) * 0.3 * b.size})` : undefined}
      >
      <rect
        x={shape.x} y={shape.y} width={Math.max(0, shape.w)} height={Math.max(0, shape.h)}
        rx={Math.max(0, shape.rx)} fill={fill} fillOpacity={shape.a}
      />
      {b.root ? (
        <GlideRoot r={{ ...b.root, x: b.root.x - o.x, y: b.root.y - o.y }} stroke={textColor} />
      ) : b.bar ? (
        // A division stacked as a fraction: its token is the bar.
        <GlideRect
          r={{ x: b.bar.x - o.x, y: b.bar.y - o.y, w: b.bar.w, h: b.bar.h }}
          rx={b.bar.h / 2} fill={textColor} style={{ pointerEvents: 'none' }}
        />
      ) : (
        <TokenText
          text={t.text} x={b.textX - o.x} y={b.baseline - o.y} size={b.size}
          fill={t.expanded ? onBand : textColor}
          opacity={t.kind === 'paren' && !t.expanded ? 0.75 : 1}
          pill={!!b.pill}
          reveal={shape.x + shape.w - PILL_PAD * b.size}
        />
      )}
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

function FormulaObject({ obj, theme, selected, lifted }) {
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
    setHoverKey(null);
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
  // Just built: the plus sign's morph, into this band.
  const spawn = useSpawn(obj.groupId);
  const spawning = spawn < 1;
  const grown = easeMorph(clamp01(spawn / MORPH_SHARE));
  const plusScale = useGraphStore(st => st.textSettings?.plusSignScale ?? 1);
  const plusSize = PLUS_SIGN_SIZE * plusScale;
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
  const clipId = `formula-spawn-${obj.groupId}`;
  // Lifted as a dragged Thing-group is: at once on the way up, eased back down.
  const lx = frame.x + frame.w / 2 - o.x;
  const ly = frame.y + frame.h / 2 - o.y;
  const liftStyle = {
    transform: lifted ? `translate(${lx}px, ${ly}px) scale(${LIFT_SCALE}) translate(${-lx}px, ${-ly}px)` : 'none',
    transformOrigin: '0px 0px',
    transition: lifted ? 'none' : 'transform 0.2s ease-out',
  };

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
          <AnimatePresence initial={false}>
            {obj.tokens.map((t, i) => (
              <Token
                key={t.key}
                t={t}
                b={obj.boxes[i]}
                o={o}
                fill={obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR}
                textColor={textColor}
                onBand={getTextColor(obj.protoOf.get(t.protoId)?.color || NODE_DEFAULT_COLOR, theme.darkMode)}
                hot={hoverKey === t.key}
                onEnter={hoverIn(t.key)}
                onLeave={hoverOut(t.key)}
                enter={tokenIn(i)}
              />
            ))}
          </AnimatePresence>
          </g>
          {/* The plus sign it grew from: its outline turning the band's color, its cross fading first. */}
          {spawning && (
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
    </g>
  );
}

/** `draggingGroupId`: the group the canvas's drag is carrying, if any. */
function FormulaObjectsLayer({ draggingGroupId = null }) {
  const formulaObjects = useFormulaObjects();
  const selectedGroupId = useCanvasUIStore(s => s.selectedGroupId);
  const theme = useTheme();
  if (!formulaObjects.objects.length) return null;
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
    </g>
  );
}

export default memo(FormulaObjectsLayer);
